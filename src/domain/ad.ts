/**
 * Anúncio e seu criativo — o que a pessoa realmente vê.
 *
 * Os campos são a união do que as três plataformas pedem, no menor
 * denominador que ainda faz sentido em cada uma. Nem toda plataforma usa
 * tudo: o Google monta um anúncio de pesquisa responsivo a partir de
 * `headlines`/`descriptions` e ignora a mídia; Meta e TikTok usam a mídia e
 * consomem só a primeira headline.
 */
import type { CampaignStatus, Platform, Publication } from './campaign.js';

export const AD_FORMATS = ['single_image', 'single_video'] as const;
export type AdFormat = (typeof AD_FORMATS)[number];

export const CALL_TO_ACTIONS = [
  'learn_more',
  'shop_now',
  'sign_up',
  'contact_us',
  'download',
  'book_now',
  'get_quote',
] as const;
export type CallToAction = (typeof CALL_TO_ACTIONS)[number];

export interface Creative {
  format: AdFormat;
  /**
   * Títulos. Meta e TikTok usam o primeiro; o Google monta o anúncio
   * responsivo com todos (e exige pelo menos três).
   */
  headlines: string[];
  /** Descrições. O Google exige pelo menos duas. */
  descriptions: string[];
  /** Texto principal — "primary text" na Meta, "ad text" na TikTok. */
  primaryText?: string;
  landingPageUrl: string;
  callToAction: CallToAction;
  /** Imagem por URL. Obrigatória em `single_image`. */
  imageUrl?: string;
  /**
   * ID do vídeo já hospedado, por plataforma — o mesmo vídeo tem IDs
   * diferentes na Meta e na TikTok, então não dá para ter um campo só.
   * Obrigatório, para a plataforma alvo, em `single_video`.
   */
  videoIds?: Partial<Record<Platform, string>>;
}

export interface Ad {
  id: string;
  adSetId: string;
  name: string;
  status: CampaignStatus;
  creative: Creative;
  publications: Publication[];
  createdAt: string;
  updatedAt: string;
}

/** ID do vídeo para a plataforma, quando o formato for de vídeo. */
export function videoIdFor(creative: Creative, platform: Platform): string | undefined {
  return creative.videoIds?.[platform];
}
