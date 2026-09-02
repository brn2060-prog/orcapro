/**
 * Modelo de domínio de campanha.
 *
 * O modelo é deliberadamente neutro em relação à plataforma: cada provider
 * (Meta, Google, TikTok) traduz estes campos para o vocabulário da sua API.
 * Nada aqui deve depender de um formato específico de plataforma.
 */

export const PLATFORMS = ['meta', 'google', 'tiktok'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Objetivos suportados, no vocabulário do orcapro. */
export const OBJECTIVES = [
  'awareness',
  'traffic',
  'engagement',
  'leads',
  'app_promotion',
  'sales',
  'video_views',
] as const;
export type Objective = (typeof OBJECTIVES)[number];

/** Estado da campanha dentro do orcapro (não é o estado na plataforma). */
export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const BUDGET_MODES = ['daily', 'lifetime'] as const;
export type BudgetMode = (typeof BUDGET_MODES)[number];

export interface Budget {
  mode: BudgetMode;
  /** Valor em unidades menores da moeda (centavos para BRL/USD). Sempre inteiro. */
  amountMinor: number;
  /** Código ISO-4217, ex.: "BRL". */
  currency: string;
}

export interface Schedule {
  /** ISO-8601. */
  startAt: string;
  /** ISO-8601. Obrigatório para orçamento `lifetime`. */
  endAt?: string;
}

export const GENDERS = ['all', 'male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

export interface Targeting {
  /** Códigos ISO-3166-1 alpha-2, ex.: ["BR"]. */
  countries: string[];
  ageMin?: number;
  ageMax?: number;
  genders?: Gender[];
  /** Termos livres; cada provider decide como (ou se) usa. */
  interests?: string[];
}

export const PUBLICATION_STATES = ['pending', 'published', 'failed'] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

/** Resultado da publicação da campanha em uma plataforma específica. */
export interface Publication {
  platform: Platform;
  state: PublicationState;
  /** ID da campanha na plataforma. */
  externalId?: string;
  /** Status cru retornado pela plataforma, para diagnóstico. */
  externalStatus?: string;
  publishedAt?: string;
  lastAttemptAt?: string;
  error?: string;
  /**
   * `true` quando a publicação foi simulada — modo dry-run ligado ou provider
   * sem credenciais. Nada foi enviado para a plataforma nesse caso.
   */
  dryRun: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  objective: Objective;
  status: CampaignStatus;
  budget: Budget;
  schedule: Schedule;
  targeting: Targeting;
  /** Plataformas nas quais esta campanha deve existir. */
  platforms: Platform[];
  publications: Publication[];
  createdAt: string;
  updatedAt: string;
}

export function findPublication(campaign: Campaign, platform: Platform): Publication | undefined {
  return campaign.publications.find((p) => p.platform === platform);
}

/** Converte unidades menores para a unidade principal da moeda (centavos -> reais). */
export function toMajorUnits(amountMinor: number): number {
  return amountMinor / 100;
}
