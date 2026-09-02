import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ValidationError } from '../domain/errors.js';
import {
  createCampaignSchema,
  formatZodIssues,
  listQuerySchema,
  publishSchema,
  setStatusSchema,
  updateCampaignSchema,
} from '../domain/schemas.js';
import { describeProviders, type ProviderRegistry } from '../providers/registry.js';
import type { CampaignService, PublishReport } from '../services/campaignService.js';

interface RoutesDeps {
  service: CampaignService;
  providers: ProviderRegistry;
  dryRun: boolean;
}

/** Traduz um erro do zod no erro de domínio que a camada HTTP sabe formatar. */
function parse<T extends z.ZodType>(schema: T, payload: unknown): z.infer<T> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ValidationError('payload inválido', formatZodIssues(result.error));
  }
  return result.data;
}

/**
 * Publicação parcial não é sucesso nem erro total:
 * tudo certo -> 200, tudo falhou -> 502, misto -> 207.
 */
function statusForReport(report: PublishReport): number {
  const failed = report.results.filter((r) => r.outcome === 'failed').length;
  if (failed === 0) return 200;
  return failed === report.results.length ? 502 : 207;
}

export async function registerCampaignRoutes(
  app: FastifyInstance,
  { service, providers, dryRun }: RoutesDeps,
): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/providers', async () => ({
    dryRun,
    providers: describeProviders(providers, dryRun),
  }));

  app.get('/campaigns', async (request) => {
    const filter = parse(listQuerySchema, request.query);
    return { campaigns: await service.list(filter) };
  });

  app.post('/campaigns', async (request, reply) => {
    const input = parse(createCampaignSchema, request.body);
    const campaign = await service.create(input);
    return reply.code(201).send({ campaign });
  });

  app.get<{ Params: { id: string } }>('/campaigns/:id', async (request) => ({
    campaign: await service.get(request.params.id),
  }));

  app.patch<{ Params: { id: string } }>('/campaigns/:id', async (request) => {
    const patch = parse(updateCampaignSchema, request.body);
    return { campaign: await service.update(request.params.id, patch) };
  });

  app.delete<{ Params: { id: string } }>('/campaigns/:id', async (request, reply) => {
    await service.remove(request.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/campaigns/:id/publish', async (request, reply) => {
    const { platforms } = parse(publishSchema, request.body ?? {});
    const report = await service.publish(request.params.id, platforms);
    return reply.code(statusForReport(report)).send(report);
  });

  app.post<{ Params: { id: string } }>('/campaigns/:id/status', async (request, reply) => {
    const { status } = parse(setStatusSchema, request.body);
    const report = await service.setStatus(request.params.id, status);
    return reply.code(statusForReport(report)).send(report);
  });

  app.post<{ Params: { id: string } }>('/campaigns/:id/sync', async (request) => ({
    campaign: await service.sync(request.params.id),
  }));

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
    return reply
      .code(500)
      .send({ error: { code: 'internal_error', message: 'erro interno' } });
  });
}
