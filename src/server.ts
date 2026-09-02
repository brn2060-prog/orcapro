import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { buildContainer } from './container.js';
import { registerRoutes } from './routes/index.js';

export async function buildServer(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });
  const container = buildContainer(config);

  await registerRoutes(app, {
    campaigns: container.campaigns,
    adSets: container.adSets,
    ads: container.ads,
    deploys: container.deploys,
    providers: container.providers,
    dryRun: container.dryRun,
  });

  return app;
}
