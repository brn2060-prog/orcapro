import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NotFoundError } from '../src/domain/errors.js';
import { findPublicationOf } from '../src/services/publishing.js';
import { adInput, adSetInput, buildServices, campaignInput, fakeRegistry } from './helpers.js';

/** Sobe campanha e conjunto publicados, prontos para receber anúncios. */
async function withPublishedAdSet(
  options: Parameters<typeof buildServices>[0] = {},
  campaignPatch = {},
) {
  const services = buildServices(options);
  const campaign = await services.campaigns.create(campaignInput(campaignPatch));
  await services.campaigns.publish(campaign.id);
  const adSet = await services.adSets.create(campaign.id, adSetInput());
  await services.adSets.publish(adSet.id);
  return { ...services, campaign, adSet };
}

describe('AdService.create', () => {
  it('herda as plataformas do conjunto', async () => {
    const { adSets, ads, campaign } = await withPublishedAdSet({}, { platforms: ['meta', 'google'] });
    const adSet = (await adSets.listByCampaign(campaign.id))[0]!;

    const ad = await ads.create(adSet.id, adInput());

    assert.deepEqual(ad.publications.map((p) => p.platform), ['meta', 'google']);
    assert.equal(ad.adSetId, adSet.id);
  });

  it('recusa criar anúncio em conjunto inexistente', async () => {
    const { ads } = buildServices();
    await assert.rejects(() => ads.create('nao-existe', adInput()), NotFoundError);
  });
});

describe('AdService.publish', () => {
  it('publica dentro do conjunto e passa o ID externo dele', async () => {
    const { ads, adSet, providers } = await withPublishedAdSet();
    const ad = await ads.create(adSet.id, adInput());

    const report = await ads.publish(ad.id);

    assert.ok(report.results.every((r) => r.outcome === 'published'));
    assert.equal(providers.meta.adCalls.length, 1);
    assert.equal(providers.meta.adCalls[0]?.context.adSetExternalId, 'adset-meta-1');
    // O provider recebe a árvore inteira para poder traduzir o criativo.
    assert.equal(providers.meta.adCalls[0]?.context.campaign.id, adSet.campaignId);
  });

  it('bloqueia enquanto o conjunto não tem ID na plataforma', async () => {
    const { campaigns, adSets, ads, providers } = buildServices();
    const campaign = await campaigns.create(campaignInput());
    await campaigns.publish(campaign.id);
    const adSet = await adSets.create(campaign.id, adSetInput());
    const ad = await ads.create(adSet.id, adInput());

    const report = await ads.publish(ad.id);

    assert.ok(report.results.every((r) => r.outcome === 'blocked'));
    assert.equal(providers.meta.adCalls.length, 0);
    assert.match(
      findPublicationOf(report.ad, 'meta')?.error ?? '',
      /conjunto ainda não foi publicado/,
    );
  });

  it('simula o anúncio quando o conjunto foi simulado naquela plataforma', async () => {
    const providers = fakeRegistry({ meta: { configured: false } });
    const { ads, adSet } = await withPublishedAdSet({ providers });
    const ad = await ads.create(adSet.id, adInput());

    const report = await ads.publish(ad.id);
    const byPlatform = Object.fromEntries(report.results.map((r) => [r.platform, r.outcome]));

    assert.equal(byPlatform.meta, 'simulated');
    assert.equal(byPlatform.google, 'published');
    assert.equal(providers.meta.adCalls.length, 0);
  });

  it('bloqueia a plataforma que não tem ID do vídeo', async () => {
    const { ads, adSet, providers } = await withPublishedAdSet();
    const ad = await ads.create(
      adSet.id,
      adInput({
        creative: {
          format: 'single_video',
          headlines: ['Um', 'Dois', 'Três'],
          descriptions: ['A', 'B'],
          landingPageUrl: 'https://exemplo.com.br',
          callToAction: 'learn_more',
          // Só a Meta tem o vídeo hospedado.
          videoIds: { meta: 'video-meta-1' },
        },
      }),
    );

    const report = await ads.publish(ad.id);
    const byPlatform = Object.fromEntries(report.results.map((r) => [r.platform, r.outcome]));

    assert.equal(byPlatform.meta, 'published');
    assert.equal(byPlatform.tiktok, 'blocked');
    assert.match(
      report.results.find((r) => r.platform === 'tiktok')?.error ?? '',
      /falta o ID do vídeo para tiktok/,
    );
    assert.equal(providers.tiktok.adCalls.length, 0);
  });

  it('não republica um anúncio já publicado', async () => {
    const { ads, adSet, providers } = await withPublishedAdSet({}, { platforms: ['meta'] });
    const ad = await ads.create(adSet.id, adInput());

    await ads.publish(ad.id);
    const second = await ads.publish(ad.id);

    assert.equal(second.results[0]?.outcome, 'skipped');
    assert.equal(providers.meta.adCalls.length, 1);
  });

  it('registra a falha sem derrubar as outras plataformas', async () => {
    const providers = fakeRegistry({ google: { failOnAd: 'faltam títulos' } });
    const { ads, adSet } = await withPublishedAdSet({ providers });
    const ad = await ads.create(adSet.id, adInput());

    const report = await ads.publish(ad.id);
    const byPlatform = Object.fromEntries(report.results.map((r) => [r.platform, r.outcome]));

    assert.equal(byPlatform.meta, 'published');
    assert.equal(byPlatform.google, 'failed');
    assert.match(findPublicationOf(report.ad, 'google')?.error ?? '', /faltam títulos/);
  });
});

describe('AdService.setStatus', () => {
  it('propaga só para o anúncio, sem tocar em conjunto ou campanha', async () => {
    const { ads, adSet, providers } = await withPublishedAdSet({}, { platforms: ['meta'] });
    const ad = await ads.create(adSet.id, adInput());
    await ads.publish(ad.id);

    const report = await ads.setStatus(ad.id, 'paused');

    assert.equal(report.ad.status, 'paused');
    assert.deepEqual(providers.meta.adStatusCalls, [
      { externalId: 'ad-meta-2', status: 'paused' },
    ]);
    assert.equal(providers.meta.adSetStatusCalls.length, 0);
    assert.equal(providers.meta.statusCalls.length, 0);
  });
});
