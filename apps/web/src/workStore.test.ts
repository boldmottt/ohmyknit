import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convertPattern, replayEvents, type ProgressEvent } from '@knitcloset/gauge-engine';
import { parsePattern, SAMPLE_PATTERN } from '@knitcloset/pattern-schema';
import type { WorkData } from './api';
import { db } from './offline';
import { useWork } from './workStore';

const converted = convertPattern(parsePattern(SAMPLE_PATTERN), { size: 'M', myGauge: { st: 25, row: 33 } });

function workData(): WorkData {
  return {
    project: {
      id: 'p1',
      profileId: 'u1',
      name: '테스트',
      patternTitle: '샘플',
      patternFileKey: null,
      sizeLabel: 'M',
      status: 'active',
      startedAt: 0,
      lastWorkedAt: null,
      conversionMode: 'recalc',
      myGauge: { st: 25, row: 33 },
      needleMm: 4,
      yarn: '',
      ballGrams: null,
    },
    converted,
    finished: {},
    pieces: converted.pieces.map((p) => ({
      id: `p1:${p.id}`,
      key: p.id,
      name: p.name,
      totalRows: p.totalRows,
      totalStitches: p.totalStitches,
      progress: { currentRow: 0, currentStitch: 0, stitchesDone: 0, frogCount: 0, frogRows: 0, updatedAt: 0 },
    })),
    notes: [],
    checkins: [],
    yarnLog: null,
    speed: { activeMs: 0, stitches: 0, stitchesPerMinute: null },
  };
}

/** 서버 흉내: 받은 이벤트를 쌓고 재생한 결과를 돌려줌. 응답은 일부러 늦게 */
function fakeServer(delayMs: number) {
  const store = new Map<string, ProgressEvent[]>();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const m = /\/api\/pieces\/([^/]+)\/events/.exec(url);
    if (!m) return new Response('{}', { status: 404 });
    const pieceId = decodeURIComponent(m[1]!);
    const { events } = JSON.parse(String(init?.body)) as { events: ProgressEvent[] };
    const all = [...(store.get(pieceId) ?? []), ...events];
    store.set(pieceId, all);
    await new Promise((r) => setTimeout(r, delayMs));
    const snap = replayEvents(all, 1000);
    return new Response(JSON.stringify({ ...snap, stitchesDone: 0 }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { store, fetchMock };
}

beforeEach(async () => {
  await db.pending.clear();
  useWork.getState().reset();
  vi.unstubAllGlobals();
});

describe('workStore', () => {
  it('+1은 바로 반영되고 큐에 쌓였다가 서버로 감', async () => {
    const { store } = fakeServer(0);
    await useWork.getState().load(workData());
    const pid = useWork.getState().activePieceId;
    useWork.getState().increment();
    useWork.getState().increment();
    expect(useWork.getState().snapshots[pid]!.currentRow).toBe(2);
    await new Promise((r) => setTimeout(r, 20));
    await useWork.getState().flush();
    expect(store.get(pid)).toHaveLength(2);
    expect(await db.pending.count()).toBe(0);
    expect(useWork.getState().sync).toBe('saved');
  });

  it('동기화 중에 누른 +1을 서버 응답이 덮어쓰지 않음 (기기 저장이 느릴 때)', async () => {
    fakeServer(20);
    await useWork.getState().load(workData());
    const pid = useWork.getState().activePieceId;
    useWork.getState().increment();
    await new Promise((r) => setTimeout(r, 10));
    // 실제 기기처럼 IndexedDB 쓰기가 느린 상황
    const realPut = db.pending.put.bind(db.pending);
    const slowPut = async (item: Parameters<typeof realPut>[0]) => {
      await new Promise((r) => setTimeout(r, 60));
      return realPut(item);
    };
    const slow = vi.spyOn(db.pending, 'put').mockImplementation(slowPut as unknown as typeof db.pending.put);
    const flushing = useWork.getState().flush();
    // 서버가 응답하기 전에 한 번 더 (아직 큐에 안 들어간 상태)
    useWork.getState().increment();
    await flushing;
    expect(useWork.getState().snapshots[pid]!.currentRow).toBe(2);
    slow.mockRestore();
    // 느린 쓰기가 끝날 때까지 기다려 다음 테스트에 새지 않게
    await new Promise((r) => setTimeout(r, 80));
  });

  it('오프라인이면 큐에 남고, 다시 열 때 다시 얹어짐', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    await useWork.getState().load(workData());
    const pid = useWork.getState().activePieceId;
    useWork.getState().increment();
    useWork.getState().increment();
    useWork.getState().increment();
    await new Promise((r) => setTimeout(r, 20));
    await useWork.getState().flush();
    expect(useWork.getState().sync).toBe('offline');
    expect(await db.pending.count()).toBe(3);
    // 앱을 다시 열면 서버 값(0단) 위에 대기 이벤트 3개가 얹어짐
    useWork.getState().reset();
    await useWork.getState().load(workData());
    expect(useWork.getState().snapshots[pid]!.currentRow).toBe(3);
  });

  it('잠금 이벤트가 있는 단은 확인해야 넘어감', async () => {
    fakeServer(0);
    const d = workData();
    await useWork.getState().load(d);
    const body = d.pieces[0]!;
    useWork.getState().setActivePiece(body.id);
    useWork.getState().jumpTo(body.totalRows - 1); // 마지막 단 직전 (분리 이벤트 = 마지막 단)
    expect(useWork.getState().increment()).toBe('locked');
    useWork.getState().acknowledge(body.id, body.totalRows);
    expect(useWork.getState().increment()).toBe('end');
    expect(useWork.getState().snapshots[body.id]!.currentRow).toBe(body.totalRows);
  });

  it('실행 취소는 이전 단으로 되돌리는 이벤트를 남김', async () => {
    fakeServer(0);
    await useWork.getState().load(workData());
    const pid = useWork.getState().activePieceId;
    useWork.getState().jumpTo(40);
    useWork.getState().increment();
    expect(useWork.getState().snapshots[pid]!.currentRow).toBe(41);
    useWork.getState().undo();
    expect(useWork.getState().snapshots[pid]!.currentRow).toBe(40);
    useWork.getState().undo();
    expect(useWork.getState().snapshots[pid]!.currentRow).toBe(0);
  });
});
