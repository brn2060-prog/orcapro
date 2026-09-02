import type { Campaign, CampaignStatus, Platform } from '../src/domain/campaign.js';
import type { ProviderRegistry } from '../src/providers/registry.js';
import type { AdProvider, PublishResult, RemoteStatus } from '../src/providers/types.js';
import type { CreateCampaignInput } from '../src/domain/schemas.js';

export interface FakeProviderOptions {
  configured?: boolean;
  failOnPublish?: string;
  failOnStatus?: string;
  remoteStatus?: string;
}

/** Provider de mentira: registra as chamadas e falha sob demanda. */
export class FakeProvider implements AdProvider {
  publishCalls: Campaign[] = [];
  statusCalls: Array<{ externalId: string; status: CampaignStatus }> = [];
  fetchCalls: string[] = [];
  private counter = 0;

  constructor(
    readonly platform: Platform,
    private readonly options: FakeProviderOptions = {},
  ) {}

  isConfigured(): boolean {
    return this.options.configured ?? true;
  }

  async publish(campaign: Campaign): Promise<PublishResult> {
    this.publishCalls.push(campaign);
    if (this.options.failOnPublish) throw new Error(this.options.failOnPublish);
    this.counter += 1;
    return { externalId: `${this.platform}-${this.counter}`, externalStatus: 'ACTIVE' };
  }

  async setStatus(externalId: string, status: CampaignStatus): Promise<void> {
    this.statusCalls.push({ externalId, status });
    if (this.options.failOnStatus) throw new Error(this.options.failOnStatus);
  }

  async fetchStatus(externalId: string): Promise<RemoteStatus> {
    this.fetchCalls.push(externalId);
    return { externalStatus: this.options.remoteStatus ?? 'ACTIVE' };
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
