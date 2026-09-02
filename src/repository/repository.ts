import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** Tudo que o orcapro persiste tem ID e data de criação. */
export interface Entity {
  id: string;
  createdAt: string;
}

export interface Repository<T extends Entity> {
  list(): Promise<T[]>;
  findById(id: string): Promise<T | undefined>;
  save(entity: T): Promise<void>;
  delete(id: string): Promise<boolean>;
}

/** Implementação em memória — usada nos testes. */
export class InMemoryRepository<T extends Entity> implements Repository<T> {
  private entities = new Map<string, T>();

  async list(): Promise<T[]> {
    return [...this.entities.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findById(id: string): Promise<T | undefined> {
    return this.entities.get(id);
  }

  async save(entity: T): Promise<void> {
    this.entities.set(entity.id, entity);
  }

  async delete(id: string): Promise<boolean> {
    return this.entities.delete(id);
  }
}

/**
 * Persistência em um único arquivo JSON por coleção.
 *
 * Suficiente para o volume de uma agência e sem dependência de banco. As
 * escritas são serializadas e atômicas (arquivo temporário + `rename`), então
 * uma queda no meio da gravação não corrompe o arquivo. Para múltiplas
 * instâncias do servidor, troque por um repositório de banco — a interface
 * `Repository` é o único ponto de contato.
 */
export class JsonFileRepository<T extends Entity> implements Repository<T> {
  private readonly file: string;
  private entities = new Map<string, T>();
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
        throw new Error(`${this.file} deveria conter um array`);
      }
      this.entities = new Map((parsed as T[]).map((entity) => [entity.id, entity]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.entities = new Map();
    }
  }

  private enqueueFlush(): Promise<void> {
    const snapshot = [...this.entities.values()];
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      await rename(tmp, this.file);
    });
    return this.writeChain;
  }

  async list(): Promise<T[]> {
    await this.load();
    return [...this.entities.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findById(id: string): Promise<T | undefined> {
    await this.load();
    return this.entities.get(id);
  }

  async save(entity: T): Promise<void> {
    await this.load();
    this.entities.set(entity.id, entity);
    await this.enqueueFlush();
  }

  async delete(id: string): Promise<boolean> {
    await this.load();
    const existed = this.entities.delete(id);
    if (existed) await this.enqueueFlush();
    return existed;
  }
}
