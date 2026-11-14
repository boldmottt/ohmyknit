/**
 * 진행 이벤트 로그 (기획서 3.1 progress_events, 3.3 동기화 규칙).
 * 클라이언트(오프라인 큐)와 서버가 같은 함수로 스냅샷을 다시 계산합니다.
 */

export type ProgressEventType =
  | 'row_inc'
  | 'row_dec'
  | 'jump'
  | 'frog'
  | 'stitch'
  | 'session_start'
  | 'session_end';

export type ProgressEvent = {
  /** 클라이언트가 만든 UUID. 같은 id는 한 번만 적용 */
  id: string;
  pieceId: string;
  type: ProgressEventType;
  /** 이벤트 직전 단 (기록용) */
  fromRow: number;
  /** jump/frog: 이동한 단. stitch: 현재 단에서 뜬 코 수 */
  toRow: number;
  /** 기기 시각 (ms) */
  at: number;
  device?: string;
  /** frog 사유 등 */
  meta?: string;
};

export type ProgressSnapshot = {
  /** 다 뜬 단 수 */
  currentRow: number;
  /** 현재 단에서 뜬 코 수 (코 단위 추적) */
  currentStitch: number;
  frogCount: number;
  frogRows: number;
  lastAt: number;
};

export const EMPTY_SNAPSHOT: ProgressSnapshot = {
  currentRow: 0,
  currentStitch: 0,
  frogCount: 0,
  frogRows: 0,
  lastAt: 0,
};

/** 중복 제거 + 시간순(같으면 id순) 정렬 */
export function normalizeEvents(events: ProgressEvent[]): ProgressEvent[] {
  const seen = new Map<string, ProgressEvent>();
  for (const e of events) if (!seen.has(e.id)) seen.set(e.id, e);
  return [...seen.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * 이벤트를 차례로 적용합니다. row_inc/row_dec는 상대 이동이라
 * 두 기기에서 동시에 눌러도 둘 다 반영됩니다.
 */
export function replayEvents(
  events: ProgressEvent[],
  totalRows: number,
  start: ProgressSnapshot = EMPTY_SNAPSHOT,
): ProgressSnapshot {
  const clamp = (n: number) => Math.max(0, Math.min(totalRows, n));
  const s = { ...start };
  for (const e of normalizeEvents(events)) {
    switch (e.type) {
      case 'row_inc':
        s.currentRow = clamp(s.currentRow + 1);
        s.currentStitch = 0;
        break;
      case 'row_dec':
        s.currentRow = clamp(s.currentRow - 1);
        s.currentStitch = 0;
        break;
      case 'jump':
        s.currentRow = clamp(e.toRow);
        s.currentStitch = 0;
        break;
      case 'frog': {
        const to = clamp(e.toRow);
        s.frogCount += 1;
        s.frogRows += Math.max(0, s.currentRow - to);
        s.currentRow = to;
        s.currentStitch = 0;
        break;
      }
      case 'stitch':
        s.currentStitch = Math.max(0, e.toRow);
        break;
      case 'session_start':
      case 'session_end':
        break;
    }
    s.lastAt = Math.max(s.lastAt, e.at);
  }
  return s;
}

export type SessionStats = {
  /** 실제로 뜬 시간 (ms). idleMs 넘게 조작이 없던 구간은 제외 */
  activeMs: number;
  rowsKnitted: number;
};

/**
 * 이벤트 시각으로 작업 시간을 계산합니다. (F4-7)
 * 이벤트 사이 간격이 idleMs(기본 5분)를 넘으면 그 구간은 쉬는 시간으로 봅니다.
 */
export function sessionStats(events: ProgressEvent[], idleMs = 5 * 60_000): SessionStats {
  const list = normalizeEvents(events);
  let activeMs = 0;
  let rows = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    if (e.type === 'row_inc') rows += 1;
    if (e.type === 'row_dec') rows -= 1;
    if (i > 0) {
      const gap = e.at - list[i - 1]!.at;
      if (gap <= idleMs) activeMs += gap;
    }
  }
  return { activeMs, rowsKnitted: Math.max(0, rows) };
}
