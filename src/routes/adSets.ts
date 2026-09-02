import type { FastifyInstance } from 'fastify';
import {
  createAdSetSchema,
  publishSchema,
  setStatusSchema,
  updateAdSetSchema,
} from '../domain/schemas.js';
import type { AdSetService } from '../services/adSetService.js';
import { parse, statusForOutcomes } from './shared.js';

export async function registerAdSetRoutes(
  app: FastifyInstance,
  adSets: AdSetService,
): Promise<void> {
  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/adsets',
    async (request) => ({ adSets: await adSets.listByCampaign(request.params.campaignId) }),
  );

  app.post<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/adsets',
    async (request, reply) => {
      const input = parse(createAdSetSchema, request.body);
      const adSet = await adSets.create(request.params.campaignId, input);
      return reply.code(201).send({ adSet });
    },
  );

  app.get<{ Params: { id: string } }>('/adsets/:id', async (request) => ({
    adSet: await adSets.get(request.params.id),
  }));

  app.patch<{ Params: { id: string } }>('/adsets/:id', async (request) => {
    const patch = parse(updateAdSetSchema, request.body);
    return { adSet: await adSets.update(request.params.id, patch) };
  });

  app.delete<{ Params: { id: string } }>('/adsets/:id', async (request, reply) => {
    await adSets.remove(request.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/adsets/:id/publish', async (request, reply) => {
    const { platforms } = parse(publishSchema, request.body ?? {});
    const report = await adSets.publish(request.params.id, platforms);
    return reply.code(statusForOutcomes(report.results)).send(report);
  });

  app.post<{ Params: { id: string } }>('/adsets/:id/status', async (request, reply) => {
    const { status } = parse(setStatusSchema, request.body);
    const report = await adSets.setStatus(request.params.id, status);
    return reply.code(statusForOutcomes(report.results)).send(report);
  });
}
