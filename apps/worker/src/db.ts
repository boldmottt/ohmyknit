/** D1 위에 얇게 씌운 도우미. 테스트에서는 node:sqlite로 같은 인터페이스를 흉내 냅니다. */
export type Param = string | number | null;

export class Db {
  constructor(private readonly d1: D1Database) {}

  stmt(sql: string, ...params: Param[]): D1PreparedStatement {
    return this.d1.prepare(sql).bind(...params);
  }

  async all<T>(sql: string, ...params: Param[]): Promise<T[]> {
    const r = await this.stmt(sql, ...params).all<T>();
    return r.results ?? [];
  }

  async first<T>(sql: string, ...params: Param[]): Promise<T | null> {
    return (await this.stmt(sql, ...params).first<T>()) ?? null;
  }

  async run(sql: string, ...params: Param[]): Promise<number> {
    const r = await this.stmt(sql, ...params).run();
    return r.meta?.changes ?? 0;
  }

  async batch(stmts: D1PreparedStatement[]): Promise<void> {
    if (stmts.length > 0) await this.d1.batch(stmts);
  }
}

export const now = () => Date.now();
export const uid = () => crypto.randomUUID();

export function json<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
