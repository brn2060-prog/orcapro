import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Ad } from '../src/domain/ad.js';
import type { AdSet } from '../src/domain/adSet.js';
import type { Campaign } from '../src/domain/campaign.js';
import { ProviderError } from '../src/domain/errors.js';
import { GoogleAdsProvider } from '../src/providers/google.js';
import { MetaAdsProvider } from '../src/providers/meta.js';
import { TikTokAdsProvider } from '../src/providers/tiktok.js';
import { adInput, adSetInput, campaignInput, jsonResponse, stubFetch } from './helpers.js';

function campaign(patch: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    ...campaignInput(),
    publications: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  } as Campaign;
}

function adSet(patch: Partial<AdSet> = {}): AdSet {
  return {
    id: 'set-1',
    campaignId: 'camp-1',
    ...adSetInput(),
    publications: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  } as AdSet;
}

function ad(patch: Partial<Ad> = {}): Ad {
  return {
    id: 'ad-1',
    adSetId: 'set-1',
    ...adInput(),
    publications: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  } as Ad;
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

const metaConfig = {
  accessToken: 'token',
  adAccountId: '123456',
  apiVersion: 'v21.0',
  pageId: '5550001',
  instagramActorId: '',
};

const googleConfig = {
  accessToken: 'token',
  developerToken: 'dev',
  customerId: '1234567890',
  loginCustomerId: '',
  apiVersion: 'v18',
};

const tiktokConfig = {
  accessToken: 'token',
  advertiserId: 'adv-1',
  apiVersion: 'v1.3',
  identityId: 'ident-1',
  identityType: 'CUSTOMIZED_USER',
};

describe('MetaAdsProvider — conjunto', () => {
  it('deriva otimização e cobrança do objetivo da campanha', async () => {
    const stub = stubFetch(() => jsonResponse({ id: 'set-99' }));
    restore = stub.restore;

    const result = await new MetaAdsProvider(metaConfig, 1000).publishAdSet(adSet(), {
      campaign: campaign({ objective: 'leads' }),
      campaignExternalId: 'camp-ext-1',
    });

    assert.equal(result.externalId, 'set-99');
    assert.match(stub.calls[0]!.url, /\/act_123456\/adsets$/);

    const body = bodyOf(stub.calls[0]!.init);
    assert.equal(body.campaign_id, 'camp-ext-1');
    assert.equal(body.optimization_goal, 'LEAD_GENERATION');
    assert.equal(body.billing_event, 'IMPRESSIONS');
    assert.deepEqual(body.targeting, {
      geo_locations: { countries: ['BR'] },
      age_min: 25,
      age_max: 44,
    });
  });

  it('omite o orçamento quando o conjunto herda o da campanha', async () => {
    const stub = stubFetch(() => jsonResponse({ id: 'set-1' }));
    restore = stub.restore;

    await new MetaAdsProvider(metaConfig, 1000).publishAdSet(adSet(), {
      campaign: campaign(),
      campaignExternalId: 'camp-ext-1',
    });

    // Com CBO a Meta recusa orçamento no conjunto.
    const body = bodyOf(stub.calls[0]!.init);
    assert.equal(body.daily_budget, undefined);
    assert.equal(body.lifetime_budget, undefined);
  });

  it('manda o orçamento próprio do conjunto quando ele tem', async () => {
    const stub = stubFetch(() => jsonResponse({ id: 'set-1' }));
    restore = stub.restore;

    await new MetaAdsProvider(metaConfig, 1000).publishAdSet(
      adSet({ budget: { mode: 'daily', amountMinor: 7500, currency: 'BRL' } }),
      { campaign: campaign(), campaignExternalId: 'camp-ext-1' },
    );

    assert.equal(bodyOf(stub.calls[0]!.init).daily_budget, '7500');
  });

  it('traduz gênero para o código numérico da Meta', async () => {
    const stub = stubFetch(() => jsonResponse({ id: 'set-1' }));
    restore = stub.restore;

    await new MetaAdsProvider(metaConfig, 1000).publishAdSet(
      adSet({ targeting: { countries: ['BR'], genders: ['female'] } }),
      { campaign: campaign(), campaignExternalId: 'camp-ext-1' },
    );

    const targeting = bodyOf(stub.calls[0]!.init).targeting as Record<string, unknown>;
    assert.deepEqual(targeting.genders, [2]);
  });

  it('não manda gênero quando a segmentação é para todos', async () => {
    const stub = stubFetch(() => jsonResponse({ id: 'set-1' }));
    restore = stub.restore;

    await new MetaAdsProvider(metaConfig, 1000).publishAdSet(
      adSet({ targeting: { countries: ['BR'], genders: ['all'] } }),
      { campaign: campaign(), campaignExternalId: 'camp-ext-1' },
    );

    const targeting = bodyOf(stub.calls[0]!.init).targeting as Record<string, unknown>;
    assert.equal(targeting.genders, undefined);
  });
});

describe('MetaAdsProvider — anúncio', () => {
  it('cria o criativo antes do anúncio e liga os dois', async () => {
    const stub = stubFetch((url) =>
      url.includes('/adcreatives')
        ? jsonResponse({ id: 'creative-1' })
        : jsonResponse({ id: 'ad-99' }),
    );
    restore = stub.restore;

    const result = await new MetaAdsProvider(metaConfig, 1000).publishAd(ad(), {
      campaign: campaign(),
      adSet: adSet(),
      adSetExternalId: 'set-ext-1',
    });

    assert.equal(stub.calls.length, 2);
    assert.equal(result.externalId, 'ad-99');

    const creativeBody = bodyOf(stub.calls[0]!.init);
    const storySpec = creativeBody.object_story_spec as Record<string, unknown>;
    assert.equal(storySpec.page_id, '5550001');

    const linkData = storySpec.link_data as Record<string, unknown>;
    assert.equal(linkData.name, 'Título um');
    assert.equal(linkData.picture, 'https://exemplo.com.br/banner.jpg');
    assert.deepEqual(linkData.call_to_action, {
      type: 'GET_QUOTE',
      value: { link: 'https://exemplo.com.br/orcamento' },
    });

    const adBody = bodyOf(stub.calls[1]!.init);
    assert.equal(adBody.adset_id, 'set-ext-1');
    assert.deepEqual(adBody.creative, { creative_id: 'creative-1' });
  });

  it('usa video_data no formato de vídeo', async () => {
    const stub = stubFetch((url) =>
      url.includes('/adcreatives') ? jsonResponse({ id: 'c-1' }) : jsonResponse({ id: 'a-1' }),
    );
    restore = stub.restore;

    await new MetaAdsProvider(metaConfig, 1000).publishAd(
      ad({
        creative: {
          format: 'single_video',
          headlines: ['Título'],
          descriptions: ['Descrição'],
          landingPageUrl: 'https://exemplo.com.br',
          callToAction: 'learn_more',
          videoIds: { meta: 'video-meta-7' },
        },
      }),
      { campaign: campaign(), adSet: adSet(), adSetExternalId: 'set-ext-1' },
    );

    const storySpec = bodyOf(stub.calls[0]!.init).object_story_spec as Record<string, unknown>;
    const videoData = storySpec.video_data as Record<string, unknown>;
    assert.equal(videoData.video_id, 'video-meta-7');
    assert.equal(storySpec.link_data, undefined);
  });

  it('exige META_PAGE_ID para criar o criativo', async () => {
    await assert.rejects(
      () =>
        new MetaAdsProvider({ ...metaConfig, pageId: '' }, 1000).publishAd(ad(), {
          campaign: campaign(),
          adSet: adSet(),
          adSetExternalId: 'set-ext-1',
        }),
      (error: unknown) => error instanceof ProviderError && /META_PAGE_ID/.test(error.message),
    );
  });
});

describe('GoogleAdsProvider — grupo e anúncio', () => {
  it('cria o grupo com o tipo do canal da campanha', async () => {
    const stub = stubFetch(() =>
      jsonResponse({ results: [{ resourceName: 'customers/1234567890/adGroups/42' }] }),
    );
    restore = stub.restore;

    const result = await new GoogleAdsProvider(googleConfig, 1000).publishAdSet(
      adSet({ bidAmountMinor: 250 }),
      { campaign: campaign({ objective: 'traffic' }), campaignExternalId: 'customers/1/campaigns/9' },
    );

    assert.equal(result.externalId, 'customers/1234567890/adGroups/42');
    const create = (bodyOf(stub.calls[0]!.init) as { operations: Array<{ create: Record<string, unknown> }> })
      .operations[0]!.create;
    assert.equal(create.type, 'SEARCH_STANDARD');
    assert.equal(create.campaign, 'customers/1/campaigns/9');
    // 250 centavos = 2,50 = 2.500.000 micros.
    assert.equal(create.cpcBidMicros, '2500000');
  });

  it('monta o anúncio responsivo a partir dos textos', async () => {
    const stub = stubFetch(() =>
      jsonResponse({ results: [{ resourceName: 'customers/1/adGroupAds/7' }] }),
    );
    restore = stub.restore;

    await new GoogleAdsProvider(googleConfig, 1000).publishAd(ad(), {
      campaign: campaign(),
      adSet: adSet(),
      adSetExternalId: 'customers/1/adGroups/42',
    });

    const create = (bodyOf(stub.calls[0]!.init) as { operations: Array<{ create: Record<string, unknown> }> })
      .operations[0]!.create;
    assert.equal(create.adGroup, 'customers/1/adGroups/42');

    const rsa = (create.ad as Record<string, unknown>).responsiveSearchAd as Record<string, unknown>;
    assert.deepEqual(rsa.headlines, [
      { text: 'Título um' },
      { text: 'Título dois' },
      { text: 'Título três' },
    ]);
    assert.deepEqual(rsa.descriptions, [{ text: 'Descrição um' }, { text: 'Descrição dois' }]);
    assert.deepEqual((create.ad as Record<string, unknown>).finalUrls, [
      'https://exemplo.com.br/orcamento',
    ]);
  });

  it('recusa antes de chamar a API quando faltam títulos', async () => {
    const stub = stubFetch(() => jsonResponse({ results: [{ resourceName: 'x' }] }));
    restore = stub.restore;

    await assert.rejects(
      () =>
        new GoogleAdsProvider(googleConfig, 1000).publishAd(
          ad({
            creative: {
              format: 'single_image',
              headlines: ['Só um'],
              descriptions: ['A', 'B'],
              landingPageUrl: 'https://exemplo.com.br',
              callToAction: 'learn_more',
              imageUrl: 'https://exemplo.com.br/i.jpg',
            },
          }),
          { campaign: campaign(), adSet: adSet(), adSetExternalId: 'customers/1/adGroups/42' },
        ),
      (error: unknown) => error instanceof ProviderError && /ao menos 3 títulos/.test(error.message),
    );
    assert.equal(stub.calls.length, 0, 'não pode gastar uma chamada para levar erro conhecido');
  });

  it('muda o status pelo recurso certo em cada nível', async () => {
    const stub = stubFetch(() => jsonResponse({ results: [{ resourceName: 'x' }] }));
    restore = stub.restore;

    const provider = new GoogleAdsProvider(googleConfig, 1000);
    await provider.setAdSetStatus('customers/1/adGroups/42', 'paused');
    await provider.setAdStatus('customers/1/adGroupAds/7', 'paused');

    assert.match(stub.calls[0]!.url, /\/adGroups:mutate$/);
    assert.match(stub.calls[1]!.url, /\/adGroupAds:mutate$/);
  });
});

describe('TikTokAdsProvider — grupo e anúncio', () => {
  const regionResponse = jsonResponse({
    code: 0,
    data: { region_info: [{ region_id: 6252001, region_code: 'BR' }] },
  });

  it('traduz o país para o ID de região antes de criar o grupo', async () => {
    const stub = stubFetch((url) =>
      url.includes('/tool/region/')
        ? jsonResponse({ code: 0, data: { region_info: [{ region_id: 6252001, region_code: 'BR' }] } })
        : jsonResponse({ code: 0, data: { adgroup_id: 'grp-1' } }),
    );
    restore = stub.restore;

    const result = await new TikTokAdsProvider(tiktokConfig, 1000).publishAdSet(adSet(), {
      campaign: campaign({ objective: 'traffic' }),
      campaignExternalId: 'camp-ext-1',
    });

    assert.equal(result.externalId, 'grp-1');
    const body = bodyOf(stub.calls[1]!.init);
    assert.deepEqual(body.location_ids, ['6252001']);
    assert.equal(body.optimization_goal, 'CLICK');
    assert.equal(body.billing_event, 'CPC');
    // 25-44 encosta em duas faixas fechadas.
    assert.deepEqual(body.age_groups, ['AGE_25_34', 'AGE_35_44']);
    assert.equal(body.schedule_start_time, '2026-01-01 00:00:00');
  });

  it('cai fora com mensagem clara quando a região não existe', async () => {
    const stub = stubFetch(() => regionResponse.clone());
    restore = stub.restore;

    await assert.rejects(
      () =>
        new TikTokAdsProvider(tiktokConfig, 1000).publishAdSet(
          adSet({ targeting: { countries: ['PT'] } }),
          { campaign: campaign(), campaignExternalId: 'camp-ext-1' },
        ),
      (error: unknown) => error instanceof ProviderError && /não reconhece a região: PT/.test(error.message),
    );
  });

  it('sobe a imagem por URL antes de criar o anúncio', async () => {
    const stub = stubFetch((url) => {
      if (url.includes('/file/image/ad/upload/')) {
        return jsonResponse({ code: 0, data: { image_id: 'img-1' } });
      }
      if (url.includes('/ad/create/')) {
        return jsonResponse({ code: 0, data: { ad_ids: ['tt-ad-1'] } });
      }
      return jsonResponse({ code: 0, data: {} });
    });
    restore = stub.restore;

    const result = await new TikTokAdsProvider(tiktokConfig, 1000).publishAd(
      ad({ status: 'active' }),
      { campaign: campaign(), adSet: adSet(), adSetExternalId: 'grp-ext-1' },
    );

    assert.equal(result.externalId, 'tt-ad-1');
    assert.match(stub.calls[0]!.url, /\/file\/image\/ad\/upload\/$/);
    assert.equal(bodyOf(stub.calls[0]!.init).upload_type, 'UPLOAD_BY_URL');

    const createBody = bodyOf(stub.calls[1]!.init);
    assert.equal(createBody.adgroup_id, 'grp-ext-1');
    const creative = (createBody.creatives as Array<Record<string, unknown>>)[0]!;
    assert.deepEqual(creative.image_ids, ['img-1']);
    assert.equal(creative.ad_format, 'SINGLE_IMAGE');
    assert.equal(creative.call_to_action, 'GET_QUOTE');
    assert.equal(creative.identity_id, 'ident-1');
  });

  it('desliga o anúncio recém-criado quando ele não deve ficar ativo', async () => {
    const stub = stubFetch((url) => {
      if (url.includes('/file/image/ad/upload/')) {
        return jsonResponse({ code: 0, data: { image_id: 'img-1' } });
      }
      if (url.includes('/ad/create/')) {
        return jsonResponse({ code: 0, data: { ad_ids: ['tt-ad-2'] } });
      }
      return jsonResponse({ code: 0, data: {} });
    });
    restore = stub.restore;

    await new TikTokAdsProvider(tiktokConfig, 1000).publishAd(ad({ status: 'draft' }), {
      campaign: campaign(),
      adSet: adSet(),
      adSetExternalId: 'grp-ext-1',
    });

    assert.equal(stub.calls.length, 3);
    assert.match(stub.calls[2]!.url, /\/ad\/status\/update\/$/);
    assert.equal(bodyOf(stub.calls[2]!.init).operation_status, 'DISABLE');
  });

  it('exige TIKTOK_IDENTITY_ID para criar anúncios', async () => {
    await assert.rejects(
      () =>
        new TikTokAdsProvider({ ...tiktokConfig, identityId: '' }, 1000).publishAd(ad(), {
          campaign: campaign(),
          adSet: adSet(),
          adSetExternalId: 'grp-ext-1',
        }),
      (error: unknown) => error instanceof ProviderError && /TIKTOK_IDENTITY_ID/.test(error.message),
    );
  });
});
