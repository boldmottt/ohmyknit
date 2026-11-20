import type { ConvertedPiece } from '@knitcloset/gauge-engine';
import { DEFAULT_MAIN, stitchAt, stitchColor, type Palette, type YarnColor } from '@knitcloset/knit-render';

/**
 * 3D 원단 자료: 조각 한 바퀴(원통뜨기는 앞뒤 전부)를 단마다 가로 끝까지 펼친 것.
 * 단마다 콧수가 달라도(늘림·줄임) 한 단이 가로를 꽉 채우고, 3D에서 둘레가 그만큼 달라져요.
 * 1단이 맨 아래 (v = 0).
 *
 * color: 코마다 실 색만 칠한 작은 그림 (코의 입체감은 셰이더가 코 타일로 그려요. fabric.ts).
 * rowData: 단마다 [콧수 아래 바이트, 위 바이트, 뜨기 종류, 255].
 */
export type KnitMaps = { color: HTMLCanvasElement; rowData: Uint8Array<ArrayBuffer>; rows: number };

/** 단의 뜨기 종류: 겉뜨기 / 2코 고무뜨기 (겉2 안2) / 안뜨기 단 */
export const TECH = { knit: 0, rib: 1, purl: 2 } as const;

const cache = new Map<string, KnitMaps>();
const MAX = 2048;
const CELL = 4;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function remember(key: string, maps: KnitMaps): KnitMaps {
  if (cache.size > 24) cache.clear();
  cache.set(key, maps);
  return maps;
}

/** 텍스처 크기: 코 하나에 최대 CELL 픽셀, 전체는 MAX 이하 */
function gridSize(maxN: number, rows: number) {
  const cellW = Math.max(1, Math.min(CELL, Math.floor(MAX / maxN)));
  const cellH = Math.max(1, Math.min(CELL, Math.floor(MAX / rows)));
  return { width: maxN * cellW, height: rows * cellH, cellH };
}

function writeRow(rowData: Uint8Array<ArrayBuffer>, index: number, stitches: number, tech: number) {
  rowData.set([stitches & 255, (stitches >> 8) & 255, tech, 255], index * 4);
}

export function pieceMaps(piece: ConvertedPiece, palette: Palette): KnitMaps {
  const key = JSON.stringify([
    piece.id,
    piece.rows.length,
    piece.castOn.value,
    piece.totalStitches,
    palette.map((p) => [p.hex, p.hex2, p.heather]),
    piece.sections.map((s) => [s.technique, s.chart?.grid.length ?? 0]),
  ]);
  const hit = cache.get(key);
  if (hit) return hit;
  const R = piece.rows.length;
  const maxN = Math.max(1, ...piece.rows.map((r) => r.stitchesWorked));
  const { width, height, cellH } = gridSize(maxN, R);
  const color = canvas(width, height);
  const ctx = color.getContext('2d')!;
  const pal = palette.length ? palette : [{ name: '', hex: DEFAULT_MAIN }];
  ctx.fillStyle = pal[0]!.hex;
  ctx.fillRect(0, 0, width, height);
  const rowData = new Uint8Array(R * 4);
  piece.rows.forEach((row, i) => {
    const n = Math.max(1, row.stitchesWorked);
    const w = width / n;
    const y = (R - 1 - i) * cellH;
    for (let c = 0; c < n; c++) {
      const s = stitchAt(piece, row, c);
      ctx.fillStyle = stitchColor(pal[s.color] ?? pal[0]!, row.row, c);
      ctx.fillRect(c * w, y, w + 0.5, cellH);
    }
    const a = stitchAt(piece, row, 0).kind;
    const b = stitchAt(piece, row, 2).kind;
    writeRow(rowData, i, n, a !== b ? TECH.rib : a === 'purl' ? TECH.purl : TECH.knit);
  });
  return remember(key, { color, rowData, rows: R });
}

/** 한 가지 실로 뜬 민무늬 원단 (도안에 없는 예상 요크). 맨 위 ribRows단은 고무단 (목둘레) */
export function plainMaps(rowStitches: number[], yarn: YarnColor, ribRows: number): KnitMaps {
  const R = rowStitches.length;
  const key = JSON.stringify(['plain', R, rowStitches[0], rowStitches[R - 1], yarn.hex, yarn.hex2, yarn.heather, ribRows]);
  const hit = cache.get(key);
  if (hit) return hit;
  const maxN = Math.max(1, ...rowStitches);
  const { width, height, cellH } = gridSize(maxN, R);
  const color = canvas(width, height);
  const ctx = color.getContext('2d')!;
  const rowData = new Uint8Array(R * 4);
  rowStitches.forEach((n, i) => {
    const w = width / n;
    const y = (R - 1 - i) * cellH;
    for (let c = 0; c < n; c++) {
      ctx.fillStyle = stitchColor(yarn, i + 1, c);
      ctx.fillRect(c * w, y, w + 0.5, cellH);
    }
    writeRow(rowData, i, n, i >= R - ribRows ? TECH.rib : TECH.knit);
  });
  return remember(key, { color, rowData, rows: R });
}
