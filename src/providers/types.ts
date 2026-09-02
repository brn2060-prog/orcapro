import type { Campaign, CampaignStatus, Platform } from '../domain/campaign.js';

export interface PublishResult {
  externalId: string;
  externalStatus?: string;
}

export interface RemoteStatus {
  externalStatus: string;
}

/**
 * Contrato que toda plataforma de anúncios implementa.
 *
 * Cada provider é responsável por traduzir o modelo do orcapro para o
 * vocabulário da sua API — e só por isso. Regras de negócio ficam no
 * `CampaignService`.
 */
export interface AdProvider {
  readonly platform: Platform;

  /** `false` quando faltam credenciais; nesse caso o serviço simula a publicação. */
  isConfigured(): boolean;

  /** Cria a campanha na plataforma e devolve o ID externo. */
  publish(campaign: Campaign): Promise<PublishResult>;

  /** Propaga uma mudança de status (ativar / pausar / arquivar). */
  setStatus(externalId: string, status: CampaignStatus): Promise<void>;

  /** Lê o status atual na plataforma. */
  fetchStatus(externalId: string): Promise<RemoteStatus>;
}
