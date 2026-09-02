import { randomUUID } from 'node:crypto';
import type {
  Campaign,
  CampaignStatus,
  Platform,
  Publication,
} from '../domain/campaign.js';
import { findPublication } from '../domain/campaign.js';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import {
  formatZodIssues,
  mergedCampaignSchema,
  type CreateCampaignInput,
  type UpdateCampaignInput,
} from '../domain/schemas.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { CampaignRepository } from '../repository/campaignRepository.js';

export interface PublishOutcome {
  platform: Platform;
  outcome: 'published' | 'simulated' | 'skipped' | 'failed';
  externalId?: string;
  error?: string;
}

export interface PublishReport {
  campaign: Campaign;
  results: PublishOutcome[];
}

export interface ListFilter {
  status?: CampaignStatus;
  platform?: Platform;
}

export interface CampaignServiceDeps {
  repository: CampaignRepository;
  providers: ProviderRegistry;
  /** Força simulação em todas as plataformas, mesmo as configuradas. */
  dryRun: boolean;
  now?: () => Date;
  newId?: () => string;
}

export class CampaignService {
  private readonly repository: CampaignRepository;
  private readonly providers: ProviderRegistry;
  private readonly dryRun: boolean;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(deps: CampaignServiceDeps) {
    this.repository = deps.repository;
    this.providers = deps.providers;
    this.dryRun = deps.dryRun;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => randomUUID());
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  async create(input: CreateCampaignInput): Promise<Campaign> {
    const timestamp = this.timestamp();
    const campaign: Campaign = {
      id: this.newId(),
      name: input.name,
      objective: input.objective,
      status: input.status,
      budget: input.budget,
      schedule: input.schedule,
      targeting: input.targeting,
      platforms: input.platforms,
      publications: input.platforms.map((platform) => ({
        platform,
        state: 'pending',
        dryRun: false,
      })),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.save(campaign);
    return campaign;
  }

  async list(filter: ListFilter = {}): Promise<Campaign[]> {
    const all = await this.repository.list();
    return all.filter((campaign) => {
      if (filter.status && campaign.status !== filter.status) return false;
      if (filter.platform && !campaign.platforms.includes(filter.platform)) return false;
      return true;
    });
  }

  async get(id: string): Promise<Campaign> {
    const campaign = await this.repository.findById(id);
    if (!campaign) throw new NotFoundError(`campanha ${id} não encontrada`);
    return campaign;
  }

  async update(id: string, patch: UpdateCampaignInput): Promise<Campaign> {
    const current = await this.get(id);

    if (current.status === 'archived') {
      throw new ConflictError('campanha arquivada não pode ser editada');
    }

    const updated: Campaign = {
      ...current,
      ...patch,
      updatedAt: this.timestamp(),
    };

    // Um patch parcial pode quebrar uma regra que envolve campos não enviados
    // (ex.: mudar para lifetime sem que exista endAt), então revalidamos o todo.
    const merged = mergedCampaignSchema.safeParse({
      budget: updated.budget,
      schedule: updated.schedule,
      targeting: updated.targeting,
    });
    if (!merged.success) {
      throw new ValidationError(
        'a campanha ficaria inválida com essa alteração',
        formatZodIssues(merged.error),
      );
    }

    // Plataformas adicionadas entram como pendentes; as removidas saem da lista
    // local, mas o que já foi publicado nelas continua existindo na plataforma.
    if (patch.platforms) {
      updated.publications = patch.platforms.map(
        (platform) =>
          findPublication(current, platform) ?? {
            platform,
            state: 'pending' as const,
            dryRun: false,
          },
      );
    }

    await this.repository.save(updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.repository.delete(id);
    if (!deleted) throw new NotFoundError(`campanha ${id} não encontrada`);
  }

  /**
   * Cria a campanha nas plataformas escolhidas.
   *
   * Uma plataforma já publicada de verdade é pulada — republicar criaria uma
   * campanha duplicada e gastaria orçamento em dobro. Publicações simuladas
   * (dry-run) são reprocessadas normalmente.
   */
  async publish(id: string, platforms?: Platform[]): Promise<PublishReport> {
    const campaign = await this.get(id);

    if (campaign.status === 'archived') {
      throw new ConflictError('campanha arquivada não pode ser publicada');
    }

    const targets = platforms ?? campaign.platforms;
    const unknown = targets.filter((p) => !campaign.platforms.includes(p));
    if (unknown.length > 0) {
      throw new ValidationError(
        `plataforma fora da campanha: ${unknown.join(', ')}. Adicione em platforms antes de publicar.`,
      );
    }

    const results: PublishOutcome[] = [];

    for (const platform of targets) {
      const existing = findPublication(campaign, platform);
      if (existing?.state === 'published' && !existing.dryRun) {
        results.push({
          platform,
          outcome: 'skipped',
          externalId: existing.externalId ?? '',
        });
        continue;
      }

      results.push(await this.publishTo(campaign, platform));
    }

    campaign.updatedAt = this.timestamp();
    await this.repository.save(campaign);

    return { campaign, results };
  }

  /** Publica em uma plataforma e grava o resultado em `campaign.publications`. */
  private async publishTo(campaign: Campaign, platform: Platform): Promise<PublishOutcome> {
    const provider = this.providers[platform];
    const simulate = this.dryRun || !provider.isConfigured();
    const attemptedAt = this.timestamp();

    if (simulate) {
      const externalId = `dryrun-${platform}-${this.newId().slice(0, 8)}`;
      this.recordPublication(campaign, {
        platform,
        state: 'published',
        externalId,
        externalStatus: 'SIMULATED',
        publishedAt: attemptedAt,
        lastAttemptAt: attemptedAt,
        dryRun: true,
      });
      return { platform, outcome: 'simulated', externalId };
    }

    try {
      const result = await provider.publish(campaign);
      this.recordPublication(campaign, {
        platform,
        state: 'published',
        externalId: result.externalId,
        externalStatus: result.externalStatus,
        publishedAt: attemptedAt,
        lastAttemptAt: attemptedAt,
        dryRun: false,
      });
      return { platform, outcome: 'published', externalId: result.externalId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordPublication(campaign, {
        platform,
        state: 'failed',
        lastAttemptAt: attemptedAt,
        error: message,
        dryRun: false,
      });
      return { platform, outcome: 'failed', error: message };
    }
  }

  private recordPublication(campaign: Campaign, publication: Publication): void {
    const index = campaign.publications.findIndex((p) => p.platform === publication.platform);
    if (index >= 0) campaign.publications[index] = publication;
    else campaign.publications.push(publication);
  }

  /**
   * Muda o status no orcapro e propaga para as plataformas onde a campanha já
   * existe. O status local muda mesmo se alguma plataforma falhar — a falha
   * fica registrada na publicação correspondente.
   */
  async setStatus(id: string, status: CampaignStatus): Promise<PublishReport> {
    const campaign = await this.get(id);
    campaign.status = status;

    const results: PublishOutcome[] = [];

    for (const publication of campaign.publications) {
      if (publication.state !== 'published' || !publication.externalId) {
        results.push({ platform: publication.platform, outcome: 'skipped' });
        continue;
      }

      if (publication.dryRun) {
        publication.externalStatus = 'SIMULATED';
        results.push({
          platform: publication.platform,
          outcome: 'simulated',
          externalId: publication.externalId,
        });
        continue;
      }

      try {
        await this.providers[publication.platform].setStatus(publication.externalId, status);
        publication.error = undefined;
        results.push({
          platform: publication.platform,
          outcome: 'published',
          externalId: publication.externalId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publication.error = message;
        results.push({ platform: publication.platform, outcome: 'failed', error: message });
      }
    }

    campaign.updatedAt = this.timestamp();
    await this.repository.save(campaign);

    return { campaign, results };
  }

  /** Relê o status de cada plataforma e atualiza `externalStatus`. */
  async sync(id: string): Promise<Campaign> {
    const campaign = await this.get(id);

    for (const publication of campaign.publications) {
      if (publication.state !== 'published' || !publication.externalId) continue;
      if (publication.dryRun) continue;

      try {
        const remote = await this.providers[publication.platform].fetchStatus(
          publication.externalId,
        );
        publication.externalStatus = remote.externalStatus;
        publication.error = undefined;
      } catch (error) {
        publication.error = error instanceof Error ? error.message : String(error);
      }
    }

    campaign.updatedAt = this.timestamp();
    await this.repository.save(campaign);
    return campaign;
  }
}
