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

import { makeSwirlChart } from '@knitcloset/pattern-schema';
import { circleLayout, expandRow, expandRows, stitchAspect, stitchColor } from '../src/index.js';

describe('차트 미리보기', () => {
  const g = makeSwirlChart(16, 18);

  it('반복을 펼칠 때 코 없음 칸은 빠짐', () => {
    expect(expandRow(g[0]!, 5)).toHaveLength(80);
    expect(expandRow(g[17]!, 5)).toHaveLength(5);
    expect(expandRows(g, { repeatsX: 2, repeatsY: 3 })).toHaveLength(54);
  });

  it('원형: 코가 적은 끝이 가운데, 반지름은 바깥으로 갈수록 커짐', () => {
    const lens = expandRows(g, { repeatsX: 5, repeatsY: 1 }).map((r) => r.length);
    const l = circleLayout(lens, 200, { st: 20, row: 20 });
    expect(l.startAtCenter).toBe(false); // 1단(80코)이 가장자리, 18단(5코)이 가운데
    expect(l.order[0]).toBe(17);
    expect(l.radii.every((r, i) => i === 0 || r > l.radii[i - 1]!)).toBe(true);
    expect(l.radii.at(-1)! + l.ringH / 2).toBeCloseTo(200, 5);
  });

  it('위에서 아래로(1단이 좁음)면 1단이 가운데', () => {
    const l = circleLayout([5, 20, 40], 100, { st: 20, row: 20 });
    expect(l.startAtCenter).toBe(true);
    expect(l.order).toEqual([0, 1, 2]);
  });

  it('게이지 비율', () => {
    expect(stitchAspect({ st: 22, row: 30 })).toBeCloseTo(0.733, 3);
  });

  it('얼룩실 색은 같은 자리면 항상 같고, 단색 실은 원래 색 근처', () => {
    const y = { name: '보라', hex: '#B07A8C', hex2: '#6E4A6A', heather: 0.8 };
    expect(stitchColor(y, 3, 7)).toBe(stitchColor(y, 3, 7));
    const colors = new Set(Array.from({ length: 200 }, (_, i) => stitchColor(y, i, i * 3)));
    expect(colors.size).toBeGreaterThan(20);
    const plain = stitchColor({ name: '', hex: '#808080' }, 1, 1);
    const v = Number.parseInt(plain.slice(1, 3), 16);
    expect(Math.abs(v - 128)).toBeLessThan(12);
  });
});
