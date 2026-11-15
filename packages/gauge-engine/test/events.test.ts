import { describe, expect, it } from 'vitest';
import { idleLimitMs, knittingPace, replayEvents, sessionStats, type ProgressEvent } from '../src/index.js';

let n = 0;
const ev = (type: ProgressEvent['type'], at: number, extra: Partial<ProgressEvent> = {}): ProgressEvent => ({
  id: `e${String(++n).padStart(4, '0')}`,
  pieceId: 'body',
  type,
  fromRow: 0,
  toRow: 0,
  at,
  ...extra,
});

describe('replayEvents', () => {
  it('+1, +1, −1', () => {
    const s = replayEvents([ev('row_inc', 1), ev('row_inc', 2), ev('row_dec', 3)], 100);
    expect(s.currentRow).toBe(1);
  });

  it('같은 id는 한 번만 (오프라인 큐 재전송)', () => {
    const e = ev('row_inc', 1);
    expect(replayEvents([e, e, e], 100).currentRow).toBe(1);
  });

  it('도착 순서와 상관없이 시간순 적용', () => {
    const a = ev('jump', 1, { toRow: 50 });
    const b = ev('row_inc', 2);
    expect(replayEvents([b, a], 100).currentRow).toBe(51);
  });

  it('두 기기에서 동시에 +1 → 둘 다 반영', () => {
    const ipad = ev('row_inc', 1000, { device: 'ipad' });
    const mac = ev('row_inc', 1000, { device: 'mac' });
    expect(replayEvents([ipad, mac], 100).currentRow).toBe(2);
  });

  it('풀기는 별도 통계', () => {
    const s = replayEvents([ev('jump', 1, { toRow: 40 }), ev('frog', 2, { toRow: 34, meta: '실수' })], 100);
    expect(s.currentRow).toBe(34);
    expect(s.frogCount).toBe(1);
    expect(s.frogRows).toBe(6);
  });

  it('0단 아래, 총 단 위로는 못 감', () => {
    expect(replayEvents([ev('row_dec', 1)], 10).currentRow).toBe(0);
    expect(replayEvents([ev('jump', 1, { toRow: 99 })], 10).currentRow).toBe(10);
  });

  it('코 단위 추적은 다음 단으로 넘어가면 0', () => {
    const s1 = replayEvents([ev('stitch', 1, { toRow: 36 })], 10);
    expect(s1.currentStitch).toBe(36);
    expect(replayEvents([ev('stitch', 1, { toRow: 36 }), ev('row_inc', 2)], 10).currentStitch).toBe(0);
  });
});

describe('sessionStats', () => {
  it('5분 넘게 쉰 시간은 빼고 셈', () => {
    const min = 60_000;
    const s = sessionStats([
      ev('row_inc', 0),
      ev('row_inc', 3 * min),
      ev('row_inc', 6 * min),
      ev('row_inc', 30 * min), // 24분 쉼 → 제외
      ev('row_inc', 32 * min),
    ]);
    expect(s.activeMs).toBe(8 * min);
    expect(s.rowsKnitted).toBe(5);
  });
});

describe('knittingPace: 속도 계산', () => {
  const min = 60_000;
  const st228 = () => 228;

  it('한 단에 12분 걸리는 228코 배색 단도 뜨는 시간으로 잡힘', () => {
    expect(idleLimitMs(228)).toBeGreaterThan(12 * min);
    const p = knittingPace([ev('row_inc', 0), ev('row_inc', 12 * min, { fromRow: 1 }), ev('row_inc', 24 * min, { fromRow: 2 })], st228);
    expect(p.activeMs).toBe(24 * min);
    expect(p.stitches).toBe(456);
    expect(p.stitchesPerMinute).toBeCloseTo(19, 5);
  });

  it('몰아서 누른 +1은 속도를 부풀리지 않음', () => {
    // 3단을 뜬 뒤 1초 간격으로 세 번 누름
    const p = knittingPace(
      [ev('row_inc', 0), ev('row_inc', 12 * min, { fromRow: 1 }), ev('row_inc', 12 * min + 1000, { fromRow: 2 }), ev('row_inc', 12 * min + 2000, { fromRow: 3 })],
      st228,
    );
    expect(p.rowsCounted).toBe(1);
    expect(p.stitchesPerMinute).toBeCloseTo(19, 5);
  });

  it('오래 쉰 뒤의 단은 빼고, 그 다음 단부터 다시 셈', () => {
    const p = knittingPace(
      [ev('row_inc', 0), ev('row_inc', 3 * 60 * min, { fromRow: 1 }), ev('row_inc', 3 * 60 * min + 10 * min, { fromRow: 2 })],
      st228,
    );
    expect(p.rowsCounted).toBe(1);
    expect(p.activeMs).toBe(10 * min);
  });

  it('이동·풀기 직후의 단은 빼고, 단 안의 코 추적은 시간에 포함', () => {
    const p = knittingPace(
      [
        ev('row_inc', 0),
        ev('jump', 1 * min, { toRow: 40 }),
        ev('row_inc', 9 * min, { fromRow: 40 }), // 이동 직후 → 제외
        ev('stitch', 13 * min, { fromRow: 41, toRow: 100 }),
        ev('row_inc', 19 * min, { fromRow: 41 }), // 10분 (코 추적 포함)
      ],
      st228,
    );
    expect(p.rowsCounted).toBe(1);
    expect(p.activeMs).toBe(10 * min);
  });

  it('자료가 1분 미만이면 속도는 null', () => {
    expect(knittingPace([ev('row_inc', 0)], st228).stitchesPerMinute).toBeNull();
  });
});
