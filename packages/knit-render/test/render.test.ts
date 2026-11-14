import { describe, expect, it } from 'vitest';
import { convertPattern } from '@knitcloset/gauge-engine';
import { parsePattern, SAMPLE_PATTERN } from '@knitcloset/pattern-schema';
import { fabricLayout, rowAtY, rowTop, shade, stitchAt, visibleStitches } from '../src/index.js';

const conv = convertPattern(parsePattern(SAMPLE_PATTERN), { size: 'M', myGauge: { st: 25, row: 33 } });
const body = conv.pieces[0]!;

describe('knit-render layout', () => {
  it('원통뜨기는 앞면 절반', () => {
    expect(visibleStitches(body, body.rows[0]!)).toBe(114);
  });

  it('아래에서 위로: 1단이 맨 아래', () => {
    const l = fabricLayout(body, 4);
    expect(rowTop(body, l, 1)).toBeCloseTo((l.totalRows - 1) * l.cellH);
    expect(l.height).toBeGreaterThanOrEqual(l.totalRows * l.cellH);
    expect(rowTop(body, l, body.totalRows)).toBeCloseTo(0);
  });

  it('y ↔ 단 번호 왕복', () => {
    const l = fabricLayout(body, 4);
    for (const r of [1, 20, 77, body.totalRows]) {
      expect(rowAtY(body, l, rowTop(body, l, r) + l.cellH / 2)).toBe(r);
    }
  });

  it('차트 구간은 차트 색, 고무단은 겉2 안2', () => {
    const chartRow = body.rows.find((r) => r.chartRow === 1)!; // 차트 2단: pppp..pppp..
    expect(stitchAt(body, chartRow, 0).color).toBe(1);
    expect(stitchAt(body, chartRow, 4).color).toBe(0);
    expect(stitchAt(body, chartRow, 12).color).toBe(1); // 12코마다 반복
    const rib = body.rows[0]!;
    expect([0, 1, 2, 3].map((c) => stitchAt(body, rib, c).kind)).toEqual(['knit', 'knit', 'purl', 'purl']);
  });

  it('shade', () => {
    expect(shade('#808080', 0)).toBe('#808080');
    expect(shade('#808080', -1)).toBe('#000000');
    expect(shade('#808080', 1)).toBe('#ffffff');
  });
});
