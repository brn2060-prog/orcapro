import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { InMemoryCampaignRepository } from '../src/repository/campaignRepository.js';
import { registerCampaignRoutes } from '../src/routes/campaigns.js';
import { CampaignService } from '../src/services/campaignService.js';
import { campaignInput, fakeRegistry } from './helpers.js';

async function buildApp(
  options: { providers?: ReturnType<typeof fakeRegistry>; dryRun?: boolean } = {},
): Promise<FastifyInstance> {
  const providers = options.providers ?? fakeRegistry();
  const app = Fastify({ logger: false });
  await registerCampaignRoutes(app, {
    service: new CampaignService({
      repository: new InMemoryCampaignRepository(),
      providers,
      dryRun: options.dryRun ?? false,
    }),
    providers,
    dryRun: options.dryRun ?? false,
  });
  return app;
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
    const created = await app.inject({ method: 'POST', url: '/campaigns', payload: campaignInput() });
    const id = (created.json() as { campaign: { id: string } }).campaign.id;

    const response = await app.inject({ method: 'POST', url: `/campaigns/${id}/publish` });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { results: Array<{ outcome: string }> };
    assert.ok(body.results.every((r) => r.outcome === 'published'));
  });

  it('POST /publish devolve 207 quando só parte das plataformas falha', async () => {
    const partial = await buildApp({
      providers: fakeRegistry({ google: { failOnPublish: 'conta suspensa' } }),
    });
    const created = await partial.inject({
      method: 'POST',
      url: '/campaigns',
      payload: campaignInput(),
    });
    const id = (created.json() as { campaign: { id: string } }).campaign.id;

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
    const created = await broken.inject({
      method: 'POST',
      url: '/campaigns',
      payload: campaignInput(),
    });
    const id = (created.json() as { campaign: { id: string } }).campaign.id;

    const response = await broken.inject({ method: 'POST', url: `/campaigns/${id}/publish` });
    assert.equal(response.statusCode, 502);
  });

  it('POST /status muda o status da campanha', async () => {
    const created = await app.inject({ method: 'POST', url: '/campaigns', payload: campaignInput() });
    const id = (created.json() as { campaign: { id: string } }).campaign.id;
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
    const created = await app.inject({ method: 'POST', url: '/campaigns', payload: campaignInput() });
    const id = (created.json() as { campaign: { id: string } }).campaign.id;

    assert.equal((await app.inject({ method: 'DELETE', url: `/campaigns/${id}` })).statusCode, 204);

    const list = await app.inject({ method: 'GET', url: '/campaigns' });
    assert.deepEqual((list.json() as { campaigns: unknown[] }).campaigns, []);
  });

  it('GET /campaigns filtra por plataforma', async () => {
    await app.inject({
      method: 'POST',
      url: '/campaigns',
      payload: campaignInput({ name: 'só meta', platforms: ['meta'] }),
    });
    await app.inject({
      method: 'POST',
      url: '/campaigns',
      payload: campaignInput({ name: 'só tiktok', platforms: ['tiktok'] }),
    });

    const response = await app.inject({ method: 'GET', url: '/campaigns?platform=tiktok' });
    const { campaigns } = response.json() as { campaigns: Array<{ name: string }> };
    assert.deepEqual(campaigns.map((c) => c.name), ['só tiktok']);
  });
});
