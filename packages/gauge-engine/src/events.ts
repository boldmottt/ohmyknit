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

/** 조작이 없어도 "뜨는 중"으로 보는 기본 시간 */
export const BASE_IDLE_MS = 5 * 60_000;
/** 아주 천천히 뜰 때 한 코에 걸리는 시간 (쉼 판단용 여유) */
export const SLOW_STITCH_MS = 6_000;
/** 이보다 빨리 한 단을 넘기면 실제로 뜬 게 아니라 몰아서 누른 것 (코당 0.3초) */
export const BURST_STITCH_MS = 300;

/**
 * 이 시간 넘게 조작이 없으면 쉬는 것으로 봅니다.
 * 단 카운터는 한 단에 한 번만 누르므로, 긴 단(228코 배색 등)은 그만큼 오래 기다려 줘야 해요.
 */
export function idleLimitMs(rowStitches = 0): number {
  return BASE_IDLE_MS + Math.max(0, rowStitches) * SLOW_STITCH_MS;
}

export type Pace = {
  /** 실제로 뜬 시간 (쉰 구간, 몰아서 누른 구간 제외) */
  activeMs: number;
  /** 그 시간 동안 뜬 코 수 */
  stitches: number;
  /** 분당 코 수. 자료가 1분 미만이면 null */
  stitchesPerMinute: number | null;
  rowsCounted: number;
};

/**
 * 진행 이벤트로 뜨개 속도를 구합니다. (F4-7, 남은 시간 예측의 근거)
 *
 * 한 단 = 앞 이벤트부터 row_inc까지의 시간. 다음 경우는 속도 계산에서 뺍니다.
 * - 그 사이에 쉼(idleLimitMs 초과)이 있었던 단
 * - 너무 빨리 넘긴 단 (여러 단을 뜬 뒤 한꺼번에 누른 경우)
 * - 이동·풀기 직후의 단
 *
 * @param stitchesIn 이벤트가 일어난 조각에서 n번째(0부터) 단의 콧수
 */
export function knittingPace(events: ProgressEvent[], stitchesIn: (pieceId: string, rowIndex: number) => number): Pace {
  const list = normalizeEvents(events);
  let activeMs = 0;
  let stitches = 0;
  let rowsCounted = 0;
  let acc = 0; // 지금 뜨는 단에 쌓인 시간
  let clean = false; // 이 단의 시작부터 끊김 없이 이어졌는지
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    const n = stitchesIn(e.pieceId, e.fromRow);
    if (i > 0) {
      const gap = e.at - list[i - 1]!.at;
      if (gap > idleLimitMs(n) || list[i - 1]!.pieceId !== e.pieceId) clean = false;
      else acc += gap;
    }
    if (e.type === 'row_inc') {
      if (clean && n > 0 && acc >= n * BURST_STITCH_MS) {
        activeMs += acc;
        stitches += n;
        rowsCounted += 1;
      }
      acc = 0;
      clean = true;
    } else if (e.type === 'stitch' || e.type === 'session_start' || e.type === 'session_end') {
      // 단 안에서 일어난 일: 시간은 계속 쌓임
    } else {
      // 되돌리기·이동·풀기: 이 단은 기준이 흐트러졌으니 다음 단부터 다시
      acc = 0;
      clean = false;
    }
  }
  return { activeMs, stitches, rowsCounted, stitchesPerMinute: activeMs >= 60_000 ? stitches / (activeMs / 60_000) : null };
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
export function sessionStats(events: ProgressEvent[], idleMs = BASE_IDLE_MS): SessionStats {
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
