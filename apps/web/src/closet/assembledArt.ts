import type { ConvertedPiece } from '@knitcloset/gauge-engine';
import type { ProgressSnapshot } from '@knitcloset/gauge-engine';
import { drawFabric, fabricLayout, rowTop, visibleStitches, type Palette } from '@knitcloset/knit-render';
import type { WorkData } from '../api';
import { convertedPiece, pieceGauge } from '../derive';

/**
 * 실제로 뜬 만큼만 보이는 옷.
 *
 * 프로젝트의 변환된 도안(조각별 단 표)으로 몸판·소매를 하나씩 실제 니트로 그리고,
 * 각 조각을 **지금까지 뜬 단까지만** 선명하게, 나머지는 옅게 남겨요.
 * 크기는 그 조각의 게이지로 계산한 실제 cm 비율이라, 소매가 몸판보다 얼마나 긴지도 그대로예요.
 * 조각들을 옷 모양(몸판 가운데, 소매 양옆)으로 조립해 제품 사진처럼 보여 줍니다.
 */

export type ArtPiece = {
  piece: ConvertedPiece;
  /** 다 뜬 단 수 */
  completedRows: number;
  /** 지금 뜨는 단에서 뜬 코 수 */
  currentStitch?: number;
  /** 이 조각을 변환할 때 쓴 게이지 (10cm 코·단) */
  gauge: { st: number; row: number };
};

export type AssembleInput = {
  pieces: ArtPiece[];
  palette: Palette;
  /** 캔버스 크기 (옷걸이 포함) */
  width: number;
  height: number;
  /** 옷걸이에 걸기 (기본: 바닥 위에 떠 있는 제품 사진처럼) */
  hanger?: boolean;
  /** cm당 최대 픽셀. 주면 옷끼리 실제 크기 비율이 맞음 (모자는 스웨터보다 작게) */
  maxPxPerCm?: number;
  /** 강조할 조각 id (비교 보기에서 지금 뜨는 조각) */
  activeId?: string;
};

export type PlacedPiece = {
  id: string;
  /** 캔버스 좌표의 대략적인 영역 (누르면 그 조각으로 가는 데 씀) */
  box: { x: number; y: number; w: number; h: number };
};

export type Role = 'main' | 'sleeveL' | 'sleeveR';

const CELL = 4;
const fabricCache = new Map<string, HTMLCanvasElement>();

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** 조각 하나를 다 뜬 모습으로 (조각·실 색이 같으면 다시 그리지 않음) */
function fullFabric(piece: ConvertedPiece, palette: Palette): HTMLCanvasElement {
  const key = JSON.stringify([piece.id, piece.totalRows, piece.castOn.value, piece.rows.length, palette.map((p) => [p.hex, p.hex2, p.heather]), piece.sections.map((s) => s.chart?.grid.length ?? 0)]);
  const hit = fabricCache.get(key);
  if (hit) return hit;
  const layout = fabricLayout(piece, CELL);
  const c = makeCanvas(layout.width, layout.height);
  const ctx = c.getContext('2d')!;
  drawFabric(ctx, piece, { palette, cellW: CELL });
  if (fabricCache.size > 60) fabricCache.clear();
  fabricCache.set(key, c);
  return c;
}

/** 옷의 어느 부분인지: 몸판(또는 모자), 왼소매, 오른소매. 그 밖의 조각은 그리지 않음 */
export function roles(pieces: ArtPiece[]): Map<ArtPiece, Role> {
  const out = new Map<ArtPiece, Role>();
  const sleeves = pieces.filter((p) => /소매|sleeve|arm/i.test(p.piece.name));
  const rest = pieces.filter((p) => !sleeves.includes(p));
  const main =
    rest.find((p) => /몸판|몸통|앞판|body|front|비니|모자|hat|beanie|요크|yoke/i.test(p.piece.name)) ??
    [...rest].sort((a, b) => b.piece.totalStitches - a.piece.totalStitches)[0];
  if (main) out.set(main, 'main');
  if (sleeves[0]) out.set(sleeves[0], 'sleeveL');
  if (sleeves[1]) out.set(sleeves[1], 'sleeveR');
  return out;
}

/** 조각 크기 (cm): 원통뜨기는 앞면 절반 너비 */
function sizeCm(p: ArtPiece) {
  const layout = fabricLayout(p.piece, CELL);
  return { w: (layout.maxStitches / p.gauge.st) * 10, h: (layout.totalRows / p.gauge.row) * 10 };
}

type Pt = { x: number; y: number };

const tiles = new Map<string, HTMLCanvasElement>();

/** 실의 보풀 같은 잔 노이즈 타일 */
function noiseTile(): HTMLCanvasElement {
  const hit = tiles.get('noise');
  if (hit) return hit;
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(128, 128);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rnd() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  tiles.set('noise', c);
  return c;
}

/** 코 기둥(세로 결)과 단 결: 코 하나 크기 sw × sh 픽셀 */
function grainTile(sw: number, sh: number): HTMLCanvasElement {
  const w = Math.max(2, Math.round(sw * 4));
  const h = Math.max(2, Math.round(sh * 4));
  const key = `grain${w}x${h}`;
  const hit = tiles.get(key);
  if (hit) return hit;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) {
    // 코 사이 골은 어둡게, 코 가운데는 밝게
    const x = (i * w) / 4;
    const g = ctx.createLinearGradient(x, 0, x + w / 4, 0);
    g.addColorStop(0, '#5a5a5a');
    g.addColorStop(0.5, '#a8a8a8');
    g.addColorStop(1, '#5a5a5a');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w / 4, h);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let j = 0; j < 4; j++) ctx.fillRect(0, (j * h) / 4, w, Math.max(0.6, h / 16));
  tiles.set(key, c);
  return c;
}

/**
 * 조각 실루엣: 도안의 단별 콧수(늘림·줄임)로 옆선을 만들고 부드럽게 다듬음.
 * 몸판은 어깨 경사·뒷목선, 소매는 둥근 소매산, 모자는 둥근 정수리.
 */
function silhouette(p: ArtPiece, w: number, h: number, role: Role, isHat: boolean): { path: Path2D; neck?: { l: number; r: number; depth: number } } {
  const layout = fabricLayout(p.piece, CELL);
  const sy = h / layout.height;
  const rows = p.piece.rows;
  const K = Math.min(56, rows.length);
  const pts: { y: number; hw: number }[] = [];
  for (let i = 0; i < K; i++) {
    const r = rows[Math.round((i / Math.max(1, K - 1)) * (rows.length - 1))]!;
    const n = visibleStitches(p.piece, r);
    pts.push({ y: (rowTop(p.piece, layout, r.row) + layout.cellH / 2) * sy, hw: (n / layout.maxStitches) * (w / 2) });
  }
  pts.sort((a, b) => a.y - b.y);
  // 이웃 평균으로 계단을 펴기
  const sm = pts.map((q, i) => {
    const a = pts[Math.max(0, i - 2)]!;
    const b = pts[Math.min(pts.length - 1, i + 2)]!;
    return { y: q.y, hw: (a.hw + q.hw * 2 + b.hw) / 4 };
  });
  sm[0] = { y: 0, hw: sm[0]!.hw };
  sm[sm.length - 1] = { y: h, hw: sm[sm.length - 1]!.hw };
  const cx = w / 2;
  const left: Pt[] = sm.map((q) => ({ x: cx - q.hw, y: q.y }));
  const right: Pt[] = sm.map((q) => ({ x: cx + q.hw, y: q.y })).reverse();
  const path = new Path2D();
  const through = (ps: Pt[], first: boolean) => {
    ps.forEach((q, i) => {
      if (i === 0) {
        if (first) path.moveTo(q.x, q.y);
        else path.lineTo(q.x, q.y);
        return;
      }
      const prev = ps[i - 1]!;
      path.quadraticCurveTo(prev.x, prev.y, (prev.x + q.x) / 2, (prev.y + q.y) / 2);
      if (i === ps.length - 1) path.lineTo(q.x, q.y);
    });
  };
  const topHw = sm[0]!.hw;
  const botHw = sm[sm.length - 1]!.hw;
  const r = Math.min(w, h) * 0.035;
  let neck: { l: number; r: number; depth: number } | undefined;
  if (role === 'main' && !isHat) {
    // 어깨 경사 + 뒷목선
    const slope = h * 0.04;
    const nw = w * 0.19;
    left[0] = { x: cx - topHw, y: slope };
    const sr = r * 2.2;
    path.moveTo(cx - nw, 0);
    path.quadraticCurveTo(cx - topHw * 0.62, slope * 0.3, cx - topHw + sr, slope * 0.85);
    path.quadraticCurveTo(cx - topHw, slope, cx - topHw, slope + sr);
    through(left.slice(1, -1), false);
    // 밑단: 살짝 둥근 모서리, 가운데가 조금 처짐
    path.quadraticCurveTo(cx - botHw, h, cx - botHw + r, h);
    path.quadraticCurveTo(cx, h + h * 0.006, cx + botHw - r, h);
    path.quadraticCurveTo(cx + botHw, h, cx + botHw, h - r);
    through(right.slice(1, -1), false);
    path.lineTo(cx + topHw, slope + sr);
    path.quadraticCurveTo(cx + topHw, slope, cx + topHw - sr, slope * 0.85);
    path.quadraticCurveTo(cx + topHw * 0.62, slope * 0.3, cx + nw, 0);
    path.quadraticCurveTo(cx, -h * 0.012, cx - nw, 0);
    path.closePath();
    neck = { l: cx - nw, r: cx + nw, depth: w * 0.11 };
  } else if (isHat) {
    // 정수리: 줄임으로 좁아진 윗부분을 둥근 돔으로
    const l1 = left[1]!;
    const r1 = right[right.length - 2]!;
    path.moveTo(cx, 0);
    path.quadraticCurveTo(l1.x, 0, l1.x, l1.y);
    through(left.slice(1, -1), false);
    path.quadraticCurveTo(cx - botHw, h, cx - botHw + r, h);
    path.lineTo(cx + botHw - r, h);
    path.quadraticCurveTo(cx + botHw, h, cx + botHw, h - r);
    through(right.slice(1, -1), false);
    path.lineTo(r1.x, r1.y);
    path.quadraticCurveTo(r1.x, 0, cx, 0);
    path.closePath();
  } else {
    // 소매: 윗부분은 몸판 아래로 들어가니 둥근 소매산, 소맷부리는 살짝 둥근 모서리
    path.moveTo(cx - topHw, h * 0.03);
    through(left.slice(1, -1), false);
    path.quadraticCurveTo(cx - botHw, h, cx - botHw + r, h);
    path.lineTo(cx + botHw - r, h);
    path.quadraticCurveTo(cx + botHw, h, cx + botHw, h - r);
    through(right.slice(1, -1), false);
    path.lineTo(cx + topHw, h * 0.03);
    path.quadraticCurveTo(cx, -h * 0.03, cx - topHw, h * 0.03);
    path.closePath();
  }
  return { path, neck };
}

/** 뜬 단이 차지하는 y 구간 (조각 캔버스 좌표) */
function knitBand(p: ArtPiece, h: number): { y0: number; y1: number; edge: number | null } {
  const layout = fabricLayout(p.piece, CELL);
  const sy = h / layout.height;
  const done = Math.max(0, Math.min(p.piece.totalRows, p.completedRows));
  if (done === 0) return { y0: 0, y1: 0, edge: p.piece.direction === 'top_down' ? 0 : h };
  if (done >= p.piece.totalRows) return { y0: 0, y1: h, edge: null };
  if (p.piece.direction === 'top_down') {
    const y = (rowTop(p.piece, layout, done) + layout.cellH) * sy;
    return { y0: 0, y1: y, edge: y };
  }
  const y = rowTop(p.piece, layout, done) * sy;
  return { y0: y, y1: h, edge: y };
}

const GHOST = 'rgba(249,244,237,0.74)';

/**
 * 한 조각을 제품 사진처럼: 도안 그대로의 니트 무늬 + 부드러운 실루엣 + 볼륨 그늘 + 실 결.
 * 안 뜬 부분은 무늬가 살짝 비치는 옅은 실루엣으로 남김. 결과 캔버스는 사방에 margin만큼 여백.
 */
function renderPiece(p: ArtPiece, palette: Palette, w: number, h: number, role: Role, isHat: boolean, active: boolean) {
  const full = fullFabric(p.piece, palette);
  const layout = fabricLayout(p.piece, CELL);
  const m = Math.ceil(Math.max(w, h) * 0.08);
  const c = makeCanvas(w + m * 2, h + m * 2);
  const ctx = c.getContext('2d')!;
  ctx.translate(m, m);
  ctx.imageSmoothingQuality = 'high';
  const base = palette[0]?.hex ?? '#C9B7C4';
  const { path, neck } = silhouette(p, w, h, role, isHat);
  const band = knitBand(p, h);
  const sx = w / layout.width;
  const sw = layout.cellW * sx;
  const sh = layout.cellH * (h / layout.height);

  ctx.save();
  ctx.clip(path);
  // 1) 바탕 실 색 + 도안 무늬 (계단 모양 가장자리는 바탕색이 메움)
  ctx.fillStyle = base;
  ctx.fillRect(-m, -m, w + m * 2, h + m * 2);
  ctx.drawImage(full, 0, 0, w, h);
  // 지금 뜨는 단의 뜬 코까지는 선명하게 남김
  const done = Math.max(0, Math.min(p.piece.totalRows, p.completedRows));
  const curRow = p.piece.rows[done];
  let partial: { x: number; y: number; w: number; h: number } | null = null;
  if (curRow && p.currentStitch && p.currentStitch > 0) {
    const n = visibleStitches(p.piece, curRow);
    const k = Math.min(n, p.currentStitch);
    const x1 = ((layout.maxStitches - n) / 2 + n) * layout.cellW * sx;
    partial = { x: x1 - k * sw, y: rowTop(p.piece, layout, done + 1) * (h / layout.height), w: k * sw, h: sh };
  }
  // 2) 실 결: 코 기둥 + 보풀
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = ctx.createPattern(grainTile(sw, sh), 'repeat')!;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = ctx.createPattern(noiseTile(), 'repeat')!;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // 3) 안 뜬 부분: 회색조 + 크림빛으로 옅게
  const ghostRects: { y0: number; y1: number }[] = [];
  if (band.y1 <= band.y0) ghostRects.push({ y0: -m, y1: h + m });
  else {
    if (band.y0 > 0) ghostRects.push({ y0: -m, y1: band.y0 });
    if (band.y1 < h) ghostRects.push({ y0: band.y1, y1: h + m });
  }
  for (const g of ghostRects) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-m, g.y0, w + m * 2, g.y1 - g.y0);
    if (partial) {
      // 지금 단의 뜬 코는 빼고 (evenodd)
      ctx.rect(partial.x, partial.y, partial.w, partial.h);
      ctx.clip('evenodd');
    } else ctx.clip();
    ctx.filter = 'grayscale(1) contrast(0.8)';
    ctx.drawImage(c, 0, 0, c.width, c.height, -m, -m, c.width, c.height);
    ctx.filter = 'none';
    ctx.fillStyle = GHOST;
    ctx.fillRect(-m, g.y0, w + m * 2, g.y1 - g.y0);
    ctx.restore();
  }

  // 4) 목둘레: 앞목이 파이고 그 안으로 뒤판 안쪽이 보임, 고무단 칼라
  if (neck) {
    const collarDone = p.piece.direction === 'top_down' ? done > 0 : done >= p.piece.totalRows;
    const front = new Path2D();
    front.moveTo(neck.l, 0);
    front.bezierCurveTo(neck.l + (neck.r - neck.l) * 0.06, neck.depth * 1.05, neck.r - (neck.r - neck.l) * 0.06, neck.depth * 1.05, neck.r, 0);
    front.closePath();
    ctx.save();
    ctx.fillStyle = collarDone ? shadeHex(base, -0.38) : 'rgb(226,220,212)';
    ctx.fill(front);
    // 안쪽 그늘
    const ig = ctx.createLinearGradient(0, 0, 0, neck.depth);
    ig.addColorStop(0, 'rgba(0,0,0,0.25)');
    ig.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ig;
    ctx.fill(front);
    ctx.restore();
    const rib = Math.max(3, w * 0.045);
    ctx.save();
    ctx.lineWidth = rib;
    ctx.lineCap = 'round';
    ctx.strokeStyle = collarDone ? base : 'rgb(238,233,226)';
    const frontEdge = new Path2D();
    frontEdge.moveTo(neck.l, 0);
    frontEdge.bezierCurveTo(neck.l + (neck.r - neck.l) * 0.06, neck.depth * 1.05, neck.r - (neck.r - neck.l) * 0.06, neck.depth * 1.05, neck.r, 0);
    ctx.shadowColor = 'rgba(40,20,10,0.25)';
    ctx.shadowBlur = rib * 0.8;
    ctx.shadowOffsetY = rib * 0.25;
    ctx.stroke(frontEdge);
    ctx.shadowColor = 'transparent';
    // 고무단 골
    ctx.setLineDash([Math.max(1, rib * 0.18), Math.max(1, rib * 0.22)]);
    ctx.lineWidth = rib * 0.8;
    ctx.strokeStyle = collarDone ? shadeHex(base, -0.18) : 'rgb(222,216,208)';
    ctx.globalAlpha = 0.55;
    ctx.stroke(frontEdge);
    ctx.restore();
  }

  // 5) 볼륨: 가장자리 안쪽 그늘(부푼 느낌), 왼쪽 위 빛, 주름
  ctx.save();
  ctx.filter = `blur(${Math.max(2, w * 0.035)}px)`;
  ctx.lineWidth = Math.max(6, w * 0.09);
  ctx.strokeStyle = 'rgba(55,30,18,0.22)';
  ctx.stroke(path);
  ctx.restore();
  const lg = ctx.createRadialGradient(w * 0.32, h * 0.22, 0, w * 0.32, h * 0.22, Math.max(w, h) * 0.95);
  lg.addColorStop(0, 'rgba(255,253,248,0.16)');
  lg.addColorStop(0.55, 'rgba(255,253,248,0)');
  lg.addColorStop(1, 'rgba(40,22,12,0.14)');
  ctx.fillStyle = lg;
  ctx.fillRect(-m, -m, w + m * 2, h + m * 2);
  const fold = (x: number, y: number, rx: number, ry: number, rot: number, dark: boolean, a: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.filter = `blur(${Math.max(2, rx * 0.5)}px)`;
    ctx.fillStyle = dark ? `rgba(45,24,14,${a})` : `rgba(255,252,246,${a})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  if (role === 'main' && !isHat) {
    fold(w * 0.04, h * 0.32, w * 0.06, h * 0.26, -0.12, true, 0.09);
    fold(w * 0.96, h * 0.32, w * 0.06, h * 0.26, 0.12, true, 0.09);
    fold(w * 0.46, h * 0.5, w * 0.14, h * 0.34, 0.05, false, 0.09);
    fold(w * 0.62, h * 0.74, w * 0.2, h * 0.02, -0.08, true, 0.06);
  } else if (isHat) {
    fold(w * 0.5, h * 0.45, w * 0.12, h * 0.3, 0, false, 0.12);
    fold(w * 0.18, h * 0.55, w * 0.05, h * 0.3, 0.1, true, 0.12);
  } else {
    fold(w * 0.5, h * 0.5, w * 0.12, h * 0.4, 0, false, 0.1);
    fold(w * 0.5, h * 0.48, w * 0.45, h * 0.018, 0.2, true, 0.12);
    fold(w * 0.5, h * 0.62, w * 0.4, h * 0.016, -0.15, true, 0.1);
  }
  ctx.restore();

  // 6) 가장자리: 보풀처럼 살짝 번지게
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.filter = 'blur(0.8px)';
  ctx.fillStyle = 'rgba(120,100,90,0.35)';
  ctx.fill(path);
  ctx.restore();

  // 7) 지금 뜨는 자리: 줄바늘 (살짝 비치는 금속선 + 그림자)
  if (band.edge !== null && done > 0) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(30,20,10,0.35)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1.5;
    const ng = ctx.createLinearGradient(-w * 0.06, 0, w * 1.06, 0);
    ng.addColorStop(0, 'rgba(160,150,140,0.0)');
    ng.addColorStop(0.08, '#b9b2aa');
    ng.addColorStop(0.5, active ? '#ffffff' : '#efebe6');
    ng.addColorStop(0.92, '#b9b2aa');
    ng.addColorStop(1, 'rgba(160,150,140,0.0)');
    ctx.strokeStyle = ng;
    ctx.lineWidth = Math.max(1.6, w * 0.012);
    ctx.beginPath();
    ctx.moveTo(-w * 0.06, band.edge);
    ctx.lineTo(w * 1.06, band.edge);
    ctx.stroke();
    ctx.restore();
  }
  return { canvas: c, margin: m };
}

function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const f = (v: number) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** 옷걸이 고리 (윗끝 y = top, 아래 끝 y = bottom) */
function drawHook(ctx: CanvasRenderingContext2D, cx: number, top: number, bottom: number) {
  const metal = ctx.createLinearGradient(cx - 16, 0, cx + 16, 0);
  metal.addColorStop(0, '#8d8d92');
  metal.addColorStop(0.5, '#f1f1f4');
  metal.addColorStop(1, '#9a9aa0');
  ctx.strokeStyle = metal;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, bottom);
  ctx.lineTo(cx, top + 22);
  ctx.bezierCurveTo(cx, top + 12, cx + 16, top + 14, cx + 16, top + 4);
  ctx.bezierCurveTo(cx + 16, top - 8, cx - 12, top - 8, cx - 13, top + 6);
  ctx.stroke();
}

function drawHanger(ctx: CanvasRenderingContext2D, cx: number, shoulderY: number, half: number, flat: boolean) {
  ctx.save();
  if (flat) {
    drawHook(ctx, cx, shoulderY - 64, shoulderY - 16);
    const wood = ctx.createLinearGradient(cx - 14, 0, cx + 14, 0);
    wood.addColorStop(0, '#b98a55');
    wood.addColorStop(0.5, '#e6c79a');
    wood.addColorStop(1, '#b98a55');
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.roundRect(cx - 9, shoulderY - 20, 18, 30, 4);
    ctx.fill();
  } else {
    drawHook(ctx, cx, shoulderY - half * 0.12 - 54, shoulderY - half * 0.1);
    const wood = ctx.createLinearGradient(0, shoulderY - 20, 0, shoulderY + 20);
    wood.addColorStop(0, '#e6c79a');
    wood.addColorStop(1, '#b98a55');
    ctx.strokeStyle = wood;
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - half, shoulderY + half * 0.2);
    ctx.quadraticCurveTo(cx - half * 0.5, shoulderY - half * 0.12, cx, shoulderY - half * 0.12);
    ctx.quadraticCurveTo(cx + half * 0.5, shoulderY - half * 0.12, cx + half, shoulderY + half * 0.2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 조각들을 옷 모양으로 조립해서 그립니다. 그릴 조각이 없으면 null.
 * 반환하는 placed는 조각별 대략적인 영역 (비교 보기에서 누른 조각 찾기용).
 */
export function drawAssembled(ctx: CanvasRenderingContext2D, input: AssembleInput): PlacedPiece[] | null {
  const roleOf = roles(input.pieces);
  const main = [...roleOf.entries()].find(([, r]) => r === 'main')?.[0];
  if (!main) return null;
  const sleeves = [...roleOf.entries()].filter(([, r]) => r !== 'main');
  const isHat = /비니|모자|hat|beanie/i.test(main.piece.name) && sleeves.length === 0;

  // cm 단위로 배치: 몸판 위 가운데가 원점, 아래로 +y. 소매는 바닥에 펼쳐 놓은 듯 비스듬히
  const ms = sizeCm(main);
  const SLEEVE_ANGLE = 0.42;
  type Laid = { p: ArtPiece; role: Role; w: number; h: number; x: number; y: number; rot: number };
  const laid: Laid[] = [{ p: main, role: 'main', w: ms.w, h: ms.h, x: -ms.w / 2, y: 0, rot: 0 }];
  for (const [p, role] of sleeves) {
    const s = sizeCm(p);
    const side = role === 'sleeveL' ? -1 : 1;
    // 소매 윗단 가운데를 어깨 끝 조금 안쪽에 붙이고 바깥으로 기울임
    laid.push({ p, role, w: s.w, h: s.h, x: side * (ms.w / 2 - s.w * 0.14), y: ms.h * 0.04 + s.w * 0.2, rot: side * -SLEEVE_ANGLE });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of laid) {
    if (l.role === 'main') {
      minX = Math.min(minX, l.x);
      maxX = Math.max(maxX, l.x + l.w);
      maxY = Math.max(maxY, l.y + l.h);
      continue;
    }
    for (const [dx, dy] of [[-l.w / 2, 0], [l.w / 2, 0], [-l.w / 2, l.h], [l.w / 2, l.h]] as const) {
      const rx = l.x + dx * Math.cos(l.rot) - dy * Math.sin(l.rot);
      const ry = l.y + dx * Math.sin(l.rot) + dy * Math.cos(l.rot);
      minX = Math.min(minX, rx);
      maxX = Math.max(maxX, rx);
      maxY = Math.max(maxY, ry);
    }
  }
  const hanger = input.hanger === true;
  const top = hanger ? input.height * 0.14 : input.height * 0.06;
  const floor = input.height * 0.1; // 바닥 그림자 자리
  const padX = input.width * 0.05;
  const k = Math.min((input.width - padX * 2) / (maxX - minX), (input.height - top - floor) / maxY, input.maxPxPerCm ?? Infinity);
  const ox = input.width / 2 - ((minX + maxX) / 2) * k;
  // 작은 옷(모자)은 바닥 쪽에 내려놓기
  const oy = hanger ? top : Math.max(top, input.height - floor - maxY * k);

  if (hanger) drawHanger(ctx, ox, oy, (ms.w / 2) * k * 0.96, isHat);
  else {
    // 떠 있는 옷 아래 부드러운 바닥 그림자
    const gw = (maxX - minX) * k * 0.42;
    const gy = oy + maxY * k + floor * 0.42;
    ctx.save();
    ctx.filter = `blur(${Math.max(8, gw * 0.08)}px)`;
    ctx.fillStyle = 'rgba(92,64,40,0.20)';
    ctx.beginPath();
    ctx.ellipse(input.width / 2, gy, gw, Math.max(5, floor * 0.12), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const placed: PlacedPiece[] = [];
  const draw = (l: Laid) => {
    const w = l.w * k;
    const h = l.h * k;
    const { canvas: img, margin } = renderPiece(l.p, input.palette, w, h, l.role, isHat, l.p.piece.id === input.activeId);
    ctx.save();
    if (l.role === 'main') {
      ctx.shadowColor = 'rgba(70,40,20,0.22)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      ctx.drawImage(img, ox + l.x * k - margin, oy + l.y * k - margin);
      placed.push({ id: l.p.piece.id, box: { x: ox + l.x * k, y: oy + l.y * k, w, h } });
    } else {
      ctx.translate(ox + l.x * k, oy + l.y * k);
      ctx.rotate(l.rot);
      ctx.shadowColor = 'rgba(70,40,20,0.18)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 5;
      ctx.drawImage(img, -w / 2 - margin, -margin);
      const cx = ox + l.x * k + Math.sin(-l.rot) * h * 0.5;
      placed.push({ id: l.p.piece.id, box: { x: cx - w / 2, y: oy + l.y * k, w, h } });
    }
    ctx.restore();
  };
  for (const l of laid) if (l.role !== 'main') draw(l);
  draw(laid[0]!);
  return placed;
}

const urlCache = new Map<string, string>();
/** 옷장 그림 크기 (옷은 바닥선에 맞춰 내려놓음) */
export const ART_W = 560;
export const ART_H = 500;

/** 옷장 옷걸이용 그림 (data URL). 같은 진행 상태면 다시 그리지 않음 */
export function assembledUrl(input: Omit<AssembleInput, 'width' | 'height'> & { key: string }): string | null {
  const key = `${input.key}|${input.pieces.map((p) => `${p.piece.id}:${p.completedRows}.${p.currentStitch ?? 0}/${p.piece.totalRows}`).join(',')}`;
  const hit = urlCache.get(key);
  if (hit !== undefined) return hit || null;
  let url = '';
  try {
    // 레티나 화면에서도 결이 보이게 2배로 그림
    const c = makeCanvas(ART_W * 2, ART_H * 2);
    const ctx = c.getContext('2d')!;
    ctx.scale(2, 2);
    const placed = drawAssembled(ctx, { ...input, width: ART_W, height: ART_H });
    url = placed ? c.toDataURL('image/webp', 0.92) : '';
  } catch {
    url = '';
  }
  if (urlCache.size > 80) urlCache.clear();
  urlCache.set(key, url);
  return url || null;
}

/** 작업 화면 자료 → 그림 재료. snapshots를 주면 그 진행 상태(작업 중 실시간)를 씀 */
export function artPieces(data: WorkData, snapshots?: Record<string, ProgressSnapshot>): ArtPiece[] {
  const out: ArtPiece[] = [];
  for (const st of data.pieces) {
    const conv = convertedPiece(data, st.id);
    if (!conv) continue;
    const snap = snapshots?.[st.id];
    out.push({
      piece: conv,
      completedRows: snap?.currentRow ?? st.progress.currentRow,
      currentStitch: snap?.currentStitch ?? st.progress.currentStitch,
      gauge: pieceGauge(data, conv),
    });
  }
  return out;
}

export function workArtUrl(data: WorkData): string | null {
  return assembledUrl({
    key: `${data.project.id}|${data.converted.palette.map((c) => c.hex).join('')}|${data.project.myGauge.st}x${data.project.myGauge.row}`,
    pieces: artPieces(data),
    palette: data.converted.palette,
    maxPxPerCm: 7.2,
  });
}

/** 비어 있는 자리(새 작품)와 아직 그림 자료가 없는 옷: 점선 실루엣만 */
export function outlineArt(tint = '#C9B7C4', dashed = true): string {
  const key = `outline|${tint}|${dashed}`;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const c = makeCanvas(ART_W * 2, ART_H * 2);
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);
  const cx = ART_W / 2;
  const top = 150;
  const bw = 250;
  const bh = 300;
  const path = new Path2D();
  // 몸판 + 비스듬한 소매 한 붓그리기
  path.moveTo(cx - 46, top);
  path.quadraticCurveTo(cx - 90, top + 4, cx - bw / 2 + 14, top + 12);
  path.lineTo(cx - bw / 2 - 92, top + 250);
  path.quadraticCurveTo(cx - bw / 2 - 96, top + 262, cx - bw / 2 - 84, top + 268);
  path.lineTo(cx - bw / 2 - 34, top + 286);
  path.quadraticCurveTo(cx - bw / 2 - 24, top + 288, cx - bw / 2 - 20, top + 278);
  path.lineTo(cx - bw / 2 + 2, top + 140);
  path.lineTo(cx - bw / 2 + 2, top + bh - 8);
  path.quadraticCurveTo(cx - bw / 2 + 2, top + bh, cx - bw / 2 + 12, top + bh);
  path.lineTo(cx + bw / 2 - 12, top + bh);
  path.quadraticCurveTo(cx + bw / 2 - 2, top + bh, cx + bw / 2 - 2, top + bh - 8);
  path.lineTo(cx + bw / 2 - 2, top + 140);
  path.lineTo(cx + bw / 2 + 20, top + 278);
  path.quadraticCurveTo(cx + bw / 2 + 24, top + 288, cx + bw / 2 + 34, top + 286);
  path.lineTo(cx + bw / 2 + 84, top + 268);
  path.quadraticCurveTo(cx + bw / 2 + 96, top + 262, cx + bw / 2 + 92, top + 250);
  path.lineTo(cx + bw / 2 - 14, top + 12);
  path.quadraticCurveTo(cx + 90, top + 4, cx + 46, top);
  path.quadraticCurveTo(cx, top + 44, cx - 46, top);
  path.closePath();
  ctx.save();
  ctx.filter = 'blur(10px)';
  ctx.fillStyle = 'rgba(92,64,40,0.10)';
  ctx.beginPath();
  ctx.ellipse(cx, top + bh + 21, 150, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = dashed ? '#fbf7f1' : shadeHex(tint, 0.72);
  ctx.fill(path);
  ctx.setLineDash(dashed ? [7, 7] : []);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = dashed ? 'rgba(90,70,60,0.38)' : shadeHex(tint, 0.35);
  ctx.stroke(path);
  const url = c.toDataURL('image/webp', 0.9);
  urlCache.set(key, url);
  return url;
}
