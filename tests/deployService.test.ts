import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { flattenOutcomes } from '../src/services/deployService.js';
import { adInput, adSetInput, buildServices, campaignInput, fakeRegistry } from './helpers.js';

describe('DeployService.deploy', () => {
  it('publica a árvore inteira de cima para baixo', async () => {
    const { campaigns, adSets, ads, deploys, providers } = buildServices();
    const campaign = await campaigns.create(campaignInput({ platforms: ['meta'] }));
    const adSet = await adSets.create(campaign.id, adSetInput());
    await ads.create(adSet.id, adInput());

    const report = await deploys.deploy(campaign.id);

    assert.ok(flattenOutcomes(report).every((r) => r.outcome === 'published'));
    assert.equal(report.adSets.length, 1);
    assert.equal(report.adSets[0]?.ads.length, 1);

    // A ordem é o que torna a árvore publicável: campanha, conjunto, anúncio.
    assert.equal(providers.meta.publishCalls.length, 1);
    assert.equal(providers.meta.adSetCalls.length, 1);
    assert.equal(providers.meta.adCalls.length, 1);
    assert.equal(providers.meta.adCalls[0]?.context.adSetExternalId, 'adset-meta-1');
  });

  it('cobre vários conjuntos e vários anúncios', async () => {
    const { campaigns, adSets, ads, deploys } = buildServices();
    const campaign = await campaigns.create(campaignInput({ platforms: ['meta'] }));

    const primeiro = await adSets.create(campaign.id, adSetInput({ name: 'Jovens' }));
    await ads.create(primeiro.id, adInput({ name: 'Anúncio A' }));
    await ads.create(primeiro.id, adInput({ name: 'Anúncio B' }));

    const segundo = await adSets.create(campaign.id, adSetInput({ name: 'Adultos' }));
    await ads.create(segundo.id, adInput({ name: 'Anúncio C' }));

    const report = await deploys.deploy(campaign.id);

    // A árvore sai na ordem em que foi escrita, não invertida.
    assert.deepEqual(report.adSets.map((s) => s.name), ['Jovens', 'Adultos']);
    assert.deepEqual(
      report.adSets.flatMap((s) => s.ads.map((a) => a.name)),
      ['Anúncio A', 'Anúncio B', 'Anúncio C'],
    );
    assert.ok(flattenOutcomes(report).every((r) => r.outcome === 'published'));
  });

  it('bloqueia a árvore abaixo quando a campanha falha na plataforma', async () => {
    const providers = fakeRegistry({ meta: { failOnPublish: 'conta suspensa' } });
    const { campaigns, adSets, ads, deploys } = buildServices({ providers });
    const campaign = await campaigns.create(campaignInput({ platforms: ['meta'] }));
    const adSet = await adSets.create(campaign.id, adSetInput());
    await ads.create(adSet.id, adInput());

    const report = await deploys.deploy(campaign.id);

    assert.equal(report.campaign[0]?.outcome, 'failed');
    assert.equal(report.adSets[0]?.results[0]?.outcome, 'blocked');
    assert.equal(report.adSets[0]?.ads[0]?.results[0]?.outcome, 'blocked');
    assert.equal(providers.meta.adSetCalls.length, 0);
    assert.equal(providers.meta.adCalls.length, 0);
  });

  it('bloqueia só os anúncios do conjunto que falhou', async () => {
    const providers = fakeRegistry({ meta: { failOnAdSet: 'segmentação inválida' } });
    const { campaigns, adSets, ads, deploys } = buildServices({ providers });
    const campaign = await campaigns.create(campaignInput({ platforms: ['meta'] }));
    const adSet = await adSets.create(campaign.id, adSetInput());
    await ads.create(adSet.id, adInput());

    const report = await deploys.deploy(campaign.id);

    assert.equal(report.campaign[0]?.outcome, 'published');
    assert.equal(report.adSets[0]?.results[0]?.outcome, 'failed');
    assert.equal(report.adSets[0]?.ads[0]?.results[0]?.outcome, 'blocked');
  });

  it('restringe a árvore inteira às plataformas pedidas', async () => {
    const { campaigns, adSets, ads, deploys, providers } = buildServices();
    const campaign = await campaigns.create(campaignInput());
    const adSet = await adSets.create(campaign.id, adSetInput());
    await ads.create(adSet.id, adInput());

    const report = await deploys.deploy(campaign.id, ['google']);

    assert.deepEqual(report.campaign.map((r) => r.platform), ['google']);
    assert.deepEqual(report.adSets[0]?.results.map((r) => r.platform), ['google']);
    assert.deepEqual(report.adSets[0]?.ads[0]?.results.map((r) => r.platform), ['google']);
    assert.equal(providers.meta.publishCalls.length, 0);
    assert.equal(providers.google.adCalls.length, 1);
  });

  it('é idempotente: rodar de novo pula tudo que já existe', async () => {
    const { campaigns, adSets, ads, deploys, providers } = buildServices();
    const campaign = await campaigns.create(campaignInput({ platforms: ['meta'] }));
    const adSet = await adSets.create(campaign.id, adSetInput());
    await ads.create(adSet.id, adInput());

    await deploys.deploy(campaign.id);
    const second = await deploys.deploy(campaign.id);

    assert.ok(flattenOutcomes(second).every((r) => r.outcome === 'skipped'));
    assert.equal(providers.meta.publishCalls.length, 1, 'não pode duplicar campanha');
    assert.equal(providers.meta.adSetCalls.length, 1, 'não pode duplicar conjunto');
    assert.equal(providers.meta.adCalls.length, 1, 'não pode duplicar anúncio');
  });

  it('completa a árvore quando um conjunto novo é adicionado depois', async () => {
    const { campaigns, adSets, ads, deploys, providers } = buildServices();
    const campaign = await campaigns.create(campaignInput({ platforms: ['meta'] }));
    const primeiro = await adSets.create(campaign.id, adSetInput({ name: 'Jovens' }));
    await ads.create(primeiro.id, adInput());
    await deploys.deploy(campaign.id);

    const segundo = await adSets.create(campaign.id, adSetInput({ name: 'Adultos' }));
    await ads.create(segundo.id, adInput({ name: 'Anúncio novo' }));
    const report = await deploys.deploy(campaign.id);

    const novo = report.adSets.find((s) => s.name === 'Adultos');
    assert.equal(novo?.results[0]?.outcome, 'published');
    assert.equal(novo?.ads[0]?.results[0]?.outcome, 'published');
    assert.equal(providers.meta.adSetCalls.length, 2);
    assert.equal(providers.meta.adCalls.length, 2);
  });
});
