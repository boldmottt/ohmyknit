import { assertPositive } from './gauge.js';

export type ShapingKind = 'inc' | 'dec';

/** 도안에 적힌 반복 늘림·줄임 ("6단마다 2코 늘림 × 12회") */
export type RepeatedShaping = {
  kind: ShapingKind;
  everyRows: number;
  times: number;
  stitchesPerEvent: number;
};

export type ConvertedShaping = {
  kind: ShapingKind;
  stitchesPerEvent: number;
  /** 변환 후 총 단 수 */
  totalRows: number;
  /** 변환 후 횟수 */
  times: number;
  /** 각 늘림·줄임 사이 간격(단). 합계 = totalRows */
  intervals: number[];
  /** 변환 후 늘거나 줄어드는 총 콧수 */
  totalStitchChange: number;
  /** 원본 콧수 변화 × kSt (반올림 전) */
  rawStitchChange: number;
  /** "6단마다 늘림 9회, 5단마다 늘림 5회 (번갈아)" */
  description: string;
};

/**
 * totalRows 단 안에 times 번의 이벤트를 최대한 고르게 배치합니다.
 * 긴 간격과 짧은 간격을 번갈아 섞는 Bresenham 방식입니다.
 *
 * 예: distributeIntervals(79, 14) → 6단 간격 9회 + 5단 간격 5회
 */
export function distributeIntervals(totalRows: number, times: number): number[] {
  if (!Number.isInteger(totalRows) || !Number.isInteger(times)) {
    throw new RangeError('totalRows and times must be integers');
  }
  if (times <= 0) return [];
  if (totalRows < times) {
    throw new RangeError(
      `${totalRows}단 안에 ${times}회를 넣을 수 없어요 (간격이 1단보다 짧아짐)`,
    );
  }
  const intervals: number[] = [];
  for (let i = 1; i <= times; i++) {
    // 긴 간격이 먼저 나오도록 ceil 사용 → 마지막 이벤트가 정확히 totalRows단에 위치
    intervals.push(Math.ceil((i * totalRows) / times) - Math.ceil(((i - 1) * totalRows) / times));
  }
  return intervals;
}

/** 간격 목록을 "6단마다 늘림 9회, 5단마다 늘림 5회 (번갈아)" 형태로 요약합니다. */
export function describeIntervals(intervals: number[], kind: ShapingKind): string {
  if (intervals.length === 0) return kind === 'inc' ? '늘림 없음' : '줄임 없음';
  const verb = kind === 'inc' ? '늘림' : '줄임';
  const counts = new Map<number, number>();
  for (const iv of intervals) counts.set(iv, (counts.get(iv) ?? 0) + 1);
  const parts = [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([gap, n]) => `${gap}단마다 ${verb} ${n}회`);
  return counts.size > 1 ? `${parts.join(', ')} (번갈아)` : parts[0]!;
}

/**
 * 반복 늘림·줄임을 내 게이지로 변환합니다. (기획서 4.2, v1.0.1)
 *
 * 1. 단 수: everyRows × times × kRow
 * 2. 횟수: 늘거나 줄어드는 콧수 × kSt ÷ stitchesPerEvent  ← 횟수도 다시 계산해야 폭이 맞음
 * 3. 간격: 새 단 수에 새 횟수를 고르게 배치
 */
export function convertShaping(
  shaping: RepeatedShaping,
  kSt: number,
  kRow: number,
): ConvertedShaping {
  assertPositive('everyRows', shaping.everyRows);
  assertPositive('times', shaping.times);
  assertPositive('stitchesPerEvent', shaping.stitchesPerEvent);
  assertPositive('kSt', kSt);
  assertPositive('kRow', kRow);

  const totalRows = Math.max(1, Math.round(shaping.everyRows * shaping.times * kRow));
  const rawStitchChange = shaping.stitchesPerEvent * shaping.times * kSt;
  const times = Math.min(
    totalRows,
    Math.max(1, Math.round(rawStitchChange / shaping.stitchesPerEvent)),
  );
  const intervals = distributeIntervals(totalRows, times);

  return {
    kind: shaping.kind,
    stitchesPerEvent: shaping.stitchesPerEvent,
    totalRows,
    times,
    intervals,
    totalStitchChange: times * shaping.stitchesPerEvent,
    rawStitchChange,
    description: describeIntervals(intervals, shaping.kind),
  };
}

/** 간격 목록 → 이벤트가 일어나는 단 번호 (startRow부터 1단씩 셈, startRow 다음 단이 1번째) */
export function eventRows(intervals: number[], startRow = 0): number[] {
  const rows: number[] = [];
  let row = startRow;
  for (const iv of intervals) {
    row += iv;
    rows.push(row);
  }
  return rows;
}
