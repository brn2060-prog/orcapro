/**
 * Configuração via variáveis de ambiente.
 *
 * Nenhuma credencial é obrigatória: sem credenciais o provider correspondente
 * fica "não configurado" e as publicações para ele são simuladas (dry-run),
 * sempre marcadas como tal na resposta.
 */

export interface MetaConfig {
  accessToken: string;
  adAccountId: string;
  apiVersion: string;
}

export interface GoogleConfig {
  accessToken: string;
  developerToken: string;
  customerId: string;
  loginCustomerId: string;
  apiVersion: string;
}

export interface TikTokConfig {
  accessToken: string;
  advertiserId: string;
  apiVersion: string;
}

export interface Config {
  port: number;
  host: string;
  logLevel: string;
  dataFile: string;
  /** Força simulação mesmo com credenciais presentes. */
  dryRun: boolean;
  httpTimeoutMs: number;
  meta: MetaConfig;
  google: GoogleConfig;
  tiktok: TikTokConfig;
}

function str(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} precisa ser um número inteiro, recebi "${raw}"`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(raw);
}

export function loadConfig(): Config {
  return {
    port: int('PORT', 3000),
    host: str('HOST', '0.0.0.0'),
    logLevel: str('LOG_LEVEL', 'info'),
    dataFile: str('ORCAPRO_DATA_FILE', 'data/campaigns.json'),
    dryRun: bool('ORCAPRO_DRY_RUN', false),
    httpTimeoutMs: int('ORCAPRO_HTTP_TIMEOUT_MS', 15_000),
    meta: {
      accessToken: str('META_ACCESS_TOKEN'),
      adAccountId: str('META_AD_ACCOUNT_ID'),
      apiVersion: str('META_API_VERSION', 'v21.0'),
    },
    google: {
      accessToken: str('GOOGLE_ADS_ACCESS_TOKEN'),
      developerToken: str('GOOGLE_ADS_DEVELOPER_TOKEN'),
      customerId: str('GOOGLE_ADS_CUSTOMER_ID'),
      loginCustomerId: str('GOOGLE_ADS_LOGIN_CUSTOMER_ID'),
      apiVersion: str('GOOGLE_ADS_API_VERSION', 'v18'),
    },
    tiktok: {
      accessToken: str('TIKTOK_ACCESS_TOKEN'),
      advertiserId: str('TIKTOK_ADVERTISER_ID'),
      apiVersion: str('TIKTOK_API_VERSION', 'v1.3'),
    },
  };
}

/** Carrega `.env` se existir. Node >= 20.6 traz isso embutido. */
export function loadDotEnv(file = '.env'): void {
  try {
    process.loadEnvFile(file);
  } catch {
    // Sem .env — seguimos só com o ambiente do processo.
  }
}
