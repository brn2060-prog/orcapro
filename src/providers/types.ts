import type { Ad } from '../domain/ad.js';
import type { AdSet } from '../domain/adSet.js';
import type { Campaign, CampaignStatus, Platform } from '../domain/campaign.js';

export interface PublishResult {
  externalId: string;
  externalStatus?: string;
}

export interface RemoteStatus {
  externalStatus: string;
}

/** O que o conjunto precisa saber do que está acima dele na hierarquia. */
export interface AdSetContext {
  campaign: Campaign;
  /** ID da campanha na plataforma — o conjunto é criado dentro dela. */
  campaignExternalId: string;
}

/** O que o anúncio precisa saber do que está acima dele na hierarquia. */
export interface AdContext {
  campaign: Campaign;
  adSet: AdSet;
  /** ID do conjunto na plataforma — o anúncio é criado dentro dele. */
  adSetExternalId: string;
}

/**
 * Contrato que toda plataforma de anúncios implementa, nos três níveis da
 * hierarquia: campanha, conjunto de anúncios e anúncio.
 *
 * Cada provider é responsável por traduzir o modelo do orcapro para o
 * vocabulário da sua API — e só por isso. Regras de negócio e a ordem em que
 * a hierarquia é publicada ficam nos serviços.
 */
export interface AdProvider {
  readonly platform: Platform;

  /** `false` quando faltam credenciais; nesse caso o serviço simula a publicação. */
  isConfigured(): boolean;

  // --- campanha ---
  publish(campaign: Campaign): Promise<PublishResult>;
  setStatus(externalId: string, status: CampaignStatus): Promise<void>;
  fetchStatus(externalId: string): Promise<RemoteStatus>;

  // --- conjunto de anúncios ---
  publishAdSet(adSet: AdSet, context: AdSetContext): Promise<PublishResult>;
  setAdSetStatus(externalId: string, status: CampaignStatus): Promise<void>;

  // --- anúncio ---
  publishAd(ad: Ad, context: AdContext): Promise<PublishResult>;
  setAdStatus(externalId: string, status: CampaignStatus): Promise<void>;
}
