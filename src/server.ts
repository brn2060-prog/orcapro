import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { buildProviderRegistry } from './providers/registry.js';
import { JsonFileCampaignRepository } from './repository/campaignRepository.js';
import { registerCampaignRoutes } from './routes/campaigns.js';
import { CampaignService } from './services/campaignService.js';

export async function buildServer(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });

  const providers = buildProviderRegistry(config);
  const service = new CampaignService({
    repository: new JsonFileCampaignRepository(config.dataFile),
    providers,
    dryRun: config.dryRun,
  });

  await registerCampaignRoutes(app, { service, providers, dryRun: config.dryRun });

  return app;
}
