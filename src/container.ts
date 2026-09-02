import { join } from 'node:path';
import type { Config } from './config.js';
import { buildProviderRegistry, type ProviderRegistry } from './providers/registry.js';
import {
  JsonFileAdRepository,
  JsonFileAdSetRepository,
  JsonFileCampaignRepository,
} from './repository/campaignRepository.js';
import { AdService } from './services/adService.js';
import { AdSetService } from './services/adSetService.js';
import { CampaignService } from './services/campaignService.js';
import { DeployService } from './services/deployService.js';

export interface Container {
  providers: ProviderRegistry;
  campaigns: CampaignService;
  adSets: AdSetService;
  ads: AdService;
  deploys: DeployService;
  dryRun: boolean;
}

/**
 * Monta o grafo de dependências uma vez. Servidor e CLI usam o mesmo — é o
 * único lugar que sabe quais implementações concretas entram.
 */
export function buildContainer(config: Config): Container {
  const providers = buildProviderRegistry(config);
  const dryRun = config.dryRun;

  const campaigns = new CampaignService({
    repository: new JsonFileCampaignRepository(join(config.dataDir, 'campaigns.json')),
    providers,
    dryRun,
  });

  const adSets = new AdSetService({
    repository: new JsonFileAdSetRepository(join(config.dataDir, 'adsets.json')),
    campaigns,
    providers,
    dryRun,
  });

  const ads = new AdService({
    repository: new JsonFileAdRepository(join(config.dataDir, 'ads.json')),
    adSets,
    campaigns,
    providers,
    dryRun,
  });

  return {
    providers,
    campaigns,
    adSets,
    ads,
    deploys: new DeployService(campaigns, adSets, ads),
    dryRun,
  };
}
