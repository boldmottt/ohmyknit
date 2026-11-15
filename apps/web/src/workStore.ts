import { create } from 'zustand';
import {
  BASE_IDLE_MS,
  EMPTY_SNAPSHOT,
  idleLimitMs,
  replayEvents,
  type ProgressEvent,
  type ProgressEventType,
  type ProgressSnapshot,
} from '@knitcloset/gauge-engine';
import { api, type WorkData } from './api';
import { DEVICE, enqueue, flushPiece, newEventId, pendingCount, pendingFor } from './offline';

/** 지금 뜨는 단의 콧수 (쉼 판단에 씀: 긴 단일수록 오래 기다려 줌) */
function rowStitches(data: WorkData, pieceId: string, completedRows: number): number {
  const conv = data.converted.pieces.find((p) => `${data.project.id}:${p.id}` === pieceId);
  return conv?.rows[completedRows]?.stitchesWorked ?? 0;
}

type Undo = { pieceId: string; before: ProgressSnapshot };

type Session = {
  startedAt: number | null;
  activeMs: number;
  lastActionAt: number | null;
  paused: boolean;
  /** 이 시간 넘게 조작이 없으면 쉬는 것으로 봄 (지금 뜨는 단의 콧수에 따라 달라짐, F4-7) */
  limitMs: number;
  /** 세션 시작 시점의 조각별 단 (세션 요약용) */
  startRows: Record<string, number>;
};

export type SyncState = 'saved' | 'syncing' | 'offline' | 'error';

type WorkState = {
  data: WorkData | null;
  activePieceId: string;
  snapshots: Record<string, ProgressSnapshot>;
  undoStack: Undo[];
  session: Session;
  sync: SyncState;
  pending: number;
  /** 확인한 잠금 이벤트 (pieceId:row) */
  acknowledged: Record<string, true>;
  /** 다른 기기의 기록을 합쳐서 단이 바뀌었을 때 알림 (기획서 5.8) */
  merged: { pieceId: string; from: number; to: number } | null;
  ui: { compare: boolean; focus: boolean; hoverRow: number | null; symbols: boolean };

  load(data: WorkData): Promise<void>;
  setActivePiece(id: string): void;
  act(type: ProgressEventType, toRow?: number, meta?: string): void;
  increment(): 'ok' | 'locked' | 'end';
  decrement(): void;
  jumpTo(row: number): void;
  frog(rows: number, reason: string): void;
  setStitch(n: number): void;
  undo(): boolean;
  acknowledge(pieceId: string, row: number): void;
  togglePause(): void;
  setUi(p: Partial<WorkState['ui']>): void;
  clearMerged(): void;
  flush(): Promise<void>;
  reset(): void;
};

const emptySession = (): Session => ({ startedAt: null, activeMs: 0, lastActionAt: null, paused: true, limitMs: BASE_IDLE_MS, startRows: {} });

let flushTimer: ReturnType<typeof setTimeout> | undefined;
/** 조작할 때마다 1씩 증가. 동기화 중에 새 조작이 있었으면 서버 결과로 덮어쓰지 않음 */
let actSeq = 0;

export const useWork = create<WorkState>((set, get) => ({
  data: null,
  activePieceId: '',
  snapshots: {},
  undoStack: [],
  session: emptySession(),
  sync: 'saved',
  pending: 0,
  acknowledged: {},
  merged: null,
  ui: { compare: false, focus: false, hoverRow: null, symbols: readSymbols() },

  async load(data) {
    const snapshots: Record<string, ProgressSnapshot> = {};
    for (const p of data.pieces) {
      const base: ProgressSnapshot = {
        ...EMPTY_SNAPSHOT,
        currentRow: p.progress.currentRow,
        currentStitch: p.progress.currentStitch,
        frogCount: p.progress.frogCount,
        frogRows: p.progress.frogRows,
      };
      // 아직 서버에 못 보낸 이벤트를 다시 얹음
      let pend: ProgressEvent[] = [];
      try {
        pend = await pendingFor(p.id);
      } catch {
        pend = [];
      }
      snapshots[p.id] = pend.length ? replayEvents(pend, p.totalRows, base) : base;
    }
    const prev = get();
    const keepActive = prev.data?.project.id === data.project.id && data.pieces.some((p) => p.id === prev.activePieceId);
    // 가장 최근에 뜬 조각을 기본으로
    const lastPiece =
      [...data.pieces].sort((a, b) => b.progress.updatedAt - a.progress.updatedAt).find((p) => p.progress.currentRow > 0) ??
      data.pieces.find((p) => (snapshots[p.id]?.currentRow ?? 0) < p.totalRows) ??
      data.pieces[0];
    set({
      data,
      snapshots,
      activePieceId: keepActive ? prev.activePieceId : (lastPiece?.id ?? ''),
      undoStack: keepActive ? prev.undoStack : [],
      session: keepActive ? prev.session : { ...emptySession(), startRows: Object.fromEntries(Object.entries(snapshots).map(([k, v]) => [k, v.currentRow])) },
      pending: await pendingCount(),
    });
  },

  setActivePiece(id) {
    set({ activePieceId: id });
  },

  act(type, toRow = 0, meta) {
    const { data, activePieceId, snapshots } = get();
    if (!data) return;
    const piece = data.pieces.find((p) => p.id === activePieceId);
    if (!piece) return;
    const before = snapshots[piece.id] ?? EMPTY_SNAPSHOT;
    const now = Date.now();
    const e: ProgressEvent = {
      id: newEventId(),
      pieceId: piece.id,
      type,
      fromRow: before.currentRow,
      toRow,
      at: now,
      device: DEVICE,
      ...(meta ? { meta } : {}),
    };
    const after = replayEvents([e], piece.totalRows, before);
    actSeq++;
    const s = get().session;
    let activeMs = s.activeMs;
    if (!s.paused && s.lastActionAt && now - s.lastActionAt <= s.limitMs) activeMs += now - s.lastActionAt;
    set({
      snapshots: { ...snapshots, [piece.id]: after },
      undoStack: [...get().undoStack.slice(-199), { pieceId: piece.id, before }],
      session: {
        ...s,
        startedAt: s.startedAt ?? now,
        activeMs,
        lastActionAt: now,
        paused: false,
        limitMs: idleLimitMs(rowStitches(data, piece.id, after.currentRow)),
        startRows: { ...s.startRows, [piece.id]: s.startRows[piece.id] ?? before.currentRow },
      },
      pending: get().pending + 1,
      sync: 'syncing',
    });
    enqueue(data.project.id, e).then(
      () => {
        clearTimeout(flushTimer);
        flushTimer = setTimeout(() => void get().flush(), 700);
      },
      () => {
        // 기기 저장소를 못 쓰는 환경(사생활 보호 모드 등): 큐 없이 바로 보냄
        api.sendEvents(piece.id, [e]).then(
          () => set({ pending: Math.max(0, get().pending - 1), sync: 'saved' }),
          () => set({ sync: 'error' }),
        );
      },
    );
  },

  increment() {
    const { data, activePieceId, snapshots, acknowledged } = get();
    if (!data) return 'ok';
    const piece = data.pieces.find((p) => p.id === activePieceId);
    const conv = data.converted.pieces.find((p) => `${data.project.id}:${p.id}` === activePieceId);
    if (!piece || !conv) return 'ok';
    const cur = snapshots[piece.id]?.currentRow ?? 0;
    if (cur >= piece.totalRows) return 'end';
    // 지금 끝내려는 단(cur+1)에 잠금 이벤트가 있으면 확인 먼저
    const row = conv.rows[cur];
    if (row?.events.some((ev) => ev.lock) && !acknowledged[`${piece.id}:${row.row}`]) return 'locked';
    get().act('row_inc');
    return cur + 1 >= piece.totalRows ? 'end' : 'ok';
  },

  decrement() {
    get().act('row_dec');
  },

  jumpTo(row) {
    get().act('jump', Math.max(0, Math.round(row)));
  },

  frog(rows, reason) {
    const cur = get().snapshots[get().activePieceId]?.currentRow ?? 0;
    get().act('frog', Math.max(0, cur - Math.max(0, Math.round(rows))), reason);
  },

  setStitch(n) {
    get().act('stitch', Math.max(0, Math.round(n)));
  },

  undo() {
    const stack = get().undoStack;
    const last = stack.at(-1);
    if (!last) return false;
    const prevActive = get().activePieceId;
    set({ activePieceId: last.pieceId, undoStack: stack.slice(0, -1) });
    // 되돌리기도 이벤트로 기록 (다른 기기와 일관성 유지)
    get().act('jump', last.before.currentRow, 'undo');
    if (last.before.currentStitch) get().act('stitch', last.before.currentStitch, 'undo');
    // act가 undo 기록을 다시 쌓으므로 제거
    set({ undoStack: stack.slice(0, -1), activePieceId: prevActive === last.pieceId ? prevActive : last.pieceId });
    return true;
  },

  acknowledge(pieceId, row) {
    set({ acknowledged: { ...get().acknowledged, [`${pieceId}:${row}`]: true } });
  },

  togglePause() {
    const s = get().session;
    const now = Date.now();
    if (s.paused) {
      set({ session: { ...s, paused: false, lastActionAt: now, startedAt: s.startedAt ?? now } });
    } else {
      const add = s.lastActionAt && now - s.lastActionAt <= s.limitMs ? now - s.lastActionAt : 0;
      set({ session: { ...s, paused: true, activeMs: s.activeMs + add, lastActionAt: now } });
    }
  },

  setUi(p) {
    if (p.symbols !== undefined) writeSymbols(p.symbols);
    set({ ui: { ...get().ui, ...p } });
  },

  clearMerged() {
    set({ merged: null });
  },

  async flush() {
    const { data } = get();
    if (!data) return;
    let offline = false;
    for (const p of data.pieces) {
      try {
        const seqBefore = actSeq;
        const snap = await flushPiece(p.id);
        if (snap && (await pendingFor(p.id)).length === 0 && seqBefore === actSeq) {
          // 다른 기기에서 뜬 것까지 합친 서버 결과를 받아들임
          const cur = get().snapshots[p.id];
          if (cur && cur.currentRow !== snap.currentRow) {
            set({ merged: { pieceId: p.id, from: cur.currentRow, to: snap.currentRow } });
          }
          set({
            snapshots: {
              ...get().snapshots,
              [p.id]: { ...(cur ?? EMPTY_SNAPSHOT), ...snap },
            },
          });
        }
      } catch (e) {
        offline = (e as { status?: number }).status === 0;
        if (!offline) {
          set({ sync: 'error' });
          return;
        }
        break;
      }
    }
    const left = await pendingCount();
    set({ pending: left, sync: offline ? 'offline' : 'saved' });
    if (offline && left > 0) {
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => void get().flush(), 20_000);
    }
  },

  reset() {
    set({ data: null, snapshots: {}, undoStack: [], session: emptySession(), acknowledged: {}, merged: null });
  },
}));

/** 화면에 보여 줄 작업 시간 (진행 중인 구간 포함) */
export function liveActiveMs(s: Session, now = Date.now()): number {
  if (s.paused || !s.lastActionAt) return s.activeMs;
  const gap = now - s.lastActionAt;
  return s.activeMs + (gap <= s.limitMs ? gap : 0);
}

/** 타이머가 실제로 돌고 있는지 (일시정지했거나 너무 오래 조작이 없으면 멈춘 것으로 표시) */
export function timerRunning(s: Session, now = Date.now()): boolean {
  return !s.paused && !!s.lastActionAt && now - s.lastActionAt <= s.limitMs;
}

function readSymbols(): boolean {
  try {
    return localStorage.getItem('kc.symbols') === '1';
  } catch {
    return false;
  }
}

function writeSymbols(v: boolean) {
  try {
    localStorage.setItem('kc.symbols', v ? '1' : '0');
  } catch {
    /* 무시 */
  }
}
