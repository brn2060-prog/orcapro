import type { MetaConfig } from '../config.js';
import type { Campaign, CampaignStatus, Objective } from '../domain/campaign.js';
import { ProviderError } from '../domain/errors.js';
import { requestJson } from './http.js';
import type { AdProvider, PublishResult, RemoteStatus } from './types.js';

/** Objetivos "Outcome-Driven Ad Experiences" da Meta. */
const OBJECTIVE_MAP: Record<Objective, string> = {
  awareness: 'OUTCOME_AWARENESS',
  traffic: 'OUTCOME_TRAFFIC',
  engagement: 'OUTCOME_ENGAGEMENT',
  leads: 'OUTCOME_LEADS',
  app_promotion: 'OUTCOME_APP_PROMOTION',
  sales: 'OUTCOME_SALES',
  // A Meta dobrou "video views" dentro de awareness no modelo ODAX.
  video_views: 'OUTCOME_AWARENESS',
};

const STATUS_MAP: Record<CampaignStatus, string> = {
  draft: 'PAUSED',
  active: 'ACTIVE',
  paused: 'PAUSED',
  archived: 'ARCHIVED',
};

interface MetaCampaignResponse {
  id: string;
}

interface MetaReadResponse {
  id: string;
  status?: string;
  effective_status?: string;
}

export class MetaAdsProvider implements AdProvider {
  readonly platform = 'meta' as const;

  constructor(
    private readonly config: MetaConfig,
    private readonly timeoutMs: number,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.accessToken && this.config.adAccountId);
  }

  private get baseUrl(): string {
    return `https://graph.facebook.com/${this.config.apiVersion}`;
  }

  /** A Meta aceita `act_123` ou `123`; normalizamos para o prefixado. */
  private get adAccountPath(): string {
    const id = this.config.adAccountId;
    return id.startsWith('act_') ? id : `act_${id}`;
  }

  private get authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.config.accessToken}` };
  }

  async publish(campaign: Campaign): Promise<PublishResult> {
    const budgetField = campaign.budget.mode === 'daily' ? 'daily_budget' : 'lifetime_budget';

    const body: Record<string, unknown> = {
      name: campaign.name,
      objective: OBJECTIVE_MAP[campaign.objective],
      status: STATUS_MAP[campaign.status],
      // Obrigatório desde a v13; vazio = nenhuma categoria especial (crédito,
      // emprego, moradia, política). Ajuste se a campanha se enquadrar.
      special_ad_categories: [],
      // A Meta espera o orçamento em unidades menores, como string.
      [budgetField]: String(campaign.budget.amountMinor),
      buying_type: 'AUCTION',
    };

    // Orçamento lifetime na Meta exige a janela completa na campanha.
    if (campaign.budget.mode === 'lifetime') {
      body.start_time = campaign.schedule.startAt;
      if (campaign.schedule.endAt) body.stop_time = campaign.schedule.endAt;
    }

    const response = await requestJson<MetaCampaignResponse>(
      this.platform,
      `${this.baseUrl}/${this.adAccountPath}/campaigns`,
      { method: 'POST', headers: this.authHeaders, body, timeoutMs: this.timeoutMs },
    );

    if (!response?.id) {
      throw new ProviderError(this.platform, 'a Meta não devolveu o ID da campanha', response);
    }

    return { externalId: response.id, externalStatus: STATUS_MAP[campaign.status] };
  }

  async setStatus(externalId: string, status: CampaignStatus): Promise<void> {
    await requestJson(this.platform, `${this.baseUrl}/${externalId}`, {
      method: 'POST',
      headers: this.authHeaders,
      body: { status: STATUS_MAP[status] },
      timeoutMs: this.timeoutMs,
    });
  }

  async fetchStatus(externalId: string): Promise<RemoteStatus> {
    const response = await requestJson<MetaReadResponse>(
      this.platform,
      `${this.baseUrl}/${externalId}?fields=id,status,effective_status`,
      { headers: this.authHeaders, timeoutMs: this.timeoutMs },
    );
    return { externalStatus: response.effective_status ?? response.status ?? 'UNKNOWN' };
  }
}
