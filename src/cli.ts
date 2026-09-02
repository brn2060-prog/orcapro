/**
 * CLI para subir campanhas a partir de um arquivo JSON.
 *
 *   npm run campanha -- publicar examples/campanha.json
 *   npm run campanha -- publicar examples/campanha.json --plataformas meta,tiktok
 *   npm run campanha -- listar
 *   npm run campanha -- status <id> pausar
 *   npm run campanha -- sincronizar <id>
 */
import { readFile } from 'node:fs/promises';
import { loadConfig, loadDotEnv } from './config.js';
import type { Platform } from './domain/campaign.js';
import { PLATFORMS } from './domain/campaign.js';
import { AppError } from './domain/errors.js';
import { createCampaignSchema, formatZodIssues } from './domain/schemas.js';
import { buildProviderRegistry, describeProviders } from './providers/registry.js';
import { JsonFileCampaignRepository } from './repository/campaignRepository.js';
import { CampaignService } from './services/campaignService.js';

const USAGE = `
orcapro — campanhas de anúncios

  publicar <arquivo.json> [--plataformas meta,google,tiktok]
      Cria a campanha descrita no arquivo e publica nas plataformas.

  listar
      Lista as campanhas salvas.

  status <id> <ativar|pausar|arquivar>
      Muda o status e propaga para as plataformas publicadas.

  sincronizar <id>
      Relê o status de cada plataforma.

  provedores
      Mostra quais plataformas estão configuradas.

Sem credenciais, ou com ORCAPRO_DRY_RUN=true, a publicação é simulada.
`.trim();

function parsePlatformsFlag(args: string[]): Platform[] | undefined {
  const index = args.findIndex((a) => a === '--plataformas' || a === '--platforms');
  if (index === -1) return undefined;

  const raw = args[index + 1];
  if (!raw) throw new Error('--plataformas exige uma lista, ex.: meta,tiktok');

  const list = raw.split(',').map((p) => p.trim().toLowerCase());
  const invalid = list.filter((p) => !PLATFORMS.includes(p as Platform));
  if (invalid.length > 0) {
    throw new Error(
      `plataforma desconhecida: ${invalid.join(', ')}. Use: ${PLATFORMS.join(', ')}`,
    );
  }
  return list as Platform[];
}

function buildService(): { service: CampaignService; dryRun: boolean } {
  loadDotEnv();
  const config = loadConfig();
  return {
    service: new CampaignService({
      repository: new JsonFileCampaignRepository(config.dataFile),
      providers: buildProviderRegistry(config),
      dryRun: config.dryRun,
    }),
    dryRun: config.dryRun,
  };
}

async function cmdPublicar(args: string[]): Promise<number> {
  const file = args[0];
  if (!file) throw new Error('informe o arquivo JSON da campanha');

  const raw = await readFile(file, 'utf8');
  const parsed = createCampaignSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error(`${file} não passou na validação:`);
    for (const issue of formatZodIssues(parsed.error)) {
      console.error(`  · ${issue.path}: ${issue.message}`);
    }
    return 1;
  }

  const platforms = parsePlatformsFlag(args);
  const { service } = buildService();

  const campaign = await service.create(parsed.data);
  console.log(`campanha criada: ${campaign.id} — "${campaign.name}"`);

  const report = await service.publish(campaign.id, platforms);

  let failures = 0;
  for (const result of report.results) {
    switch (result.outcome) {
      case 'published':
        console.log(`  ✓ ${result.platform}: publicada (${result.externalId})`);
        break;
      case 'simulated':
        console.log(`  ~ ${result.platform}: simulada (${result.externalId}) — nada foi enviado`);
        break;
      case 'skipped':
        console.log(`  · ${result.platform}: já publicada, pulada`);
        break;
      case 'failed':
        failures += 1;
        console.error(`  ✗ ${result.platform}: ${result.error}`);
        break;
    }
  }

  return failures > 0 ? 1 : 0;
}

async function cmdListar(): Promise<number> {
  const { service } = buildService();
  const campaigns = await service.list();

  if (campaigns.length === 0) {
    console.log('nenhuma campanha salva.');
    return 0;
  }

  for (const campaign of campaigns) {
    const publications = campaign.publications
      .map((p) => `${p.platform}:${p.state}${p.dryRun ? '(dry-run)' : ''}`)
      .join(' ');
    console.log(`${campaign.id}  ${campaign.status.padEnd(8)}  ${campaign.name}`);
    console.log(`  ${publications}`);
  }
  return 0;
}

const STATUS_ALIASES: Record<string, 'active' | 'paused' | 'archived'> = {
  ativar: 'active',
  active: 'active',
  pausar: 'paused',
  paused: 'paused',
  arquivar: 'archived',
  archived: 'archived',
};

async function cmdStatus(args: string[]): Promise<number> {
  const [id, action] = args;
  if (!id || !action) throw new Error('uso: status <id> <ativar|pausar|arquivar>');

  const status = STATUS_ALIASES[action.toLowerCase()];
  if (!status) throw new Error(`ação desconhecida: ${action}`);

  const { service } = buildService();
  const report = await service.setStatus(id, status);
  console.log(`campanha ${id} agora está "${report.campaign.status}"`);

  let failures = 0;
  for (const result of report.results) {
    if (result.outcome === 'failed') {
      failures += 1;
      console.error(`  ✗ ${result.platform}: ${result.error}`);
    } else {
      console.log(`  · ${result.platform}: ${result.outcome}`);
    }
  }
  return failures > 0 ? 1 : 0;
}

async function cmdSincronizar(args: string[]): Promise<number> {
  const id = args[0];
  if (!id) throw new Error('uso: sincronizar <id>');

  const { service } = buildService();
  const campaign = await service.sync(id);
  for (const publication of campaign.publications) {
    console.log(
      `  ${publication.platform}: ${publication.externalStatus ?? '—'}` +
        (publication.error ? ` (erro: ${publication.error})` : ''),
    );
  }
  return 0;
}

async function cmdProvedores(): Promise<number> {
  loadDotEnv();
  const config = loadConfig();
  for (const entry of describeProviders(buildProviderRegistry(config), config.dryRun)) {
    console.log(
      `  ${entry.platform.padEnd(8)} ${entry.configured ? 'configurado' : 'sem credenciais'}  →  ${entry.mode}`,
    );
  }
  return 0;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'publicar':
      return cmdPublicar(args);
    case 'listar':
      return cmdListar();
    case 'status':
      return cmdStatus(args);
    case 'sincronizar':
      return cmdSincronizar(args);
    case 'provedores':
      return cmdProvedores();
    default:
      console.log(USAGE);
      return command ? 1 : 0;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof AppError) {
      console.error(`erro: ${error.message}`);
      if (error.details) console.error(JSON.stringify(error.details, null, 2));
    } else {
      console.error(`erro: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  });
