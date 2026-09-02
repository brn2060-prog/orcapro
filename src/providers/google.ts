import type { GoogleConfig } from '../config.js';
import type { Ad } from '../domain/ad.js';
import type { AdSet } from '../domain/adSet.js';
import type { Campaign, CampaignStatus, Objective } from '../domain/campaign.js';
import { ProviderError } from '../domain/errors.js';
import { requestJson } from './http.js';
import type {
  AdContext,
  AdProvider,
  AdSetContext,
  PublishResult,
  RemoteStatus,
} from './types.js';

/**
 * O Google Ads não tem "objetivo" no mesmo sentido que Meta/TikTok — o que
 * mais se aproxima é o canal da campanha, então é para lá que mapeamos.
 */
const CHANNEL_MAP: Record<Objective, string> = {
  awareness: 'DISPLAY',
  traffic: 'SEARCH',
  engagement: 'DISPLAY',
  leads: 'SEARCH',
  app_promotion: 'MULTI_CHANNEL',
  sales: 'SEARCH',
  video_views: 'VIDEO',
};

const STATUS_MAP: Record<CampaignStatus, string> = {
  draft: 'PAUSED',
  active: 'ENABLED',
  paused: 'PAUSED',
  archived: 'REMOVED',
};

/** O tipo do grupo de anúncios acompanha o canal da campanha. */
const AD_GROUP_TYPE_MAP: Record<string, string> = {
  SEARCH: 'SEARCH_STANDARD',
  DISPLAY: 'DISPLAY_STANDARD',
  VIDEO: 'VIDEO_RESPONSIVE',
  MULTI_CHANNEL: 'SEARCH_STANDARD',
};

/** Mínimos que o Google exige num anúncio de pesquisa responsivo. */
const RSA_MIN_HEADLINES = 3;
const RSA_MIN_DESCRIPTIONS = 2;
const RSA_MAX_HEADLINES = 15;
const RSA_MAX_DESCRIPTIONS = 4;

interface MutateResponse {
  results?: Array<{ resourceName?: string }>;
}

interface SearchResponse {
  results?: Array<{ campaign?: { status?: string } }>;
}

/** 1 unidade da moeda = 1.000.000 micros, logo 1 centavo = 10.000 micros. */
function minorUnitsToMicros(amountMinor: number): number {
  return amountMinor * 10_000;
}

/** O Google Ads usa datas locais no formato YYYY-MM-DD. */
function toAdsDate(isoDateTime: string): string {
  return new Date(isoDateTime).toISOString().slice(0, 10);
}

export class GoogleAdsProvider implements AdProvider {
  readonly platform = 'google' as const;

  constructor(
    private readonly config: GoogleConfig,
    private readonly timeoutMs: number,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.accessToken && this.config.developerToken && this.config.customerId,
    );
  }

  /** IDs de cliente vão sem hífen na URL e nos headers. */
  private get customerId(): string {
    return this.config.customerId.replace(/-/g, '');
  }

  private get baseUrl(): string {
    return `https://googleads.googleapis.com/${this.config.apiVersion}`;
  }

  private get authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.accessToken}`,
      'developer-token': this.config.developerToken,
    };
    // Necessário quando se opera uma conta de cliente a partir de um MCC.
    if (this.config.loginCustomerId) {
      headers['login-customer-id'] = this.config.loginCustomerId.replace(/-/g, '');
    }
    return headers;
  }

  /**
   * No Google Ads o orçamento é um recurso próprio: primeiro cria-se o
   * `CampaignBudget`, depois a campanha que aponta para ele.
   */
  private async createBudget(campaign: Campaign): Promise<string> {
    const budget: Record<string, unknown> = {
      // O nome do orçamento precisa ser único na conta.
      name: `${campaign.name} · ${campaign.id.slice(0, 8)}`,
      deliveryMethod: 'STANDARD',
      // Um orçamento por campanha; compartilhá-lo mudaria a semântica.
      explicitlyShared: false,
    };

    if (campaign.budget.mode === 'daily') {
      budget.amountMicros = String(minorUnitsToMicros(campaign.budget.amountMinor));
      budget.period = 'DAILY';
    } else {
      budget.totalAmountMicros = String(minorUnitsToMicros(campaign.budget.amountMinor));
      budget.period = 'CUSTOM_PERIOD';
    }

    const response = await requestJson<MutateResponse>(
      this.platform,
      `${this.baseUrl}/customers/${this.customerId}/campaignBudgets:mutate`,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: { operations: [{ create: budget }] },
        timeoutMs: this.timeoutMs,
      },
    );

    const resourceName = response.results?.[0]?.resourceName;
    if (!resourceName) {
      throw new ProviderError(this.platform, 'o Google Ads não criou o orçamento', response);
    }
    return resourceName;
  }

  async publish(campaign: Campaign): Promise<PublishResult> {
    const budgetResourceName = await this.createBudget(campaign);

    const create: Record<string, unknown> = {
      name: campaign.name,
      status: STATUS_MAP[campaign.status],
      advertisingChannelType: CHANNEL_MAP[campaign.objective],
      campaignBudget: budgetResourceName,
      startDate: toAdsDate(campaign.schedule.startAt),
      // Estratégia de lance padrão; troque conforme a conta exigir.
      manualCpc: { enhancedCpcEnabled: false },
      networkSettings: {
        targetGoogleSearch: CHANNEL_MAP[campaign.objective] === 'SEARCH',
        targetSearchNetwork: CHANNEL_MAP[campaign.objective] === 'SEARCH',
        targetContentNetwork: CHANNEL_MAP[campaign.objective] === 'DISPLAY',
        targetPartnerSearchNetwork: false,
      },
    };

    if (campaign.schedule.endAt) create.endDate = toAdsDate(campaign.schedule.endAt);

    const response = await requestJson<MutateResponse>(
      this.platform,
      `${this.baseUrl}/customers/${this.customerId}/campaigns:mutate`,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: { operations: [{ create }] },
        timeoutMs: this.timeoutMs,
      },
    );

    const resourceName = response.results?.[0]?.resourceName;
    if (!resourceName) {
      throw new ProviderError(this.platform, 'o Google Ads não criou a campanha', response);
    }

    // resourceName = "customers/{customerId}/campaigns/{campaignId}"
    return { externalId: resourceName, externalStatus: STATUS_MAP[campaign.status] };
  }

  async setStatus(externalId: string, status: CampaignStatus): Promise<void> {
    await this.mutateStatus('campaigns', externalId, status);
  }

  async fetchStatus(externalId: string): Promise<RemoteStatus> {
    const campaignId = externalId.split('/').pop() ?? externalId;
    // GAQL compara IDs como número literal, sem aspas — então o valor precisa
    // ser mesmo numérico antes de entrar na query.
    if (!/^\d+$/.test(campaignId)) {
      throw new ProviderError(
        this.platform,
        `ID de campanha inesperado do Google Ads: "${externalId}"`,
      );
    }

    const response = await requestJson<SearchResponse>(
      this.platform,
      `${this.baseUrl}/customers/${this.customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: {
          query: `SELECT campaign.status FROM campaign WHERE campaign.id = ${campaignId}`,
        },
        timeoutMs: this.timeoutMs,
      },
    );
    return { externalStatus: response.results?.[0]?.campaign?.status ?? 'UNKNOWN' };
  }

  // --- grupo de anúncios ---

  async publishAdSet(adSet: AdSet, context: AdSetContext): Promise<PublishResult> {
    const channel = CHANNEL_MAP[context.campaign.objective];

    const create: Record<string, unknown> = {
      name: adSet.name,
      campaign: context.campaignExternalId,
      status: STATUS_MAP[adSet.status],
      type: AD_GROUP_TYPE_MAP[channel] ?? 'SEARCH_STANDARD',
    };

    if (adSet.bidAmountMinor) {
      create.cpcBidMicros = String(minorUnitsToMicros(adSet.bidAmountMinor));
    }

    const response = await requestJson<MutateResponse>(
      this.platform,
      `${this.baseUrl}/customers/${this.customerId}/adGroups:mutate`,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: { operations: [{ create }] },
        timeoutMs: this.timeoutMs,
      },
    );

    const resourceName = response.results?.[0]?.resourceName;
    if (!resourceName) {
      throw new ProviderError(this.platform, 'o Google Ads não criou o grupo de anúncios', response);
    }

    return { externalId: resourceName, externalStatus: STATUS_MAP[adSet.status] };
  }

  async setAdSetStatus(externalId: string, status: CampaignStatus): Promise<void> {
    await this.mutateStatus('adGroups', externalId, status);
  }

  // --- anúncio ---

  async publishAd(ad: Ad, context: AdContext): Promise<PublishResult> {
    const { headlines, descriptions, landingPageUrl } = ad.creative;

    // O Google recusa a criação abaixo desses mínimos; falhar aqui dá uma
    // mensagem útil em vez de um erro cru da API.
    if (headlines.length < RSA_MIN_HEADLINES) {
      throw new ProviderError(
        this.platform,
        `o Google Ads exige ao menos ${RSA_MIN_HEADLINES} títulos no anúncio responsivo; este tem ${headlines.length}`,
      );
    }
    if (descriptions.length < RSA_MIN_DESCRIPTIONS) {
      throw new ProviderError(
        this.platform,
        `o Google Ads exige ao menos ${RSA_MIN_DESCRIPTIONS} descrições no anúncio responsivo; este tem ${descriptions.length}`,
      );
    }

    const response = await requestJson<MutateResponse>(
      this.platform,
      `${this.baseUrl}/customers/${this.customerId}/adGroupAds:mutate`,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: {
          operations: [
            {
              create: {
                adGroup: context.adSetExternalId,
                status: STATUS_MAP[ad.status],
                ad: {
                  name: ad.name,
                  finalUrls: [landingPageUrl],
                  // O Google monta o anúncio a partir do texto; a mídia do
                  // criativo não se aplica ao formato responsivo de pesquisa.
                  responsiveSearchAd: {
                    headlines: headlines
                      .slice(0, RSA_MAX_HEADLINES)
                      .map((text) => ({ text })),
                    descriptions: descriptions
                      .slice(0, RSA_MAX_DESCRIPTIONS)
                      .map((text) => ({ text })),
                  },
                },
              },
            },
          ],
        },
        timeoutMs: this.timeoutMs,
      },
    );

    const resourceName = response.results?.[0]?.resourceName;
    if (!resourceName) {
      throw new ProviderError(this.platform, 'o Google Ads não criou o anúncio', response);
    }

    return { externalId: resourceName, externalStatus: STATUS_MAP[ad.status] };
  }

  async setAdStatus(externalId: string, status: CampaignStatus): Promise<void> {
    await this.mutateStatus('adGroupAds', externalId, status);
  }

  /** Todos os recursos do Google Ads mudam de status pelo mesmo formato de mutate. */
  private async mutateStatus(
    resource: 'campaigns' | 'adGroups' | 'adGroupAds',
    externalId: string,
    status: CampaignStatus,
  ): Promise<void> {
    await requestJson(
      this.platform,
      `${this.baseUrl}/customers/${this.customerId}/${resource}:mutate`,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: {
          operations: [
            {
              update: { resourceName: externalId, status: STATUS_MAP[status] },
              updateMask: 'status',
            },
          ],
        },
        timeoutMs: this.timeoutMs,
      },
    );
  }
}
