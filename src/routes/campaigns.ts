import type { FastifyInstance } from 'fastify';
import {
  createCampaignSchema,
  listQuerySchema,
  publishSchema,
  setStatusSchema,
  updateCampaignSchema,
} from '../domain/schemas.js';
import { describeProviders, type ProviderRegistry } from '../providers/registry.js';
import type { CampaignService } from '../services/campaignService.js';
import { flattenOutcomes, type DeployService } from '../services/deployService.js';
import { parse, statusForOutcomes } from './shared.js';

interface Deps {
  campaigns: CampaignService;
  deploys: DeployService;
  providers: ProviderRegistry;
  dryRun: boolean;
}

export async function registerCampaignRoutes(
  app: FastifyInstance,
  { campaigns, deploys, providers, dryRun }: Deps,
): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/providers', async () => ({
    dryRun,
    providers: describeProviders(providers, dryRun),
  }));

  app.get('/campaigns', async (request) => {
    const filter = parse(listQuerySchema, request.query);
    return { campaigns: await campaigns.list(filter) };
  });

  app.post('/campaigns', async (request, reply) => {
    const input = parse(createCampaignSchema, request.body);
    const campaign = await campaigns.create(input);
    return reply.code(201).send({ campaign });
  });

  app.get<{ Params: { id: string } }>('/campaigns/:id', async (request) => ({
    campaign: await campaigns.get(request.params.id),
  }));

  app.patch<{ Params: { id: string } }>('/campaigns/:id', async (request) => {
    const patch = parse(updateCampaignSchema, request.body);
    return { campaign: await campaigns.update(request.params.id, patch) };
  });

  app.delete<{ Params: { id: string } }>('/campaigns/:id', async (request, reply) => {
    await campaigns.remove(request.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/campaigns/:id/publish', async (request, reply) => {
    const { platforms } = parse(publishSchema, request.body ?? {});
    const report = await campaigns.publish(request.params.id, platforms);
    return reply.code(statusForOutcomes(report.results)).send(report);
  });

  app.post<{ Params: { id: string } }>('/campaigns/:id/status', async (request, reply) => {
    const { status } = parse(setStatusSchema, request.body);
    const report = await campaigns.setStatus(request.params.id, status);
    return reply.code(statusForOutcomes(report.results)).send(report);
  });

  app.post<{ Params: { id: string } }>('/campaigns/:id/sync', async (request) => ({
    campaign: await campaigns.sync(request.params.id),
  }));

  /** Publica a árvore inteira — campanha, conjuntos e anúncios, nessa ordem. */
  app.post<{ Params: { id: string } }>('/campaigns/:id/deploy', async (request, reply) => {
    const { platforms } = parse(publishSchema, request.body ?? {});
    const report = await deploys.deploy(request.params.id, platforms);
    return reply.code(statusForOutcomes(flattenOutcomes(report))).send(report);
  });
}
