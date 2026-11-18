import { fabricLayout, rowTop, visibleStitches, type Palette } from '@knitcloset/knit-render';
import { CELL, fullFabric, knitBand, type ArtPiece } from '../closet/assembledArt';
import { simRoles } from './shape';

/**
 * 패턴판 (CLO의 2D 창처럼): 조각을 평평하게 같은 cm 축척으로 늘어놓고,
 * 다 뜬 모습은 반투명, 실제로 뜬 단(과 지금 단의 뜬 코)까지만 진하게.
 * 원통뜨기 조각은 납작하게 눌러 놓은 앞면(둘레의 절반 너비)으로 보여요.
 */

export type BoardHit = { id: string; x: number; y: number; w: number; h: number };

const INK = '#3b322d';
const SOFT = '#8c8178';
const ACCENT = '#b5523b';
export const BOARD_GHOST = 0.3;

const ORDER: Record<string, number> = { body: 0, front: 0, back: 1, yoke: 2, hat: 0, panel: 0, sleeveL: 3, sleeveR: 4, extra: 5 };

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  pieces: ArtPiece[],
  palette: Palette,
  W: number,
  H: number,
  activeId?: string,
): BoardHit[] {
  ctx.clearRect(0, 0, W, H);
  if (!pieces.length) return [];
  const roles = simRoles(pieces);
  const list = [...pieces].sort((a, b) => (ORDER[roles.get(a) ?? 'extra'] ?? 5) - (ORDER[roles.get(b) ?? 'extra'] ?? 5));
  const sizes = list.map((p) => {
    const l = fabricLayout(p.piece, CELL);
    return { p, l, w: (l.maxStitches / p.gauge.st) * 10, h: (p.piece.rows.length / p.gauge.row) * 10 };
  });
  const pad = 16;
  const labelH = 50;
  const gapCm = 9;
  const sumW = sizes.reduce((s, x) => s + x.w, 0) + gapCm * (sizes.length - 1);
  const maxH = Math.max(...sizes.map((x) => x.h));
  const k = Math.min((W - pad * 2) / sumW, (H - pad * 2 - labelH - 12) / maxH);
  const base = H - pad - labelH;
  let x = (W - sumW * k) / 2;

  // 모눈종이: 1cm 옅게, 10cm 진하게 (첫 조각 왼쪽 아래가 기준)
  const ox = x;
  ctx.save();
  ctx.lineWidth = 1;
  for (const [step, alpha] of [
    [1, 0.045],
    [10, 0.1],
  ] as const) {
    if (step * k < 4) continue;
    ctx.strokeStyle = `rgba(80,60,45,${alpha})`;
    ctx.beginPath();
    for (let gx = ox - Math.ceil(ox / (step * k)) * step * k; gx <= W; gx += step * k) {
      ctx.moveTo(Math.round(gx) + 0.5, 0);
      ctx.lineTo(Math.round(gx) + 0.5, H);
    }
    for (let gy = base - Math.ceil(base / (step * k)) * step * k; gy <= H; gy += step * k) {
      ctx.moveTo(0, Math.round(gy) + 0.5);
      ctx.lineTo(W, Math.round(gy) + 0.5);
    }
    ctx.stroke();
  }
  ctx.fillStyle = SOFT;
  ctx.font = '500 10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`패턴판 · 큰 칸 10cm`, 8, 6);
  ctx.restore();

  const hits: BoardHit[] = [];
  for (const { p, l, w, h } of sizes) {
    const pw = w * k;
    const ph = h * k;
    const top = base - ph;
    const full = fullFabric(p.piece, palette);
    const active = p.piece.id === activeId;
    const sx = pw / l.width;
    const sy = ph / l.height;

    // 조각 모양 (단마다 콧수대로 계단)
    const outline = new Path2D();
    const rows = [...p.piece.rows].sort((a, b) => rowTop(p.piece, l, a.row) - rowTop(p.piece, l, b.row));
    const edge = (r: (typeof rows)[number]) => {
      const n = visibleStitches(p.piece, r);
      return ((l.maxStitches - n) / 2) * l.cellW * sx;
    };
    rows.forEach((r, i) => {
      const y0 = top + rowTop(p.piece, l, r.row) * sy;
      const ex = x + edge(r);
      if (i === 0) outline.moveTo(ex, y0);
      else outline.lineTo(ex, y0);
      outline.lineTo(ex, y0 + l.cellH * sy);
    });
    [...rows].reverse().forEach((r) => {
      const y0 = top + rowTop(p.piece, l, r.row) * sy;
      const ex = x + pw - edge(r);
      outline.lineTo(ex, y0 + l.cellH * sy);
      outline.lineTo(ex, y0);
    });
    outline.closePath();

    // 다 뜬 모습: 반투명
    ctx.save();
    ctx.globalAlpha = BOARD_GHOST;
    ctx.drawImage(full, x, top, pw, ph);
    ctx.restore();

    // 실제로 뜬 단: 진하게
    const band = knitBand(p, ph);
    if (band.y1 > band.y0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 1, top + band.y0, pw + 2, band.y1 - band.y0);
      ctx.clip();
      ctx.drawImage(full, x, top, pw, ph);
      ctx.restore();
    }
    const done = Math.max(0, Math.min(p.piece.totalRows, p.completedRows));
    const cur = p.piece.rows[done];
    if (cur && p.currentStitch) {
      const n = visibleStitches(p.piece, cur);
      const m = Math.min(n, p.currentStitch);
      const x1 = x + ((l.maxStitches - n) / 2 + n) * l.cellW * sx;
      const y0 = top + rowTop(p.piece, l, done + 1) * sy;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x1 - m * l.cellW * sx, y0, m * l.cellW * sx, l.cellH * sy);
      ctx.clip();
      ctx.drawImage(full, x, top, pw, ph);
      ctx.restore();
    }

    // 윤곽: 점선, 고른 조각은 진한 실선
    ctx.save();
    ctx.lineJoin = 'round';
    if (active) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = 'rgba(60,45,35,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
    }
    ctx.stroke(outline);
    ctx.restore();

    // 줄바늘
    if (band.edge !== null && done > 0 && done < p.piece.totalRows) {
      ctx.save();
      ctx.strokeStyle = active ? ACCENT : '#9d958d';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 5, top + band.edge);
      ctx.lineTo(x + pw + 5, top + band.edge);
      ctx.stroke();
      ctx.restore();
    }

    // 이름 · 진행 · 치수 (진척도는 칩과 같은 콧수 기준)
    let st = 0;
    for (let i = 0; i < done; i++) st += p.piece.rows[i]!.stitchesWorked;
    st += Math.min(cur?.stitchesWorked ?? 0, p.currentStitch ?? 0);
    const ratio = p.piece.totalStitches ? st / p.piece.totalStitches : 0;
    const round = p.piece.construction === 'round';
    const widest = Math.max(...p.piece.rows.map((r) => r.stitchesWorked));
    const widthCm = Math.round((widest / p.gauge.st) * 100) / 10;
    const cx = x + pw / 2;
    const room = pw + gapCm * k - 6;
    const roomy = room > 96;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = active ? ACCENT : INK;
    ctx.font = `${active ? 600 : 500} 12px system-ui, sans-serif`;
    ctx.fillText(p.piece.name, cx, base + 8, room);
    ctx.fillStyle = INK;
    ctx.font = '400 11px system-ui, sans-serif';
    ctx.fillText(roomy ? `${done}/${p.piece.totalRows}단 · ${Math.round(ratio * 100)}%` : `${Math.round(ratio * 100)}%`, cx, base + 24, room);
    ctx.fillStyle = SOFT;
    ctx.font = '400 10px system-ui, sans-serif';
    ctx.fillText(roomy ? `${round ? '둘레' : '너비'} ${widthCm} · 길이 ${Math.round(h * 10) / 10}cm` : `${done}/${p.piece.totalRows}단`, cx, base + 38, room);
    ctx.restore();

    hits.push({ id: p.piece.id, x, y: top, w: pw, h: ph + labelH });
    x += pw + gapCm * k;
  }
  return hits;
}
