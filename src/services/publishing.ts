import type { Platform, Publication } from '../domain/campaign.js';
import type { AdProvider, PublishResult } from '../providers/types.js';

export type PublishOutcomeKind =
  | 'published'
  | 'simulated'
  | 'skipped'
  /** A entidade acima na hierarquia ainda não existe nessa plataforma. */
  | 'blocked'
  | 'failed';

export interface PublishOutcome {
  platform: Platform;
  outcome: PublishOutcomeKind;
  externalId?: string;
  error?: string;
}

/** Qualquer coisa que o orcapro publica guarda o resultado do mesmo jeito. */
export interface Publishable {
  publications: Publication[];
}

export function findPublicationOf(
  target: Publishable,
  platform: Platform,
): Publication | undefined {
  return target.publications.find((p) => p.platform === platform);
}

export function recordPublication(target: Publishable, publication: Publication): void {
  const index = target.publications.findIndex((p) => p.platform === publication.platform);
  if (index >= 0) target.publications[index] = publication;
  else target.publications.push(publication);
}

export interface RunPublishOptions {
  platform: Platform;
  provider: AdProvider;
  dryRun: boolean;
  target: Publishable;
  timestamp: string;
  newId: () => string;
  /** A chamada de verdade à plataforma. Só roda fora do dry-run. */
  publish: () => Promise<PublishResult>;
}

/**
 * Executa uma publicação e registra o resultado no alvo.
 *
 * Campanha, conjunto e anúncio compartilham exatamente este fluxo: decidir se
 * simula, chamar a plataforma, e gravar sucesso ou falha na publicação
 * correspondente.
 */
export async function runPublish(options: RunPublishOptions): Promise<PublishOutcome> {
  const { platform, provider, dryRun, target, timestamp, newId, publish } = options;
  const simulate = dryRun || !provider.isConfigured();

  if (simulate) {
    const externalId = `dryrun-${platform}-${newId().slice(0, 8)}`;
    recordPublication(target, {
      platform,
      state: 'published',
      externalId,
      externalStatus: 'SIMULATED',
      publishedAt: timestamp,
      lastAttemptAt: timestamp,
      dryRun: true,
    });
    return { platform, outcome: 'simulated', externalId };
  }

  try {
    const result = await publish();
    recordPublication(target, {
      platform,
      state: 'published',
      externalId: result.externalId,
      externalStatus: result.externalStatus,
      publishedAt: timestamp,
      lastAttemptAt: timestamp,
      dryRun: false,
    });
    return { platform, outcome: 'published', externalId: result.externalId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordPublication(target, {
      platform,
      state: 'failed',
      lastAttemptAt: timestamp,
      error: message,
      dryRun: false,
    });
    return { platform, outcome: 'failed', error: message };
  }
}

/**
 * Registra que a publicação não pôde nem ser tentada porque o nível acima da
 * hierarquia ainda não existe na plataforma.
 */
export function recordBlocked(
  target: Publishable,
  platform: Platform,
  reason: string,
  timestamp: string,
): PublishOutcome {
  recordPublication(target, {
    platform,
    state: 'pending',
    lastAttemptAt: timestamp,
    error: reason,
    dryRun: false,
  });
  return { platform, outcome: 'blocked', error: reason };
}

/**
 * Propaga uma mudança de status para uma plataforma onde a entidade já existe.
 * Devolve `undefined` quando não há o que propagar.
 */
export async function runStatusChange(options: {
  publication: Publication;
  apply: (externalId: string) => Promise<void>;
}): Promise<PublishOutcome> {
  const { publication, apply } = options;

  if (publication.state !== 'published' || !publication.externalId) {
    return { platform: publication.platform, outcome: 'skipped' };
  }

  if (publication.dryRun) {
    publication.externalStatus = 'SIMULATED';
    return {
      platform: publication.platform,
      outcome: 'simulated',
      externalId: publication.externalId,
    };
  }

  try {
    await apply(publication.externalId);
    publication.error = undefined;
    return {
      platform: publication.platform,
      outcome: 'published',
      externalId: publication.externalId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    publication.error = message;
    return { platform: publication.platform, outcome: 'failed', error: message };
  }
}
