import type { ConvertedPiece } from '@knitcloset/gauge-engine';
import { DEFAULT_MAIN, drawStitch, stitchAt, stitchColor, type Palette } from '@knitcloset/knit-render';

/**
 * 3D 원단 텍스처: 조각 한 바퀴(원통뜨기는 앞뒤 전부)를 단마다 가로 끝까지 펼쳐 그림.
 * 단마다 콧수가 달라도(늘림·줄임) 한 단이 텍스처 너비를 꽉 채우고, 3D에서 둘레가 그만큼 달라져요.
 * 1단이 텍스처 맨 아래 (v = 0).
 * color: 실 색 그대로, bump: 코의 V자 볼록함만 (빛을 받으면 니트 결이 서요).
 */
export type PieceTextures = { color: HTMLCanvasElement; bump: HTMLCanvasElement };

const cache = new Map<string, PieceTextures>();
const MAX = 2048;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function pieceTextures(piece: ConvertedPiece, palette: Palette): PieceTextures {
  const key = JSON.stringify([piece.id, piece.rows.length, piece.castOn.value, piece.totalStitches, palette.map((p) => [p.hex, p.hex2, p.heather])]);
  const hit = cache.get(key);
  if (hit) return hit;
  const R = piece.rows.length;
  const maxN = Math.max(1, ...piece.rows.map((r) => r.stitchesWorked));
  let cell = Math.max(3, Math.min(8, Math.floor(MAX / maxN)));
  while (R * cell * 0.86 > MAX && cell > 1) cell -= 0.5;
  const W = maxN * cell;
  const rowH = cell * 0.86;
  const color = canvas(W, R * rowH);
  const bump = canvas(W, R * rowH);
  const cg = color.getContext('2d')!;
  const bg = bump.getContext('2d')!;
  const pal = palette.length ? palette : [{ name: '', hex: DEFAULT_MAIN }];
  cg.fillStyle = pal[0]!.hex;
  cg.fillRect(0, 0, color.width, color.height);
  bg.fillStyle = '#5a5a5a';
  bg.fillRect(0, 0, bump.width, bump.height);
  for (const row of piece.rows) {
    const n = Math.max(1, row.stitchesWorked);
    const w = W / n;
    const y = (R - row.row) * rowH;
    for (let c = 0; c < n; c++) {
      const s = stitchAt(piece, row, c);
      drawStitch(cg, c * w, y, w, rowH, stitchColor(pal[s.color] ?? pal[0]!, row.row, c), s.kind);
      drawStitch(bg, c * w, y, w, rowH, '#b4b4b4', s.kind);
    }
  }
  const out = { color, bump };
  if (cache.size > 24) cache.clear();
  cache.set(key, out);
  return out;
}
