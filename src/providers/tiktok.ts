import type { TikTokConfig } from '../config.js';
import type { Ad, CallToAction } from '../domain/ad.js';
import { videoIdFor } from '../domain/ad.js';
import type { AdSet } from '../domain/adSet.js';
import { effectiveBudget, effectiveSchedule } from '../domain/adSet.js';
import {
  toMajorUnits,
  type Campaign,
  type CampaignStatus,
  type Gender,
  type Objective,
  type Targeting,
} from '../domain/campaign.js';
import { ProviderError } from '../domain/errors.js';
import { requestJson } from './http.js';
import type {
  AdContext,
  AdProvider,
  AdSetContext,
  PublishResult,
  RemoteStatus,
} from './types.js';

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

/** Como o grupo otimiza e pelo que é cobrado, derivado do objetivo da campanha. */
const DELIVERY_MAP: Record<Objective, { optimizationGoal: string; billingEvent: string }> = {
  awareness: { optimizationGoal: 'REACH', billingEvent: 'CPM' },
  traffic: { optimizationGoal: 'CLICK', billingEvent: 'CPC' },
  engagement: { optimizationGoal: 'ENGAGED_VIEW', billingEvent: 'CPV' },
  leads: { optimizationGoal: 'CONVERT', billingEvent: 'OCPM' },
  app_promotion: { optimizationGoal: 'INSTALL', billingEvent: 'OCPM' },
  sales: { optimizationGoal: 'CONVERT', billingEvent: 'OCPM' },
  video_views: { optimizationGoal: 'VIDEO_VIEW', billingEvent: 'CPV' },
};

const CTA_MAP: Record<CallToAction, string> = {
  learn_more: 'LEARN_MORE',
  shop_now: 'SHOP_NOW',
  sign_up: 'SIGN_UP',
  contact_us: 'CONTACT_US',
  download: 'DOWNLOAD_NOW',
  book_now: 'BOOK_NOW',
  get_quote: 'GET_QUOTE',
};

/**
 * A TikTok segmenta por faixas fechadas, não por idade mínima e máxima.
 * Devolvemos todas as faixas que a janela pedida encosta.
 */
const AGE_BUCKETS: Array<{ id: string; min: number; max: number }> = [
  { id: 'AGE_13_17', min: 13, max: 17 },
  { id: 'AGE_18_24', min: 18, max: 24 },
  { id: 'AGE_25_34', min: 25, max: 34 },
  { id: 'AGE_35_44', min: 35, max: 44 },
  { id: 'AGE_45_54', min: 45, max: 54 },
  { id: 'AGE_55_100', min: 55, max: 100 },
];

function tiktokAgeGroups(targeting: Targeting): string[] | undefined {
  const { ageMin, ageMax } = targeting;
  if (ageMin === undefined && ageMax === undefined) return undefined;

  const min = ageMin ?? 13;
  const max = ageMax ?? 100;
  const buckets = AGE_BUCKETS.filter((b) => b.max >= min && b.min <= max).map((b) => b.id);
  return buckets.length > 0 ? buckets : undefined;
}

function tiktokGender(genders: Gender[] | undefined): string {
  if (!genders || genders.length !== 1 || genders[0] === 'all') return 'GENDER_UNLIMITED';
  return genders[0] === 'male' ? 'GENDER_MALE' : 'GENDER_FEMALE';
}

/** A TikTok espera 'YYYY-MM-DD HH:MM:SS' em UTC, não ISO-8601. */
function toTikTokTime(isoDateTime: string): string {
  return new Date(isoDateTime).toISOString().slice(0, 19).replace('T', ' ');
}

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

interface AdGroupData {
  adgroup_id?: string;
}

interface RegionData {
  region_info?: Array<{ region_id?: string | number; region_code?: string }>;
}

interface ImageUploadData {
  image_id?: string;
}

interface AdCreateData {
  ad_ids?: string[];
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

  // --- grupo de anúncios ---

  /**
   * A TikTok segmenta por IDs de região próprios, não por código ISO, e o
   * grupo de anúncios não é aceito sem `location_ids`. Traduzimos os códigos
   * uma vez e guardamos — a tabela não muda durante a vida do processo.
   */
  private regionCache: Map<string, string> | undefined;

  private async resolveLocationIds(countries: string[]): Promise<string[]> {
    if (!this.regionCache) {
      const params = new URLSearchParams({ advertiser_id: this.config.advertiserId });
      const envelope = await requestJson<TikTokEnvelope<RegionData>>(
        this.platform,
        `${this.baseUrl}/tool/region/?${params.toString()}`,
        { headers: this.authHeaders, timeoutMs: this.timeoutMs },
      );

      const regions = this.unwrap(envelope)?.region_info ?? [];
      this.regionCache = new Map(
        regions
          .filter((region) => region.region_code && region.region_id !== undefined)
          .map((region) => [String(region.region_code).toUpperCase(), String(region.region_id)]),
      );
    }

    const ids: string[] = [];
    const missing: string[] = [];
    for (const country of countries) {
      const id = this.regionCache.get(country.toUpperCase());
      if (id) ids.push(id);
      else missing.push(country);
    }

    if (missing.length > 0) {
      throw new ProviderError(
        this.platform,
        `a TikTok não reconhece a região: ${missing.join(', ')}`,
      );
    }
    return ids;
  }

  async publishAdSet(adSet: AdSet, context: AdSetContext): Promise<PublishResult> {
    const { campaign, campaignExternalId } = context;
    const budget = effectiveBudget(adSet, campaign.budget);
    const schedule = effectiveSchedule(adSet, campaign.schedule);
    const { optimizationGoal, billingEvent } = DELIVERY_MAP[campaign.objective];
    const locationIds = await this.resolveLocationIds(adSet.targeting.countries);

    const body: Record<string, unknown> = {
      advertiser_id: this.config.advertiserId,
      campaign_id: campaignExternalId,
      adgroup_name: adSet.name,
      promotion_type: 'WEBSITE',
      placement_type: 'PLACEMENT_TYPE_AUTOMATIC',
      location_ids: locationIds,
      gender: tiktokGender(adSet.targeting.genders),
      // Diferente de Meta e Google, a TikTok exige orçamento no grupo mesmo
      // quando a campanha já tem um.
      budget_mode: budget.mode === 'daily' ? 'BUDGET_MODE_DAY' : 'BUDGET_MODE_TOTAL',
      budget: toMajorUnits(budget.amountMinor),
      optimization_goal: optimizationGoal,
      billing_event: billingEvent,
      bid_type: adSet.bidAmountMinor ? 'BID_TYPE_CUSTOM' : 'BID_TYPE_NO_BID',
      operation_status: OPERATION_MAP[adSet.status],
    };

    const ageGroups = tiktokAgeGroups(adSet.targeting);
    if (ageGroups) body.age_groups = ageGroups;
    if (adSet.bidAmountMinor) body.bid_price = toMajorUnits(adSet.bidAmountMinor);

    if (schedule.endAt) {
      body.schedule_type = 'SCHEDULE_START_END';
      body.schedule_start_time = toTikTokTime(schedule.startAt);
      body.schedule_end_time = toTikTokTime(schedule.endAt);
    } else {
      body.schedule_type = 'SCHEDULE_FROM_NOW';
      body.schedule_start_time = toTikTokTime(schedule.startAt);
    }

    const envelope = await requestJson<TikTokEnvelope<AdGroupData>>(
      this.platform,
      `${this.baseUrl}/adgroup/create/`,
      { method: 'POST', headers: this.authHeaders, body, timeoutMs: this.timeoutMs },
    );

    const data = this.unwrap(envelope);
    if (!data?.adgroup_id) {
      throw new ProviderError(this.platform, 'a TikTok não devolveu o ID do grupo', envelope);
    }

    return { externalId: data.adgroup_id, externalStatus: OPERATION_MAP[adSet.status] };
  }

  async setAdSetStatus(externalId: string, status: CampaignStatus): Promise<void> {
    const envelope = await requestJson<TikTokEnvelope<unknown>>(
      this.platform,
      `${this.baseUrl}/adgroup/status/update/`,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: {
          advertiser_id: this.config.advertiserId,
          adgroup_ids: [externalId],
          operation_status: OPERATION_MAP[status],
        },
        timeoutMs: this.timeoutMs,
      },
    );
    this.unwrap(envelope);
  }

  // --- anúncio ---

  /**
   * A TikTok não aceita imagem por URL direto no criativo: é preciso subir a
   * imagem para a biblioteca da conta e usar o ID que ela devolve.
   */
  private async uploadImage(imageUrl: string): Promise<string> {
    const envelope = await requestJson<TikTokEnvelope<ImageUploadData>>(
      this.platform,
      `${this.baseUrl}/file/image/ad/upload/`,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: {
          advertiser_id: this.config.advertiserId,
          upload_type: 'UPLOAD_BY_URL',
          image_url: imageUrl,
        },
        timeoutMs: this.timeoutMs,
      },
    );

    const data = this.unwrap(envelope);
    if (!data?.image_id) {
      throw new ProviderError(this.platform, 'a TikTok não devolveu o ID da imagem', envelope);
    }
    return data.image_id;
  }

  async publishAd(ad: Ad, context: AdContext): Promise<PublishResult> {
    if (!this.config.identityId) {
      throw new ProviderError(
        this.platform,
        'TIKTOK_IDENTITY_ID é obrigatório para criar anúncios na TikTok',
      );
    }

    const creative = ad.creative;
    const entry: Record<string, unknown> = {
      ad_name: ad.name,
      identity_id: this.config.identityId,
      identity_type: this.config.identityType,
      ad_text: creative.primaryText ?? creative.headlines[0],
      call_to_action: CTA_MAP[creative.callToAction],
      landing_page_url: creative.landingPageUrl,
    };

    if (creative.format === 'single_video') {
      entry.ad_format = 'SINGLE_VIDEO';
      entry.video_id = videoIdFor(creative, this.platform);
      // A capa do vídeo também vem da biblioteca de imagens.
      if (creative.imageUrl) entry.image_ids = [await this.uploadImage(creative.imageUrl)];
    } else {
      entry.ad_format = 'SINGLE_IMAGE';
      entry.image_ids = [await this.uploadImage(creative.imageUrl!)];
    }

    const envelope = await requestJson<TikTokEnvelope<AdCreateData>>(
      this.platform,
      `${this.baseUrl}/ad/create/`,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: {
          advertiser_id: this.config.advertiserId,
          adgroup_id: context.adSetExternalId,
          creatives: [entry],
        },
        timeoutMs: this.timeoutMs,
      },
    );

    const adId = this.unwrap(envelope)?.ad_ids?.[0];
    if (!adId) {
      throw new ProviderError(this.platform, 'a TikTok não devolveu o ID do anúncio', envelope);
    }

    // Como na campanha, a TikTok cria habilitado; desligamos se não for para ficar ativo.
    if (ad.status !== 'active') {
      await this.setAdStatus(adId, ad.status);
    }

    return { externalId: adId, externalStatus: OPERATION_MAP[ad.status] };
  }

  async setAdStatus(externalId: string, status: CampaignStatus): Promise<void> {
    const envelope = await requestJson<TikTokEnvelope<unknown>>(
      this.platform,
      `${this.baseUrl}/ad/status/update/`,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: {
          advertiser_id: this.config.advertiserId,
          ad_ids: [externalId],
          operation_status: OPERATION_MAP[status],
        },
        timeoutMs: this.timeoutMs,
      },
    );
    this.unwrap(envelope);
  }
}
