import type { ShapingKind } from './shaping.js';
import { eventRows } from './shaping.js';

export type RowEvent = { kind: ShapingKind; stitches: number };

export type RowEntry = {
  /** 1부터 시작하는 단 번호 */
  row: number;
  /** 이 단을 다 뜬 뒤 바늘에 있는 콧수 */
  stitchCount: number;
  events: RowEvent[];
};

export type ShapingPlacement = {
  kind: ShapingKind;
  stitchesPerEvent: number;
  /** convertShaping()의 intervals */
  intervals: number[];
  /** 이 늘림·줄임 구간이 시작되기 직전 단 (기본 0) */
  startRow?: number;
};

export type RowTableInput = {
  castOn: number;
  totalRows: number;
  shaping?: ShapingPlacement[];
};

/**
 * 단마다 콧수와 이벤트를 펼친 rowTable을 만듭니다. (기획서 3.2)
 * 작업 화면의 지시 카드, 다가오는 일, 진척도가 모두 이 표를 읽습니다.
 */
export function buildRowTable(input: RowTableInput): RowEntry[] {
  if (!Number.isInteger(input.castOn) || input.castOn <= 0) {
    throw new RangeError(`castOn must be a positive integer (got ${input.castOn})`);
  }
  if (!Number.isInteger(input.totalRows) || input.totalRows <= 0) {
    throw new RangeError(`totalRows must be a positive integer (got ${input.totalRows})`);
  }

  const eventsByRow = new Map<number, RowEvent[]>();
  for (const s of input.shaping ?? []) {
    for (const row of eventRows(s.intervals, s.startRow ?? 0)) {
      if (row > input.totalRows) {
        throw new RangeError(`${row}단 이벤트가 총 ${input.totalRows}단을 넘어요`);
      }
      const list = eventsByRow.get(row) ?? [];
      list.push({ kind: s.kind, stitches: s.stitchesPerEvent });
      eventsByRow.set(row, list);
    }
  }

  const table: RowEntry[] = [];
  let count = input.castOn;
  for (let row = 1; row <= input.totalRows; row++) {
    const events = eventsByRow.get(row) ?? [];
    for (const e of events) count += e.kind === 'inc' ? e.stitches : -e.stitches;
    if (count <= 0) throw new RangeError(`${row}단에서 콧수가 0 이하가 돼요`);
    table.push({ row, stitchCount: count, events });
  }
  return table;
}

/** 현재 단 기준으로 앞으로 lookahead 단 안의 이벤트 (작업 화면 "다가오는 일") */
export function upcomingEvents(
  table: RowEntry[],
  completedRows: number,
  lookahead = 20,
): { row: number; rowsAway: number; events: RowEvent[] }[] {
  return table
    .filter((r) => r.events.length > 0 && r.row > completedRows && r.row <= completedRows + lookahead)
    .map((r) => ({ row: r.row, rowsAway: r.row - completedRows, events: r.events }));
}
