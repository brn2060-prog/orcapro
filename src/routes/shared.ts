import type { z } from 'zod';
import { ValidationError } from '../domain/errors.js';
import { formatZodIssues } from '../domain/schemas.js';
import type { PublishOutcome } from '../services/publishing.js';

/** Traduz um erro do zod no erro de domínio que a camada HTTP sabe formatar. */
export function parse<T extends z.ZodType>(schema: T, payload: unknown): z.infer<T> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ValidationError('payload inválido', formatZodIssues(result.error));
  }
  return result.data as z.infer<T>;
}

/**
 * Publicação parcial não é sucesso nem erro total:
 * tudo certo -> 200, tudo com problema -> 502, misto -> 207.
 *
 * `blocked` (o nível acima ainda não existe na plataforma) conta como problema
 * junto com `failed` — em ambos os casos nada foi criado lá.
 */
export function statusForOutcomes(results: PublishOutcome[]): number {
  if (results.length === 0) return 200;
  const problems = results.filter(
    (r) => r.outcome === 'failed' || r.outcome === 'blocked',
  ).length;
  if (problems === 0) return 200;
  return problems === results.length ? 502 : 207;
}
