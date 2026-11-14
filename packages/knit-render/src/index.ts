import type { ConvertedPiece, ConvertedRow } from '@knitcloset/gauge-engine';
import { NO_STITCH, realCells } from '@knitcloset/pattern-schema';

/**
 * 니트 렌더러 (기획서 2.4 knit-render).
 * 옷장의 옷 텍스처와 작업 화면 시뮬레이션이 같은 함수로 그려서 두 화면 모습이 일치합니다.
 *
 * 구현: Canvas 2D. 코 하나 = V자(겉뜨기) 또는 가로 혹(안뜨기).
 * 완성된 원단을 한 번 오프스크린 캔버스에 그려 두고, 진행 표시는 그 위에 덧그립니다.
 * (PixiJS 인스턴싱은 천 물리와 함께 M5에서)
 */

/** 실 한 가지. hex2·heather가 있으면 두 색이 섞인 얼룩실로 그려요 */
export type YarnColor = { name: string; hex: string; hex2?: string; heather?: number };
export type Palette = YarnColor[];

export const DEFAULT_MAIN = '#6B1F3A';

/** 원통뜨기는 앞면 절반만 보여 줌 */
export function visibleStitches(piece: Pick<ConvertedPiece, 'construction'>, row: Pick<ConvertedRow, 'stitchesWorked'>): number {
  return piece.construction === 'round' ? Math.ceil(row.stitchesWorked / 2) : row.stitchesWorked;
}

export type FabricLayout = {
  /** 가장 넓은 단의 보이는 코 수 */
  maxStitches: number;
  totalRows: number;
  cellW: number;
  cellH: number;
  width: number;
  height: number;
};

export function fabricLayout(piece: ConvertedPiece, cellW: number): FabricLayout {
  const maxStitches = Math.max(1, ...piece.rows.map((r) => visibleStitches(piece, r)));
  const cellH = Math.round(cellW * 0.86 * 100) / 100;
  return {
    maxStitches,
    totalRows: piece.rows.length,
    cellW,
    cellH,
    width: Math.ceil(maxStitches * cellW),
    height: Math.ceil(piece.rows.length * cellH),
  };
}

/** 1부터 시작하는 단 번호 → 캔버스 y (그 단의 위쪽 모서리). 아래에서 위로 뜨면 1단이 맨 아래 */
export function rowTop(piece: Pick<ConvertedPiece, 'direction'>, layout: FabricLayout, row: number): number {
  return piece.direction === 'top_down'
    ? (row - 1) * layout.cellH
    : (layout.totalRows - row) * layout.cellH;
}

/** 캔버스 y → 단 번호 (1 ~ totalRows) */
export function rowAtY(piece: Pick<ConvertedPiece, 'direction'>, layout: FabricLayout, y: number): number {
  const fromTop = Math.floor(y / layout.cellH);
  const row = piece.direction === 'top_down' ? fromTop + 1 : layout.totalRows - fromTop;
  return Math.max(1, Math.min(layout.totalRows, row));
}

export type StitchKind = 'knit' | 'purl';

/**
 * (단, 코)의 색 번호와 겉/안. col은 화면 왼쪽부터 0.
 * 차트가 있으면 차트를 반복해서 읽고, 고무뜨기는 2코 겉 / 2코 안으로 보여 줌.
 */
export function stitchAt(piece: ConvertedPiece, row: ConvertedRow, col: number): { color: number; kind: StitchKind } {
  const section = piece.sections[row.sectionIndex];
  if (section?.chart && row.chartRow !== undefined) {
    const line = section.chart.grid[row.chartRow] ?? [0];
    // 코 없음 칸은 실제로 없는 코라서 건너뛰고 읽음
    const cells = section.chart.shaped ? realCells(line) : line;
    const w = Math.max(1, cells.length);
    const c = cells[col % w] ?? 0;
    return { color: c === NO_STITCH ? 0 : c, kind: 'knit' };
  }
  if (section?.technique === 'ribbing') return { color: 0, kind: col % 4 < 2 ? 'knit' : 'purl' };
  if (section?.technique === 'garter') return { color: 0, kind: row.sectionRow % 2 === 0 ? 'purl' : 'knit' };
  return { color: 0, kind: 'knit' };
}

export function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amount > 0 ? (255 - c) * amount : c * amount))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/* ───────────── 코 스프라이트 ─────────────
 * 코 하나를 고해상도로 한 번만 그려 두고(실의 볼륨·꼬임·그림자) 필요한 크기로 찍어요.
 * 색·종류마다 하나씩 캐시해서 수만 코도 빠르게 그립니다.
 */
const SPRITE_W = 64;
const SPRITE_H = 56;
type SpriteCanvas = HTMLCanvasElement | OffscreenCanvas;
const sprites = new Map<string, SpriteCanvas>();

function makeCanvas(w: number, h: number): SpriteCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

function paintLeg(g: Ctx, side: -1 | 1, color: string) {
  const W = SPRITE_W;
  const H = SPRITE_H;
  const cx = W / 2 + side * W * 0.2;
  const cy = H * 0.5;
  g.save();
  g.translate(cx, cy);
  // 왼쪽 다리는 위가 왼쪽으로, 오른쪽 다리는 위가 오른쪽으로 → 아래가 모이는 V자
  g.rotate(side * 0.5);
  const rx = W * 0.235;
  const ry = H * 0.6;
  // 실 한 가닥의 둥근 볼륨: 가장자리는 어둡고 가운데 살짝 위가 밝게
  const vol = g.createLinearGradient(-rx, 0, rx, 0);
  vol.addColorStop(0, shade(color, -0.3));
  vol.addColorStop(0.28, shade(color, 0));
  vol.addColorStop(0.5, shade(color, 0.2));
  vol.addColorStop(0.74, shade(color, -0.02));
  vol.addColorStop(1, shade(color, -0.34));
  g.beginPath();
  g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = vol;
  g.fill();
  g.save();
  g.clip();
  // 위에서 비추는 빛 + 아래쪽 그늘
  const lit = g.createLinearGradient(0, -ry, 0, ry);
  lit.addColorStop(0, 'rgba(255,255,255,0.20)');
  lit.addColorStop(0.45, 'rgba(255,255,255,0)');
  lit.addColorStop(1, 'rgba(0,0,0,0.26)');
  g.fillStyle = lit;
  g.fillRect(-rx, -ry, rx * 2, ry * 2);
  // 실의 꼬임(플라이) 결
  g.lineCap = 'round';
  for (let i = -4; i <= 4; i++) {
    const y = (i / 4) * ry * 0.95;
    g.beginPath();
    g.moveTo(-rx, y + side * rx * 0.55);
    g.quadraticCurveTo(0, y, rx, y - side * rx * 0.55);
    g.strokeStyle = i % 2 ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.12)';
    g.lineWidth = 1.5;
    g.stroke();
  }
  g.restore();
  g.strokeStyle = shade(color, -0.55);
  g.globalAlpha = 0.55;
  g.lineWidth = 1.1;
  g.stroke();
  g.restore();
}

function stitchSprite(color: string, kind: StitchKind): SpriteCanvas | null {
  const key = `${kind}${color}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const c = makeCanvas(SPRITE_W, SPRITE_H);
  const g = c?.getContext('2d') as Ctx | null;
  if (!c || !g) return null;
  const W = SPRITE_W;
  const H = SPRITE_H;
  // 코 사이 깊은 그늘 (원단이 비어 보이지 않게)
  g.fillStyle = shade(color, -0.4);
  g.beginPath();
  g.ellipse(W / 2, H / 2, W * 0.5, H * 0.5, 0, 0, Math.PI * 2);
  g.fill();
  if (kind === 'purl') {
    // 안뜨기: 가로로 누운 혹
    const vol = g.createLinearGradient(0, H * 0.16, 0, H * 0.84);
    vol.addColorStop(0, shade(color, -0.3));
    vol.addColorStop(0.4, shade(color, 0.14));
    vol.addColorStop(1, shade(color, -0.42));
    g.beginPath();
    g.ellipse(W / 2, H / 2, W * 0.47, H * 0.3, 0, 0, Math.PI * 2);
    g.fillStyle = vol;
    g.fill();
    g.strokeStyle = shade(color, -0.55);
    g.globalAlpha = 0.5;
    g.lineWidth = 1.1;
    g.stroke();
    g.globalAlpha = 1;
  } else {
    paintLeg(g, -1, color);
    paintLeg(g, 1, color);
  }
  sprites.set(key, c);
  return c;
}

function drawStitch(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, kind: StitchKind) {
  const sprite = stitchSprite(color, kind);
  if (sprite) {
    // 위아래 코가 살짝 겹쳐야 실제 편물처럼 촘촘해 보여요
    ctx.drawImage(sprite as CanvasImageSource, x - w * 0.04, y - h * 0.12, w * 1.08, h * 1.24);
    return;
  }
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

export type FabricOptions = {
  palette: Palette;
  cellW: number;
  /** 배경 (실루엣 바깥). undefined면 투명 */
  background?: string;
  /** 색약 모드: 색마다 다른 기호를 겹쳐 그림 */
  symbols?: boolean;
  /** 원통뜨기 뒷면 보기: 앞면 코 수만큼 밀어서 읽음 */
  back?: boolean;
};

export const COLOR_SYMBOLS = ['', '●', '▲', '■', '◆', '★', '✚', '▼', '◐', '◇'];

/**
 * 조각 전체를 다 뜬 모습으로 그립니다. 반환값은 레이아웃 (오버레이 계산용).
 * 단마다 보이는 코 수가 다르면 가운데 정렬해서 늘림·줄임 실루엣이 보이게 합니다.
 */
export function drawFabric(ctx: Ctx, piece: ConvertedPiece, opts: FabricOptions): FabricLayout {
  const layout = fabricLayout(piece, opts.cellW);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, layout.width, layout.height);
  } else {
    ctx.clearRect(0, 0, layout.width, layout.height);
  }
  const pal = opts.palette.length ? opts.palette : [{ name: '', hex: DEFAULT_MAIN }];
  const colors = pal.map((p) => p.hex);
  const { cellW: w, cellH: h } = layout;
  for (const row of piece.rows) {
    const n = visibleStitches(piece, row);
    const x0 = ((layout.maxStitches - n) * w) / 2;
    const y = rowTop(piece, layout, row.row);
    const offset = opts.back && piece.construction === 'round' ? n : 0;
    for (let c = 0; c < n; c++) {
      const s = stitchAt(piece, row, c + offset);
      drawStitch(ctx, x0 + c * w, y, w, h, stitchColor(pal[s.color] ?? pal[0]!, row.row, c + offset), s.kind);
      if (opts.symbols && s.color > 0 && w >= 9) {
        ctx.fillStyle = shade(colors[s.color] ?? '#000', -0.6);
        ctx.font = `${Math.floor(w * 0.6)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(COLOR_SYMBOLS[s.color % COLOR_SYMBOLS.length]!, x0 + c * w + w / 2, y + h / 2);
      }
    }
  }
  return layout;
}

export type ProgressOverlayOptions = {
  /** 다 뜬 단 수 */
  completedRows: number;
  ghost: string;
  highlight: string;
  /** 현재 단에서 뜬 코 수 (코 단위 추적) */
  currentStitch?: number;
};

/**
 * 진행 표시: 아직 안 뜬 단은 반투명 고스트로 덮고, 지금 뜨는 단에 테두리와 바늘을 그립니다.
 */
export function drawProgress(ctx: Ctx, piece: ConvertedPiece, layout: FabricLayout, o: ProgressOverlayOptions) {
  const { cellW: w, cellH: h } = layout;
  ctx.save();
  ctx.fillStyle = o.ghost;
  for (const row of piece.rows) {
    if (row.row <= o.completedRows) continue;
    const n = visibleStitches(piece, row);
    const x0 = ((layout.maxStitches - n) * w) / 2;
    ctx.fillRect(x0, rowTop(piece, layout, row.row), n * w, h + 0.5);
  }
  const current = piece.rows[o.completedRows];
  if (current) {
    const n = visibleStitches(piece, current);
    const x0 = ((layout.maxStitches - n) * w) / 2;
    const y = rowTop(piece, layout, current.row);
    ctx.strokeStyle = o.highlight;
    ctx.lineWidth = Math.max(1.5, w * 0.25);
    ctx.strokeRect(x0 - 1, y - 1, n * w + 2, h + 2);
    // 바늘
    const needleY = piece.direction === 'top_down' ? y + h + 3 : y - 3;
    ctx.beginPath();
    ctx.moveTo(x0 - w * 2, needleY);
    if (piece.construction === 'round') {
      ctx.quadraticCurveTo(x0 + (n * w) / 2, needleY - h * 1.6, x0 + n * w + w * 2, needleY);
    } else {
      ctx.lineTo(x0 + n * w + w * 2, needleY);
    }
    ctx.strokeStyle = '#B08D57';
    ctx.lineWidth = Math.max(2, w * 0.35);
    ctx.lineCap = 'round';
    ctx.stroke();
    if (o.currentStitch && o.currentStitch > 0) {
      // 원통뜨기는 앞면 절반만 보이므로 비율로 표시
      const ratio = Math.min(1, o.currentStitch / current.stitchesWorked);
      ctx.fillStyle = o.highlight;
      ctx.globalAlpha = 0.35;
      // 뜨개는 오른쪽에서 왼쪽으로 진행
      ctx.fillRect(x0 + n * w * (1 - ratio), y, n * w * ratio, h);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

/** 옷 실루엣 위에 칠할 진척도 (0~1)를 단 높이 기준으로 바꿈 */
export function filledHeightRatio(piece: ConvertedPiece, completedRows: number): number {
  return piece.rows.length ? Math.min(1, completedRows / piece.rows.length) : 0;
}

/**
 * 옷장의 옷 텍스처용 작은 원단 조각. colorAt(행, 열)이 색 번호를 돌려줌 (행 0 = 맨 아래).
 */
export function drawSwatch(
  ctx: Ctx,
  cols: number,
  rows: number,
  cellW: number,
  palette: Palette,
  colorAt: (row: number, col: number) => number = () => 0,
) {
  const colors = palette.length ? palette.map((p) => p.hex) : [DEFAULT_MAIN];
  const h = cellW * 0.86;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = colorAt(r, c);
      drawStitch(ctx, c * cellW, (rows - 1 - r) * h, cellW, h, colors[idx] ?? colors[0]!, 'knit');
    }
  }
}

/* ───────────── 실 질감 ───────────── */

function hash2(a: number, b: number): number {
  let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * 코 하나의 실제 색. 같은 (단, 코)는 항상 같은 색 (다시 그려도 깜빡이지 않게).
 * 얼룩실이면 heather 비율만큼 두 번째 색이 섞이고, 모든 실에 아주 약한 명암 차이를 줘요.
 */
export function stitchColor(yarn: YarnColor, row: number, col: number): string {
  const h = hash2(row + 1, col + 1);
  const r1 = (h % 1000) / 1000;
  const r2 = ((h >>> 10) % 1000) / 1000;
  const base = yarn.hex2 && yarn.heather && r1 < yarn.heather * 0.7 ? yarn.hex2 : yarn.hex;
  // 명암은 5단계로만 (스프라이트 캐시가 작게 유지되도록)
  return shade(base, ((Math.floor(r2 * 5) + 0.5) / 5 - 0.5) * (yarn.heather ? 0.16 : 0.08));
}

/* ───────────── 차트 미리보기 (디자인 스튜디오) ───────────── */

export type ChartPreviewOptions = {
  palette: Palette;
  /** 가로(둘레) 반복 횟수 */
  repeatsX: number;
  /** 세로 반복 횟수 */
  repeatsY: number;
  /** 게이지: 10cm 코 수 / 단 수 → 코 하나의 가로세로 비율 */
  gauge: { st: number; row: number };
  /** 뜨는 방향. 아래에서 위로면 1단이 아래(평면) */
  direction?: 'bottom_up' | 'top_down';
};

/** 반복을 펼친 한 단의 코 색 목록 (코 없음은 빠짐) */
export function expandRow(line: readonly number[], repeatsX: number): number[] {
  const cells = realCells(line);
  const out: number[] = [];
  for (let i = 0; i < repeatsX; i++) out.push(...cells);
  return out;
}

/** 세로 반복까지 펼친 단 목록 (index 0 = 1단) */
export function expandRows(grid: readonly (readonly number[])[], o: Pick<ChartPreviewOptions, 'repeatsX' | 'repeatsY'>): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < Math.max(1, o.repeatsY); y++) for (const line of grid) rows.push(expandRow(line, Math.max(1, o.repeatsX)));
  return rows;
}

/** 코 하나의 높이/너비 비율 = 코 게이지 / 단 게이지 */
export function stitchAspect(g: { st: number; row: number }): number {
  return g.st > 0 && g.row > 0 ? g.st / g.row : 0.86;
}

/**
 * 평면 미리보기: 단마다 실제 코만 가운데 정렬로 늘어놓아요 (줄임이 있으면 모양이 좁아짐).
 * 반환: 그린 크기
 */
export function drawChartFlat(
  ctx: Ctx,
  grid: readonly (readonly number[])[],
  o: ChartPreviewOptions & { cellW: number },
): { width: number; height: number } {
  const rows = expandRows(grid, o);
  const w = o.cellW;
  const h = w * stitchAspect(o.gauge);
  const maxN = Math.max(1, ...rows.map((r) => r.length));
  const width = maxN * w;
  const height = rows.length * h;
  const rx = Math.max(1, o.repeatsX);
  const repW = maxN / rx;
  rows.forEach((cells, i) => {
    const y = o.direction === 'top_down' ? i * h : height - (i + 1) * h;
    // 반복마다 가운데 정렬 → 줄임이 있으면 반복 수만큼 뾰족한 쐐기 모양이 됨 (정수리를 펼친 모습)
    const per = cells.length / rx;
    cells.forEach((c, j) => {
      const rep = Math.floor(j / per);
      const k = j - rep * per;
      const x = (rep * repW + (repW - per) / 2 + k) * w;
      const yarn = o.palette[c] ?? o.palette[0] ?? { name: '', hex: DEFAULT_MAIN };
      drawStitch(ctx, x, y, w, h, stitchColor(yarn, i, j), 'knit');
    });
  });
  return { width, height };
}

export type CircleLayout = {
  /** 가운데에서 바깥쪽 순서의 단 index (expandRows 기준) */
  order: number[];
  /** order[i] 단의 반지름 (가운데) */
  radii: number[];
  ringH: number;
  /** 가운데가 1단이면 true (위에서 아래로 뜨는 원형, 또는 1단이 가장 좁을 때) */
  startAtCenter: boolean;
};

/**
 * 원형(정수리·원형 요크) 배치. 코가 적은 쪽 끝을 가운데에 둬요.
 * 고리 두께는 게이지 비율로, 가운데 구멍은 가장 안쪽 단의 코가 들어갈 만큼만.
 */
export function circleLayout(rowLengths: readonly number[], radius: number, gauge: { st: number; row: number }): CircleLayout {
  const n = rowLengths.length;
  const first = rowLengths[0] ?? 1;
  const last = rowLengths[n - 1] ?? 1;
  const startAtCenter = first <= last;
  const order = [...Array(n).keys()];
  if (!startAtCenter) order.reverse();
  const a = stitchAspect(gauge);
  const kCenter = Math.max(1, rowLengths[order[0]!] ?? 1);
  // 가장 안쪽 고리 둘레 ≈ 코 수 × 코 너비 (코 너비 = 고리 두께 / a)
  const r0Rows = Math.max(0.3, kCenter / (2 * Math.PI * a) - 0.5);
  const ringH = radius / (n + r0Rows);
  const radii = order.map((_, i) => ringH * (r0Rows + i + 0.5));
  return { order, radii, ringH, startAtCenter };
}

/**
 * 원형 미리보기: 단마다 고리 하나, 코는 고리 둘레에 고르게.
 * 줄임이 늘 같은 쪽(코 없음 칸 쪽)에서 일어나면 자연스럽게 소용돌이가 보여요.
 */
export function drawChartCircle(
  ctx: Ctx,
  grid: readonly (readonly number[])[],
  o: ChartPreviewOptions & { cx: number; cy: number; radius: number; rotateDeg?: number },
): CircleLayout {
  const rows = expandRows(grid, o);
  const layout = circleLayout(
    rows.map((r) => r.length),
    o.radius,
    o.gauge,
  );
  const rot = ((o.rotateDeg ?? 0) * Math.PI) / 180 - Math.PI / 2;
  layout.order.forEach((rowIdx, ring) => {
    const cells = rows[rowIdx]!;
    const k = cells.length;
    if (k === 0) return;
    const r = layout.radii[ring]!;
    const arcW = (2 * Math.PI * r) / k;
    const sw = Math.min(arcW * 1.08, layout.ringH * 1.6);
    const sh = layout.ringH * 1.12;
    cells.forEach((c, j) => {
      // 뜨개는 오른쪽→왼쪽으로 진행 = 시계 반대 방향
      const th = rot - ((j + 0.5) / k) * 2 * Math.PI;
      const yarn = o.palette[c] ?? o.palette[0] ?? { name: '', hex: DEFAULT_MAIN };
      ctx.save();
      ctx.translate(o.cx + r * Math.cos(th), o.cy + r * Math.sin(th));
      // V자의 뾰족한 쪽이 먼저 뜬 단(1단) 쪽을 향하게
      ctx.rotate(layout.startAtCenter ? th + Math.PI / 2 : th - Math.PI / 2);
      drawStitch(ctx, -sw / 2, -sh / 2, sw, sh, stitchColor(yarn, rowIdx, j), 'knit');
      ctx.restore();
    });
  });
  return layout;
}
