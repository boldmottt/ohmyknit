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
