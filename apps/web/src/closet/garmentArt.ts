import { drawSwatch, shade, type Palette } from '@knitcloset/knit-render';

/**
 * 옷걸이에 걸린 옷 그림. 실제 프로젝트의 실 색과 배색 무늬로 뜬 니트를 그리고,
 * 진척도만큼만 아래부터 선명하게, 나머지는 옅은 윤곽으로 남겨요.
 */
export type GarmentSpec = {
  palette: Palette;
  motif: number[][] | null;
  kind: 'hat' | 'sweater';
  progress: number;
};

export const ART_W = 560;
export const ART_H = 660;
const CELL = 7;
const ROW_H = CELL * 0.86;

const cache = new Map<string, string>();

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** 무늬 띠가 들어간 원단 조각 (위에서 bandTop줄 아래부터 무늬) */
function fabric(w: number, h: number, spec: GarmentSpec, bandTop: number): HTMLCanvasElement {
  const cols = Math.ceil(w / CELL) + 1;
  const rows = Math.ceil(h / ROW_H) + 1;
  const c = canvas(cols * CELL, Math.ceil(rows * ROW_H));
  const ctx = c.getContext('2d')!;
  const m = spec.motif?.slice(0, 36) ?? null;
  const mh = m?.length ?? 0;
  const pal = spec.palette.length ? spec.palette : [{ name: '', hex: '#B7A7C9' }];
  drawSwatch(ctx, cols, rows, CELL, pal, (r, col) => {
    if (!m) return 0;
    const fromTop = rows - 1 - r;
    const k = fromTop - bandTop;
    if (k < 0 || k >= mh) return 0;
    const line = m[mh - 1 - k]!;
    const v = line[col % line.length] ?? 0;
    return v < 0 || v >= pal.length ? 0 : v;
  });
  return c;
}

function rib(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let i = 0; i < w; i += CELL * 2) {
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(x + i, y, CELL * 0.9, h);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x + i + CELL, y, CELL * 0.5, h);
  }
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(0,0,0,0.22)');
  g.addColorStop(0.25, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function hanger(ctx: CanvasRenderingContext2D, clip = false) {
  // 금속 고리
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(280, 64);
  ctx.lineTo(280, 44);
  ctx.bezierCurveTo(280, 30, 304, 34, 304, 18);
  ctx.bezierCurveTo(304, -2, 262, 0, 260, 20);
  const metal = ctx.createLinearGradient(256, 0, 306, 0);
  metal.addColorStop(0, '#8d8d92');
  metal.addColorStop(0.5, '#f1f1f4');
  metal.addColorStop(1, '#9a9aa0');
  ctx.strokeStyle = metal;
  ctx.lineWidth = 5;
  ctx.stroke();
  // 나무 어깨
  const wood = ctx.createLinearGradient(0, 50, 0, 96);
  wood.addColorStop(0, '#e6c79a');
  wood.addColorStop(1, '#b98a55');
  ctx.strokeStyle = wood;
  ctx.lineWidth = 15;
  ctx.beginPath();
  if (clip) {
    ctx.moveTo(214, 72);
    ctx.lineTo(346, 72);
  } else {
    ctx.moveTo(138, 100);
    ctx.quadraticCurveTo(210, 62, 280, 60);
    ctx.quadraticCurveTo(350, 62, 422, 100);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function sweater(spec: GarmentSpec): HTMLCanvasElement {
  const c = canvas(ART_W, ART_H);
  const ctx = c.getContext('2d')!;
  const main = spec.palette[0]?.hex ?? '#B7A7C9';
  const body = fabric(300, 470, spec, 7);
  const sleeveTex = fabric(110, 360, spec, 3);

  // 소매 (몸판 뒤)
  for (const side of [-1, 1] as const) {
    ctx.save();
    ctx.translate(280 + side * 122, 98);
    ctx.rotate(side * -0.2);
    const path = new Path2D();
    path.moveTo(-50, 0);
    path.quadraticCurveTo(0, -14, 50, 0);
    path.lineTo(40, 318);
    path.quadraticCurveTo(0, 330, -40, 318);
    path.closePath();
    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = main;
    ctx.fillRect(-60, -20, 120, 360);
    ctx.drawImage(sleeveTex, -55, -10);
    rib(ctx, -60, 282, 120, 50);
    // 소매 볼륨: 몸 쪽이 어둡게
    const g = ctx.createLinearGradient(-50, 0, 50, 0);
    const inner = side < 0 ? 1 : 0;
    g.addColorStop(inner, 'rgba(30,10,20,0.34)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.10)');
    g.addColorStop(1 - inner, 'rgba(30,10,20,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(-60, -20, 120, 360);
    ctx.restore();
    ctx.restore();
  }

  // 몸판
  const bodyPath = new Path2D();
  bodyPath.moveTo(232, 72);
  bodyPath.quadraticCurveTo(280, 108, 328, 72);
  bodyPath.quadraticCurveTo(380, 78, 416, 104);
  bodyPath.quadraticCurveTo(412, 300, 424, 528);
  bodyPath.quadraticCurveTo(280, 544, 136, 528);
  bodyPath.quadraticCurveTo(148, 300, 144, 104);
  bodyPath.quadraticCurveTo(180, 78, 232, 72);
  bodyPath.closePath();
  ctx.save();
  ctx.shadowColor = 'rgba(40,15,30,0.35)';
  ctx.shadowBlur = 22;
  ctx.fillStyle = main;
  ctx.fill(bodyPath);
  ctx.restore();
  ctx.save();
  ctx.clip(bodyPath);
  ctx.drawImage(body, 130, 68);
  rib(ctx, 130, 484, 300, 60);
  // 볼륨과 주름
  const h = ctx.createLinearGradient(136, 0, 424, 0);
  h.addColorStop(0, 'rgba(30,10,20,0.30)');
  h.addColorStop(0.16, 'rgba(30,10,20,0.04)');
  h.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  h.addColorStop(0.84, 'rgba(30,10,20,0.04)');
  h.addColorStop(1, 'rgba(30,10,20,0.30)');
  ctx.fillStyle = h;
  ctx.fillRect(120, 60, 320, 500);
  const v = ctx.createLinearGradient(0, 70, 0, 540);
  v.addColorStop(0, 'rgba(255,255,255,0.16)');
  v.addColorStop(0.35, 'rgba(255,255,255,0)');
  v.addColorStop(1, 'rgba(30,10,20,0.16)');
  ctx.fillStyle = v;
  ctx.fillRect(120, 60, 320, 500);
  ctx.strokeStyle = 'rgba(30,10,20,0.10)';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  for (const [x1, x2] of [[196, 186], [364, 374]] as const) {
    ctx.beginPath();
    ctx.moveTo(x1, 150);
    ctx.quadraticCurveTo((x1 + x2) / 2 + (x1 < 280 ? -8 : 8), 330, x2, 480);
    ctx.stroke();
  }
  ctx.restore();
  // 목 고무단
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(232, 72);
  ctx.quadraticCurveTo(280, 108, 328, 72);
  ctx.lineWidth = 16;
  ctx.strokeStyle = shade(main, -0.12);
  ctx.stroke();
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 16;
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.stroke();
  ctx.restore();
  return c;
}

function hat(spec: GarmentSpec): HTMLCanvasElement {
  const c = canvas(ART_W, ART_H);
  const ctx = c.getContext('2d')!;
  const main = spec.palette[0]?.hex ?? '#B7A7C9';
  const tex = fabric(300, 360, spec, 14);
  const dome = new Path2D();
  dome.moveTo(150, 430);
  dome.bezierCurveTo(150, 210, 220, 96, 280, 96);
  dome.bezierCurveTo(340, 96, 410, 210, 410, 430);
  dome.lineTo(414, 500);
  dome.quadraticCurveTo(280, 520, 146, 500);
  dome.closePath();
  ctx.save();
  ctx.shadowColor = 'rgba(40,15,30,0.35)';
  ctx.shadowBlur = 22;
  ctx.fillStyle = main;
  ctx.fill(dome);
  ctx.restore();
  ctx.save();
  ctx.clip(dome);
  ctx.drawImage(tex, 140, 92);
  rib(ctx, 140, 424, 290, 100);
  const g = ctx.createRadialGradient(250, 230, 20, 280, 300, 260);
  g.addColorStop(0, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(30,10,20,0.34)');
  ctx.fillStyle = g;
  ctx.fillRect(130, 80, 310, 460);
  ctx.restore();
  return c;
}

/** 진척도만큼 아래부터 선명하게 */
function compose(full: HTMLCanvasElement, spec: GarmentSpec): HTMLCanvasElement {
  const out = canvas(ART_W, ART_H);
  const ctx = out.getContext('2d')!;
  const top = spec.kind === 'hat' ? 96 : 68;
  const bottom = spec.kind === 'hat' ? 512 : 540;
  const p = Math.max(0, Math.min(1, spec.progress));
  const cut = bottom - (bottom - top) * p;
  if (p < 1) {
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.filter = 'saturate(0.4) brightness(1.25)';
    ctx.drawImage(full, 0, 0);
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, cut, ART_W, ART_H - cut);
  ctx.clip();
  ctx.drawImage(full, 0, 0);
  ctx.restore();
  if (p > 0 && p < 1) {
    // 뜨는 중인 자리의 줄바늘
    const g = ctx.createLinearGradient(110, 0, 450, 0);
    g.addColorStop(0, 'rgba(160,160,168,0)');
    g.addColorStop(0.15, '#c9c9cf');
    g.addColorStop(0.5, '#ffffff');
    g.addColorStop(0.85, '#c9c9cf');
    g.addColorStop(1, 'rgba(160,160,168,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(96, cut);
    ctx.lineTo(464, cut);
    ctx.stroke();
  }
  hanger(ctx, spec.kind === 'hat');
  return out;
}

export function garmentArt(spec: GarmentSpec): string {
  const key = JSON.stringify([spec.palette.map((p) => p.hex), spec.motif, spec.kind, Math.round(spec.progress * 100)]);
  const hit = cache.get(key);
  if (hit) return hit;
  let url = '';
  try {
    const full = spec.kind === 'hat' ? hat(spec) : sweater(spec);
    url = compose(full, spec).toDataURL('image/png');
  } catch {
    url = '';
  }
  cache.set(key, url);
  return url;
}

/** 빈 옷걸이 (새 작품 자리) */
export function emptyHangerArt(): string {
  const hit = cache.get('empty');
  if (hit) return hit;
  const c = canvas(ART_W, ART_H);
  hanger(c.getContext('2d')!);
  const url = c.toDataURL('image/png');
  cache.set('empty', url);
  return url;
}
