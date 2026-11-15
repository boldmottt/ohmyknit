import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// vite가 'node:sqlite'의 접두사를 떼어 버려서 require로 불러옴
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

/** node:sqlite로 D1의 필요한 부분만 흉내 냄 (테스트 전용) */
export function fakeD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(dir, f), 'utf8'));
  }

  const makeStmt = (sql: string, params: unknown[] = []) => {
    const s = {
      sql,
      params,
      bind: (...p: unknown[]) => makeStmt(sql, p),
      all: async () => ({ results: db.prepare(sql).all(...(params as never[])), success: true, meta: {} }),
      first: async (col?: string) => {
        const row = db.prepare(sql).get(...(params as never[])) as Record<string, unknown> | undefined;
        if (!row) return null;
        return col ? row[col] : row;
      },
      run: async () => {
        const r = db.prepare(sql).run(...(params as never[]));
        return { success: true, meta: { changes: Number(r.changes) }, results: [] };
      },
      raw: async () => [],
    };
    return s;
  };

  return {
    prepare: (sql: string) => makeStmt(sql),
    batch: async (stmts: ReturnType<typeof makeStmt>[]) => {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database;
}

export function fakeR2(): R2Bucket {
  const store = new Map<string, { data: ArrayBuffer; type?: string }>();
  return {
    put: async (key: string, data: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) => {
      store.set(key, { data, type: opts?.httpMetadata?.contentType });
      return { key };
    },
    get: async (key: string) => {
      const o = store.get(key);
      if (!o) return null;
      return {
        body: new Blob([o.data]).stream(),
        httpMetadata: { contentType: o.type },
        arrayBuffer: async () => o.data,
      };
    },
  } as unknown as R2Bucket;
}
