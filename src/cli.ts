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
import { buildContainer, type Container } from './container.js';
import type { Platform } from './domain/campaign.js';
import { PLATFORMS } from './domain/campaign.js';
import { AppError } from './domain/errors.js';
import { campaignFileSchema, formatZodIssues } from './domain/schemas.js';
import { buildProviderRegistry, describeProviders } from './providers/registry.js';
import { flattenOutcomes, type DeployReport } from './services/deployService.js';
import type { PublishOutcome } from './services/publishing.js';

const USAGE = `
orcapro — campanhas de anúncios

  publicar <arquivo.json> [--plataformas meta,google,tiktok]
      Sobe a campanha do arquivo — com seus conjuntos e anúncios, se houver —
      e publica tudo na ordem certa.

  listar
      Lista as campanhas salvas com seus conjuntos e anúncios.

  status <id> <ativar|pausar|arquivar>
      Muda o status da campanha e propaga para as plataformas publicadas.

  sincronizar <id>
      Relê o status da campanha em cada plataforma.

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

function buildCli(): Container {
  loadDotEnv();
  return buildContainer(loadConfig());
}

const SYMBOL: Record<PublishOutcome['outcome'], string> = {
  published: '✓',
  simulated: '~',
  skipped: '·',
  blocked: '!',
  failed: '✗',
};

function describeOutcome(result: PublishOutcome): string {
  switch (result.outcome) {
    case 'published':
      return `${result.platform}: publicado (${result.externalId})`;
    case 'simulated':
      return `${result.platform}: simulado (${result.externalId}) — nada foi enviado`;
    case 'skipped':
      return `${result.platform}: já publicado, pulado`;
    case 'blocked':
      return `${result.platform}: bloqueado — ${result.error}`;
    case 'failed':
      return `${result.platform}: ${result.error}`;
  }
}

function printOutcomes(results: PublishOutcome[], indent: string): void {
  for (const result of results) {
    const line = `${indent}${SYMBOL[result.outcome]} ${describeOutcome(result)}`;
    if (result.outcome === 'failed' || result.outcome === 'blocked') console.error(line);
    else console.log(line);
  }
}

function printDeploy(report: DeployReport): void {
  console.log('  campanha');
  printOutcomes(report.campaign, '    ');

  for (const adSet of report.adSets) {
    console.log(`  conjunto "${adSet.name}"`);
    printOutcomes(adSet.results, '    ');
    for (const ad of adSet.ads) {
      console.log(`    anúncio "${ad.name}"`);
      printOutcomes(ad.results, '      ');
    }
  }
}

async function cmdPublicar(args: string[]): Promise<number> {
  const file = args[0];
  if (!file) throw new Error('informe o arquivo JSON da campanha');

  const raw = await readFile(file, 'utf8');
  const parsed = campaignFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error(`${file} não passou na validação:`);
    for (const issue of formatZodIssues(parsed.error)) {
      console.error(`  · ${issue.path}: ${issue.message}`);
    }
    return 1;
  }

  const platforms = parsePlatformsFlag(args);
  const cli = buildCli();
  const { adSets: adSetInputs, ...campaignInput } = parsed.data;

  const campaign = await cli.campaigns.create(campaignInput);
  console.log(`campanha criada: ${campaign.id} — "${campaign.name}"`);

  for (const { ads: adInputs, ...adSetInput } of adSetInputs ?? []) {
    const adSet = await cli.adSets.create(campaign.id, adSetInput);
    console.log(`  conjunto criado: ${adSet.id} — "${adSet.name}"`);
    for (const adInput of adInputs ?? []) {
      const ad = await cli.ads.create(adSet.id, adInput);
      console.log(`    anúncio criado: ${ad.id} — "${ad.name}"`);
    }
  }

  console.log('\npublicando:');
  const report = await cli.deploys.deploy(campaign.id, platforms);
  printDeploy(report);

  const problems = flattenOutcomes(report).filter(
    (r) => r.outcome === 'failed' || r.outcome === 'blocked',
  );
  return problems.length > 0 ? 1 : 0;
}

async function cmdListar(): Promise<number> {
  const cli = buildCli();
  const campaigns = await cli.campaigns.list();

  if (campaigns.length === 0) {
    console.log('nenhuma campanha salva.');
    return 0;
  }

  const summarize = (publications: { platform: string; state: string; dryRun: boolean }[]): string =>
    publications.map((p) => `${p.platform}:${p.state}${p.dryRun ? '(dry-run)' : ''}`).join(' ');

  for (const campaign of campaigns) {
    console.log(`${campaign.id}  ${campaign.status.padEnd(8)}  ${campaign.name}`);
    console.log(`  ${summarize(campaign.publications)}`);

    for (const adSet of await cli.adSets.listByCampaign(campaign.id)) {
      console.log(`  └ conjunto "${adSet.name}"  ${summarize(adSet.publications)}`);
      for (const ad of await cli.ads.listByAdSet(adSet.id)) {
        console.log(`      └ anúncio "${ad.name}"  ${summarize(ad.publications)}`);
      }
    }
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

  const cli = buildCli();
  const report = await cli.campaigns.setStatus(id, status);
  console.log(`campanha ${id} agora está "${report.campaign.status}"`);
  printOutcomes(report.results, '  ');

  return report.results.some((r) => r.outcome === 'failed') ? 1 : 0;
}

async function cmdSincronizar(args: string[]): Promise<number> {
  const id = args[0];
  if (!id) throw new Error('uso: sincronizar <id>');

  const cli = buildCli();
  const campaign = await cli.campaigns.sync(id);
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
