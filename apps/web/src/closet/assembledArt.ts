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
 * 조각들을 옷 모양(몸판 가운데, 소매 양옆)으로 조립해서 옷걸이에 겁니다.
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
  /** 옷걸이를 그릴지 (작업 화면 비교 보기에서는 끔) */
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

/**
 * 한 조각을 목표 크기로: 안 뜬 부분은 옅게, 뜬 부분은 그대로, 위에 볼륨 그늘.
 * 결과는 조각 모양대로 투명 배경.
 */
function renderPiece(p: ArtPiece, palette: Palette, w: number, h: number, role: Role, active: boolean): HTMLCanvasElement {
  const full = fullFabric(p.piece, palette);
  const layout = fabricLayout(p.piece, CELL);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const sx = w / layout.width;
  const sy = h / layout.height;
  const done = Math.max(0, Math.min(p.piece.totalRows, p.completedRows));

  // 안 뜬 부분: 도안의 무늬는 살짝 비치는, 불투명한 옅은 실루엣 (뒤에 있는 소매가 비치지 않게)
  if (done < p.piece.totalRows) {
    ctx.save();
    ctx.filter = 'grayscale(1)';
    ctx.drawImage(full, 0, 0, w, h);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(246,243,245,0.7)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // 뜬 부분: 실제 니트 그대로 (뜬 단들이 차지하는 띠만)
  let edgeY: number | null = null;
  if (done > 0) {
    const topDown = p.piece.direction === 'top_down';
    const yA = topDown ? 0 : rowTop(p.piece, layout, done) * sy;
    const yB = topDown ? (rowTop(p.piece, layout, done) + layout.cellH) * sy : h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, yA, w, yB - yA);
    ctx.clip();
    ctx.clearRect(0, yA, w, yB - yA);
    ctx.drawImage(full, 0, 0, w, h);
    ctx.restore();
    if (done < p.piece.totalRows) edgeY = topDown ? yB : yA;
  }

  // 지금 뜨는 단: 뜬 코까지만 (겉면에서 오른쪽 → 왼쪽으로 진행)
  const curRow = p.piece.rows[done];
  if (curRow && p.currentStitch && p.currentStitch > 0) {
    const n = visibleStitches(p.piece, curRow);
    const m = Math.min(n, p.currentStitch);
    const x1 = (((layout.maxStitches - n) / 2 + n) * layout.cellW) * sx;
    const y0 = rowTop(p.piece, layout, done + 1) * sy;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x1 - m * layout.cellW * sx, y0, m * layout.cellW * sx, layout.cellH * sy);
    ctx.clip();
    ctx.clearRect(x1 - m * layout.cellW * sx, y0, m * layout.cellW * sx, layout.cellH * sy);
    ctx.drawImage(full, 0, 0, w, h);
    ctx.restore();
  }

  // 볼륨: 조각 픽셀 위에만 (source-atop)
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const g = ctx.createLinearGradient(0, 0, w, 0);
  if (role === 'main') {
    g.addColorStop(0, 'rgba(30,10,20,0.30)');
    g.addColorStop(0.16, 'rgba(30,10,20,0.05)');
    g.addColorStop(0.48, 'rgba(255,255,255,0.12)');
    g.addColorStop(0.84, 'rgba(30,10,20,0.05)');
    g.addColorStop(1, 'rgba(30,10,20,0.30)');
  } else {
    // 소매는 몸 쪽(안쪽)이 어둡게
    const inner = role === 'sleeveL' ? 1 : 0;
    g.addColorStop(inner, 'rgba(30,10,20,0.36)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.10)');
    g.addColorStop(1 - inner, 'rgba(30,10,20,0.20)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const v = ctx.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0, 'rgba(255,255,255,0.12)');
  v.addColorStop(0.35, 'rgba(255,255,255,0)');
  v.addColorStop(1, 'rgba(30,10,20,0.16)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // 지금 뜨는 자리: 줄바늘
  if (edgeY !== null) {
    const ng = ctx.createLinearGradient(0, 0, w, 0);
    ng.addColorStop(0, 'rgba(170,170,178,0.2)');
    ng.addColorStop(0.5, active ? '#ffffff' : '#ececf0');
    ng.addColorStop(1, 'rgba(170,170,178,0.2)');
    ctx.strokeStyle = ng;
    ctx.lineWidth = Math.max(2, h * 0.006);
    ctx.beginPath();
    ctx.moveTo(-w * 0.04, edgeY);
    ctx.lineTo(w * 1.04, edgeY);
    ctx.stroke();
  }
  return c;
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
    // 모자는 정수리를 집게로 집어서 걺
    drawHook(ctx, cx, shoulderY - 64, shoulderY - 16);
    const wood = ctx.createLinearGradient(cx - 14, 0, cx + 14, 0);
    wood.addColorStop(0, '#b98a55');
    wood.addColorStop(0.5, '#e6c79a');
    wood.addColorStop(1, '#b98a55');
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.roundRect(cx - 9, shoulderY - 20, 18, 30, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(80,50,20,0.35)';
    ctx.fillRect(cx - 9, shoulderY - 6, 18, 2);
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

  // cm 단위로 배치: 몸판 위 가운데가 원점, 아래로 +y
  const ms = sizeCm(main);
  const SLEEVE_ANGLE = 0.3; // 소매가 몸 바깥으로 벌어지는 각도
  type Laid = { p: ArtPiece; role: Role; w: number; h: number; x: number; y: number; rot: number };
  const laid: Laid[] = [{ p: main, role: 'main', w: ms.w, h: ms.h, x: -ms.w / 2, y: 0, rot: 0 }];
  for (const [p, role] of sleeves) {
    const s = sizeCm(p);
    const side = role === 'sleeveL' ? -1 : 1;
    // 소매 윗단 가운데를 어깨에 붙이고 바깥으로 기울임
    laid.push({ p, role, w: s.w, h: s.h, x: side * (ms.w / 2 - s.w * 0.12), y: s.w * 0.12, rot: side * -SLEEVE_ANGLE });
  }

  // 전체 영역 (회전한 소매 포함)
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
  const top = input.hanger === false ? input.height * 0.04 : input.height * 0.14;
  const padX = input.width * 0.04;
  const k = Math.min((input.width - padX * 2) / (maxX - minX), (input.height - top - input.height * 0.03) / maxY, input.maxPxPerCm ?? Infinity);
  const ox = input.width / 2 - ((minX + maxX) / 2) * k;
  const oy = top;
  const isHat = /비니|모자|hat|beanie/i.test(main.piece.name) && sleeves.length === 0;

  if (input.hanger !== false) drawHanger(ctx, ox, oy, (ms.w / 2) * k * 0.96, isHat);

  const placed: PlacedPiece[] = [];
  const draw = (l: Laid) => {
    const w = l.w * k;
    const h = l.h * k;
    const img = renderPiece(l.p, input.palette, w, h, l.role, l.p.piece.id === input.activeId);
    ctx.save();
    if (l.role === 'main') {
      ctx.shadowColor = 'rgba(40,15,30,0.30)';
      ctx.shadowBlur = 20;
      ctx.shadowOffsetY = 6;
      ctx.drawImage(img, ox + l.x * k, oy + l.y * k);
      placed.push({ id: l.p.piece.id, box: { x: ox + l.x * k, y: oy + l.y * k, w, h } });
    } else {
      ctx.translate(ox + l.x * k, oy + l.y * k);
      ctx.rotate(l.rot);
      ctx.shadowColor = 'rgba(40,15,30,0.22)';
      ctx.shadowBlur = 14;
      ctx.drawImage(img, -w / 2, 0);
      const cx = ox + l.x * k + Math.sin(-l.rot) * h * 0.5;
      placed.push({ id: l.p.piece.id, box: { x: cx - w / 2, y: oy + l.y * k, w, h } });
    }
    ctx.restore();
  };
  // 소매가 몸판 뒤로
  for (const l of laid) if (l.role !== 'main') draw(l);
  draw(laid[0]!);
  return placed;
}

const urlCache = new Map<string, string>();

/** 옷장 옷걸이용 그림 (data URL). 같은 진행 상태면 다시 그리지 않음 */
export function assembledUrl(input: Omit<AssembleInput, 'width' | 'height'> & { key: string }): string | null {
  const key = `${input.key}|${input.pieces.map((p) => `${p.piece.id}:${p.completedRows}.${p.currentStitch ?? 0}/${p.piece.totalRows}`).join(',')}`;
  const hit = urlCache.get(key);
  if (hit !== undefined) return hit || null;
  let url = '';
  try {
    const c = makeCanvas(560, 660);
    const placed = drawAssembled(c.getContext('2d')!, { ...input, width: 560, height: 660 });
    url = placed ? c.toDataURL('image/png') : '';
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
    maxPxPerCm: 8,
  });
}
