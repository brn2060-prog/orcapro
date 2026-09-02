import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ConflictError, NotFoundError, ValidationError } from '../src/domain/errors.js';
import { findPublication } from '../src/domain/campaign.js';
import { InMemoryCampaignRepository } from '../src/repository/campaignRepository.js';
import { CampaignService } from '../src/services/campaignService.js';
import { buildServices, campaignInput, fakeRegistry, type FakeProvider } from './helpers.js';
import type { Platform } from '../src/domain/campaign.js';

function buildService(options: {
  providers?: ReturnType<typeof fakeRegistry>;
  dryRun?: boolean;
} = {}) {
  const { campaigns, providers } = buildServices(options);
  return { service: campaigns, providers };
}

describe('CampaignService.create', () => {
  it('cria a campanha com uma publicação pendente por plataforma', async () => {
    const { service } = buildService();
    const campaign = await service.create(campaignInput());

    assert.equal(campaign.publications.length, 3);
    assert.deepEqual(
      campaign.publications.map((p) => p.state),
      ['pending', 'pending', 'pending'],
    );
    assert.equal(campaign.status, 'draft');
  });
});

describe('CampaignService.publish', () => {
  it('publica em todas as plataformas e guarda o ID externo', async () => {
    const { service, providers } = buildService();
    const created = await service.create(campaignInput());
    const report = await service.publish(created.id);

    assert.deepEqual(
      report.results.map((r) => r.outcome),
      ['published', 'published', 'published'],
    );
    assert.equal(findPublication(report.campaign, 'meta')?.externalId, 'meta-1');
    assert.equal(findPublication(report.campaign, 'meta')?.dryRun, false);
    assert.equal(providers.meta.publishCalls.length, 1);
  });

  it('publica só nas plataformas pedidas', async () => {
    const { service, providers } = buildService();
    const created = await service.create(campaignInput());
    const report = await service.publish(created.id, ['tiktok']);

    assert.equal(report.results.length, 1);
    assert.equal(providers.meta.publishCalls.length, 0);
    assert.equal(providers.tiktok.publishCalls.length, 1);
    assert.equal(findPublication(report.campaign, 'meta')?.state, 'pending');
  });

  it('não republica uma plataforma já publicada', async () => {
    const { service, providers } = buildService();
    const created = await service.create(campaignInput({ platforms: ['meta'] }));

    await service.publish(created.id);
    const second = await service.publish(created.id);

    assert.equal(second.results[0]?.outcome, 'skipped');
    assert.equal(providers.meta.publishCalls.length, 1, 'não pode criar campanha duplicada');
  });

  it('registra a falha de uma plataforma sem derrubar as outras', async () => {
    const providers = fakeRegistry({ google: { failOnPublish: 'orçamento recusado' } });
    const { service } = buildService({ providers });
    const created = await service.create(campaignInput());

    const report = await service.publish(created.id);
    const byPlatform = Object.fromEntries(report.results.map((r) => [r.platform, r]));

    assert.equal(byPlatform.meta?.outcome, 'published');
    assert.equal(byPlatform.google?.outcome, 'failed');
    assert.equal(byPlatform.tiktok?.outcome, 'published');
    assert.match(findPublication(report.campaign, 'google')?.error ?? '', /orçamento recusado/);
    assert.equal(findPublication(report.campaign, 'google')?.state, 'failed');
  });

  it('simula a publicação quando o provider não tem credenciais', async () => {
    const providers = fakeRegistry({ meta: { configured: false } });
    const { service } = buildService({ providers });
    const created = await service.create(campaignInput({ platforms: ['meta'] }));

    const report = await service.publish(created.id);

    assert.equal(report.results[0]?.outcome, 'simulated');
    assert.equal(providers.meta.publishCalls.length, 0, 'nada pode ir para a plataforma');
    assert.equal(findPublication(report.campaign, 'meta')?.dryRun, true);
  });

  it('simula tudo com dryRun ligado, mesmo com credenciais', async () => {
    const { service, providers } = buildService({ dryRun: true });
    const created = await service.create(campaignInput());

    const report = await service.publish(created.id);

    assert.ok(report.results.every((r) => r.outcome === 'simulated'));
    assert.equal(providers.google.publishCalls.length, 0);
  });

  it('reprocessa uma publicação que era simulada', async () => {
    const providers = fakeRegistry({ meta: { configured: false } });
    const { service } = buildService({ providers });
    const created = await service.create(campaignInput({ platforms: ['meta'] }));
    await service.publish(created.id);

    // Credenciais chegaram: a próxima publicação precisa ir de verdade.
    const live = fakeRegistry();
    const repo = new InMemoryCampaignRepository();
    await repo.save(await service.get(created.id));
    const relaunched = new CampaignService({ repository: repo, providers: live, dryRun: false });

    const report = await relaunched.publish(created.id);
    assert.equal(report.results[0]?.outcome, 'published');
    assert.equal(live.meta.publishCalls.length, 1);
  });

  it('recusa plataforma que não faz parte da campanha', async () => {
    const { service } = buildService();
    const created = await service.create(campaignInput({ platforms: ['meta'] }));

    await assert.rejects(
      () => service.publish(created.id, ['tiktok' as Platform]),
      ValidationError,
    );
  });

  it('recusa publicar campanha arquivada', async () => {
    const { service } = buildService();
    const created = await service.create(campaignInput());
    await service.setStatus(created.id, 'archived');

    await assert.rejects(() => service.publish(created.id), ConflictError);
  });

  it('falha ao publicar campanha inexistente', async () => {
    const { service } = buildService();
    await assert.rejects(() => service.publish('nao-existe'), NotFoundError);
  });
});

describe('CampaignService.setStatus', () => {
  it('propaga o status para as plataformas publicadas', async () => {
    const { service, providers } = buildService();
    const created = await service.create(campaignInput());
    await service.publish(created.id);

    const report = await service.setStatus(created.id, 'paused');

    assert.equal(report.campaign.status, 'paused');
    assert.deepEqual(providers.meta.statusCalls, [{ externalId: 'meta-1', status: 'paused' }]);
    assert.deepEqual(providers.tiktok.statusCalls, [{ externalId: 'tiktok-1', status: 'paused' }]);
  });

  it('pula plataformas ainda não publicadas', async () => {
    const { service, providers } = buildService();
    const created = await service.create(campaignInput());

    const report = await service.setStatus(created.id, 'paused');

    assert.ok(report.results.every((r) => r.outcome === 'skipped'));
    assert.equal(providers.meta.statusCalls.length, 0);
  });

  it('muda o status local mesmo se uma plataforma falhar', async () => {
    const providers = fakeRegistry({ tiktok: { failOnStatus: 'token expirado' } });
    const { service } = buildService({ providers });
    const created = await service.create(campaignInput());
    await service.publish(created.id);

    const report = await service.setStatus(created.id, 'paused');

    assert.equal(report.campaign.status, 'paused');
    const tiktok = report.results.find((r) => r.platform === 'tiktok');
    assert.equal(tiktok?.outcome, 'failed');
    assert.match(findPublication(report.campaign, 'tiktok')?.error ?? '', /token expirado/);
  });

  it('não chama a plataforma para publicações simuladas', async () => {
    const { service, providers } = buildService({ dryRun: true });
    const created = await service.create(campaignInput());
    await service.publish(created.id);

    const report = await service.setStatus(created.id, 'paused');

    assert.ok(report.results.every((r) => r.outcome === 'simulated'));
    assert.equal(providers.meta.statusCalls.length, 0);
  });
});

describe('CampaignService.sync', () => {
  it('atualiza o status externo de cada plataforma publicada', async () => {
    const providers = fakeRegistry({
      meta: { remoteStatus: 'PAUSED' },
      google: { remoteStatus: 'ENABLED' },
      tiktok: { remoteStatus: 'DISABLE' },
    });
    const { service } = buildService({ providers });
    const created = await service.create(campaignInput());
    await service.publish(created.id);

    const synced = await service.sync(created.id);

    assert.equal(findPublication(synced, 'meta')?.externalStatus, 'PAUSED');
    assert.equal(findPublication(synced, 'google')?.externalStatus, 'ENABLED');
    assert.equal(findPublication(synced, 'tiktok')?.externalStatus, 'DISABLE');
  });

  it('ignora publicações simuladas', async () => {
    const { service, providers } = buildService({ dryRun: true });
    const created = await service.create(campaignInput());
    await service.publish(created.id);

    await service.sync(created.id);

    assert.equal((providers.meta as FakeProvider).fetchCalls.length, 0);
  });
});

describe('CampaignService.update', () => {
  it('revalida as regras cruzadas com os campos já salvos', async () => {
    const { service } = buildService();
    const created = await service.create(
      campaignInput({ schedule: { startAt: '2026-01-01T00:00:00.000Z' } }),
    );

    // Só o orçamento muda, mas lifetime exige endAt — que a campanha não tem.
    await assert.rejects(
      () =>
        service.update(created.id, {
          budget: { mode: 'lifetime', amountMinor: 100000, currency: 'BRL' },
        }),
      ValidationError,
    );
  });

  it('mantém a publicação existente ao acrescentar uma plataforma', async () => {
    const { service } = buildService();
    const created = await service.create(campaignInput({ platforms: ['meta'] }));
    await service.publish(created.id);

    const updated = await service.update(created.id, { platforms: ['meta', 'tiktok'] });

    assert.equal(findPublication(updated, 'meta')?.state, 'published');
    assert.equal(findPublication(updated, 'meta')?.externalId, 'meta-1');
    assert.equal(findPublication(updated, 'tiktok')?.state, 'pending');
  });

  it('recusa editar campanha arquivada', async () => {
    const { service } = buildService();
    const created = await service.create(campaignInput());
    await service.setStatus(created.id, 'archived');

    await assert.rejects(() => service.update(created.id, { name: 'novo nome' }), ConflictError);
  });
});

describe('CampaignService.list', () => {
  let service: CampaignService;

  beforeEach(async () => {
    ({ service } = buildService());
    await service.create(campaignInput({ name: 'A', platforms: ['meta'] }));
    await service.create(campaignInput({ name: 'B', platforms: ['tiktok'], status: 'active' }));
  });

  it('filtra por status', async () => {
    const active = await service.list({ status: 'active' });
    assert.deepEqual(active.map((c) => c.name), ['B']);
  });

  it('filtra por plataforma', async () => {
    const meta = await service.list({ platform: 'meta' });
    assert.deepEqual(meta.map((c) => c.name), ['A']);
  });
});
