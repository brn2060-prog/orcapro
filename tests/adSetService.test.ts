import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effectiveBudget, effectiveSchedule } from '../src/domain/adSet.js';
import { ConflictError, NotFoundError, ValidationError } from '../src/domain/errors.js';
import { findPublicationOf } from '../src/services/publishing.js';
import { adSetInput, buildServices, campaignInput, fakeRegistry } from './helpers.js';

describe('AdSetService.create', () => {
  it('herda as plataformas da campanha', async () => {
    const { campaigns, adSets } = buildServices();
    const campaign = await campaigns.create(campaignInput({ platforms: ['meta', 'tiktok'] }));

    const adSet = await adSets.create(campaign.id, adSetInput());

    assert.deepEqual(adSet.publications.map((p) => p.platform), ['meta', 'tiktok']);
    assert.ok(adSet.publications.every((p) => p.state === 'pending'));
    assert.equal(adSet.campaignId, campaign.id);
  });

  it('recusa criar conjunto em campanha inexistente', async () => {
    const { adSets } = buildServices();
    await assert.rejects(() => adSets.create('nao-existe', adSetInput()), NotFoundError);
  });
});

describe('AdSetService.publish', () => {
  it('bloqueia enquanto a campanha não tem ID na plataforma', async () => {
    const { campaigns, adSets, providers } = buildServices();
    const campaign = await campaigns.create(campaignInput());
    const adSet = await adSets.create(campaign.id, adSetInput());

    const report = await adSets.publish(adSet.id);

    assert.ok(report.results.every((r) => r.outcome === 'blocked'));
    assert.equal(providers.meta.adSetCalls.length, 0, 'nada pode ir para a plataforma');
    assert.match(
      findPublicationOf(report.adSet, 'meta')?.error ?? '',
      /campanha ainda não foi publicada/,
    );
  });

  it('publica dentro da campanha e passa o ID externo dela', async () => {
    const { campaigns, adSets, providers } = buildServices();
    const campaign = await campaigns.create(campaignInput());
    await campaigns.publish(campaign.id);
    const adSet = await adSets.create(campaign.id, adSetInput());

    const report = await adSets.publish(adSet.id);

    assert.ok(report.results.every((r) => r.outcome === 'published'));
    assert.equal(providers.meta.adSetCalls.length, 1);
    assert.equal(providers.meta.adSetCalls[0]?.context.campaignExternalId, 'meta-1');
  });

  it('bloqueia só a plataforma cuja campanha não foi publicada', async () => {
    const { campaigns, adSets } = buildServices();
    const campaign = await campaigns.create(campaignInput());
    await campaigns.publish(campaign.id, ['meta']);
    const adSet = await adSets.create(campaign.id, adSetInput());

    const report = await adSets.publish(adSet.id);
    const byPlatform = Object.fromEntries(report.results.map((r) => [r.platform, r.outcome]));

    assert.equal(byPlatform.meta, 'published');
    assert.equal(byPlatform.google, 'blocked');
    assert.equal(byPlatform.tiktok, 'blocked');
  });

  it('simula o conjunto quando a campanha foi simulada naquela plataforma', async () => {
    // Meta sem credenciais: a campanha lá é simulada, então o conjunto também
    // precisa ser — não dá para pendurar um conjunto real numa campanha que não existe.
    const providers = fakeRegistry({ meta: { configured: false } });
    const { campaigns, adSets } = buildServices({ providers });
    const campaign = await campaigns.create(campaignInput());
    await campaigns.publish(campaign.id);
    const adSet = await adSets.create(campaign.id, adSetInput());

    const report = await adSets.publish(adSet.id);
    const byPlatform = Object.fromEntries(report.results.map((r) => [r.platform, r.outcome]));

    assert.equal(byPlatform.meta, 'simulated');
    assert.equal(byPlatform.google, 'published');
    assert.equal(providers.meta.adSetCalls.length, 0);
  });

  it('não republica um conjunto já publicado', async () => {
    const { campaigns, adSets, providers } = buildServices();
    const campaign = await campaigns.create(campaignInput({ platforms: ['meta'] }));
    await campaigns.publish(campaign.id);
    const adSet = await adSets.create(campaign.id, adSetInput());

    await adSets.publish(adSet.id);
    const second = await adSets.publish(adSet.id);

    assert.equal(second.results[0]?.outcome, 'skipped');
    assert.equal(providers.meta.adSetCalls.length, 1);
  });

  it('registra a falha de uma plataforma sem derrubar as outras', async () => {
    const providers = fakeRegistry({ tiktok: { failOnAdSet: 'região não reconhecida' } });
    const { campaigns, adSets } = buildServices({ providers });
    const campaign = await campaigns.create(campaignInput());
    await campaigns.publish(campaign.id);
    const adSet = await adSets.create(campaign.id, adSetInput());

    const report = await adSets.publish(adSet.id);
    const byPlatform = Object.fromEntries(report.results.map((r) => [r.platform, r.outcome]));

    assert.equal(byPlatform.meta, 'published');
    assert.equal(byPlatform.tiktok, 'failed');
    assert.match(
      findPublicationOf(report.adSet, 'tiktok')?.error ?? '',
      /região não reconhecida/,
    );
  });

  it('recusa publicar conjunto arquivado', async () => {
    const { campaigns, adSets } = buildServices();
    const campaign = await campaigns.create(campaignInput());
    const adSet = await adSets.create(campaign.id, adSetInput());
    await adSets.setStatus(adSet.id, 'archived');

    await assert.rejects(() => adSets.publish(adSet.id), ConflictError);
  });

  it('recusa plataforma fora da campanha', async () => {
    const { campaigns, adSets } = buildServices();
    const campaign = await campaigns.create(campaignInput({ platforms: ['meta'] }));
    const adSet = await adSets.create(campaign.id, adSetInput());

    await assert.rejects(() => adSets.publish(adSet.id, ['tiktok']), ValidationError);
  });
});

describe('AdSetService.setStatus', () => {
  it('propaga para as plataformas onde o conjunto existe', async () => {
    const { campaigns, adSets, providers } = buildServices();
    const campaign = await campaigns.create(campaignInput({ platforms: ['meta'] }));
    await campaigns.publish(campaign.id);
    const adSet = await adSets.create(campaign.id, adSetInput());
    await adSets.publish(adSet.id);

    const report = await adSets.setStatus(adSet.id, 'paused');

    assert.equal(report.adSet.status, 'paused');
    assert.deepEqual(providers.meta.adSetStatusCalls, [
      { externalId: 'adset-meta-1', status: 'paused' },
    ]);
    // Pausar o conjunto não pode mexer na campanha.
    assert.equal(providers.meta.statusCalls.length, 0);
  });

  it('pula plataformas onde o conjunto ainda não existe', async () => {
    const { campaigns, adSets, providers } = buildServices();
    const campaign = await campaigns.create(campaignInput());
    const adSet = await adSets.create(campaign.id, adSetInput());

    const report = await adSets.setStatus(adSet.id, 'paused');

    assert.ok(report.results.every((r) => r.outcome === 'skipped'));
    assert.equal(providers.meta.adSetStatusCalls.length, 0);
  });
});

describe('AdSetService.update', () => {
  it('revalida orçamento e janela quando o conjunto tem os dois', async () => {
    const { campaigns, adSets } = buildServices();
    const campaign = await campaigns.create(campaignInput());
    const adSet = await adSets.create(
      campaign.id,
      adSetInput({ schedule: { startAt: '2026-01-01T00:00:00.000Z' } }),
    );

    await assert.rejects(
      () =>
        adSets.update(adSet.id, {
          budget: { mode: 'lifetime', amountMinor: 100000, currency: 'BRL' },
        }),
      ValidationError,
    );
  });

  it('aceita orçamento lifetime quando a janela vem da campanha', async () => {
    const { campaigns, adSets } = buildServices();
    const campaign = await campaigns.create(campaignInput());
    // Sem schedule próprio o conjunto herda o da campanha, que tem endAt.
    const adSet = await adSets.create(campaign.id, adSetInput());

    const updated = await adSets.update(adSet.id, {
      budget: { mode: 'lifetime', amountMinor: 100000, currency: 'BRL' },
    });

    assert.equal(updated.budget?.mode, 'lifetime');
  });
});

describe('herança de orçamento e janela', () => {
  it('usa o do conjunto quando ele tem', () => {
    const own = { mode: 'daily' as const, amountMinor: 999, currency: 'BRL' };
    const herdado = { mode: 'daily' as const, amountMinor: 100, currency: 'BRL' };
    assert.equal(effectiveBudget({ budget: own } as never, herdado).amountMinor, 999);
  });

  it('cai para o da campanha quando o conjunto não tem', () => {
    const herdado = { mode: 'daily' as const, amountMinor: 100, currency: 'BRL' };
    assert.equal(effectiveBudget({} as never, herdado).amountMinor, 100);

    const janela = { startAt: '2026-01-01T00:00:00.000Z' };
    assert.equal(effectiveSchedule({} as never, janela).startAt, janela.startAt);
  });
});
