import type { Config } from '../config.js';
import type { Platform } from '../domain/campaign.js';
import { GoogleAdsProvider } from './google.js';
import { MetaAdsProvider } from './meta.js';
import { TikTokAdsProvider } from './tiktok.js';
import type { AdProvider } from './types.js';

export type ProviderRegistry = Record<Platform, AdProvider>;

export function buildProviderRegistry(config: Config): ProviderRegistry {
  return {
    meta: new MetaAdsProvider(config.meta, config.httpTimeoutMs),
    google: new GoogleAdsProvider(config.google, config.httpTimeoutMs),
    tiktok: new TikTokAdsProvider(config.tiktok, config.httpTimeoutMs),
  };
}

export function describeProviders(
  registry: ProviderRegistry,
  dryRun: boolean,
): Array<{ platform: Platform; configured: boolean; mode: 'live' | 'dry-run' }> {
  return (Object.keys(registry) as Platform[]).map((platform) => {
    const configured = registry[platform].isConfigured();
    return {
      platform,
      configured,
      mode: dryRun || !configured ? 'dry-run' : 'live',
    };
  });
}
