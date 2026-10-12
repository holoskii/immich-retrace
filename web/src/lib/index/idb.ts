import {SCHEMA_VERSION} from '../../../../shared/api.ts';

/** String-keyed store; IndexedDB when available, otherwise a Map that lives as long as the tab. Never throws synchronously. */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  /** Values of every key starting with prefix, in key order. */
  list<T>(prefix: string): Promise<T[]>;
  keys(prefix: string): Promise<string[]>;
  /** One transaction: first delete every key under each prefix, then put. */
  write(put: Record<string, unknown>, clear?: string[]): Promise<void>;
}

// One DB per schema at a fixed IDB version: tabs on another schema (upgrade or rollback) never
// block on versionchange or wipe each other; they just ignore each other's DB.
export const DB_NAME = `immich-viewer-v${SCHEMA_VERSION}`;

const done = <T>(r: IDBRequest<T>) => new Promise<T>((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
const under = (p: string) => IDBKeyRange.bound(p, p + '\uffff');

export function memoryKV(): KV {
  const m = new Map<string, unknown>();
  const keys = async (p: string) => [...m.keys()].filter(k => k.startsWith(p)).sort();
  return {
    get: async <T>(k: string) => m.get(k) as T | undefined,
    list: async <T>(p: string) => (await keys(p)).map(k => m.get(k) as T),
    keys,
    async write(put, clear = []) {
      for (const p of clear) for (const k of [...m.keys()]) if (k.startsWith(p)) m.delete(k);
      for (const [k, v] of Object.entries(put)) m.set(k, v);
    },
  };
}

function open(idb: IDBFactory, name: string) {
  const r = idb.open(name, 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  return done(r);
}

// Methods are async so a closed DB (transaction() throws) surfaces as a rejection.
function idbKV(db: IDBDatabase): KV {
  const store = (mode: IDBTransactionMode) => db.transaction('kv', mode).objectStore('kv');
  return {
    get: async <T>(k: string) => done(store('readonly').get(k)) as Promise<T | undefined>,
    list: async <T>(p: string) => done(store('readonly').getAll(under(p))) as Promise<T[]>,
    keys: async (p: string) => done(store('readonly').getAllKeys(under(p))) as Promise<string[]>,
    write: async (put, clear = []) => new Promise<void>((ok, fail) => {
      const s = store('readwrite');
      for (const p of clear) s.delete(under(p));
      for (const [k, v] of Object.entries(put)) s.put(v, k);
      s.transaction.oncomplete = () => ok();
      s.transaction.onerror = s.transaction.onabort = () => fail(s.transaction.error);
    }),
  };
}

/** Best effort: deletes other schemas' DBs. Resolves after `ms` at the latest (a delete stays blocked while a tab holds that DB open). */
export function dropOtherSchemas(idb: IDBFactory, keep = DB_NAME, ms = 2000): Promise<void> {
  const drop = (async () => {
    const dbs = await idb.databases?.() ?? [];
    await Promise.all(dbs.filter(d => d.name && d.name !== keep && /^immich-viewer-v\d+$/.test(d.name))
      .map(d => done(idb.deleteDatabase(d.name!)).catch(() => {})));
  })().catch(() => {});
  return Promise.race([drop, new Promise<void>(r => setTimeout(r, ms))]);
}

export async function openKV(idb: IDBFactory | undefined = globalThis.indexedDB, name = DB_NAME): Promise<KV> {
  try {
    if (!idb) throw new Error('no IndexedDB');
    const db = await open(idb, name);
    void dropOtherSchemas(idb, name);
    let kv = idbKV(db);
    // Someone deletes this DB (a tab on a newer schema cleaning up), or the browser closes it:
    // let go and keep going on memory for the rest of this tab's life.
    db.onversionchange = db.onclose = () => { db.close(); kv = memoryKV(); };
    return {get: <T>(k: string) => kv.get<T>(k), list: <T>(p: string) => kv.list<T>(p), keys: p => kv.keys(p), write: (put, clear) => kv.write(put, clear)};
  } catch (e) {
    console.warn('IndexedDB unavailable, caching in memory only:', e);
    return memoryKV();
  }
}
