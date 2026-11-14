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

/** 번지는 부드러운 선 (주름·그늘). 굵기를 줄여 가며 여러 번 그어 흐림을 흉내 냄 */
function softStroke(ctx: CanvasRenderingContext2D, path: Path2D, color: string, width: number) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  for (let i = 0; i < 5; i++) {
    ctx.lineWidth = width * (1 - i * 0.18);
    ctx.stroke(path);
  }
  ctx.restore();
}

function sweater(spec: GarmentSpec): HTMLCanvasElement {
  const c = canvas(ART_W, ART_H);
  const ctx = c.getContext('2d')!;
  const main = spec.palette[0]?.hex ?? '#B7A7C9';
  const body = fabric(310, 480, spec, 8);
  const sleeveTex = fabric(130, 380, spec, 2);

  // 소매 (몸판 뒤): 어깨에서 자연스럽게 떨어져 팔꿈치에서 살짝 꺾이고 소맷단에서 모임
  for (const side of [-1, 1] as const) {
    ctx.save();
    ctx.translate(280 + side * 118, 92);
    ctx.scale(side, 1);
    // 뒤집힌 좌표에서 음수 회전 = 소매 끝이 몸 바깥쪽으로
    ctx.rotate(-0.17);
    // 여기서는 +x가 몸 바깥쪽
    const path = new Path2D();
    path.moveTo(-46, 6);
    path.bezierCurveTo(-10, -16, 34, -10, 56, 14);
    path.bezierCurveTo(72, 110, 66, 210, 46, 292);
    path.bezierCurveTo(44, 304, 40, 318, 38, 332);
    path.quadraticCurveTo(4, 344, -30, 334);
    path.bezierCurveTo(-30, 320, -34, 306, -36, 294);
    path.bezierCurveTo(-52, 200, -58, 110, -46, 6);
    path.closePath();
    ctx.save();
    ctx.shadowColor = 'rgba(40,15,30,0.22)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = main;
    ctx.fill(path);
    ctx.restore();
    ctx.save();
    ctx.clip(path);
    ctx.drawImage(sleeveTex, -66, -18);
    rib(ctx, -70, 292, 150, 60);
    // 볼륨: 몸 쪽(안쪽)이 어둡고 바깥쪽 가장자리도 살짝 어두움
    const g = ctx.createLinearGradient(-56, 0, 66, 0);
    g.addColorStop(0, 'rgba(30,10,20,0.40)');
    g.addColorStop(0.3, 'rgba(30,10,20,0.10)');
    g.addColorStop(0.58, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(30,10,20,0.26)');
    ctx.fillStyle = g;
    ctx.fillRect(-80, -30, 170, 400);
    // 팔꿈치 주름과 소맷단 위 고임
    const f1 = new Path2D();
    f1.moveTo(-40, 150);
    f1.quadraticCurveTo(0, 176, 52, 148);
    softStroke(ctx, f1, 'rgba(30,10,20,0.05)', 16);
    const f2 = new Path2D();
    f2.moveTo(-34, 280);
    f2.quadraticCurveTo(6, 296, 44, 280);
    softStroke(ctx, f2, 'rgba(30,10,20,0.07)', 14);
    const hi = new Path2D();
    hi.moveTo(26, 30);
    hi.bezierCurveTo(40, 110, 36, 200, 22, 280);
    softStroke(ctx, hi, 'rgba(255,255,255,0.045)', 18);
    ctx.restore();
    ctx.restore();
  }

  // 몸판: 처진 어깨, 살짝 들어간 옆선, 밑단에서 모이는 고무단
  const bodyPath = new Path2D();
  bodyPath.moveTo(230, 70);
  bodyPath.quadraticCurveTo(280, 112, 330, 70);
  bodyPath.bezierCurveTo(366, 72, 400, 84, 420, 108);
  bodyPath.bezierCurveTo(424, 190, 414, 300, 422, 420);
  bodyPath.bezierCurveTo(424, 460, 420, 490, 412, 532);
  bodyPath.quadraticCurveTo(280, 552, 148, 532);
  bodyPath.bezierCurveTo(140, 490, 136, 460, 138, 420);
  bodyPath.bezierCurveTo(146, 300, 136, 190, 140, 108);
  bodyPath.bezierCurveTo(160, 84, 194, 72, 230, 70);
  bodyPath.closePath();
  ctx.save();
  ctx.shadowColor = 'rgba(40,15,30,0.38)';
  ctx.shadowBlur = 26;
  ctx.fillStyle = main;
  ctx.fill(bodyPath);
  ctx.restore();
  ctx.save();
  ctx.clip(bodyPath);
  ctx.drawImage(body, 126, 66);
  rib(ctx, 126, 486, 310, 70);
  const h = ctx.createLinearGradient(138, 0, 422, 0);
  h.addColorStop(0, 'rgba(30,10,20,0.34)');
  h.addColorStop(0.14, 'rgba(30,10,20,0.06)');
  h.addColorStop(0.46, 'rgba(255,255,255,0.15)');
  h.addColorStop(0.86, 'rgba(30,10,20,0.06)');
  h.addColorStop(1, 'rgba(30,10,20,0.34)');
  ctx.fillStyle = h;
  ctx.fillRect(120, 60, 320, 500);
  const v = ctx.createLinearGradient(0, 70, 0, 550);
  v.addColorStop(0, 'rgba(255,255,255,0.18)');
  v.addColorStop(0.3, 'rgba(255,255,255,0)');
  v.addColorStop(0.86, 'rgba(30,10,20,0.10)');
  v.addColorStop(1, 'rgba(30,10,20,0.22)');
  ctx.fillStyle = v;
  ctx.fillRect(120, 60, 320, 500);
  // 옷걸이에서 흘러내리는 세로 주름
  for (const [x0, bend, a] of [[188, -14, 0.05], [244, 6, 0.03], [318, -6, 0.03], [372, 14, 0.05]] as const) {
    const f = new Path2D();
    f.moveTo(x0, 128);
    f.bezierCurveTo(x0 + bend, 240, x0 - bend, 380, x0 + bend * 0.6, 482);
    softStroke(ctx, f, `rgba(30,10,20,${a})`, 20);
  }
  // 어깨 아래 밝은 면, 밑단 위 고임
  const sh = new Path2D();
  sh.moveTo(176, 112);
  sh.quadraticCurveTo(280, 150, 384, 112);
  softStroke(ctx, sh, 'rgba(255,255,255,0.04)', 26);
  const hem = new Path2D();
  hem.moveTo(146, 480);
  hem.quadraticCurveTo(280, 498, 414, 480);
  softStroke(ctx, hem, 'rgba(30,10,20,0.06)', 14);
  ctx.restore();

  // 목: 뒤 목선 안쪽(그늘) + 앞 고무단
  ctx.save();
  const inner = new Path2D();
  inner.moveTo(236, 72);
  inner.quadraticCurveTo(280, 54, 324, 72);
  inner.quadraticCurveTo(280, 104, 236, 72);
  ctx.fillStyle = shade(main, -0.5);
  ctx.fill(inner);
  ctx.lineCap = 'round';
  const back = new Path2D();
  back.moveTo(234, 70);
  back.quadraticCurveTo(280, 50, 326, 70);
  ctx.lineWidth = 9;
  ctx.strokeStyle = shade(main, -0.22);
  ctx.stroke(back);
  const front = new Path2D();
  front.moveTo(230, 70);
  front.quadraticCurveTo(280, 112, 330, 70);
  ctx.lineWidth = 15;
  ctx.strokeStyle = shade(main, -0.06);
  ctx.stroke(front);
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(0,0,0,0.17)';
  ctx.stroke(front);
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  const edge = new Path2D();
  edge.moveTo(232, 64);
  edge.quadraticCurveTo(280, 104, 328, 64);
  ctx.stroke(edge);
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
  // 옷걸이는 옷 뒤에 (어깨 나무는 옷에 가려지고 고리와 목 사이만 보임)
  hanger(ctx, spec.kind === 'hat');
  if (p < 1) {
    ctx.save();
    ctx.globalAlpha = 0.34;
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
