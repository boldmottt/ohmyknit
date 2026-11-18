import type { ArtPiece } from '../closet/assembledArt';
import { neckRadius, smoothKeys, torsoKeys, torsoReach } from './form';
import { layoutOf, wrinkle, type Layout, type Placement, type Ring, type SimRole, type Tube } from './shape';

/**
 * 입힌 모양 (three.js 없이 숫자만): 조각마다 (가로 u, 단 k) → 3D 점을 주는 면.
 *
 * shape.ts가 조각의 치수(둘레·길이)와 자리를 정하면, 여기서 옷처럼 다듬어요.
 *  - 고무단은 조여서 살짝 오므라듦
 *  - 소매는 곧은 통이 아니라 팔처럼 어깨에서 벌어졌다가 팔꿈치 아래로 앞으로 굽음
 *  - 요크는 몸판 윗단과 소매 윗단을 한 바퀴 감싼 선에서 목까지 이어지는 면.
 *    도안에 요크 조각이 없으면 같은 면을 "예상 완성 모습"으로만 보여 줘요.
 */

export type Vec3 = [number, number, number];

export type Sheet = {
  /** 단 수 R. k = 0..R */
  rows: number;
  /** 가로로 한 바퀴 이어지는지 (원통) */
  closed: boolean;
  /** 한 바퀴를 나눌 칸 수 */
  segs: number;
  at(u: number, k: number): Vec3;
  /** 면 안쪽의 한 점: 법선을 바깥으로 맞추는 데 씀 */
  inside(u: number, k: number): Vec3;
};

export type Axis = { at(t: number): { p: Vec3; x: Vec3; y: Vec3; z: Vec3 } };

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** 양옆 radius칸 평균 (끝은 있는 만큼만) */
function blur(values: number[], radius: number): number[] {
  return values.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      s += values[j]!;
      n++;
    }
    return s / n;
  });
}

/** 고리처럼 이어진 값의 평균 */
function blurLoop(values: number[], radius: number): number[] {
  const n = values.length;
  return values.map((_, i) => {
    let s = 0;
    for (let j = -radius; j <= radius; j++) s += values[(i + j + n) % n]!;
    return s / (radius * 2 + 1);
  });
}

export function ringAt(rings: Ring[], k: number): Required<Ring> {
  const R = rings.length - 1;
  const kk = Math.max(0, Math.min(R, k));
  const k0 = Math.min(Math.max(0, R - 1), Math.floor(kk));
  const f = kk - k0;
  const a = rings[k0]!;
  const b = rings[Math.min(R, k0 + 1)]!;
  return { t: lerp(a.t, b.t, f), rx: lerp(a.rx, b.rx, f), rz: lerp(a.rz, b.rz, f), cz: lerp(a.cz ?? 0, b.cz ?? 0, f) };
}

/** 고무단이 조이는 정도 */
export const RIB_CINCH = 0.1;
/** 고무단에서 몸판으로 풀리는 구간 (단) */
const RIB_EASE = 11;

/** 늘림·줄임 계단을 펴고, 고무단을 조인 고리 (모자는 머리에 맞춰 이미 다듬어져 있어 그대로) */
export function relax(tube: Tube, p: ArtPiece, role: SimRole): Tube {
  if (role === 'hat' || tube.kind === 'panel') return tube;
  const rows = p.piece.rows;
  const R = rows.length;
  const rib = blur(
    tube.rings.map((_, k) => (p.piece.sections[rows[Math.min(R - 1, k)]?.sectionIndex ?? -1]?.technique === 'ribbing' ? 1 : 0)),
    RIB_EASE,
  );
  const rx = blur(
    tube.rings.map((r) => r.rx),
    5,
  );
  const rz = blur(
    tube.rings.map((r) => r.rz),
    5,
  );
  const rings = tube.rings.map((r, k) => ({ ...r, rx: rx[k]! * (1 - RIB_CINCH * rib[k]!), rz: rz[k]! * (1 - RIB_CINCH * rib[k]!) }));
  return { ...tube, rings };
}

function phiOf(kind: Tube['kind'], role: SimRole, u: number) {
  return kind === 'tube' ? Math.PI - 2 * Math.PI * u : role === 'back' ? -Math.PI * u : Math.PI - Math.PI * u;
}

/** 몸판·모자·판: 세로축 둘레로 감은 면 (origin만큼 올려 놓음) */
function tubeSheet(tube: Tube, role: SimRole, origin: Vec3, segs: number): Sheet {
  const [ox, oy, oz] = origin;
  return {
    rows: tube.rings.length - 1,
    closed: tube.kind === 'tube',
    segs,
    at(u, k) {
      const r = ringAt(tube.rings, k);
      if (tube.kind === 'panel') return [ox + (u - 0.5) * r.rx, oy + r.t, oz + Math.sin(u * Math.PI * 3 + r.t * 0.08) * 0.8];
      const phi = phiOf(tube.kind, role, u);
      const d = wrinkle(role, phi, r.t, tube.length);
      return [ox + (r.rx + d) * Math.cos(phi), oy + r.t, oz + (r.rz + d) * Math.sin(phi) + r.cz];
    },
    inside(u, k) {
      const r = ringAt(tube.rings, k);
      if (tube.kind === 'panel') return [ox + (u - 0.5) * r.rx, oy + r.t, oz - 5];
      return [ox, oy + r.t, oz + r.cz];
    },
  };
}

/**
 * 팔의 축 (소맷부리 t = 0 → 어깨 t = length). 어깨 쪽은 더 벌어지고 손목 쪽은 몸에 가깝게 내려오며,
 * 팔꿈치 아래는 살짝 앞으로 나와요. 평균 기울기는 shape의 자리(tilt)와 같아서 소맷부리 위치는 거의 그대로.
 */
export function armAxis(pl: Placement, length: number): Axis {
  const sx = Math.sign(pl.tilt) || 1;
  const a0 = Math.abs(pl.tilt);
  const top: Vec3 = [pl.origin[0] - Math.sin(pl.tilt) * length, pl.origin[1] + Math.cos(pl.tilt) * length, pl.origin[2]];
  const dir = (f: number): Vec3 => {
    const a = a0 * (0.72 + 0.62 * clamp01(f));
    const z = -0.2 * smoothstep(1 - clamp01(f) / 0.55);
    const len = Math.hypot(1, z);
    return [(-sx * Math.sin(a)) / len, Math.cos(a) / len, z / len];
  };
  const M = 48;
  const pts: Vec3[] = Array.from({ length: M + 1 }, () => [0, 0, 0] as Vec3);
  pts[M] = top;
  const dt = length / M;
  for (let i = M - 1; i >= 0; i--) {
    const d = dir((i + 0.5) / M);
    const q = pts[i + 1]!;
    pts[i] = [q[0] - d[0] * dt, q[1] - d[1] * dt, q[2] - d[2] * dt];
  }
  return {
    at(t) {
      const f = length > 0 ? t / length : 0;
      const y = dir(f);
      let p: Vec3;
      if (f <= 0) {
        const q = pts[0]!;
        p = [q[0] + y[0] * t, q[1] + y[1] * t, q[2] + y[2] * t];
      } else if (f >= 1) {
        p = [top[0] + y[0] * (t - length), top[1] + y[1] * (t - length), top[2] + y[2] * (t - length)];
      } else {
        const i = Math.min(M - 1, Math.floor(f * M));
        const g = f * M - i;
        const a = pts[i]!;
        const b = pts[i + 1]!;
        p = [lerp(a[0], b[0], g), lerp(a[1], b[1], g), lerp(a[2], b[2], g)];
      }
      // 축에 수직인 틀: z는 앞쪽, x = y × z
      const zl = Math.hypot(y[2] * y[0], 1 - y[2] * y[2], y[2] * y[1]) || 1;
      const z: Vec3 = [(-y[2] * y[0]) / zl, (-y[2] * y[1]) / zl, (1 - y[2] * y[2]) / zl];
      const x: Vec3 = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
      return { p, x, y, z };
    },
  };
}

/** 축을 따라 감은 면 (소매, 마네킹 팔) */
export function axisSheet(rings: Ring[], axis: Axis, segs: number, bump?: (phi: number, t: number) => number): Sheet {
  return {
    rows: rings.length - 1,
    closed: true,
    segs,
    at(u, k) {
      const r = ringAt(rings, k);
      const f = axis.at(r.t);
      const phi = Math.PI - 2 * Math.PI * u;
      const d = bump ? bump(phi, r.t) : 0;
      const cx = (r.rx + d) * Math.cos(phi);
      const cz = (r.rz + d) * Math.sin(phi);
      return [f.p[0] + f.x[0] * cx + f.z[0] * cz, f.p[1] + f.x[1] * cx + f.z[1] * cz, f.p[2] + f.x[2] * cx + f.z[2] * cz];
    },
    inside(_u, k) {
      return axis.at(ringAt(rings, k).t).p;
    },
  };
}

/** 세로축 둘레의 고리들로 만든 면 (마네킹 몸통·머리) */
export function ringSheet(rings: Ring[], segs = 64): Sheet {
  return tubeSheet({ kind: 'tube', rings, length: 0 }, 'extra', [0, 0, 0], segs);
}

const BINS = 240;

/** 위에서 본 각도마다 가장 바깥 점을 이은 선 (몸판 윗단 + 소매 윗단을 한 바퀴 감쌈) */
function envelope(points: Vec3[]): { rho: number[]; y: number[] } {
  const rho = new Array<number>(BINS).fill(0);
  const y = new Array<number>(BINS).fill(0);
  for (const [px, py, pz] of points) {
    const i = ((Math.round(((Math.atan2(pz, px) + Math.PI) / (2 * Math.PI)) * BINS) % BINS) + BINS) % BINS;
    const r = Math.hypot(px, pz);
    if (r > rho[i]!) {
      rho[i] = r;
      y[i] = py;
    }
  }
  // 점이 하나도 안 들어간 칸은 양옆의 찬 칸 사이를 이어서 채움 (비워 두면 선이 안쪽·아래로 꺼짐)
  const filled = rho.map((r) => r > 0);
  if (filled.some(Boolean)) {
    for (let i = 0; i < BINS; i++) {
      if (filled[i]) continue;
      let a = 1;
      while (!filled[(i - a + BINS) % BINS]) a++;
      let b = 1;
      while (!filled[(i + b) % BINS]) b++;
      const ia = (i - a + BINS) % BINS;
      const ib = (i + b) % BINS;
      const f = a / (a + b);
      rho[i] = lerp(rho[ia]!, rho[ib]!, f);
      y[i] = lerp(y[ia]!, y[ib]!, f);
    }
  }
  return { rho: blurLoop(blurLoop(rho, 3), 3).map((r) => r + 0.25), y: blurLoop(blurLoop(y, 4), 4) };
}

export type YokeShape = {
  rows: number;
  /** k단에서 목 쪽으로 얼마나 좁아졌는지 0..1 */
  narrow(k: number): number;
  /** k단이 요크 높이의 어디인지 0..1 */
  rise(k: number): number;
  neck: { rx: number; rz: number; y: number };
};

/** 요크: 아래는 감싼 선, 위는 목둘레. 어깨에서는 마네킹 위에 얹힘 */
function yokeSheet(base: Vec3[], shape: YokeShape, torso: Ring[]): Sheet {
  const env = envelope(base);
  const sample = (arr: number[], theta: number) => {
    const x = (((theta + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
    const xx = x < 0 ? x + BINS : x;
    const i = Math.floor(xx) % BINS;
    return lerp(arr[i]!, arr[(i + 1) % BINS]!, xx - Math.floor(xx));
  };
  const { rx, rz, y: ny } = shape.neck;
  const height = (theta: number, k: number) => {
    const g = 1 - (1 - clamp01(shape.rise(k))) ** 1.7;
    // 앞목은 뒷목보다 살짝 낮게
    return lerp(sample(env.y, theta), ny - 0.9 * Math.sin(theta), g);
  };
  return {
    rows: shape.rows,
    closed: true,
    segs: SEGS.yoke,
    at(u, k) {
      const theta = Math.PI - 2 * Math.PI * u;
      const y = height(theta, k);
      const neck = (rx * rz) / Math.hypot(rz * Math.cos(theta), rx * Math.sin(theta));
      const rho = Math.max(lerp(sample(env.rho, theta), neck, clamp01(shape.narrow(k))), torsoReach(torso, theta, y) + 0.6);
      return [rho * Math.cos(theta), y, rho * Math.sin(theta)];
    },
    inside(u, k) {
      return [0, height(Math.PI - 2 * Math.PI * u, k), 0];
    },
  };
}

/** 면의 k단 둘레 (cm) */
export function girth(sheet: Sheet, k: number, n = 72): number {
  let s = 0;
  let prev = sheet.at(0, k);
  for (let i = 1; i <= n; i++) {
    const q = sheet.at(i / n, k);
    s += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]);
    prev = q;
  }
  return s;
}

function topEdge(sheet: Sheet, tube: Tube, n: number): Vec3[] {
  const first = tube.rings[0]!;
  const last = tube.rings[tube.rings.length - 1]!;
  const k = last.t >= first.t ? tube.rings.length - 1 : 0;
  return Array.from({ length: n }, (_, i) => sheet.at(i / n, k));
}

export type ImpliedYoke = {
  sheet: Sheet;
  /** 단마다 콧수 (둘레 × 게이지): 원단 결을 그리는 데 씀 */
  rowStitches: number[];
};

export type Draped = {
  layout: Layout;
  /** 3D에 입힌 조각의 면 (자리가 없는 조각은 없음) */
  sheets: Map<ArtPiece, Sheet>;
  /** 다듬은 뒤의 고리 (마네킹이 옷 밖으로 안 나오게 맞추는 데 씀) */
  tubes: Map<ArtPiece, Tube>;
  /** 소매의 팔 축 */
  axes: Map<ArtPiece, Axis>;
  /** 도안에 요크가 없을 때 몸판과 소매를 어깨에서 잇는 예상 면 */
  impliedYoke: ImpliedYoke | null;
};

const SEGS: Record<SimRole, number> = { body: 224, front: 112, back: 112, yoke: 200, sleeveL: 96, sleeveR: 96, hat: 160, panel: 64, extra: 0 };

/** 예상 요크의 깊이 (겨드랑이 → 목, 옷감을 따라 잰 길이 cm) */
const IMPLIED_YOKE_DEPTH = 19;

export function drape(pieces: ArtPiece[]): Draped {
  const layout = layoutOf(pieces);
  const sheets = new Map<ArtPiece, Sheet>();
  const tubes = new Map<ArtPiece, Tube>();
  const axes = new Map<ArtPiece, Axis>();
  const find = (r: SimRole) => [...layout.roles].find(([, x]) => x === r)?.[0];

  for (const [p, role] of layout.roles) {
    const raw = layout.tubes.get(p);
    const pl = layout.place.get(p);
    if (!raw || !pl || role === 'extra') continue;
    const tube = relax(raw, p, role);
    tubes.set(p, tube);
    if (role === 'sleeveL' || role === 'sleeveR') {
      const axis = armAxis(pl, tube.length);
      axes.set(p, axis);
      sheets.set(
        p,
        axisSheet(tube.rings, axis, SEGS[role], (phi, t) => wrinkle(role, phi, t, tube.length)),
      );
    } else {
      sheets.set(p, tubeSheet(tube, role, pl.origin, SEGS[role]));
    }
  }

  // 요크: 원통 몸판 위, 소매 윗단까지 감싸서 목으로
  const body = find('body');
  const yoke = find('yoke');
  const sleeves = [find('sleeveL'), find('sleeveR')].filter((s): s is ArtPiece => !!s);
  let impliedYoke: ImpliedYoke | null = null;
  if (body && (yoke || sleeves.length > 0)) {
    const base = [body, ...sleeves].flatMap((p) => topEdge(sheets.get(p)!, tubes.get(p)!, p === body ? 240 : 96));
    const torso = smoothKeys(torsoKeys(layout));
    const neck = neckRadius(layout);
    if (yoke) {
      const tube = tubes.get(yoke)!;
      const bottom = tube.rings.reduce((a, b) => (a.t < b.t ? a : b));
      const top = tube.rings.reduce((a, b) => (a.t > b.t ? a : b));
      const span = bottom.rx - top.rx;
      const shape: YokeShape = {
        rows: tube.rings.length - 1,
        rise: (k) => (tube.length > 0 ? ringAt(tube.rings, k).t / tube.length : 0),
        narrow: (k) => (span > 0.5 ? (bottom.rx - ringAt(tube.rings, k).rx) / span : tube.length > 0 ? ringAt(tube.rings, k).t / tube.length : 0),
        neck: { rx: Math.max(neck * 1.3, top.rx), rz: Math.max(neck * 1.15, top.rz), y: layout.topY + Math.max(8, Math.min(26, tube.length * 0.82)) },
      };
      sheets.set(yoke, yokeSheet(base, shape, torso));
    } else {
      const rows = Math.max(8, Math.round((IMPLIED_YOKE_DEPTH / 10) * body.gauge.row));
      const shape: YokeShape = {
        rows,
        rise: (k) => k / rows,
        narrow: (k) => (k / rows) ** 1.2,
        neck: { rx: neck * 1.75, rz: neck * 1.55, y: layout.topY + 12.8 },
      };
      const sheet = yokeSheet(base, shape, torso);
      const rowStitches = Array.from({ length: rows }, (_, k) => Math.max(4, Math.round((girth(sheet, k + 0.5) / 10) * body.gauge.st)));
      impliedYoke = { sheet, rowStitches };
    }
  }
  return { layout, sheets, tubes, axes, impliedYoke };
}
