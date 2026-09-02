import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../domain/errors.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { AdService } from '../services/adService.js';
import type { AdSetService } from '../services/adSetService.js';
import type { CampaignService } from '../services/campaignService.js';
import type { DeployService } from '../services/deployService.js';
import { registerAdRoutes } from './ads.js';
import { registerAdSetRoutes } from './adSets.js';
import { registerCampaignRoutes } from './campaigns.js';

export interface RoutesDeps {
  campaigns: CampaignService;
  adSets: AdSetService;
  ads: AdService;
  deploys: DeployService;
  providers: ProviderRegistry;
  dryRun: boolean;
}

export async function registerRoutes(app: FastifyInstance, deps: RoutesDeps): Promise<void> {
  await registerCampaignRoutes(app, {
    campaigns: deps.campaigns,
    deploys: deps.deploys,
    providers: deps.providers,
    dryRun: deps.dryRun,
  });
  await registerAdSetRoutes(app, deps.adSets);
  await registerAdRoutes(app, deps.ads);

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    // Corpo malformado chega como erro do próprio Fastify.
    if (typeof error.statusCode === 'number' && error.statusCode < 500) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: 'bad_request', message: error.message } });
    }

    request.log.error({ err: error }, 'erro não tratado');
    return reply.code(500).send({ error: { code: 'internal_error', message: 'erro interno' } });
  });
}
