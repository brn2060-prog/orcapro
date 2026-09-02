import type { FastifyInstance } from 'fastify';
import { createAdSchema, publishSchema, setStatusSchema, updateAdSchema } from '../domain/schemas.js';
import type { AdService } from '../services/adService.js';
import { parse, statusForOutcomes } from './shared.js';

export async function registerAdRoutes(app: FastifyInstance, ads: AdService): Promise<void> {
  app.get<{ Params: { adSetId: string } }>('/adsets/:adSetId/ads', async (request) => ({
    ads: await ads.listByAdSet(request.params.adSetId),
  }));

  app.post<{ Params: { adSetId: string } }>('/adsets/:adSetId/ads', async (request, reply) => {
    const input = parse(createAdSchema, request.body);
    const ad = await ads.create(request.params.adSetId, input);
    return reply.code(201).send({ ad });
  });

  app.get<{ Params: { id: string } }>('/ads/:id', async (request) => ({
    ad: await ads.get(request.params.id),
  }));

  app.patch<{ Params: { id: string } }>('/ads/:id', async (request) => {
    const patch = parse(updateAdSchema, request.body);
    return { ad: await ads.update(request.params.id, patch) };
  });

  app.delete<{ Params: { id: string } }>('/ads/:id', async (request, reply) => {
    await ads.remove(request.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/ads/:id/publish', async (request, reply) => {
    const { platforms } = parse(publishSchema, request.body ?? {});
    const report = await ads.publish(request.params.id, platforms);
    return reply.code(statusForOutcomes(report.results)).send(report);
  });

  app.post<{ Params: { id: string } }>('/ads/:id/status', async (request, reply) => {
    const { status } = parse(setStatusSchema, request.body);
    const report = await ads.setStatus(request.params.id, status);
    return reply.code(statusForOutcomes(report.results)).send(report);
  });
}
