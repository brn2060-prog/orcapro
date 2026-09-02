import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import type { Campaign } from '../src/domain/campaign.js';
import { JsonFileCampaignRepository } from '../src/repository/campaignRepository.js';
import { campaignInput } from './helpers.js';

const dirs: string[] = [];

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'orcapro-'));
  dirs.push(dir);
  // Subdiretório inexistente de propósito: o repositório deve criá-lo.
  return join(dir, 'nested', 'campaigns.json');
}

function makeCampaign(id: string): Campaign {
  return {
    id,
    ...campaignInput(),
    publications: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as Campaign;
}

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('JsonFileCampaignRepository', () => {
  it('trata arquivo inexistente como base vazia', async () => {
    const repo = new JsonFileCampaignRepository(await tempFile());
    assert.deepEqual(await repo.list(), []);
    assert.equal(await repo.findById('qualquer'), undefined);
  });

  it('persiste e relê pelo disco', async () => {
    const file = await tempFile();
    const writer = new JsonFileCampaignRepository(file);
    await writer.save(makeCampaign('a'));
    await writer.save(makeCampaign('b'));

    const reader = new JsonFileCampaignRepository(file);
    const all = await reader.list();

    assert.deepEqual(all.map((c) => c.id).sort(), ['a', 'b']);
    assert.equal((await reader.findById('a'))?.id, 'a');
  });

  it('remove e reflete no arquivo', async () => {
    const file = await tempFile();
    const repo = new JsonFileCampaignRepository(file);
    await repo.save(makeCampaign('a'));

    assert.equal(await repo.delete('a'), true);
    assert.equal(await repo.delete('a'), false);

    const raw = JSON.parse(await readFile(file, 'utf8')) as unknown[];
    assert.deepEqual(raw, []);
  });

  it('não perde escritas concorrentes', async () => {
    const file = await tempFile();
    const repo = new JsonFileCampaignRepository(file);

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => repo.save(makeCampaign(`c${i}`))),
    );

    const reread = await new JsonFileCampaignRepository(file).list();
    assert.equal(reread.length, 20);
  });

  it('rejeita um arquivo que não contém um array', async () => {
    const file = await tempFile();
    const repo = new JsonFileCampaignRepository(file);
    await repo.save(makeCampaign('a'));

    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, '{"nao":"e um array"}', 'utf8');

    await assert.rejects(() => new JsonFileCampaignRepository(file).list(), /deveria conter um array/);
  });
});
