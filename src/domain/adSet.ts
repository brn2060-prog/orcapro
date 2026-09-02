/**
 * Conjunto de anúncios — "ad set" na Meta, "ad group" no Google e na TikTok.
 *
 * É aqui que mora a segmentação que de fato é entregue: a campanha define
 * objetivo e orçamento, o conjunto define para quem e com qual otimização.
 */
import type { Budget, CampaignStatus, Publication, Schedule, Targeting } from './campaign.js';

export interface AdSet {
  id: string;
  campaignId: string;
  name: string;
  status: CampaignStatus;
  /**
   * Orçamento próprio. Omitido = herda o da campanha — na Meta isso é o
   * Campaign Budget Optimization, que distribui o orçamento entre os conjuntos.
   */
  budget?: Budget;
  /** Janela própria. Omitida = herda a da campanha. */
  schedule?: Schedule;
  targeting: Targeting;
  /** Lance máximo em unidades menores. Omitido = lance automático. */
  bidAmountMinor?: number;
  publications: Publication[];
  createdAt: string;
  updatedAt: string;
}

/** Orçamento efetivo: o do conjunto, ou o da campanha quando ele não tem. */
export function effectiveBudget(adSet: AdSet, campaignBudget: Budget): Budget {
  return adSet.budget ?? campaignBudget;
}

/** Janela efetiva: a do conjunto, ou a da campanha quando ele não tem. */
export function effectiveSchedule(adSet: AdSet, campaignSchedule: Schedule): Schedule {
  return adSet.schedule ?? campaignSchedule;
}
