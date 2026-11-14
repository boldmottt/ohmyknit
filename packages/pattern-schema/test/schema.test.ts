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
