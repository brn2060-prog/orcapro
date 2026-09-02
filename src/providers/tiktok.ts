import type { TikTokConfig } from '../config.js';
import { toMajorUnits, type Campaign, type CampaignStatus, type Objective } from '../domain/campaign.js';
import { ProviderError } from '../domain/errors.js';
import { requestJson } from './http.js';
import type { AdProvider, PublishResult, RemoteStatus } from './types.js';

const OBJECTIVE_MAP: Record<Objective, string> = {
  awareness: 'REACH',
  traffic: 'TRAFFIC',
  engagement: 'ENGAGEMENT',
  leads: 'LEAD_GENERATION',
  app_promotion: 'APP_PROMOTION',
  sales: 'PRODUCT_SALES',
  video_views: 'VIDEO_VIEWS',
};

/** Operações aceitas por `/campaign/status/update/`. */
const OPERATION_MAP: Record<CampaignStatus, string> = {
  draft: 'DISABLE',
  active: 'ENABLE',
  paused: 'DISABLE',
  archived: 'DELETE',
};

/** A TikTok devolve `code: 0` em sucesso e um código != 0 em erro, sempre com HTTP 200. */
interface TikTokEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

interface CreateData {
  campaign_id?: string;
}

interface ListData {
  list?: Array<{ campaign_id?: string; operation_status?: string; secondary_status?: string }>;
}

export class TikTokAdsProvider implements AdProvider {
  readonly platform = 'tiktok' as const;

  constructor(
    private readonly config: TikTokConfig,
    private readonly timeoutMs: number,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.accessToken && this.config.advertiserId);
  }

  private get baseUrl(): string {
    return `https://business-api.tiktok.com/open_api/${this.config.apiVersion}`;
  }

  private get authHeaders(): Record<string, string> {
    return { 'Access-Token': this.config.accessToken };
  }

  /**
   * A TikTok responde HTTP 200 mesmo em erro de negócio — o que vale é o
   * `code` do envelope. Sem esta checagem, uma falha passaria por sucesso.
   */
  private unwrap<T>(envelope: TikTokEnvelope<T>): T {
    if (envelope?.code !== 0) {
      throw new ProviderError(
        this.platform,
        `TikTok Ads recusou a requisição (code ${envelope?.code}): ${envelope?.message ?? 'sem mensagem'}`,
        envelope,
      );
    }
    return envelope.data as T;
  }

  async publish(campaign: Campaign): Promise<PublishResult> {
    const body: Record<string, unknown> = {
      advertiser_id: this.config.advertiserId,
      campaign_name: campaign.name,
      objective_type: OBJECTIVE_MAP[campaign.objective],
      budget_mode: campaign.budget.mode === 'daily' ? 'BUDGET_MODE_DAY' : 'BUDGET_MODE_TOTAL',
      // Diferente de Meta e Google, a TikTok espera a unidade principal da moeda.
      budget: toMajorUnits(campaign.budget.amountMinor),
    };

    const envelope = await requestJson<TikTokEnvelope<CreateData>>(
      this.platform,
      `${this.baseUrl}/campaign/create/`,
      { method: 'POST', headers: this.authHeaders, body, timeoutMs: this.timeoutMs },
    );

    const data = this.unwrap(envelope);
    if (!data?.campaign_id) {
      throw new ProviderError(this.platform, 'a TikTok não devolveu o ID da campanha', envelope);
    }

    // A TikTok cria a campanha habilitada; se o orcapro não quer ela ativa,
    // desligamos logo em seguida para não gastar orçamento sem querer.
    if (campaign.status !== 'active') {
      await this.setStatus(data.campaign_id, campaign.status);
    }

    return {
      externalId: data.campaign_id,
      externalStatus: OPERATION_MAP[campaign.status] === 'ENABLE' ? 'ENABLE' : 'DISABLE',
    };
  }

  async setStatus(externalId: string, status: CampaignStatus): Promise<void> {
    const envelope = await requestJson<TikTokEnvelope<unknown>>(
      this.platform,
      `${this.baseUrl}/campaign/status/update/`,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: {
          advertiser_id: this.config.advertiserId,
          campaign_ids: [externalId],
          operation_status: OPERATION_MAP[status],
        },
        timeoutMs: this.timeoutMs,
      },
    );
    this.unwrap(envelope);
  }

  async fetchStatus(externalId: string): Promise<RemoteStatus> {
    const params = new URLSearchParams({
      advertiser_id: this.config.advertiserId,
      filtering: JSON.stringify({ campaign_ids: [externalId] }),
    });

    const envelope = await requestJson<TikTokEnvelope<ListData>>(
      this.platform,
      `${this.baseUrl}/campaign/get/?${params.toString()}`,
      { headers: this.authHeaders, timeoutMs: this.timeoutMs },
    );

    const entry = this.unwrap(envelope)?.list?.[0];
    return {
      externalStatus: entry?.secondary_status ?? entry?.operation_status ?? 'UNKNOWN',
    };
  }
}
