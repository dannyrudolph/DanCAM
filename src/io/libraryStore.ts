import type { LibraryBlock } from '../model/library';

/**
 * Where the block library lives: the browser's IndexedDB, shared by every
 * drawing opened in this browser (spec, "Blocks", Library). Blocks are keyed
 * by name without case, so `put` replaces a block of the same name in any
 * case; callers ask before replacing one.
 */
export interface BlockLibraryStore {
  list(): Promise<LibraryBlock[]>;
  put(blocks: readonly LibraryBlock[]): Promise<void>;
  remove(name: string): Promise<void>;
}

const DB = 'dancam';
const STORE = 'blocks';

type Row = { readonly key: string; readonly block: LibraryBlock };

export class IndexedDbLibrary implements BlockLibraryStore {
  private db: Promise<IDBDatabase> | undefined;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('this browser has no IndexedDB'));
        return;
      }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB would not open'));
    });
    return this.db;
  }

  private async run<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB stopped'));
    });
  }

  async list(): Promise<LibraryBlock[]> {
    const rows = ((await this.run('readonly', (s) => s.getAll())) ?? []) as Row[];
    return rows.map((r) => r.block);
  }

  async put(blocks: readonly LibraryBlock[]): Promise<void> {
    await this.run('readwrite', (s) => {
      for (const block of blocks) s.put({ key: block.name.toLowerCase(), block } satisfies Row);
    });
  }

  async remove(name: string): Promise<void> {
    await this.run('readwrite', (s) => {
      s.delete(name.toLowerCase());
    });
  }
}
