import type { Ad } from '../src/domain/ad.js';
import type { AdSet } from '../src/domain/adSet.js';
import type { Campaign, CampaignStatus, Platform } from '../src/domain/campaign.js';
import type {
  CreateAdInput,
  CreateAdSetInput,
  CreateCampaignInput,
} from '../src/domain/schemas.js';
import type { ProviderRegistry } from '../src/providers/registry.js';
import type {
  AdContext,
  AdProvider,
  AdSetContext,
  PublishResult,
  RemoteStatus,
} from '../src/providers/types.js';
import {
  InMemoryAdRepository,
  InMemoryAdSetRepository,
  InMemoryCampaignRepository,
} from '../src/repository/campaignRepository.js';
import { AdService } from '../src/services/adService.js';
import { AdSetService } from '../src/services/adSetService.js';
import { CampaignService } from '../src/services/campaignService.js';
import { DeployService } from '../src/services/deployService.js';

export interface FakeProviderOptions {
  configured?: boolean;
  failOnPublish?: string;
  failOnStatus?: string;
  failOnAdSet?: string;
  failOnAd?: string;
  remoteStatus?: string;
}

/** Provider de mentira: registra as chamadas e falha sob demanda. */
export class FakeProvider implements AdProvider {
  publishCalls: Campaign[] = [];
  statusCalls: Array<{ externalId: string; status: CampaignStatus }> = [];
  fetchCalls: string[] = [];
  adSetCalls: Array<{ adSet: AdSet; context: AdSetContext }> = [];
  adSetStatusCalls: Array<{ externalId: string; status: CampaignStatus }> = [];
  adCalls: Array<{ ad: Ad; context: AdContext }> = [];
  adStatusCalls: Array<{ externalId: string; status: CampaignStatus }> = [];
  private counter = 0;

  constructor(
    readonly platform: Platform,
    private readonly options: FakeProviderOptions = {},
  ) {}

  isConfigured(): boolean {
    return this.options.configured ?? true;
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.platform}-${this.counter}`;
  }

  async publish(campaign: Campaign): Promise<PublishResult> {
    this.publishCalls.push(campaign);
    if (this.options.failOnPublish) throw new Error(this.options.failOnPublish);
    return { externalId: `${this.platform}-1`, externalStatus: 'ACTIVE' };
  }

  async setStatus(externalId: string, status: CampaignStatus): Promise<void> {
    this.statusCalls.push({ externalId, status });
    if (this.options.failOnStatus) throw new Error(this.options.failOnStatus);
  }

  async fetchStatus(externalId: string): Promise<RemoteStatus> {
    this.fetchCalls.push(externalId);
    return { externalStatus: this.options.remoteStatus ?? 'ACTIVE' };
  }

  async publishAdSet(adSet: AdSet, context: AdSetContext): Promise<PublishResult> {
    this.adSetCalls.push({ adSet, context });
    if (this.options.failOnAdSet) throw new Error(this.options.failOnAdSet);
    return { externalId: this.nextId('adset'), externalStatus: 'ACTIVE' };
  }

  async setAdSetStatus(externalId: string, status: CampaignStatus): Promise<void> {
    this.adSetStatusCalls.push({ externalId, status });
    if (this.options.failOnStatus) throw new Error(this.options.failOnStatus);
  }

  async publishAd(ad: Ad, context: AdContext): Promise<PublishResult> {
    this.adCalls.push({ ad, context });
    if (this.options.failOnAd) throw new Error(this.options.failOnAd);
    return { externalId: this.nextId('ad'), externalStatus: 'ACTIVE' };
  }

  async setAdStatus(externalId: string, status: CampaignStatus): Promise<void> {
    this.adStatusCalls.push({ externalId, status });
    if (this.options.failOnStatus) throw new Error(this.options.failOnStatus);
  }
}

export function fakeRegistry(
  overrides: Partial<Record<Platform, FakeProviderOptions>> = {},
): ProviderRegistry & Record<Platform, FakeProvider> {
  return {
    meta: new FakeProvider('meta', overrides.meta),
    google: new FakeProvider('google', overrides.google),
    tiktok: new FakeProvider('tiktok', overrides.tiktok),
  };
}

export function campaignInput(patch: Partial<CreateCampaignInput> = {}): CreateCampaignInput {
  return {
    name: 'Campanha de teste',
    objective: 'traffic',
    status: 'draft',
    budget: { mode: 'daily', amountMinor: 5000, currency: 'BRL' },
    schedule: { startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-01-31T00:00:00.000Z' },
    targeting: { countries: ['BR'] },
    platforms: ['meta', 'google', 'tiktok'],
    ...patch,
  } as CreateCampaignInput;
}

export function adSetInput(patch: Partial<CreateAdSetInput> = {}): CreateAdSetInput {
  return {
    name: 'Conjunto de teste',
    status: 'draft',
    targeting: { countries: ['BR'], ageMin: 25, ageMax: 44 },
    ...patch,
  } as CreateAdSetInput;
}

export function adInput(patch: Partial<CreateAdInput> = {}): CreateAdInput {
  return {
    name: 'Anúncio de teste',
    status: 'draft',
    creative: {
      format: 'single_image',
      headlines: ['Título um', 'Título dois', 'Título três'],
      descriptions: ['Descrição um', 'Descrição dois'],
      primaryText: 'Texto principal do anúncio',
      landingPageUrl: 'https://exemplo.com.br/orcamento',
      callToAction: 'get_quote',
      imageUrl: 'https://exemplo.com.br/banner.jpg',
    },
    ...patch,
  } as CreateAdInput;
}

/**
 * Monta o grafo de serviços inteiro sobre repositórios em memória.
 *
 * IDs e relógio são determinísticos; o relógio avança um segundo por leitura
 * para que a ordenação por `createdAt` seja estável entre entidades.
 */
export function buildServices(
  options: { providers?: ReturnType<typeof fakeRegistry>; dryRun?: boolean } = {},
) {
  const providers = options.providers ?? fakeRegistry();
  const dryRun = options.dryRun ?? false;

  let idSeq = 0;
  const newId = (): string => `id-${(idSeq += 1)}-0000-0000-000000000000`;

  let clock = Date.parse('2026-01-01T12:00:00.000Z');
  const now = (): Date => new Date((clock += 1000));

  const campaigns = new CampaignService({
    repository: new InMemoryCampaignRepository(),
    providers,
    dryRun,
    newId,
    now,
  });
  const adSets = new AdSetService({
    repository: new InMemoryAdSetRepository(),
    campaigns,
    providers,
    dryRun,
    newId,
    now,
  });
  const ads = new AdService({
    repository: new InMemoryAdRepository(),
    adSets,
    campaigns,
    providers,
    dryRun,
    newId,
    now,
  });

  return { providers, campaigns, adSets, ads, deploys: new DeployService(campaigns, adSets, ads) };
}

/** Substitui `globalThis.fetch` e devolve a função para restaurar. */
export function stubFetch(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
): { restore: () => void; calls: Array<{ url: string; init: RequestInit | undefined }> } {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;

  return { restore: () => { globalThis.fetch = original; }, calls };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
