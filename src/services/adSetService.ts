import { randomUUID } from 'node:crypto';
import type { AdSet } from '../domain/adSet.js';
import type { CampaignStatus, Platform } from '../domain/campaign.js';
import { findPublication } from '../domain/campaign.js';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import {
  formatZodIssues,
  mergedCampaignSchema,
  type CreateAdSetInput,
  type UpdateAdSetInput,
} from '../domain/schemas.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { AdSetRepository } from '../repository/campaignRepository.js';
import type { CampaignService } from './campaignService.js';
import {
  findPublicationOf,
  recordBlocked,
  runPublish,
  runStatusChange,
  type PublishOutcome,
} from './publishing.js';

export interface AdSetReport {
  adSet: AdSet;
  results: PublishOutcome[];
}

export interface AdSetServiceDeps {
  repository: AdSetRepository;
  campaigns: CampaignService;
  providers: ProviderRegistry;
  dryRun: boolean;
  now?: () => Date;
  newId?: () => string;
}

export class AdSetService {
  private readonly repository: AdSetRepository;
  private readonly campaigns: CampaignService;
  private readonly providers: ProviderRegistry;
  private readonly dryRun: boolean;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(deps: AdSetServiceDeps) {
    this.repository = deps.repository;
    this.campaigns = deps.campaigns;
    this.providers = deps.providers;
    this.dryRun = deps.dryRun;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => randomUUID());
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  async create(campaignId: string, input: CreateAdSetInput): Promise<AdSet> {
    // Falha aqui se a campanha não existe.
    const campaign = await this.campaigns.get(campaignId);

    const timestamp = this.timestamp();
    const adSet: AdSet = {
      id: this.newId(),
      campaignId,
      name: input.name,
      status: input.status,
      budget: input.budget,
      schedule: input.schedule,
      targeting: input.targeting,
      bidAmountMinor: input.bidAmountMinor,
      // Um conjunto existe nas mesmas plataformas que a campanha.
      publications: campaign.platforms.map((platform) => ({
        platform,
        state: 'pending' as const,
        dryRun: false,
      })),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.save(adSet);
    return adSet;
  }

  /** Na ordem em que foram criados — é como a pessoa escreveu a campanha. */
  async listByCampaign(campaignId: string): Promise<AdSet[]> {
    const all = await this.repository.list();
    return all
      .filter((adSet) => adSet.campaignId === campaignId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<AdSet> {
    const adSet = await this.repository.findById(id);
    if (!adSet) throw new NotFoundError(`conjunto ${id} não encontrado`);
    return adSet;
  }

  async update(id: string, patch: UpdateAdSetInput): Promise<AdSet> {
    const current = await this.get(id);
    if (current.status === 'archived') {
      throw new ConflictError('conjunto arquivado não pode ser editado');
    }

    const updated: AdSet = { ...current, ...patch, updatedAt: this.timestamp() };

    // O conjunto pode não ter orçamento nem janela próprios (herda da
    // campanha); só revalidamos as regras cruzadas quando ele tem os dois.
    if (updated.budget && updated.schedule) {
      const merged = mergedCampaignSchema.safeParse({
        budget: updated.budget,
        schedule: updated.schedule,
        targeting: updated.targeting,
      });
      if (!merged.success) {
        throw new ValidationError(
          'o conjunto ficaria inválido com essa alteração',
          formatZodIssues(merged.error),
        );
      }
    }

    await this.repository.save(updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.repository.delete(id);
    if (!deleted) throw new NotFoundError(`conjunto ${id} não encontrado`);
  }

  /**
   * Publica o conjunto nas plataformas onde a campanha já existe.
   *
   * Um conjunto só pode ser criado dentro de uma campanha que já tem ID na
   * plataforma — publicar antes disso é `blocked`, com a razão registrada.
   * Se a campanha foi simulada naquela plataforma, o conjunto também é
   * simulado: não dá para pendurar um conjunto real numa campanha que não existe.
   */
  async publish(id: string, platforms?: Platform[]): Promise<AdSetReport> {
    const adSet = await this.get(id);
    const campaign = await this.campaigns.get(adSet.campaignId);

    if (adSet.status === 'archived') {
      throw new ConflictError('conjunto arquivado não pode ser publicado');
    }

    const known = adSet.publications.map((p) => p.platform);
    const targets = platforms ?? known;
    const unknown = targets.filter((p) => !known.includes(p));
    if (unknown.length > 0) {
      throw new ValidationError(
        `plataforma fora da campanha do conjunto: ${unknown.join(', ')}`,
      );
    }

    const results: PublishOutcome[] = [];

    for (const platform of targets) {
      const existing = findPublicationOf(adSet, platform);
      if (existing?.state === 'published' && !existing.dryRun) {
        results.push({ platform, outcome: 'skipped', externalId: existing.externalId ?? '' });
        continue;
      }

      const parent = findPublication(campaign, platform);
      const timestamp = this.timestamp();

      if (parent?.state !== 'published' || !parent.externalId) {
        results.push(
          recordBlocked(
            adSet,
            platform,
            `a campanha ainda não foi publicada em ${platform}`,
            timestamp,
          ),
        );
        continue;
      }

      const provider = this.providers[platform];
      results.push(
        await runPublish({
          platform,
          provider,
          // Campanha simulada => conjunto simulado, obrigatoriamente.
          dryRun: this.dryRun || parent.dryRun,
          target: adSet,
          timestamp,
          newId: this.newId,
          publish: () =>
            provider.publishAdSet(adSet, {
              campaign,
              campaignExternalId: parent.externalId!,
            }),
        }),
      );
    }

    adSet.updatedAt = this.timestamp();
    await this.repository.save(adSet);

    return { adSet, results };
  }

  async setStatus(id: string, status: CampaignStatus): Promise<AdSetReport> {
    const adSet = await this.get(id);
    adSet.status = status;

    const results: PublishOutcome[] = [];
    for (const publication of adSet.publications) {
      results.push(
        await runStatusChange({
          publication,
          apply: (externalId) =>
            this.providers[publication.platform].setAdSetStatus(externalId, status),
        }),
      );
    }

    adSet.updatedAt = this.timestamp();
    await this.repository.save(adSet);

    return { adSet, results };
  }
}
