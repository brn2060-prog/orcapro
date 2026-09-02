import { randomUUID } from 'node:crypto';
import type { Ad } from '../domain/ad.js';
import { videoIdFor } from '../domain/ad.js';
import type { CampaignStatus, Platform } from '../domain/campaign.js';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import type { CreateAdInput, UpdateAdInput } from '../domain/schemas.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { AdRepository } from '../repository/campaignRepository.js';
import type { AdSetService } from './adSetService.js';
import type { CampaignService } from './campaignService.js';
import {
  findPublicationOf,
  recordBlocked,
  runPublish,
  runStatusChange,
  type PublishOutcome,
} from './publishing.js';

export interface AdReport {
  ad: Ad;
  results: PublishOutcome[];
}

export interface AdServiceDeps {
  repository: AdRepository;
  adSets: AdSetService;
  campaigns: CampaignService;
  providers: ProviderRegistry;
  dryRun: boolean;
  now?: () => Date;
  newId?: () => string;
}

export class AdService {
  private readonly repository: AdRepository;
  private readonly adSets: AdSetService;
  private readonly campaigns: CampaignService;
  private readonly providers: ProviderRegistry;
  private readonly dryRun: boolean;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(deps: AdServiceDeps) {
    this.repository = deps.repository;
    this.adSets = deps.adSets;
    this.campaigns = deps.campaigns;
    this.providers = deps.providers;
    this.dryRun = deps.dryRun;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => randomUUID());
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  async create(adSetId: string, input: CreateAdInput): Promise<Ad> {
    // Falha aqui se o conjunto não existe.
    const adSet = await this.adSets.get(adSetId);

    const timestamp = this.timestamp();
    const ad: Ad = {
      id: this.newId(),
      adSetId,
      name: input.name,
      status: input.status,
      creative: input.creative,
      publications: adSet.publications.map((publication) => ({
        platform: publication.platform,
        state: 'pending' as const,
        dryRun: false,
      })),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.save(ad);
    return ad;
  }

  /** Na ordem em que foram criados — é como a pessoa escreveu a campanha. */
  async listByAdSet(adSetId: string): Promise<Ad[]> {
    const all = await this.repository.list();
    return all
      .filter((ad) => ad.adSetId === adSetId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<Ad> {
    const ad = await this.repository.findById(id);
    if (!ad) throw new NotFoundError(`anúncio ${id} não encontrado`);
    return ad;
  }

  async update(id: string, patch: UpdateAdInput): Promise<Ad> {
    const current = await this.get(id);
    if (current.status === 'archived') {
      throw new ConflictError('anúncio arquivado não pode ser editado');
    }

    const updated: Ad = { ...current, ...patch, updatedAt: this.timestamp() };
    await this.repository.save(updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.repository.delete(id);
    if (!deleted) throw new NotFoundError(`anúncio ${id} não encontrado`);
  }

  /**
   * Publica o anúncio nas plataformas onde o conjunto já existe.
   *
   * Mesma regra do conjunto, um nível abaixo: sem conjunto publicado a
   * plataforma fica `blocked`, e conjunto simulado força anúncio simulado.
   */
  async publish(id: string, platforms?: Platform[]): Promise<AdReport> {
    const ad = await this.get(id);
    const adSet = await this.adSets.get(ad.adSetId);
    const campaign = await this.campaigns.get(adSet.campaignId);

    if (ad.status === 'archived') {
      throw new ConflictError('anúncio arquivado não pode ser publicado');
    }

    const known = ad.publications.map((p) => p.platform);
    const targets = platforms ?? known;
    const unknown = targets.filter((p) => !known.includes(p));
    if (unknown.length > 0) {
      throw new ValidationError(`plataforma fora do conjunto do anúncio: ${unknown.join(', ')}`);
    }

    const results: PublishOutcome[] = [];

    for (const platform of targets) {
      const existing = findPublicationOf(ad, platform);
      if (existing?.state === 'published' && !existing.dryRun) {
        results.push({ platform, outcome: 'skipped', externalId: existing.externalId ?? '' });
        continue;
      }

      const timestamp = this.timestamp();

      // Vídeo tem um ID por plataforma; sem ele não há o que publicar aqui.
      if (ad.creative.format === 'single_video' && !videoIdFor(ad.creative, platform)) {
        results.push(
          recordBlocked(
            ad,
            platform,
            `falta o ID do vídeo para ${platform} em creative.videoIds`,
            timestamp,
          ),
        );
        continue;
      }

      const parent = findPublicationOf(adSet, platform);
      if (parent?.state !== 'published' || !parent.externalId) {
        results.push(
          recordBlocked(
            ad,
            platform,
            `o conjunto ainda não foi publicado em ${platform}`,
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
          // Conjunto simulado => anúncio simulado, obrigatoriamente.
          dryRun: this.dryRun || parent.dryRun,
          target: ad,
          timestamp,
          newId: this.newId,
          publish: () =>
            provider.publishAd(ad, {
              campaign,
              adSet,
              adSetExternalId: parent.externalId!,
            }),
        }),
      );
    }

    ad.updatedAt = this.timestamp();
    await this.repository.save(ad);

    return { ad, results };
  }

  async setStatus(id: string, status: CampaignStatus): Promise<AdReport> {
    const ad = await this.get(id);
    ad.status = status;

    const results: PublishOutcome[] = [];
    for (const publication of ad.publications) {
      results.push(
        await runStatusChange({
          publication,
          apply: (externalId) =>
            this.providers[publication.platform].setAdStatus(externalId, status),
        }),
      );
    }

    ad.updatedAt = this.timestamp();
    await this.repository.save(ad);

    return { ad, results };
  }
}
