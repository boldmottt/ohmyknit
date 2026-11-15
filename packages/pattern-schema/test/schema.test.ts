import { describe, expect, it } from 'vitest';
import { parsePattern, resolveSize, SAMPLE_CHART_GRID, SAMPLE_PATTERN } from '../src/index.js';

describe('pattern schema', () => {
  it('샘플 도안이 통과하고 기본값이 채워짐', () => {
    const p = parsePattern(SAMPLE_PATTERN);
    expect(p.pieces[0]!.sections[0]!.shaping).toEqual([]);
    expect(p.pieces[1]!.count).toBe(2);
  });

  it('샘플 차트는 12×19', () => {
    expect(SAMPLE_CHART_GRID).toHaveLength(19);
    expect(SAMPLE_CHART_GRID.every((r) => r.length === 12)).toBe(true);
  });

  it('잘못된 도안은 경로가 담긴 메시지로 거부', () => {
    expect(() => parsePattern({ title: '', gauge: { st: 0, row: 30 } })).toThrow(/gauge\.st|title/);
  });

  it('resolveSize', () => {
    expect(resolveSize(10, 'M')).toBe(10);
    expect(resolveSize({ M: 200 }, 'M')).toBe(200);
    expect(() => resolveSize({ M: 200 }, 'S')).toThrow('S');
  });
});

import { chartHasNoStitch, makeSwirlChart, NO_STITCH, realCells, SAMPLE_BEANIE } from '../src/index.js';

describe('코 없음 칸', () => {
  it('소용돌이 차트: 1단 16코 → 맨 위 1코, 코 없음은 왼쪽', () => {
    const g = makeSwirlChart(16, 18);
    expect(realCells(g[0]!)).toHaveLength(16);
    expect(realCells(g[17]!)).toHaveLength(1);
    expect(g[17]![0]).toBe(NO_STITCH);
    expect(g[17]![15]).not.toBe(NO_STITCH);
    expect(chartHasNoStitch(g)).toBe(true);
  });

  it('비니 샘플이 스키마를 통과', () => {
    const p = parsePattern(SAMPLE_BEANIE);
    expect(p.palette[0]!.heather).toBe(0.35);
    expect(p.pieces[0]!.sections[2]!.chart!.preview!.renderAs).toBe('circle');
  });

  it('-2 같은 값은 거부', () => {
    expect(() => parsePattern({ ...SAMPLE_BEANIE, pieces: [{ ...SAMPLE_BEANIE.pieces[0]!, sections: [{ name: 'x', rows: 1, chart: { grid: [[-2]] } }] }] })).toThrow();
  });
});

describe('저장 전에 막는 값', () => {
  const body = SAMPLE_PATTERN.pieces[0]!;
  const withBody = (over: object) => ({ ...SAMPLE_PATTERN, pieces: [{ ...body, ...over }] });
  const sec = (over: object) => withBody({ sections: [{ name: 'x', rows: 4, ...over }] });

  it('조각 id가 겹치면 거부 (여러 장 뜨는 조각을 펼친 id 포함)', () => {
    expect(() => parsePattern({ ...SAMPLE_PATTERN, pieces: [body, body] })).toThrow(/겹쳐요/);
    expect(() =>
      parsePattern({ ...SAMPLE_PATTERN, pieces: [{ ...body, id: 'sleeve', count: 2 }, { ...body, id: 'sleeve-1' }] }),
    ).toThrow(/sleeve-1/);
  });

  it('코잡기 0코, 소수 단 수는 거부', () => {
    expect(() => parsePattern(withBody({ castOn: 0 }))).toThrow(/코잡기/);
    expect(() => parsePattern(withBody({ castOn: { M: 100.5 } }))).toThrow(/정수/);
    expect(() => parsePattern(sec({ rows: 4.5 }))).toThrow(/단 수/);
    expect(() => parsePattern(sec({ rows: 0 }))).toThrow(/단 수/);
  });

  it('차트: 빈 줄, 줄마다 다른 칸 수, 코가 없는 줄, 너무 큰 반복 너비는 거부', () => {
    expect(() => parsePattern(sec({ chart: { grid: [[]] } }))).toThrow(/빈 줄/);
    expect(() => parsePattern(sec({ chart: { grid: [[0, 1, 0, 1], [0]] } }))).toThrow(/칸 수/);
    expect(() => parsePattern(sec({ chart: { grid: [[0, 1], [NO_STITCH, NO_STITCH]] } }))).toThrow(/뜨는 코/);
    expect(() => parsePattern(sec({ chart: { grid: [[0, 1]], repeatW: 3 } }))).toThrow(/반복 너비/);
  });
});
