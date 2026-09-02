import type { Platform } from '../domain/campaign.js';
import type { AdService } from './adService.js';
import type { AdSetService } from './adSetService.js';
import type { CampaignService } from './campaignService.js';
import type { PublishOutcome } from './publishing.js';

export interface DeployedAd {
  adId: string;
  name: string;
  results: PublishOutcome[];
}

export interface DeployedAdSet {
  adSetId: string;
  name: string;
  results: PublishOutcome[];
  ads: DeployedAd[];
}

export interface DeployReport {
  campaignId: string;
  campaign: PublishOutcome[];
  adSets: DeployedAdSet[];
}

/**
 * Publica a árvore inteira de uma campanha, de cima para baixo.
 *
 * A ordem importa: um conjunto só pode ser criado depois que a campanha tem ID
 * na plataforma, e um anúncio só depois que o conjunto tem. Fazer tudo numa
 * chamada é o caminho normal — publicar nível a nível é para quando se quer
 * conferir cada etapa.
 */
export class DeployService {
  constructor(
    private readonly campaigns: CampaignService,
    private readonly adSets: AdSetService,
    private readonly ads: AdService,
  ) {}

  async deploy(campaignId: string, platforms?: Platform[]): Promise<DeployReport> {
    const campaignReport = await this.campaigns.publish(campaignId, platforms);

    const adSets = await this.adSets.listByCampaign(campaignId);
    const deployedAdSets: DeployedAdSet[] = [];

    for (const adSet of adSets) {
      const adSetReport = await this.adSets.publish(adSet.id, platforms);
      const ads = await this.ads.listByAdSet(adSet.id);

      const deployedAds: DeployedAd[] = [];
      for (const ad of ads) {
        const adReport = await this.ads.publish(ad.id, platforms);
        deployedAds.push({ adId: ad.id, name: ad.name, results: adReport.results });
      }

      deployedAdSets.push({
        adSetId: adSet.id,
        name: adSet.name,
        results: adSetReport.results,
        ads: deployedAds,
      });
    }

    return {
      campaignId,
      campaign: campaignReport.results,
      adSets: deployedAdSets,
    };
  }
}

/** Todos os resultados da árvore, achatados — útil para decidir o status HTTP. */
export function flattenOutcomes(report: DeployReport): PublishOutcome[] {
  return [
    ...report.campaign,
    ...report.adSets.flatMap((adSet) => [
      ...adSet.results,
      ...adSet.ads.flatMap((ad) => ad.results),
    ]),
  ];
}
