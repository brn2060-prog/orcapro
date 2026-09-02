import type { MetaConfig } from '../config.js';
import type { Ad, CallToAction } from '../domain/ad.js';
import { videoIdFor } from '../domain/ad.js';
import type { AdSet } from '../domain/adSet.js';
import { effectiveBudget, effectiveSchedule } from '../domain/adSet.js';
import type { Campaign, CampaignStatus, Gender, Objective } from '../domain/campaign.js';
import { ProviderError } from '../domain/errors.js';
import { requestJson } from './http.js';
import type {
  AdContext,
  AdProvider,
  AdSetContext,
  PublishResult,
  RemoteStatus,
} from './types.js';

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

/**
 * Como a Meta deve otimizar a entrega e pelo que ela cobra. Deriva do
 * objetivo da campanha — a Meta recusa combinações incoerentes.
 */
const DELIVERY_MAP: Record<Objective, { optimizationGoal: string; billingEvent: string }> = {
  awareness: { optimizationGoal: 'REACH', billingEvent: 'IMPRESSIONS' },
  traffic: { optimizationGoal: 'LINK_CLICKS', billingEvent: 'IMPRESSIONS' },
  engagement: { optimizationGoal: 'POST_ENGAGEMENT', billingEvent: 'IMPRESSIONS' },
  leads: { optimizationGoal: 'LEAD_GENERATION', billingEvent: 'IMPRESSIONS' },
  app_promotion: { optimizationGoal: 'APP_INSTALLS', billingEvent: 'IMPRESSIONS' },
  sales: { optimizationGoal: 'OFFSITE_CONVERSIONS', billingEvent: 'IMPRESSIONS' },
  video_views: { optimizationGoal: 'THRUPLAY', billingEvent: 'IMPRESSIONS' },
};

const CTA_MAP: Record<CallToAction, string> = {
  learn_more: 'LEARN_MORE',
  shop_now: 'SHOP_NOW',
  sign_up: 'SIGN_UP',
  contact_us: 'CONTACT_US',
  download: 'DOWNLOAD',
  book_now: 'BOOK_TRAVEL',
  get_quote: 'GET_QUOTE',
};

/** A Meta codifica gênero como 1 = masculino, 2 = feminino. */
function metaGenders(genders: Gender[] | undefined): number[] | undefined {
  if (!genders || genders.length === 0 || genders.includes('all')) return undefined;
  const codes = genders.map((gender) => (gender === 'male' ? 1 : 2));
  return [...new Set(codes)];
}

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

  // --- conjunto de anúncios ---

  async publishAdSet(adSet: AdSet, context: AdSetContext): Promise<PublishResult> {
    const { campaign, campaignExternalId } = context;
    const schedule = effectiveSchedule(adSet, campaign.schedule);
    const { optimizationGoal, billingEvent } = DELIVERY_MAP[campaign.objective];

    const body: Record<string, unknown> = {
      name: adSet.name,
      campaign_id: campaignExternalId,
      status: STATUS_MAP[adSet.status],
      optimization_goal: optimizationGoal,
      billing_event: billingEvent,
      targeting: {
        geo_locations: { countries: adSet.targeting.countries },
        ...(adSet.targeting.ageMin ? { age_min: adSet.targeting.ageMin } : {}),
        ...(adSet.targeting.ageMax ? { age_max: adSet.targeting.ageMax } : {}),
        ...(metaGenders(adSet.targeting.genders)
          ? { genders: metaGenders(adSet.targeting.genders) }
          : {}),
      },
      start_time: schedule.startAt,
    };

    if (schedule.endAt) body.end_time = schedule.endAt;
    if (adSet.bidAmountMinor) body.bid_amount = String(adSet.bidAmountMinor);

    // Sem orçamento próprio o conjunto usa o da campanha (CBO) — nesse caso a
    // Meta recusa receber um campo de orçamento aqui.
    if (adSet.budget) {
      const budget = effectiveBudget(adSet, campaign.budget);
      const field = budget.mode === 'daily' ? 'daily_budget' : 'lifetime_budget';
      body[field] = String(budget.amountMinor);
    }

    const response = await requestJson<MetaCampaignResponse>(
      this.platform,
      `${this.baseUrl}/${this.adAccountPath}/adsets`,
      { method: 'POST', headers: this.authHeaders, body, timeoutMs: this.timeoutMs },
    );

    if (!response?.id) {
      throw new ProviderError(this.platform, 'a Meta não devolveu o ID do conjunto', response);
    }

    return { externalId: response.id, externalStatus: STATUS_MAP[adSet.status] };
  }

  async setAdSetStatus(externalId: string, status: CampaignStatus): Promise<void> {
    // Campanha, conjunto e anúncio são todos nós do grafo: mesma chamada.
    await this.setStatus(externalId, status);
  }

  // --- anúncio ---

  /**
   * Na Meta o anúncio e o criativo são recursos separados: primeiro cria-se o
   * AdCreative, depois o Ad que aponta para ele.
   */
  private async createCreative(ad: Ad): Promise<string> {
    if (!this.config.pageId) {
      throw new ProviderError(
        this.platform,
        'META_PAGE_ID é obrigatório para criar criativos na Meta',
      );
    }

    const creative = ad.creative;
    const callToAction = {
      type: CTA_MAP[creative.callToAction],
      value: { link: creative.landingPageUrl },
    };

    const storySpec: Record<string, unknown> = { page_id: this.config.pageId };
    if (this.config.instagramActorId) {
      storySpec.instagram_actor_id = this.config.instagramActorId;
    }

    if (creative.format === 'single_video') {
      storySpec.video_data = {
        video_id: videoIdFor(creative, this.platform),
        title: creative.headlines[0],
        message: creative.primaryText ?? creative.descriptions[0],
        link_description: creative.descriptions[0],
        call_to_action: callToAction,
        // A Meta exige uma thumbnail para o vídeo.
        ...(creative.imageUrl ? { image_url: creative.imageUrl } : {}),
      };
    } else {
      storySpec.link_data = {
        link: creative.landingPageUrl,
        name: creative.headlines[0],
        description: creative.descriptions[0],
        message: creative.primaryText ?? creative.headlines[0],
        picture: creative.imageUrl,
        call_to_action: callToAction,
      };
    }

    const response = await requestJson<MetaCampaignResponse>(
      this.platform,
      `${this.baseUrl}/${this.adAccountPath}/adcreatives`,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: { name: `${ad.name} — criativo`, object_story_spec: storySpec },
        timeoutMs: this.timeoutMs,
      },
    );

    if (!response?.id) {
      throw new ProviderError(this.platform, 'a Meta não devolveu o ID do criativo', response);
    }
    return response.id;
  }

  async publishAd(ad: Ad, context: AdContext): Promise<PublishResult> {
    const creativeId = await this.createCreative(ad);

    const response = await requestJson<MetaCampaignResponse>(
      this.platform,
      `${this.baseUrl}/${this.adAccountPath}/ads`,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: {
          name: ad.name,
          adset_id: context.adSetExternalId,
          creative: { creative_id: creativeId },
          status: STATUS_MAP[ad.status],
        },
        timeoutMs: this.timeoutMs,
      },
    );

    if (!response?.id) {
      throw new ProviderError(this.platform, 'a Meta não devolveu o ID do anúncio', response);
    }

    return { externalId: response.id, externalStatus: STATUS_MAP[ad.status] };
  }

  async setAdStatus(externalId: string, status: CampaignStatus): Promise<void> {
    await this.setStatus(externalId, status);
  }
}
