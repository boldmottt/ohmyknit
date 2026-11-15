import { describe, expect, it } from 'vitest';
import {
  buildRowTable,
  convertShaping,
  convertStitchCount,
  describeIntervals,
  distributeIntervals,
  eventRows,
  gaugeRatio,
  kFromFinished,
  overallProgress,
  pieceProgress,
  updateCoefficient,
  upcomingEvents,
  FINISHED_WEIGHT,
} from '../src/index.js';

// 기획서 예시: 도안 22코 30단 / 내 손 25코 33단
const pattern = { st: 22, row: 30 };
const mine = { st: 25, row: 33 };

describe('gaugeRatio (4.1)', () => {
  it('내 게이지 / 도안 게이지', () => {
    const { kSt, kRow } = gaugeRatio(mine, pattern);
    expect(kSt).toBeCloseTo(1.1364, 4);
    expect(kRow).toBeCloseTo(1.1, 10);
  });

  it('0이나 음수 게이지는 거부', () => {
    expect(() => gaugeRatio({ st: 0, row: 30 }, pattern)).toThrow(RangeError);
  });
});

describe('convertStitchCount (4.1, F3-4)', () => {
  const { kSt } = gaugeRatio(mine, pattern);

  it('200코 + 12코 반복 → 228코 (12×19), 오차 0.29cm', () => {
    const r = convertStitchCount(200, kSt, { repeat: 12, myStGauge: 25 });
    expect(r.raw).toBeCloseTo(227.27, 2);
    expect(r.value).toBe(228);
    expect(r.value % 12).toBe(0);
    expect(r.errorCm).toBeCloseTo(0.29, 2); // |228 − 227.27| / 25 × 10
    expect(r.withinTolerance).toBe(true);
  });

  it('반복 단위가 크면 허용 오차를 넘을 수 있음 → 바늘 교체 제안 대상', () => {
    // raw 227.27, 40코 반복 → 240 (12.7코 차이 = 5.1cm)
    const r = convertStitchCount(200, kSt, { repeat: 40, myStGauge: 25 });
    expect(r.value).toBe(240);
    expect(r.withinTolerance).toBe(false);
  });

  it('반복 단위가 없으면 홀짝 조건으로 반올림', () => {
    expect(convertStitchCount(200, kSt, { myStGauge: 25 }).value).toBe(227);
    expect(convertStitchCount(200, kSt, { myStGauge: 25, parity: 'even' }).value).toBe(228);
    expect(convertStitchCount(200, kSt, { myStGauge: 25, parity: 'odd' }).value).toBe(227);
  });

  it('근거 문장을 만들어 줌 (계산식 보기)', () => {
    const r = convertStitchCount(200, kSt, { repeat: 12, myStGauge: 25 });
    expect(r.explanation).toContain('228코');
    expect(r.explanation).toContain('12×19');
  });
});

describe('distributeIntervals (4.2)', () => {
  it('79단에 12회 → 7단 간격 7회 + 6단 간격 5회 (v1.0 예시)', () => {
    const iv = distributeIntervals(79, 12);
    expect(iv).toHaveLength(12);
    expect(iv.reduce((a, b) => a + b, 0)).toBe(79);
    expect(iv.filter((x) => x === 7)).toHaveLength(7);
    expect(iv.filter((x) => x === 6)).toHaveLength(5);
  });

  it('79단에 14회 → 6단 간격 9회 + 5단 간격 5회 (v1.0.1 예시)', () => {
    const iv = distributeIntervals(79, 14);
    expect(iv.reduce((a, b) => a + b, 0)).toBe(79);
    expect(iv.filter((x) => x === 6)).toHaveLength(9);
    expect(iv.filter((x) => x === 5)).toHaveLength(5);
  });

  it('긴 간격과 짧은 간격이 몰리지 않고 섞임', () => {
    const iv = distributeIntervals(79, 14);
    // 같은 간격이 3번 넘게 연속되지 않음
    let run = 1;
    for (let i = 1; i < iv.length; i++) {
      run = iv[i] === iv[i - 1] ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(3);
    }
  });

  it('나누어떨어지면 모두 같은 간격', () => {
    expect(distributeIntervals(72, 12)).toEqual(Array(12).fill(6));
  });

  it('단이 횟수보다 적으면 오류', () => {
    expect(() => distributeIntervals(5, 6)).toThrow(RangeError);
  });
});

describe('convertShaping (4.2, v1.0.1)', () => {
  const { kSt, kRow } = gaugeRatio(mine, pattern);

  it('6단마다 2코 늘림 × 12회 → 79단, 14회(28코)', () => {
    const r = convertShaping({ kind: 'inc', everyRows: 6, times: 12, stitchesPerEvent: 2 }, kSt, kRow);
    expect(r.totalRows).toBe(79); // 72 × 1.1 = 79.2
    expect(r.rawStitchChange).toBeCloseTo(27.27, 2); // 24 × 1.136
    expect(r.times).toBe(14);
    expect(r.totalStitchChange).toBe(28);
    expect(r.intervals.reduce((a, b) => a + b, 0)).toBe(79);
    expect(r.description).toBe('6단마다 늘림 9회, 5단마다 늘림 5회 (번갈아)');
  });

  it('게이지가 같으면 원본 그대로', () => {
    const r = convertShaping({ kind: 'dec', everyRows: 4, times: 8, stitchesPerEvent: 2 }, 1, 1);
    expect(r.totalRows).toBe(32);
    expect(r.times).toBe(8);
    expect(r.description).toBe('4단마다 줄임 8회');
  });
});

describe('describeIntervals', () => {
  it('빈 목록', () => {
    expect(describeIntervals([], 'inc')).toBe('늘림 없음');
  });
});

describe('buildRowTable / upcomingEvents (3.2, F4-5)', () => {
  const { kSt, kRow } = gaugeRatio(mine, pattern);
  const shaping = convertShaping({ kind: 'inc', everyRows: 6, times: 12, stitchesPerEvent: 2 }, kSt, kRow);

  it('늘림이 반영된 단별 콧수', () => {
    const table = buildRowTable({
      castOn: 68,
      totalRows: 90,
      shaping: [{ kind: 'inc', stitchesPerEvent: 2, intervals: shaping.intervals }],
    });
    expect(table).toHaveLength(90);
    expect(table[0]!.stitchCount).toBe(68);
    expect(table[78]!.row).toBe(79);
    expect(table[78]!.events).toHaveLength(1); // 마지막 늘림 = 79단
    expect(table[89]!.stitchCount).toBe(68 + 28);
  });

  it('다가오는 일: 앞으로 20단 안의 이벤트', () => {
    const table = buildRowTable({
      castOn: 68,
      totalRows: 90,
      shaping: [{ kind: 'inc', stitchesPerEvent: 2, intervals: shaping.intervals }],
    });
    const rows = eventRows(shaping.intervals);
    const next = upcomingEvents(table, 0, 20);
    expect(next.map((e) => e.row)).toEqual(rows.filter((r) => r <= 20));
    expect(next[0]!.rowsAway).toBe(rows[0]);
  });

  it('총 단을 넘는 이벤트는 오류', () => {
    expect(() =>
      buildRowTable({ castOn: 10, totalRows: 5, shaping: [{ kind: 'inc', stitchesPerEvent: 1, intervals: [3, 3] }] }),
    ).toThrow(RangeError);
  });
});

describe('progress (4.3)', () => {
  it('완료한 단 + 현재 단에서 뜬 코', () => {
    const p = pieceProgress({ rowStitchCounts: [10, 10, 12, 12], completedRows: 2, stitchesInCurrentRow: 6 });
    expect(p.stitchesDone).toBe(26);
    expect(p.totalStitches).toBe(44);
    expect(p.ratio).toBeCloseTo(26 / 44);
  });

  it('범위를 벗어난 입력은 잘라냄', () => {
    const p = pieceProgress({ rowStitchCounts: [10, 10], completedRows: 5, stitchesInCurrentRow: 99 });
    expect(p.ratio).toBe(1);
  });

  it('전체 진척도는 콧수 가중 평균', () => {
    const body = { stitchesDone: 720, totalStitches: 1000, ratio: 0.72 };
    const sleeve = { stitchesDone: 0, totalStitches: 500, ratio: 0 };
    expect(overallProgress([body, sleeve]).ratio).toBeCloseTo(0.48);
  });
});

describe('coefficient learning (4.4)', () => {
  it('예상 96cm, 실제 92cm, k_used 1.136 → 약 1.185', () => {
    expect(kFromFinished(96, 92, 1.136)).toBeCloseTo(1.1854, 3);
  });

  it('완성 실측은 가중치 2로 반영', () => {
    const afterSwatches = { k: 1.1, sampleCount: 2 };
    const r = updateCoefficient(afterSwatches, 1.2, FINISHED_WEIGHT);
    expect(r.k).toBeCloseTo((1.1 * 2 + 1.2 * 2) / 4);
    expect(r.sampleCount).toBe(4);
  });

  it('첫 표본은 그대로', () => {
    expect(updateCoefficient(undefined, 1.13)).toEqual({ k: 1.13, sampleCount: 1 });
  });
});
