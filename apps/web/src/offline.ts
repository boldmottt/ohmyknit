import Dexie, { type EntityTable } from 'dexie';
import type { ProgressEvent } from '@knitcloset/gauge-engine';
import { api, ApiError, type WorkData } from './api';

/**
 * 오프라인 우선 (기획서 1.7, 2.3).
 * - pending: 아직 서버에 못 보낸 진행 이벤트 큐
 * - work: 작업 화면 데이터 캐시 (맥북이 잠들어도 아이패드에서 열 수 있게)
 */
type CachedWork = { projectId: string; data: WorkData; savedAt: number };

class KnitDb extends Dexie {
  pending!: EntityTable<ProgressEvent & { projectId: string }, 'id'>;
  work!: EntityTable<CachedWork, 'projectId'>;

  constructor() {
    super('knitcloset');
    this.version(1).stores({
      pending: 'id, pieceId, projectId, at',
      work: 'projectId',
    });
  }
}

export const db = new KnitDb();

export async function cacheWork(data: WorkData) {
  try {
    await db.work.put({ projectId: data.project.id, data, savedAt: Date.now() });
  } catch {
    // 저장 공간이 막힌 환경(사생활 보호 모드)에서도 화면은 동작해야 함
  }
}

export async function cachedWork(projectId: string): Promise<WorkData | undefined> {
  try {
    return (await db.work.get(projectId))?.data;
  } catch {
    return undefined;
  }
}

export async function enqueue(projectId: string, e: ProgressEvent) {
  await db.pending.put({ ...e, projectId });
}

export async function pendingFor(pieceId: string): Promise<ProgressEvent[]> {
  const rows = await db.pending.where('pieceId').equals(pieceId).sortBy('at');
  return rows.map(({ projectId: _p, ...e }) => e);
}

export async function pendingCount(): Promise<number> {
  try {
    return await db.pending.count();
  } catch {
    return 0;
  }
}

/** 조각 하나의 대기 이벤트를 보내고, 보낸 것만 큐에서 지움. 서버 스냅샷을 돌려줌 */
export async function flushPiece(pieceId: string) {
  const events = await pendingFor(pieceId);
  if (events.length === 0) return null;
  const snap = await api.sendEvents(pieceId, events);
  await db.pending.bulkDelete(events.map((e) => e.id));
  return snap;
}

/** 모든 대기 이벤트 전송. 네트워크 오류면 조용히 다음 기회에 */
export async function flushAll(): Promise<{ sent: number; offline: boolean }> {
  let sent = 0;
  try {
    const all = await db.pending.toArray();
    const pieces = [...new Set(all.map((e) => e.pieceId))];
    for (const p of pieces) {
      const n = all.filter((e) => e.pieceId === p).length;
      await flushPiece(p);
      sent += n;
    }
    return { sent, offline: false };
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) return { sent, offline: true };
    throw e;
  }
}

export function newEventId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const DEVICE = (() => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in globalThis)) return 'ipad';
  if (/iPhone/.test(ua)) return 'iphone';
  if (/Macintosh/.test(ua)) return 'mac';
  return 'web';
})();
