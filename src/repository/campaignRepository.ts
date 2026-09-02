import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Campaign } from '../domain/campaign.js';

export interface CampaignRepository {
  list(): Promise<Campaign[]>;
  findById(id: string): Promise<Campaign | undefined>;
  save(campaign: Campaign): Promise<void>;
  delete(id: string): Promise<boolean>;
}

/** Implementação em memória — usada nos testes e como base do repositório em arquivo. */
export class InMemoryCampaignRepository implements CampaignRepository {
  protected campaigns = new Map<string, Campaign>();

  async list(): Promise<Campaign[]> {
    return [...this.campaigns.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findById(id: string): Promise<Campaign | undefined> {
    return this.campaigns.get(id);
  }

  async save(campaign: Campaign): Promise<void> {
    this.campaigns.set(campaign.id, campaign);
  }

  async delete(id: string): Promise<boolean> {
    return this.campaigns.delete(id);
  }
}

/**
 * Persistência em um único arquivo JSON.
 *
 * Suficiente para o volume de campanhas de uma agência e sem dependência de
 * banco. As escritas são serializadas e atômicas (arquivo temporário +
 * `rename`), então uma queda no meio da gravação não corrompe o arquivo.
 * Para múltiplas instâncias do servidor, troque por um repositório de banco —
 * a interface acima é o único ponto de contato.
 */
export class JsonFileCampaignRepository implements CampaignRepository {
  private readonly file: string;
  private campaigns = new Map<string, Campaign>();
  /** Carregamento memoizado: sem isso, escritas concorrentes se sobrescrevem. */
  private loadPromise: Promise<void> | undefined;
  /** Fila de escrita: garante uma gravação por vez. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.file = resolve(file);
  }

  /**
   * Chamadas concorrentes compartilham a mesma leitura. Se cada uma lesse o
   * arquivo por conta própria, a última a terminar substituiria o mapa e
   * descartaria o que as outras já tinham gravado em memória.
   */
  private load(): Promise<void> {
    this.loadPromise ??= this.readFromDisk().catch((error: unknown) => {
      // Falha não fica cacheada: a próxima chamada tenta de novo.
      this.loadPromise = undefined;
      throw error;
    });
    return this.loadPromise;
  }

  private async readFromDisk(): Promise<void> {
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error(`${this.file} deveria conter um array de campanhas`);
      }
      this.campaigns = new Map((parsed as Campaign[]).map((c) => [c.id, c]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.campaigns = new Map();
    }
  }

  private enqueueFlush(): Promise<void> {
    const snapshot = [...this.campaigns.values()];
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      await rename(tmp, this.file);
    });
    return this.writeChain;
  }

  async list(): Promise<Campaign[]> {
    await this.load();
    return [...this.campaigns.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findById(id: string): Promise<Campaign | undefined> {
    await this.load();
    return this.campaigns.get(id);
  }

  async save(campaign: Campaign): Promise<void> {
    await this.load();
    this.campaigns.set(campaign.id, campaign);
    await this.enqueueFlush();
  }

  async delete(id: string): Promise<boolean> {
    await this.load();
    const existed = this.campaigns.delete(id);
    if (existed) await this.enqueueFlush();
    return existed;
  }
}
