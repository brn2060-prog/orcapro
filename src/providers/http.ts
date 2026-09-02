import { ProviderError } from '../domain/errors.js';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Tentativas totais, incluindo a primeira. */
  attempts?: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function backoffMs(attempt: number): number {
  // 500ms, 1s, 2s... com jitter para não sincronizar retentativas.
  return 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * `fetch` com timeout, retentativa com backoff e erro tipado por plataforma.
 *
 * Só repete o que é seguro repetir: falha de rede, timeout e os status da lista
 * acima. Um 400 da plataforma é erro do payload e volta na primeira tentativa.
 */
export async function requestJson<T>(
  platform: string,
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', headers = {}, body, timeoutMs = 15_000, attempts = 3 } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });

      const text = await response.text();
      clearTimeout(timer);
      const payload = text ? safeJsonParse(text) : undefined;

      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt < attempts) {
          lastError = new ProviderError(platform, `HTTP ${response.status}`, payload ?? text);
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new ProviderError(
          platform,
          `${platform}: a API respondeu HTTP ${response.status}`,
          payload ?? text,
        );
      }

      return payload as T;
    } catch (error) {
      if (error instanceof ProviderError) throw error;

      // Rede caiu ou o timeout abortou: vale repetir.
      lastError = error;
      if (attempt < attempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
      const reason = controller.signal.aborted
        ? `timeout de ${timeoutMs}ms`
        : (error as Error).message;
      throw new ProviderError(platform, `${platform}: falha de rede (${reason})`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new ProviderError(platform, `${platform}: falha após ${attempts} tentativas`, lastError);
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
