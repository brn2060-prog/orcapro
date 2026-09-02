import { loadConfig, loadDotEnv } from './config.js';
import { buildProviderRegistry, describeProviders } from './providers/registry.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const app = await buildServer(config);

  const providerStatus = describeProviders(buildProviderRegistry(config), config.dryRun);
  app.log.info({ providers: providerStatus, dryRun: config.dryRun }, 'providers carregados');

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'encerrando');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  console.error('falha ao subir o orcapro:', error);
  process.exit(1);
});
