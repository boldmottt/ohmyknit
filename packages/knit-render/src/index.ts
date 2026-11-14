import type { ConvertedPiece, ConvertedRow } from '@knitcloset/gauge-engine';

/**
 * 니트 렌더러 (기획서 2.4 knit-render).
 * 옷장의 옷 텍스처와 작업 화면 시뮬레이션이 같은 함수로 그려서 두 화면 모습이 일치합니다.
 *
 * 구현: Canvas 2D. 코 하나 = V자(겉뜨기) 또는 가로 혹(안뜨기).
 * 완성된 원단을 한 번 오프스크린 캔버스에 그려 두고, 진행 표시는 그 위에 덧그립니다.
 * (PixiJS 인스턴싱은 천 물리와 함께 M5에서)
 */

export type Palette = { name: string; hex: string }[];

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
    const line = section.chart.grid[row.chartRow];
    const w = line?.length ?? 1;
    return { color: line?.[col % w] ?? 0, kind: 'knit' };
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

function drawStitch(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, kind: StitchKind) {
  const dark = shade(color, -0.35);
  const light = shade(color, 0.18);
  if (kind === 'purl') {
    ctx.fillStyle = shade(color, -0.12);
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w * 0.48, h * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(0.4, w * 0.06);
    ctx.stroke();
    return;
  }
  for (const side of [-1, 1] as const) {
    const cx = x + w / 2 + side * w * 0.2;
    ctx.beginPath();
    ctx.ellipse(cx, y + h * 0.52, w * 0.24, h * 0.6, side * -0.55, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(0.4, w * 0.06);
    ctx.stroke();
    // 실의 결: 밝은 줄 하나
    ctx.beginPath();
    ctx.moveTo(cx - side * w * 0.05, y + h * 0.2);
    ctx.lineTo(cx + side * w * 0.06, y + h * 0.8);
    ctx.strokeStyle = light;
    ctx.lineWidth = Math.max(0.3, w * 0.05);
    ctx.stroke();
  }
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
  const colors = opts.palette.length ? opts.palette.map((p) => p.hex) : [DEFAULT_MAIN];
  const { cellW: w, cellH: h } = layout;
  for (const row of piece.rows) {
    const n = visibleStitches(piece, row);
    const x0 = ((layout.maxStitches - n) * w) / 2;
    const y = rowTop(piece, layout, row.row);
    const offset = opts.back && piece.construction === 'round' ? n : 0;
    for (let c = 0; c < n; c++) {
      const s = stitchAt(piece, row, c + offset);
      drawStitch(ctx, x0 + c * w, y, w, h, colors[s.color] ?? colors[0]!, s.kind);
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
