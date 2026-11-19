import Dexie, { type EntityTable } from 'dexie';
import type { ProgressEvent } from '@knitcloset/gauge-engine';
import { api, ApiError, type WorkData } from './api';

/**
 * 오프라인 우선 (기획서 1.7, 2.3).
 * - pending: 아직 서버에 못 보낸 진행 이벤트 큐
 * - work: 작업 화면 데이터 캐시 (맥북이 잠들어도 아이패드에서 열 수 있게)
 */
type CachedWork = { projectId: string; data: WorkData; savedAt: number };
/** 천 시뮬레이션으로 늘어뜨린 모양 (조각마다 입자 위치). 옷 모양이 같으면 다시 계산하지 않게 */
type CachedCloth = { key: string; pos: Float32Array[]; savedAt: number };

class KnitDb extends Dexie {
  pending!: EntityTable<ProgressEvent & { projectId: string }, 'id'>;
  work!: EntityTable<CachedWork, 'projectId'>;
  cloth!: EntityTable<CachedCloth, 'key'>;

  constructor() {
    super('knitcloset');
    this.version(1).stores({
      pending: 'id, pieceId, projectId, at',
      work: 'projectId',
    });
    this.version(2).stores({
      pending: 'id, pieceId, projectId, at',
      work: 'projectId',
      cloth: 'key',
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

/** 한 번에 보내는 기록 수. 오래 오프라인이었어도 서버 한도(2000개)에 걸리지 않게 나눠 보냄 */
export const FLUSH_CHUNK = 500;

/** 다시 보내도 절대 받아들여지지 않는 응답 (형식 오류, 없어진 조각 등). 로그인 만료(401·403)나 서버 오류(5xx)는 아님 */
const isRejected = (e: unknown) => e instanceof ApiError && [400, 404, 410, 413, 422].includes(e.status);

type ServerSnap = Awaited<ReturnType<typeof api.sendEvents>>;

/**
 * 조각 하나의 대기 이벤트를 나눠 보내고, 보낸 것만 큐에서 지움. 마지막 서버 스냅샷을 돌려줌.
 *
 * 서버가 거절한 기록은 큐에 남겨 두면 영원히 다시 보내다 실패해서 뒤의 기록까지 막아요.
 * - 조각이 없어짐(404): 그 조각의 기록은 갈 곳이 없으니 지움
 * - 묶음이 거절됨: 하나씩 다시 보내서 문제 있는 기록만 지우고 나머지는 살림
 */
export async function flushPiece(pieceId: string): Promise<ServerSnap | null> {
  const events = await pendingFor(pieceId);
  let snap: ServerSnap | null = null;
  const drop = async (list: ProgressEvent[], why: unknown) => {
    console.warn(`보낼 수 없는 진행 기록 ${list.length}개를 큐에서 뺐어요`, why);
    await db.pending.bulkDelete(list.map((e) => e.id));
  };
  for (let i = 0; i < events.length; i += FLUSH_CHUNK) {
    const chunk = events.slice(i, i + FLUSH_CHUNK);
    try {
      snap = await api.sendEvents(pieceId, chunk);
      await db.pending.bulkDelete(chunk.map((e) => e.id));
    } catch (e) {
      if (!isRejected(e)) throw e;
      if ((e as ApiError).status === 404) {
        await drop(events.slice(i), e);
        return snap;
      }
      for (const one of chunk) {
        try {
          snap = await api.sendEvents(pieceId, [one]);
          await db.pending.delete(one.id);
        } catch (e1) {
          if (!isRejected(e1)) throw e1;
          await drop([one], e1);
          if ((e1 as ApiError).status === 404) {
            await drop(events.slice(i), e1);
            return snap;
          }
        }
      }
    }
  }
  return snap;
}

/** 모든 대기 이벤트 전송. 네트워크 오류면 조용히 다음 기회에 */
export async function flushAll(): Promise<{ sent: number; offline: boolean }> {
  let sent = 0;
  try {
    const all = await db.pending.toArray();
    const pieces = [...new Set(all.map((e) => e.pieceId))];
    let failed: unknown;
    for (const p of pieces) {
      const n = all.filter((e) => e.pieceId === p).length;
      try {
        await flushPiece(p);
        sent += n;
      } catch (e) {
        // 오프라인이면 더 해 봐야 소용없고, 그 밖의 오류는 다른 조각까지 막지 않게 넘어감
        if (e instanceof ApiError && e.status === 0) throw e;
        failed ??= e;
      }
    }
    if (failed) throw failed;
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
