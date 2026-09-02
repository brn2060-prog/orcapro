import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Campaign } from '../src/domain/campaign.js';
import { ProviderError } from '../src/domain/errors.js';
import { GoogleAdsProvider } from '../src/providers/google.js';
import { MetaAdsProvider } from '../src/providers/meta.js';
import { TikTokAdsProvider } from '../src/providers/tiktok.js';
import { campaignInput, jsonResponse, stubFetch } from './helpers.js';

function campaign(patch: Partial<Campaign> = {}): Campaign {
  const input = campaignInput();
  return {
    id: '11111111-2222-3333-4444-555555555555',
    ...input,
    publications: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  } as Campaign;
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe('MetaAdsProvider', () => {
  const config = {
    accessToken: 'token',
    adAccountId: '123456',
    apiVersion: 'v21.0',
    pageId: '5550001',
    instagramActorId: '',
  };

  it('só se considera configurado com token e conta', () => {
    assert.equal(new MetaAdsProvider(config, 1000).isConfigured(), true);
    assert.equal(
      new MetaAdsProvider({ ...config, accessToken: '' }, 1000).isConfigured(),
      false,
    );
  });

  it('prefixa a conta com act_ e envia o orçamento diário em centavos', async () => {
    const stub = stubFetch(() => jsonResponse({ id: '99887766' }));
    restore = stub.restore;

    const result = await new MetaAdsProvider(config, 1000).publish(
      campaign({ objective: 'leads', status: 'active' }),
    );

    assert.equal(result.externalId, '99887766');
    assert.match(stub.calls[0]!.url, /\/act_123456\/campaigns$/);

    const body = bodyOf(stub.calls[0]!.init);
    assert.equal(body.objective, 'OUTCOME_LEADS');
    assert.equal(body.status, 'ACTIVE');
    assert.equal(body.daily_budget, '5000');
    assert.deepEqual(body.special_ad_categories, []);
    assert.equal(body.lifetime_budget, undefined);
  });

  it('não duplica o prefixo quando a conta já vem como act_', async () => {
    const stub = stubFetch(() => jsonResponse({ id: '1' }));
    restore = stub.restore;

    await new MetaAdsProvider({ ...config, adAccountId: 'act_123456' }, 1000).publish(campaign());

    assert.match(stub.calls[0]!.url, /\/act_123456\/campaigns$/);
    assert.doesNotMatch(stub.calls[0]!.url, /act_act_/);
  });

  it('manda a janela da campanha no orçamento lifetime', async () => {
    const stub = stubFetch(() => jsonResponse({ id: '1' }));
    restore = stub.restore;

    await new MetaAdsProvider(config, 1000).publish(
      campaign({ budget: { mode: 'lifetime', amountMinor: 250000, currency: 'BRL' } }),
    );

    const body = bodyOf(stub.calls[0]!.init);
    assert.equal(body.lifetime_budget, '250000');
    assert.equal(body.start_time, '2026-01-01T00:00:00.000Z');
    assert.equal(body.stop_time, '2026-01-31T00:00:00.000Z');
  });

  it('vira ProviderError quando a Graph API responde erro', async () => {
    const stub = stubFetch(() =>
      jsonResponse({ error: { message: 'Invalid parameter' } }, 400),
    );
    restore = stub.restore;

    await assert.rejects(
      () => new MetaAdsProvider(config, 1000).publish(campaign()),
      (error: unknown) => error instanceof ProviderError && error.platform === 'meta',
    );
  });
});

describe('GoogleAdsProvider', () => {
  const config = {
    accessToken: 'token',
    developerToken: 'dev',
    customerId: '123-456-7890',
    loginCustomerId: '999-888-7777',
    apiVersion: 'v18',
  };

  it('cria o orçamento em micros antes da campanha', async () => {
    const stub = stubFetch((url) =>
      url.includes('campaignBudgets:mutate')
        ? jsonResponse({ results: [{ resourceName: 'customers/1234567890/campaignBudgets/55' }] })
        : jsonResponse({ results: [{ resourceName: 'customers/1234567890/campaigns/77' }] }),
    );
    restore = stub.restore;

    const result = await new GoogleAdsProvider(config, 1000).publish(campaign());

    assert.equal(stub.calls.length, 2);
    assert.equal(result.externalId, 'customers/1234567890/campaigns/77');

    // 5000 centavos = 50 unidades = 50.000.000 micros.
    const budgetOp = bodyOf(stub.calls[0]!.init) as { operations: Array<{ create: Record<string, unknown> }> };
    assert.equal(budgetOp.operations[0]!.create.amountMicros, '50000000');
    assert.equal(budgetOp.operations[0]!.create.period, 'DAILY');

    const campaignOp = bodyOf(stub.calls[1]!.init) as { operations: Array<{ create: Record<string, unknown> }> };
    assert.equal(campaignOp.operations[0]!.create.advertisingChannelType, 'SEARCH');
    assert.equal(campaignOp.operations[0]!.create.startDate, '2026-01-01');
    assert.equal(campaignOp.operations[0]!.create.endDate, '2026-01-31');
  });

  it('remove os hífens dos IDs de cliente na URL e nos headers', async () => {
    const stub = stubFetch((url) =>
      url.includes('campaignBudgets:mutate')
        ? jsonResponse({ results: [{ resourceName: 'customers/1234567890/campaignBudgets/55' }] })
        : jsonResponse({ results: [{ resourceName: 'customers/1234567890/campaigns/77' }] }),
    );
    restore = stub.restore;

    await new GoogleAdsProvider(config, 1000).publish(campaign());

    assert.match(stub.calls[0]!.url, /customers\/1234567890\//);
    const headers = stub.calls[0]!.init?.headers as Record<string, string>;
    assert.equal(headers['login-customer-id'], '9998887777');
    assert.equal(headers['developer-token'], 'dev');
  });

  it('usa totalAmountMicros em orçamento lifetime', async () => {
    const stub = stubFetch(() =>
      jsonResponse({ results: [{ resourceName: 'customers/1/campaignBudgets/2' }] }),
    );
    restore = stub.restore;

    await new GoogleAdsProvider(config, 1000).publish(
      campaign({ budget: { mode: 'lifetime', amountMinor: 100000, currency: 'BRL' } }),
    );

    const budgetOp = bodyOf(stub.calls[0]!.init) as { operations: Array<{ create: Record<string, unknown> }> };
    assert.equal(budgetOp.operations[0]!.create.totalAmountMicros, '1000000000');
    assert.equal(budgetOp.operations[0]!.create.period, 'CUSTOM_PERIOD');
    assert.equal(budgetOp.operations[0]!.create.amountMicros, undefined);
  });

  it('recusa ID de campanha não numérico ao ler o status', async () => {
    await assert.rejects(
      () => new GoogleAdsProvider(config, 1000).fetchStatus('customers/1/campaigns/abc'),
      ProviderError,
    );
  });

  it('mapeia video_views para o canal VIDEO', async () => {
    const stub = stubFetch(() =>
      jsonResponse({ results: [{ resourceName: 'customers/1/campaigns/2' }] }),
    );
    restore = stub.restore;

    await new GoogleAdsProvider(config, 1000).publish(campaign({ objective: 'video_views' }));

    const campaignOp = bodyOf(stub.calls[1]!.init) as { operations: Array<{ create: Record<string, unknown> }> };
    assert.equal(campaignOp.operations[0]!.create.advertisingChannelType, 'VIDEO');
  });
});

describe('TikTokAdsProvider', () => {
  const config = {
    accessToken: 'token',
    advertiserId: 'adv-1',
    apiVersion: 'v1.3',
    identityId: 'ident-1',
    identityType: 'CUSTOMIZED_USER',
  };

  it('envia o orçamento na unidade principal da moeda', async () => {
    const stub = stubFetch(() => jsonResponse({ code: 0, data: { campaign_id: 'tt-1' } }));
    restore = stub.restore;

    const result = await new TikTokAdsProvider(config, 1000).publish(
      campaign({ status: 'active' }),
    );

    assert.equal(result.externalId, 'tt-1');
    const body = bodyOf(stub.calls[0]!.init);
    assert.equal(body.budget, 50); // 5000 centavos
    assert.equal(body.budget_mode, 'BUDGET_MODE_DAY');
    assert.equal(body.objective_type, 'TRAFFIC');
    assert.equal(stub.calls.length, 1, 'campanha ativa não precisa de ajuste de status');
  });

  it('desliga a campanha logo após criar quando ela não deve ficar ativa', async () => {
    const stub = stubFetch((url) =>
      url.includes('/campaign/create/')
        ? jsonResponse({ code: 0, data: { campaign_id: 'tt-2' } })
        : jsonResponse({ code: 0, data: {} }),
    );
    restore = stub.restore;

    await new TikTokAdsProvider(config, 1000).publish(campaign({ status: 'draft' }));

    assert.equal(stub.calls.length, 2);
    assert.match(stub.calls[1]!.url, /\/campaign\/status\/update\/$/);
    assert.equal(bodyOf(stub.calls[1]!.init).operation_status, 'DISABLE');
  });

  it('trata code != 0 como erro, mesmo com HTTP 200', async () => {
    const stub = stubFetch(() =>
      jsonResponse({ code: 40001, message: 'advertiser_id inválido' }, 200),
    );
    restore = stub.restore;

    await assert.rejects(
      () => new TikTokAdsProvider(config, 1000).publish(campaign()),
      (error: unknown) =>
        error instanceof ProviderError && /advertiser_id inválido/.test(error.message),
    );
  });

  it('lê o status pelo secondary_status quando disponível', async () => {
    const stub = stubFetch(() =>
      jsonResponse({
        code: 0,
        data: { list: [{ campaign_id: 'tt-1', operation_status: 'ENABLE', secondary_status: 'CAMPAIGN_STATUS_ENABLE' }] },
      }),
    );
    restore = stub.restore;

    const status = await new TikTokAdsProvider(config, 1000).fetchStatus('tt-1');
    assert.equal(status.externalStatus, 'CAMPAIGN_STATUS_ENABLE');
  });
});
