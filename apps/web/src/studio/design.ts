import { NO_STITCH, realCells, type Pattern, type PatternInput, type Yarn } from '@knitcloset/pattern-schema';

/** 디자인 스튜디오에서 편집하는 차트 한 장 */
export type Design = {
  name: string;
  description: string;
  /** index 0 = 1단(맨 아래), 각 줄은 화면 왼쪽→오른쪽 */
  grid: number[][];
  repeatsX: number;
  repeatsY: number;
  direction: 'bottom_up' | 'top_down';
  renderAs: 'flat' | 'circle';
  gauge: { st: number; row: number };
  yarns: Yarn[];
};

export function blankDesign(): Design {
  return {
    name: '새 디자인',
    description: '',
    grid: Array.from({ length: 18 }, () => Array(16).fill(1)),
    repeatsX: 5,
    repeatsY: 1,
    direction: 'bottom_up',
    renderAs: 'flat',
    gauge: { st: 20, row: 20 },
    yarns: [
      { name: '크림', hex: '#F3EBDD' },
      { name: '호박', hex: '#C8641E' },
    ],
  };
}

export const gridW = (g: number[][]) => g[0]?.length ?? 0;

/**
 * 크기 바꾸기. 1코가 오른쪽, 1단이 아래라서 오른쪽 아래를 기준으로 늘리고 줄여요.
 */
export function resizeGrid(g: number[][], w: number, h: number, fill = 0): number[][] {
  w = Math.max(1, Math.min(80, Math.round(w)));
  h = Math.max(1, Math.min(120, Math.round(h)));
  const oldW = gridW(g);
  return Array.from({ length: h }, (_, r) =>
    Array.from({ length: w }, (_, c) => {
      const oc = c - (w - oldW);
      return g[r]?.[oc] ?? fill;
    }),
  );
}

/** 같은 값으로 이어진 칸을 한 번에 칠하기 (4방향) */
export function floodFill(g: number[][], r: number, c: number, value: number): number[][] {
  const target = g[r]?.[c];
  if (target === undefined || target === value) return g;
  const out = g.map((row) => [...row]);
  const stack: [number, number][] = [[r, c]];
  while (stack.length) {
    const [y, x] = stack.pop()!;
    if (out[y]?.[x] !== target) continue;
    out[y]![x] = value;
    stack.push([y + 1, x], [y - 1, x], [y, x + 1], [y, x - 1]);
  }
  return out;
}

/** 실을 지우면 그 번호를 쓰던 칸을 0번으로, 뒤 번호는 하나씩 당김 */
export function removeYarnFromGrid(g: number[][], idx: number): number[][] {
  return g.map((row) => row.map((v) => (v === NO_STITCH ? v : v === idx ? 0 : v > idx ? v - 1 : v)));
}

export function stitchesInRow(line: number[], repeatsX: number): number {
  return realCells(line).length * repeatsX;
}

export type ChartRef = { pieceIndex: number; sectionIndex: number };

/** 도안에서 차트가 있는 구간 목록 */
export function chartSections(p: Pattern | PatternInput): (ChartRef & { label: string })[] {
  const out: (ChartRef & { label: string })[] = [];
  p.pieces.forEach((pc, pi) =>
    pc.sections.forEach((s, si) => {
      if (s.chart) out.push({ pieceIndex: pi, sectionIndex: si, label: `${pc.name} · ${s.name}` });
    }),
  );
  return out;
}

export function designFromPattern(p: Pattern, ref: ChartRef): Design | null {
  const piece = p.pieces[ref.pieceIndex];
  const sec = piece?.sections[ref.sectionIndex];
  if (!piece || !sec?.chart) return null;
  const grid = sec.chart.grid.map((r) => [...r]);
  const w = gridW(grid);
  const firstReal = realCells(grid[0] ?? []).length || w;
  return {
    name: p.title,
    description: sec.instruction,
    grid,
    repeatsX: sec.chart.preview?.repeatsX ?? 5,
    repeatsY: sec.chart.preview?.repeatsY ?? 1,
    direction: piece.direction,
    renderAs: sec.chart.preview?.renderAs ?? (piece.construction === 'round' && grid.some((r) => r.includes(NO_STITCH)) ? 'circle' : 'flat'),
    gauge: { st: p.gauge.st, row: p.gauge.row },
    yarns: p.palette.length ? p.palette.map((y) => ({ ...y })) : [{ name: '바탕색', hex: '#6B1F3A' }],
    ...(firstReal ? {} : {}),
  };
}

/** 스튜디오에서 만든 도안(조각 1개, 차트 구간 1개)인지. 그렇다면 디자인이 도안 전체를 정함 */
export function isStandalone(p: Pattern | PatternInput, sourceType: string): boolean {
  return sourceType === 'design' && p.pieces.length === 1 && p.pieces[0]!.sections.length === 1 && !!p.pieces[0]!.sections[0]!.chart;
}

/**
 * 열어 둔 도안의 그 구간에 디자인을 다시 넣습니다.
 *
 * - 차트 높이가 바뀌면 구간 단 수도 같은 반복 횟수로 맞춤 (안 그러면 늘린 줄이 뜰 때 잘려요)
 * - 스튜디오에서 만든 도안이면 코잡기·게이지·방향까지 디자인대로 다시 만듦
 * - 다른 도안(스웨터의 한 구간 등)이면 그 구간의 차트·설명과 실 색만 바꾸고 나머지는 건드리지 않음
 */
export function applyDesign(p: Pattern, ref: ChartRef, d: Design, standalone = false): Pattern {
  if (standalone) {
    const made = designToPattern(d);
    return { ...structuredClone(p), ...made, designer: p.designer, sizes: made.sizes, pieces: made.pieces } as Pattern;
  }
  const next = structuredClone(p);
  const sec = next.pieces[ref.pieceIndex]!.sections[ref.sectionIndex]!;
  const oldH = sec.chart?.grid.length ?? 0;
  const newH = d.grid.length;
  if (oldH > 0 && newH !== oldH) {
    const scale = (rows: number) => newH * Math.max(1, Math.round(rows / oldH));
    sec.rows = typeof sec.rows === 'number' ? scale(sec.rows) : Object.fromEntries(Object.entries(sec.rows).map(([k, v]) => [k, scale(v)]));
  }
  sec.chart = {
    ...sec.chart,
    grid: d.grid,
    repeatW: gridW(d.grid),
    preview: { repeatsX: d.repeatsX, repeatsY: d.repeatsY, renderAs: d.renderAs },
  };
  if (d.description.trim()) sec.instruction = d.description.trim();
  next.palette = d.yarns;
  next.title = d.name.trim() || next.title;
  return next;
}

/** 새 디자인을 바로 뜰 수 있는 도안으로 (조각 1개, 차트 구간 1개) */
export function designToPattern(d: Design): PatternInput {
  const castOn = Math.max(1, stitchesInRow(d.grid[0] ?? [], d.repeatsX));
  const w = gridW(d.grid);
  const shaped = d.grid.some((r) => r.includes(NO_STITCH));
  return {
    title: d.name || '새 디자인',
    designer: '',
    yarn: d.yarns.map((y) => [y.brand, y.name].filter(Boolean).join(' ')).join(', '),
    gauge: { st: d.gauge.st, row: d.gauge.row, technique: 'colorwork' },
    palette: d.yarns,
    sizes: [{ label: '기본', finished: { 둘레: Math.round((castOn / d.gauge.st) * 100) / 10 } }],
    pieces: [
      {
        id: 'design',
        name: d.name || '디자인',
        construction: d.renderAs === 'circle' ? 'round' : 'flat',
        direction: d.direction,
        count: 1,
        castOn,
        ...(shaped ? {} : { stitchMultiple: w }),
        sections: [
          {
            name: '차트',
            technique: 'colorwork',
            rows: d.grid.length * d.repeatsY,
            instruction: d.description || `차트대로 (가로 ${d.repeatsX}회 반복)`,
            chart: {
              grid: d.grid,
              repeatW: w,
              preview: { repeatsX: d.repeatsX, repeatsY: d.repeatsY, renderAs: d.renderAs },
            },
            shaping: [],
            events: [],
          },
        ],
      },
    ],
  };
}
