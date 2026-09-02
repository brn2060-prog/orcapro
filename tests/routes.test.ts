import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes } from '../src/routes/index.js';
import { adInput, adSetInput, buildServices, campaignInput, fakeRegistry } from './helpers.js';

async function buildApp(
  options: { providers?: ReturnType<typeof fakeRegistry>; dryRun?: boolean } = {},
): Promise<FastifyInstance> {
  const services = buildServices(options);
  const app = Fastify({ logger: false });
  await registerRoutes(app, { ...services, dryRun: options.dryRun ?? false });
  return app;
}

async function createCampaign(app: FastifyInstance, payload = campaignInput()): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/campaigns', payload });
  assert.equal(response.statusCode, 201);
  return (response.json() as { campaign: { id: string } }).campaign.id;
}

async function createAdSet(app: FastifyInstance, campaignId: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: `/campaigns/${campaignId}/adsets`,
    payload: adSetInput(),
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { adSet: { id: string } }).adSet.id;
}

async function createAd(app: FastifyInstance, adSetId: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: `/adsets/${adSetId}/ads`,
    payload: adInput(),
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { ad: { id: string } }).ad.id;
}

describe('rotas de campanha', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  it('GET /healthz responde ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
  });

  it('GET /providers lista o modo de cada plataforma', async () => {
    const response = await app.inject({ method: 'GET', url: '/providers' });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { providers: Array<{ platform: string; mode: string }> };
    assert.deepEqual(body.providers.map((p) => p.platform).sort(), ['google', 'meta', 'tiktok']);
  });

  it('POST /campaigns cria e devolve 201', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/campaigns',
      payload: campaignInput(),
    });

    assert.equal(response.statusCode, 201);
    const { campaign } = response.json() as { campaign: { id: string; publications: unknown[] } };
    assert.ok(campaign.id);
    assert.equal(campaign.publications.length, 3);
  });

  it('POST /campaigns devolve 400 detalhado em payload inválido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/campaigns',
      payload: { ...campaignInput(), platforms: [] },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json() as { error: { code: string; details: Array<{ path: string }> } };
    assert.equal(body.error.code, 'validation_error');
    assert.ok(body.error.details.some((d) => d.path === 'platforms'));
  });

  it('GET /campaigns/:id devolve 404 para ID desconhecido', async () => {
    const response = await app.inject({ method: 'GET', url: '/campaigns/nao-existe' });
    assert.equal(response.statusCode, 404);
    assert.equal((response.json() as { error: { code: string } }).error.code, 'not_found');
  });

  it('POST /publish devolve 200 quando todas as plataformas aceitam', async () => {
    const id = await createCampaign(app);
    const response = await app.inject({ method: 'POST', url: `/campaigns/${id}/publish` });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { results: Array<{ outcome: string }> };
    assert.ok(body.results.every((r) => r.outcome === 'published'));
  });

  it('POST /publish devolve 207 quando só parte das plataformas falha', async () => {
    const partial = await buildApp({
      providers: fakeRegistry({ google: { failOnPublish: 'conta suspensa' } }),
    });
    const id = await createCampaign(partial);

    const response = await partial.inject({ method: 'POST', url: `/campaigns/${id}/publish` });
    assert.equal(response.statusCode, 207);
  });

  it('POST /publish devolve 502 quando todas falham', async () => {
    const broken = await buildApp({
      providers: fakeRegistry({
        meta: { failOnPublish: 'x' },
        google: { failOnPublish: 'x' },
        tiktok: { failOnPublish: 'x' },
      }),
    });
    const id = await createCampaign(broken);

    const response = await broken.inject({ method: 'POST', url: `/campaigns/${id}/publish` });
    assert.equal(response.statusCode, 502);
  });

  it('POST /status muda o status da campanha', async () => {
    const id = await createCampaign(app);
    await app.inject({ method: 'POST', url: `/campaigns/${id}/publish` });

    const response = await app.inject({
      method: 'POST',
      url: `/campaigns/${id}/status`,
      payload: { status: 'paused' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal((response.json() as { campaign: { status: string } }).campaign.status, 'paused');
  });

  it('DELETE /campaigns/:id devolve 204 e some da listagem', async () => {
    const id = await createCampaign(app);

    assert.equal((await app.inject({ method: 'DELETE', url: `/campaigns/${id}` })).statusCode, 204);

    const list = await app.inject({ method: 'GET', url: '/campaigns' });
    assert.deepEqual((list.json() as { campaigns: unknown[] }).campaigns, []);
  });

  it('GET /campaigns filtra por plataforma', async () => {
    await createCampaign(app, campaignInput({ name: 'só meta', platforms: ['meta'] }));
    await createCampaign(app, campaignInput({ name: 'só tiktok', platforms: ['tiktok'] }));

    const response = await app.inject({ method: 'GET', url: '/campaigns?platform=tiktok' });
    const { campaigns } = response.json() as { campaigns: Array<{ name: string }> };
    assert.deepEqual(campaigns.map((c) => c.name), ['só tiktok']);
  });
});

describe('rotas de conjunto de anúncios', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  it('cria o conjunto dentro da campanha e devolve 201', async () => {
    const campaignId = await createCampaign(app);
    const response = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/adsets`,
      payload: adSetInput(),
    });

    assert.equal(response.statusCode, 201);
    const { adSet } = response.json() as {
      adSet: { campaignId: string; publications: unknown[] };
    };
    assert.equal(adSet.campaignId, campaignId);
    assert.equal(adSet.publications.length, 3);
  });

  it('recusa criar conjunto em campanha inexistente', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/campaigns/nao-existe/adsets',
      payload: adSetInput(),
    });
    assert.equal(response.statusCode, 404);
  });

  it('devolve 502 ao publicar antes da campanha', async () => {
    const campaignId = await createCampaign(app);
    const adSetId = await createAdSet(app, campaignId);

    const response = await app.inject({ method: 'POST', url: `/adsets/${adSetId}/publish` });

    assert.equal(response.statusCode, 502);
    const body = response.json() as { results: Array<{ outcome: string; error?: string }> };
    assert.ok(body.results.every((r) => r.outcome === 'blocked'));
    assert.match(body.results[0]!.error ?? '', /campanha ainda não foi publicada/);
  });

  it('publica depois da campanha', async () => {
    const campaignId = await createCampaign(app);
    const adSetId = await createAdSet(app, campaignId);
    await app.inject({ method: 'POST', url: `/campaigns/${campaignId}/publish` });

    const response = await app.inject({ method: 'POST', url: `/adsets/${adSetId}/publish` });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { results: Array<{ outcome: string }> };
    assert.ok(body.results.every((r) => r.outcome === 'published'));
  });

  it('lista os conjuntos de uma campanha', async () => {
    const campaignId = await createCampaign(app);
    await createAdSet(app, campaignId);

    const response = await app.inject({ method: 'GET', url: `/campaigns/${campaignId}/adsets` });
    assert.equal((response.json() as { adSets: unknown[] }).adSets.length, 1);
  });
});

describe('rotas de anúncio', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  it('cria o anúncio dentro do conjunto e devolve 201', async () => {
    const campaignId = await createCampaign(app);
    const adSetId = await createAdSet(app, campaignId);

    const response = await app.inject({
      method: 'POST',
      url: `/adsets/${adSetId}/ads`,
      payload: adInput(),
    });

    assert.equal(response.statusCode, 201);
    const { ad } = response.json() as { ad: { adSetId: string; publications: unknown[] } };
    assert.equal(ad.adSetId, adSetId);
    assert.equal(ad.publications.length, 3);
  });

  it('recusa criativo single_image sem imagem', async () => {
    const campaignId = await createCampaign(app);
    const adSetId = await createAdSet(app, campaignId);

    const payload = adInput();
    delete (payload.creative as { imageUrl?: string }).imageUrl;

    const response = await app.inject({
      method: 'POST',
      url: `/adsets/${adSetId}/ads`,
      payload,
    });

    assert.equal(response.statusCode, 400);
    const body = response.json() as { error: { details: Array<{ path: string }> } };
    assert.ok(body.error.details.some((d) => d.path === 'creative.imageUrl'));
  });

  it('devolve 502 ao publicar antes do conjunto', async () => {
    const campaignId = await createCampaign(app);
    const adSetId = await createAdSet(app, campaignId);
    const adId = await createAd(app, adSetId);
    await app.inject({ method: 'POST', url: `/campaigns/${campaignId}/publish` });

    const response = await app.inject({ method: 'POST', url: `/ads/${adId}/publish` });

    assert.equal(response.statusCode, 502);
    const body = response.json() as { results: Array<{ outcome: string; error?: string }> };
    assert.match(body.results[0]!.error ?? '', /conjunto ainda não foi publicado/);
  });
});

describe('POST /campaigns/:id/deploy', () => {
  it('publica a árvore inteira numa chamada', async () => {
    const app = await buildApp();
    const campaignId = await createCampaign(app);
    const adSetId = await createAdSet(app, campaignId);
    await createAd(app, adSetId);

    const response = await app.inject({ method: 'POST', url: `/campaigns/${campaignId}/deploy` });

    assert.equal(response.statusCode, 200);
    const report = response.json() as {
      campaign: Array<{ outcome: string }>;
      adSets: Array<{ results: Array<{ outcome: string }>; ads: Array<{ results: Array<{ outcome: string }> }> }>;
    };

    assert.ok(report.campaign.every((r) => r.outcome === 'published'));
    assert.equal(report.adSets.length, 1);
    assert.ok(report.adSets[0]!.results.every((r) => r.outcome === 'published'));
    assert.equal(report.adSets[0]!.ads.length, 1);
    assert.ok(report.adSets[0]!.ads[0]!.results.every((r) => r.outcome === 'published'));
  });

  it('publica só nas plataformas pedidas, em toda a árvore', async () => {
    const app = await buildApp();
    const campaignId = await createCampaign(app);
    const adSetId = await createAdSet(app, campaignId);
    await createAd(app, adSetId);

    const response = await app.inject({
      method: 'POST',
      url: `/campaigns/${campaignId}/deploy`,
      payload: { platforms: ['meta'] },
    });

    assert.equal(response.statusCode, 200);
    const report = response.json() as {
      campaign: Array<{ platform: string }>;
      adSets: Array<{ results: Array<{ platform: string }>; ads: Array<{ results: Array<{ platform: string }> }> }>;
    };

    assert.deepEqual(report.campaign.map((r) => r.platform), ['meta']);
    assert.deepEqual(report.adSets[0]!.results.map((r) => r.platform), ['meta']);
    assert.deepEqual(report.adSets[0]!.ads[0]!.results.map((r) => r.platform), ['meta']);
  });
});
