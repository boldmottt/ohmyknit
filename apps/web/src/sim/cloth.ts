/**
 * 천 시뮬레이션 (three.js 없이 숫자만 — 워커에서도, 테스트에서도 돌아가요).
 *
 * CLO 3D처럼 옷이 자기 무게로 늘어지고 몸에 걸쳐 자연스러운 주름이 생기게:
 *  - 조각마다 입자 격자 (가로 = 둘레, 세로 = 단)
 *  - 입자 사이 거리 제약: 가로·세로(원단 길이), 대각(비틀림), 한 칸 건너(굽힘)
 *    길이는 도안 치수 그대로 (콧수 ÷ 게이지, 단 수 ÷ 단 게이지). 고무단은 오므라든 길이
 *  - 솔기: 요크 아랫단 ↔ 몸판·소매 윗단을 꿰맴
 *  - 마네킹과 부딪힘(몸통 회전체·팔 관·머리 타원체) + 마찰
 *  - XPBD 작은 단계: 한 번에 아주 짧게 여러 번 → 늘어나지 않으면서도 부드럽게 접힘
 * 끝나면 주름 안쪽이 어두워지는 정도(앰비언트 오클루전)를 입자마다 구워 둬요.
 */

export type Vec3 = [number, number, number];

export type ClothPanel = {
  id: string;
  /** 가로로 한 바퀴 이어지는지 (원통) */
  closed: boolean;
  /** 고리 하나의 입자 수 */
  cols: number;
  /** 고리 수 */
  rings: number;
  /** 처음 위치 rings × cols × 3 */
  pos: Float32Array;
  /** 고리마다 이웃 입자 사이 쉴 때 거리 (가로) */
  restU: Float32Array;
  /** 고리 사이 쉴 때 거리 (세로, rings - 1개) */
  restK: Float32Array;
  /** 움직이지 않게 잡아 둘 고리 */
  pin?: number[];
  /** cross(du, dk)에 곱하면 바깥쪽 법선이 되는 부호 */
  orient: number;
};

export type Collider = (
  /** 세로축 둘레의 타원 고리들 (마네킹 몸통) */
  | { kind: 'lathe'; t: number[]; rx: number[]; rz: number[]; margin: number; friction: number }
  /** 굵기가 변하는 관 (팔, 목) */
  | { kind: 'tube'; p: number[]; r: number[]; margin: number; friction: number }
  /** 타원체 (머리) */
  | { kind: 'ellipsoid'; c: Vec3; r: Vec3; margin: number; friction: number }
  /** 높이마다 각도별 반지름을 가진 단면 쌓기 (사람 몸통·머리). r은 단면 × A */
  | { kind: 'loft'; y: number[]; cx: number[]; cz: number[]; A: number; r: number[]; margin: number; friction: number }
) & {
  /** 이 부딪힘을 건너뛰는 조각 번호 (panels 순서) */
  skip?: number[];
};

/** 솔기: 전체 입자 번호 두 개 */
export type Seam = [number, number];

export type ClothParams = {
  /** 1/60초 프레임 수 */
  frames: number;
  /** 프레임마다 작은 단계 수 */
  substeps: number;
  gravity: number;
  /** 작은 단계마다 속도를 줄이는 비율 */
  damping: number;
  /** 유연도 (XPBD compliance): 클수록 잘 늘어나거나 잘 접힘 */
  stretchU: number;
  stretchK: number;
  shear: number;
  bend: number;
  seam: number;
};

export const CLOTH_PARAMS: ClothParams = {
  frames: 110,
  substeps: 16,
  gravity: 981,
  damping: 0.006,
  stretchU: 3e-7,
  stretchK: 6e-8,
  shear: 1.5e-6,
  bend: 1.1e-4,
  seam: 1e-8,
};

export type ClothInput = {
  panels: ClothPanel[];
  seams: Seam[];
  colliders: Collider[];
  params?: Partial<ClothParams>;
  /** 처음 위치를 아주 조금 흔들어 대칭을 깨는 씨앗 (주름이 한쪽으로 자연스럽게 잡히게) */
  seed?: number;
};

export type Occupancy = { grid: Uint8Array; nx: number; ny: number; nz: number; origin: Vec3; cell: number };

export type ClothOutput = {
  /** 조각마다 늘어뜨린 뒤 위치 */
  pos: Float32Array[];
  /** 조각마다 입자의 밝기 (1 = 트인 곳, 작을수록 주름 안쪽) */
  ao: Float32Array[];
  /** 마네킹 그늘 계산용 점유 격자 */
  occ: Occupancy;
  /** 시뮬레이션이 정상으로 끝났는지 (NaN·폭주 없음) */
  ok: boolean;
  ms: number;
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

type Constraints = { a: Int32Array; b: Int32Array; rest: Float32Array; alpha: Float32Array; n: number };

function buildConstraints(panels: ClothPanel[], offsets: number[], seams: Seam[], P: ClothParams, x: Float32Array, seed: number): Constraints {
  // 손으로 뜬 원단은 코마다 아주 조금씩 다름 → 주름이 고르지 않게 잡힘
  const jitter = rng(seed * 31 + 5);
  const A: number[] = [];
  const B: number[] = [];
  const Rs: number[] = [];
  const Al: number[] = [];
  const dist = (i: number, j: number) => Math.hypot(x[i * 3]! - x[j * 3]!, x[i * 3 + 1]! - x[j * 3 + 1]!, x[i * 3 + 2]! - x[j * 3 + 2]!);
  const add = (i: number, j: number, rest: number, alpha: number) => {
    A.push(i);
    B.push(j);
    Rs.push(rest);
    Al.push(alpha);
  };
  panels.forEach((p, pi) => {
    const off = offsets[pi]!;
    const C = p.cols;
    const K = p.rings;
    const id = (i: number, j: number) => off + i * C + (p.closed ? ((j % C) + C) % C : j);
    const lastJ = p.closed ? C : C - 1;
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < lastJ; j++) add(id(i, j), id(i, j + 1), p.restU[i]! * (1 + jitter() * 0.02), P.stretchU);
    }
    for (let i = 0; i < K - 1; i++) {
      const ru = (p.restU[i]! + p.restU[i + 1]!) / 2;
      const rk = p.restK[i]!;
      const diag = Math.hypot(ru, rk);
      for (let j = 0; j < C; j++) add(id(i, j), id(i + 1, j), rk, P.stretchK);
      for (let j = 0; j < lastJ; j++) {
        add(id(i, j), id(i + 1, j + 1), diag, P.shear);
        add(id(i, j + 1), id(i + 1, j), diag, P.shear);
      }
    }
    // 굽힘: 한 칸 건너 이웃. 쉴 때 거리는 처음 모양 (굽은 정도를 조금만 기억)
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < (p.closed ? C : C - 2); j++) {
        const a = id(i, j);
        const b = id(i, j + 2);
        add(a, b, Math.min(dist(a, b), p.restU[i]! * 2), P.bend);
      }
    }
    for (let i = 0; i < K - 2; i++) {
      for (let j = 0; j < C; j++) {
        const a = id(i, j);
        const b = id(i + 2, j);
        add(a, b, Math.min(dist(a, b), p.restK[i]! + p.restK[i + 1]!), P.bend);
      }
    }
  });
  for (const [a, b] of seams) add(a, b, 0, P.seam);
  return { a: Int32Array.from(A), b: Int32Array.from(B), rest: Float32Array.from(Rs), alpha: Float32Array.from(Al), n: A.length };
}

/* ───────── 충돌 ───────── */

type Prepared =
  | {
      kind: 'lathe';
      t: Float64Array;
      rx: Float64Array;
      rz: Float64Array;
      tMin: number;
      tMax: number;
      rMax: number;
      margin: number;
      friction: number;
    }
  | { kind: 'tube'; p: Float64Array; r: Float64Array; lo: Vec3; hi: Vec3; bc: Float64Array; br2: Float64Array; margin: number; friction: number }
  | { kind: 'ellipsoid'; c: Vec3; r: Vec3; margin: number; friction: number }
  | {
      kind: 'loft';
      y: Float64Array;
      cx: Float64Array;
      cz: Float64Array;
      r: Float64Array;
      A: number;
      yMin: number;
      yMax: number;
      rMax: number;
      /** 높이 근처(앞뒤 몇 단면)에서 가장 바깥까지의 거리: 멀리 떨어진 점은 바로 건너뜀 */
      near: Float64Array;
      margin: number;
      friction: number;
    };

function prepare(c: Collider): Prepared {
  if (c.kind === 'loft') {
    let rMax = 0;
    const n = c.y.length;
    const ring = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const off = Math.hypot(c.cx[i]!, c.cz[i]!);
      for (let a = 0; a < c.A; a++) ring[i] = Math.max(ring[i]!, c.r[i * c.A + a]! + off);
      rMax = Math.max(rMax, ring[i]!);
    }
    const near = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 5); j++) m = Math.max(m, ring[j]!);
      near[i] = m;
    }
    return {
      kind: 'loft',
      y: Float64Array.from(c.y),
      cx: Float64Array.from(c.cx),
      cz: Float64Array.from(c.cz),
      r: Float64Array.from(c.r),
      A: c.A,
      yMin: c.y[0]!,
      yMax: c.y[n - 1]!,
      rMax,
      near,
      margin: c.margin,
      friction: c.friction,
    };
  }
  if (c.kind === 'lathe') {
    const order = c.t.map((_, i) => i).sort((a, b) => c.t[a]! - c.t[b]!);
    const t = Float64Array.from(order.map((i) => c.t[i]!));
    const rx = Float64Array.from(order.map((i) => c.rx[i]!));
    const rz = Float64Array.from(order.map((i) => c.rz[i]!));
    return { kind: 'lathe', t, rx, rz, tMin: t[0]!, tMax: t[t.length - 1]!, rMax: Math.max(...rx, ...rz), margin: c.margin, friction: c.friction };
  }
  if (c.kind === 'tube') {
    const n = c.r.length;
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    const rMax = Math.max(...c.r);
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < 3; d++) {
        lo[d] = Math.min(lo[d]!, c.p[i * 3 + d]! - rMax - c.margin);
        hi[d] = Math.max(hi[d]!, c.p[i * 3 + d]! + rMax + c.margin);
      }
    }
    // 구간마다 감싸는 공 (멀리 있는 구간은 바로 건너뜀)
    const bc = new Float64Array((n - 1) * 3);
    const br2 = new Float64Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      const hx = (c.p[i * 3 + 3]! - c.p[i * 3]!) / 2;
      const hy = (c.p[i * 3 + 4]! - c.p[i * 3 + 1]!) / 2;
      const hz = (c.p[i * 3 + 5]! - c.p[i * 3 + 2]!) / 2;
      bc[i * 3] = c.p[i * 3]! + hx;
      bc[i * 3 + 1] = c.p[i * 3 + 1]! + hy;
      bc[i * 3 + 2] = c.p[i * 3 + 2]! + hz;
      const rr = Math.sqrt(hx * hx + hy * hy + hz * hz) + Math.max(c.r[i]!, c.r[i + 1]!) + c.margin;
      br2[i] = rr * rr;
    }
    return { kind: 'tube', p: Float64Array.from(c.p), r: Float64Array.from(c.r), lo, hi, bc, br2, margin: c.margin, friction: c.friction };
  }
  return c;
}

/** 빠른 atan2 (오차 0.0001라디안 이하): 몸 단면의 각도 칸(5도)을 고르는 데는 충분 */
function atan2f(y: number, x: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const a = Math.min(ax, ay) / (Math.max(ax, ay) + 1e-12);
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = 1.5707963268 - r;
  if (x < 0) r = Math.PI - r;
  return y < 0 ? -r : r;
}

/**
 * (x, y, z)가 몸 안이거나 너무 가까우면 바깥 자리를 out에 넣고 법선을 n에 넣어 true.
 * hint[idx]: 이 점이 지난번에 있던 단면 번호 (단면 쌓기에서 높이 찾기를 건너뜀)
 */
function pushOut(c: Prepared, x: number, y: number, z: number, out: Float64Array, n: Float64Array, hint?: Int32Array, idx = 0): boolean {
  if (c.kind === 'loft') {
    const m = c.margin;
    if (y < c.yMin - m || y > c.yMax + m) return false;
    const last = c.y.length - 2;
    let lo = hint ? hint[idx]! : -1;
    if (lo >= 0 && lo <= last) {
      while (lo > 0 && c.y[lo]! > y) lo--;
      while (lo < last && c.y[lo + 1]! <= y) lo++;
    } else {
      lo = 0;
      let hi = c.y.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (c.y[mid]! <= y) lo = mid;
        else hi = mid;
      }
    }
    if (hint) hint[idx] = lo;
    // 이 높이 근처에서 가장 바깥보다 멀면 바로 건너뜀 (헐렁한 옷은 대부분 여기서 끝)
    if (x * x + z * z > (c.near[lo]! + m + 0.5) ** 2) return false;
    const span = c.y[lo + 1]! - c.y[lo]!;
    const fy = span > 1e-9 ? Math.max(0, Math.min(1, (y - c.y[lo]!) / span)) : 0;
    const ccx = c.cx[lo]! + (c.cx[lo + 1]! - c.cx[lo]!) * fy;
    const ccz = c.cz[lo]! + (c.cz[lo + 1]! - c.cz[lo]!) * fy;
    const dx = x - ccx;
    const dz = z - ccz;
    const rho = Math.sqrt(dx * dx + dz * dz);
    if (rho > c.rMax + m) return false;
    const ct = rho > 1e-9 ? dx / rho : 1;
    const st = rho > 1e-9 ? dz / rho : 0;
    let ax = atan2f(st, ct) / (2 * Math.PI);
    if (ax < 0) ax += 1;
    ax *= c.A;
    if (ax >= c.A) ax -= c.A;
    const a0 = Math.floor(ax) % c.A;
    const fa = ax - Math.floor(ax);
    const a1 = (a0 + 1) % c.A;
    // 단면 i의 겉면까지 거리 (이 점의 중심 기준)
    const R = (i: number) => c.r[i * c.A + a0]! * (1 - fa) + c.r[i * c.A + a1]! * fa + (c.cx[i]! - ccx) * ct + (c.cz[i]! - ccz) * st;
    const from = Math.max(0, lo - 3);
    const to = Math.min(c.y.length - 2, lo + 3);
    let best = Infinity;
    let cr = 0;
    let cy = 0;
    let inside = false;
    let rPrev = 0;
    for (let i = from; i <= to; i++) {
      const r0 = i === from ? R(i) : rPrev;
      const r1 = R(i + 1);
      rPrev = r1;
      const t0 = c.y[i]!;
      const t1 = c.y[i + 1]!;
      const dr = r1 - r0;
      const dt = t1 - t0;
      const len2 = dr * dr + dt * dt;
      const s = len2 > 1e-12 ? Math.max(0, Math.min(1, ((rho - r0) * dr + (y - t0) * dt) / len2)) : 0;
      const pr = r0 + dr * s;
      const py = t0 + dt * s;
      const ex = rho - pr;
      const ey = y - py;
      const d2 = ex * ex + ey * ey;
      if (d2 < best) {
        best = d2;
        cr = pr;
        cy = py;
      }
      if (y >= t0 && y <= t1 && dt > 1e-9 && rho < r0 + (dr * (y - t0)) / dt) inside = true;
    }
    if (!inside && best >= m * m) return false;
    let nr = rho - cr;
    let ny = y - cy;
    const l = Math.sqrt(nr * nr + ny * ny);
    if (l < 1e-9) {
      nr = 1;
      ny = 0;
    } else {
      nr /= l;
      ny /= l;
    }
    if (inside) {
      nr = -nr;
      ny = -ny;
    }
    const tr = cr + nr * m;
    const ty = cy + ny * m;
    out[0] = ccx + tr * ct;
    out[1] = ty;
    out[2] = ccz + tr * st;
    n[0] = nr * ct;
    n[1] = ny;
    n[2] = nr * st;
    return true;
  }
  if (c.kind === 'lathe') {
    const m = c.margin;
    if (y < c.tMin - m || y > c.tMax + m) return false;
    const rho = Math.sqrt(x * x + z * z);
    if (rho > c.rMax + m) return false;
    const ct = rho > 1e-9 ? x / rho : 1;
    const st = rho > 1e-9 ? z / rho : 0;
    // y 근처 구간만 살펴봄
    let lo = 0;
    let hi = c.t.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c.t[mid]! <= y) lo = mid;
      else hi = mid;
    }
    const from = Math.max(0, lo - 4);
    const to = Math.min(c.t.length - 2, lo + 4);
    let best = Infinity;
    let cr = 0;
    let cy = 0;
    let inside = false;
    let rPrev = 0;
    for (let i = from; i <= to; i++) {
      let r0: number;
      if (i === from) {
        const a = c.rz[i]! * ct;
        const b = c.rx[i]! * st;
        r0 = (c.rx[i]! * c.rz[i]!) / Math.sqrt(a * a + b * b);
      } else r0 = rPrev;
      const a1 = c.rz[i + 1]! * ct;
      const b1 = c.rx[i + 1]! * st;
      const r1 = (c.rx[i + 1]! * c.rz[i + 1]!) / Math.sqrt(a1 * a1 + b1 * b1);
      rPrev = r1;
      const t0 = c.t[i]!;
      const t1 = c.t[i + 1]!;
      const dr = r1 - r0;
      const dt = t1 - t0;
      const len2 = dr * dr + dt * dt;
      const s = len2 > 1e-12 ? Math.max(0, Math.min(1, ((rho - r0) * dr + (y - t0) * dt) / len2)) : 0;
      const pr = r0 + dr * s;
      const py = t0 + dt * s;
      const ex = rho - pr;
      const ey = y - py;
      const d2 = ex * ex + ey * ey;
      if (d2 < best) {
        best = d2;
        cr = pr;
        cy = py;
      }
      if (y >= t0 && y <= t1 && dt > 1e-9) {
        const ry = r0 + (dr * (y - t0)) / dt;
        if (rho < ry) inside = true;
      }
    }
    if (!inside && best >= m * m) return false;
    let nr = rho - cr;
    let ny = y - cy;
    const l = Math.sqrt(nr * nr + ny * ny);
    if (l < 1e-9) {
      nr = 1;
      ny = 0;
    } else {
      nr /= l;
      ny /= l;
    }
    if (inside) {
      nr = -nr;
      ny = -ny;
    }
    const tr = cr + nr * m;
    const ty = cy + ny * m;
    out[0] = tr * ct;
    out[1] = ty;
    out[2] = tr * st;
    n[0] = nr * ct;
    n[1] = ny;
    n[2] = nr * st;
    return true;
  }
  if (c.kind === 'tube') {
    if (x < c.lo[0] || y < c.lo[1] || z < c.lo[2] || x > c.hi[0] || y > c.hi[1] || z > c.hi[2]) return false;
    const segs = c.r.length - 1;
    let bestD = Infinity;
    let bx = 0;
    let by = 0;
    let bz = 0;
    let br = 0;
    for (let i = 0; i < segs; i++) {
      const qx = x - c.bc[i * 3]!;
      const qy = y - c.bc[i * 3 + 1]!;
      const qz = z - c.bc[i * 3 + 2]!;
      if (qx * qx + qy * qy + qz * qz > c.br2[i]!) continue;
      const ax = c.p[i * 3]!;
      const ay = c.p[i * 3 + 1]!;
      const az = c.p[i * 3 + 2]!;
      const vx = c.p[i * 3 + 3]! - ax;
      const vy = c.p[i * 3 + 4]! - ay;
      const vz = c.p[i * 3 + 5]! - az;
      const l2 = vx * vx + vy * vy + vz * vz;
      const s = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy + (z - az) * vz) / l2)) : 0;
      const px = ax + vx * s;
      const py = ay + vy * s;
      const pz = az + vz * s;
      const r = c.r[i]! + (c.r[i + 1]! - c.r[i]!) * s;
      const ex = x - px;
      const ey = y - py;
      const ez = z - pz;
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez) - r;
      if (d < bestD) {
        bestD = d;
        bx = px;
        by = py;
        bz = pz;
        br = r;
      }
    }
    if (bestD >= c.margin) return false;
    let nx = x - bx;
    let ny = y - by;
    let nz = z - bz;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const target = br + c.margin;
    out[0] = bx + nx * target;
    out[1] = by + ny * target;
    out[2] = bz + nz * target;
    n[0] = nx;
    n[1] = ny;
    n[2] = nz;
    return true;
  }
  const qx = (x - c.c[0]) / c.r[0];
  const qy = (y - c.c[1]) / c.r[1];
  const qz = (z - c.c[2]) / c.r[2];
  const L = Math.sqrt(qx * qx + qy * qy + qz * qz);
  const grow = 1 + c.margin / Math.min(c.r[0], c.r[1], c.r[2]);
  if (L >= grow) return false;
  const s = L > 1e-9 ? grow / L : grow;
  out[0] = c.c[0] + qx * s * c.r[0];
  out[1] = c.c[1] + qy * s * c.r[1];
  out[2] = c.c[2] + qz * s * c.r[2];
  // 타원체 바깥 법선: 축척의 제곱으로 나눈 방향
  let nx = qx / c.r[0];
  let ny = qy / c.r[1];
  let nz = qz / c.r[2];
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  n[0] = nx;
  n[1] = ny;
  n[2] = nz;
  return true;
}

/**
 * 출발 모양이 몸 안으로 파고든 곳(가슴·어깨처럼 옷보다 나온 곳)을 몸 밖으로 밀어 둠.
 * 길이 제약이 나중에 다시 끌어당겨서, 옷이 몸에 걸쳐 감싸게 돼요.
 */
export function separate(panels: ClothPanel[], colliders: Collider[], extra = 0.35, passes = 3) {
  const all = colliders.map((c) => prepare({ ...c, margin: c.margin + extra }));
  const out = new Float64Array(3);
  const nrm = new Float64Array(3);
  for (const [pi, p] of panels.entries()) {
    const prep = all.filter((_, ci) => !colliders[ci]!.skip?.includes(pi));
    const n = p.cols * p.rings;
    for (let i = 0; i < n; i++) {
      let x = p.pos[i * 3]!;
      let y = p.pos[i * 3 + 1]!;
      let z = p.pos[i * 3 + 2]!;
      for (let pass = 0; pass < passes; pass++) {
        let moved = false;
        for (const c of prep) {
          if (!pushOut(c, x, y, z, out, nrm)) continue;
          x = out[0]!;
          y = out[1]!;
          z = out[2]!;
          moved = true;
        }
        if (!moved) break;
      }
      p.pos[i * 3] = x;
      p.pos[i * 3 + 1] = y;
      p.pos[i * 3 + 2] = z;
    }
  }
}

/* ───────── 시뮬레이션 ───────── */

export function simulate(input: ClothInput): ClothOutput {
  const t0 = Date.now();
  const P = { ...CLOTH_PARAMS, ...input.params };
  const panels = input.panels;
  const offsets: number[] = [];
  let N = 0;
  for (const p of panels) {
    offsets.push(N);
    N += p.cols * p.rings;
  }
  const x = new Float32Array(N * 3);
  panels.forEach((p, i) => x.set(p.pos, offsets[i]! * 3));
  const C = buildConstraints(panels, offsets, input.seams, P, x, input.seed ?? 7);
  // 대칭을 살짝 깨기 (완벽한 원통은 주름이 어느 쪽으로 질지 몰라 그대로 매끈하게 남음):
  // 고리마다 둘레를 따라 느리게 출렁이는 굴곡을 몇 mm 넣어 주름이 자리 잡을 곳을 고르지 않게 흩어 둠
  const rand = rng(input.seed ?? 7);
  panels.forEach((p, pi) => {
    if (!p.closed) return;
    const waves = Array.from({ length: 4 }, (_, m) => ({ f: 2 + m * 1.7 + rand() * 0.8, g: rand() * 1.5, ph: rand() * Math.PI, a: (0.32 / (m + 1)) * (0.7 + 0.3 * rand()) }));
    for (let i = 0; i < p.rings; i++) {
      let cx = 0;
      let cz = 0;
      for (let j = 0; j < p.cols; j++) {
        const k = (offsets[pi]! + i * p.cols + j) * 3;
        cx += x[k]!;
        cz += x[k + 2]!;
      }
      cx /= p.cols;
      cz /= p.cols;
      for (let j = 0; j < p.cols; j++) {
        const k = (offsets[pi]! + i * p.cols + j) * 3;
        const dx = x[k]! - cx;
        const dz = x[k + 2]! - cz;
        const l = Math.sqrt(dx * dx + dz * dz) || 1;
        const u = j / p.cols;
        const v = i / Math.max(1, p.rings - 1);
        let d = 0;
        for (const w of waves) d += w.a * Math.sin(2 * Math.PI * (w.f * u + w.g * v) + w.ph);
        x[k] = x[k]! + (dx / l) * d;
        x[k + 2] = x[k + 2]! + (dz / l) * d;
      }
    }
  });
  for (let i = 0; i < N * 3; i++) x[i] = x[i]! + rand() * 0.03;
  const prev = new Float32Array(x);
  const vel = new Float32Array(N * 3);
  const w = new Float32Array(N).fill(1);
  panels.forEach((p, pi) => {
    for (const ring of p.pin ?? []) {
      for (let j = 0; j < p.cols; j++) w[offsets[pi]! + ring * p.cols + j] = 0;
    }
  });
  const colliders = input.colliders.map(prepare);
  const hints = colliders.map(() => new Int32Array(N).fill(-1));
  // 조각마다 건너뛰는 부딪힘 (입자 번호로 펼침)
  const skip = input.colliders.map((c) => {
    if (!c.skip?.length) return null;
    const m = new Uint8Array(N);
    for (const pi of c.skip) if (panels[pi]) m.fill(1, offsets[pi]!, offsets[pi]! + panels[pi]!.cols * panels[pi]!.rings);
    return m;
  });
  const out = new Float64Array(3);
  const nrm = new Float64Array(3);
  // 마지막으로 닿은 마네킹과 그 자리의 법선: 부딪힘은 두 단계에 한 번 재지만 마찰은 매 단계 걸어요
  // (안 그러면 마찰이 절반만 걸려 비니가 정수리로 올라가고 어깨에서 옷이 미끄러짐)
  const touch = new Int16Array(N).fill(-1);
  const tn = new Float32Array(N * 3);
  const dt = 1 / 60 / P.substeps;
  const steps = P.frames * P.substeps;
  let ok = true;

  for (let step = 0; step < steps; step++) {
    // 처음에는 중력을 천천히 올려서 출렁이지 않게
    const g = P.gravity * Math.min(1, step / (P.substeps * 12));
    const keep = 1 - P.damping;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      prev[i3] = x[i3]!;
      prev[i3 + 1] = x[i3 + 1]!;
      prev[i3 + 2] = x[i3 + 2]!;
      if (w[i] === 0) continue;
      vel[i3 + 1] = vel[i3 + 1]! - g * dt;
      x[i3] = x[i3]! + vel[i3]! * dt;
      x[i3 + 1] = x[i3 + 1]! + vel[i3 + 1]! * dt;
      x[i3 + 2] = x[i3 + 2]! + vel[i3 + 2]! * dt;
    }
    const dt2 = dt * dt;
    for (let c = 0; c < C.n; c++) {
      const a = C.a[c]!;
      const b = C.b[c]!;
      const wa = w[a]!;
      const wb = w[b]!;
      const ws = wa + wb;
      if (ws === 0) continue;
      const a3 = a * 3;
      const b3 = b * 3;
      const dx = x[b3]! - x[a3]!;
      const dy = x[b3 + 1]! - x[a3 + 1]!;
      const dz = x[b3 + 2]! - x[a3 + 2]!;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rest = C.rest[c]!;
      if (len < 1e-9) continue;
      const Cv = len - rest;
      const dl = -Cv / (ws + C.alpha[c]! / dt2);
      const nx = (dx / len) * dl;
      const ny = (dy / len) * dl;
      const nz = (dz / len) * dl;
      x[a3] = x[a3]! - nx * wa;
      x[a3 + 1] = x[a3 + 1]! - ny * wa;
      x[a3 + 2] = x[a3 + 2]! - nz * wa;
      x[b3] = x[b3]! + nx * wb;
      x[b3 + 1] = x[b3 + 1]! + ny * wb;
      x[b3 + 2] = x[b3 + 2]! + nz * wb;
    }
    // 마네킹: 밀어내고, 미끄러지는 만큼 마찰로 붙잡음 (한 단계 움직임이 0.1mm도 안 돼서 밀어내기는 두 단계에 한 번)
    const full = step % 2 === 0 || step === steps - 1;
    for (let i = 0; i < N; i++) {
      if (w[i] === 0) continue;
      const i3 = i * 3;
      if (!full) {
        // 사이 단계: 지난번에 닿았던 면 그대로 마찰만 (면 안쪽으로는 못 들어가게)
        const ci = touch[i]!;
        if (ci < 0) continue;
        const ox = prev[i3]!;
        const oy = prev[i3 + 1]!;
        const oz = prev[i3 + 2]!;
        const mx = x[i3]! - ox;
        const my = x[i3 + 1]! - oy;
        const mz = x[i3 + 2]! - oz;
        const n0 = tn[i3]!;
        const n1 = tn[i3 + 1]!;
        const n2 = tn[i3 + 2]!;
        const dn = mx * n0 + my * n1 + mz * n2;
        const dk = Math.max(0, dn);
        const keepT = 1 - colliders[ci]!.friction;
        x[i3] = ox + n0 * dk + (mx - n0 * dn) * keepT;
        x[i3 + 1] = oy + n1 * dk + (my - n1 * dn) * keepT;
        x[i3 + 2] = oz + n2 * dk + (mz - n2 * dn) * keepT;
        continue;
      }
      touch[i] = -1;
      for (let ci = 0; ci < colliders.length; ci++) {
        const col = colliders[ci]!;
        if (skip[ci]?.[i]) continue;
        if (!pushOut(col, x[i3]!, x[i3 + 1]!, x[i3 + 2]!, out, nrm, hints[ci], i)) continue;
        const ox = prev[i3]!;
        const oy = prev[i3 + 1]!;
        const oz = prev[i3 + 2]!;
        const mx = out[0]! - ox;
        const my = out[1]! - oy;
        const mz = out[2]! - oz;
        const dn = mx * nrm[0]! + my * nrm[1]! + mz * nrm[2]!;
        const keepT = 1 - col.friction;
        x[i3] = ox + nrm[0]! * dn + (mx - nrm[0]! * dn) * keepT;
        x[i3 + 1] = oy + nrm[1]! * dn + (my - nrm[1]! * dn) * keepT;
        x[i3 + 2] = oz + nrm[2]! * dn + (mz - nrm[2]! * dn) * keepT;
        touch[i] = ci;
        tn[i3] = nrm[0]!;
        tn[i3 + 1] = nrm[1]!;
        tn[i3 + 2] = nrm[2]!;
      }
    }
    for (let i = 0; i < N * 3; i++) vel[i] = ((x[i]! - prev[i]!) / dt) * keep;
    if (step % 200 === 199) {
      for (let i = 0; i < N * 3; i++) {
        if (!Number.isFinite(x[i]!) || Math.abs(x[i]!) > 5000) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
  }

  const pos = panels.map((p, i) => x.slice(offsets[i]! * 3, (offsets[i]! + p.cols * p.rings) * 3));
  return { ...bakeCloth(input, pos), ok, ms: Date.now() - t0 };
}

/** 늘어뜨린 위치로 그늘 굽기 (저장해 둔 위치를 다시 쓸 때도) */
export function bakeCloth(input: ClothInput, pos: Float32Array[]): Pick<ClothOutput, 'pos' | 'ao' | 'occ'> {
  const occ = occupancy(input.panels, pos, input.colliders);
  const ao = input.panels.map((p, i) => bakeAO(p, pos[i]!, occ));
  return { pos, ao, occ };
}

/* ───────── 앰비언트 오클루전 (주름 안쪽 그늘) ───────── */

const CELL = 0.75;

function occupancy(panels: ClothPanel[], pos: Float32Array[], colliders: Collider[]): Occupancy {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const grow = (px: number, py: number, pz: number) => {
    lo[0] = Math.min(lo[0], px);
    lo[1] = Math.min(lo[1], py);
    lo[2] = Math.min(lo[2], pz);
    hi[0] = Math.max(hi[0], px);
    hi[1] = Math.max(hi[1], py);
    hi[2] = Math.max(hi[2], pz);
  };
  for (const p of pos) for (let i = 0; i < p.length; i += 3) grow(p[i]!, p[i + 1]!, p[i + 2]!);
  const pad = 14;
  const origin: Vec3 = [lo[0] - pad, lo[1] - pad, lo[2] - pad];
  const nx = Math.min(260, Math.ceil((hi[0] - lo[0] + pad * 2) / CELL));
  const ny = Math.min(320, Math.ceil((hi[1] - lo[1] + pad * 2) / CELL));
  const nz = Math.min(220, Math.ceil((hi[2] - lo[2] + pad * 2) / CELL));
  const grid = new Uint8Array(nx * ny * nz);
  let flag = 1;
  const mark = (px: number, py: number, pz: number) => {
    const ix = Math.floor((px - origin[0]) / CELL);
    const iy = Math.floor((py - origin[1]) / CELL);
    const iz = Math.floor((pz - origin[2]) / CELL);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return;
    const k = (iy * nz + iz) * nx + ix;
    grid[k] = grid[k]! | flag;
  };
  // 옷: 칸마다 3×3 점
  panels.forEach((p, pi) => {
    const x = pos[pi]!;
    const C = p.cols;
    const lastJ = p.closed ? C : C - 1;
    for (let i = 0; i < p.rings - 1; i++) {
      for (let j = 0; j < lastJ; j++) {
        const jj = (j + 1) % C;
        const q = [i * C + j, i * C + jj, (i + 1) * C + j, (i + 1) * C + jj].map((k) => k * 3);
        for (let a = 0; a <= 2; a++) {
          for (let b = 0; b <= 2; b++) {
            const s = a / 2;
            const t = b / 2;
            const w00 = (1 - s) * (1 - t);
            const w01 = s * (1 - t);
            const w10 = (1 - s) * t;
            const w11 = s * t;
            mark(
              x[q[0]!]! * w00 + x[q[1]!]! * w01 + x[q[2]!]! * w10 + x[q[3]!]! * w11,
              x[q[0]! + 1]! * w00 + x[q[1]! + 1]! * w01 + x[q[2]! + 1]! * w10 + x[q[3]! + 1]! * w11,
              x[q[0]! + 2]! * w00 + x[q[1]! + 2]! * w01 + x[q[2]! + 2]! * w10 + x[q[3]! + 2]! * w11,
            );
          }
        }
      }
    }
  });
  // 마네킹 겉면
  flag = 2;
  for (const c of colliders) {
    if (c.kind === 'loft') {
      const rings = c.y.length;
      const radius = (i: number, phi: number) => {
        let ax = phi / (2 * Math.PI);
        ax = (ax - Math.floor(ax)) * c.A;
        const a0 = Math.floor(ax) % c.A;
        const fa = ax - Math.floor(ax);
        return c.r[i * c.A + a0]! * (1 - fa) + c.r[i * c.A + ((a0 + 1) % c.A)]! * fa;
      };
      for (let i = 0; i < rings - 1; i++) {
        const steps = Math.max(1, Math.ceil(Math.abs(c.y[i + 1]! - c.y[i]!) / (CELL * 0.8)));
        for (let s2 = 0; s2 <= steps; s2++) {
          const f = s2 / steps;
          const y = c.y[i]! + (c.y[i + 1]! - c.y[i]!) * f;
          const cx = c.cx[i]! + (c.cx[i + 1]! - c.cx[i]!) * f;
          const cz = c.cz[i]! + (c.cz[i + 1]! - c.cz[i]!) * f;
          let rm = 0;
          for (let a = 0; a < c.A; a++) rm = Math.max(rm, c.r[i * c.A + a]!);
          const n = Math.max(16, Math.ceil((2 * Math.PI * rm) / (CELL * 0.8)));
          for (let j = 0; j < n; j++) {
            const phi = (2 * Math.PI * j) / n;
            const r = radius(i, phi) * (1 - f) + radius(i + 1, phi) * f;
            mark(cx + r * Math.cos(phi), y, cz + r * Math.sin(phi));
          }
        }
      }
    } else if (c.kind === 'lathe') {
      const order = c.t.map((_, i) => i).sort((a, b) => c.t[a]! - c.t[b]!);
      for (let k = 0; k < order.length - 1; k++) {
        const a = order[k]!;
        const b = order[k + 1]!;
        const steps = Math.max(1, Math.ceil(Math.abs(c.t[b]! - c.t[a]!) / (CELL * 0.8)));
        for (let s = 0; s <= steps; s++) {
          const f = s / steps;
          const t = c.t[a]! + (c.t[b]! - c.t[a]!) * f;
          const rx = c.rx[a]! + (c.rx[b]! - c.rx[a]!) * f;
          const rz = c.rz[a]! + (c.rz[b]! - c.rz[a]!) * f;
          const n = Math.max(12, Math.ceil((2 * Math.PI * Math.max(rx, rz)) / (CELL * 0.8)));
          for (let j = 0; j < n; j++) {
            const th = (2 * Math.PI * j) / n;
            mark(rx * Math.cos(th), t, rz * Math.sin(th));
          }
        }
      }
    } else if (c.kind === 'tube') {
      const segs = c.r.length - 1;
      for (let i = 0; i < segs; i++) {
        const a: Vec3 = [c.p[i * 3]!, c.p[i * 3 + 1]!, c.p[i * 3 + 2]!];
        const v: Vec3 = [c.p[i * 3 + 3]! - a[0], c.p[i * 3 + 4]! - a[1], c.p[i * 3 + 5]! - a[2]];
        const len = Math.hypot(...v) || 1;
        const d: Vec3 = [v[0] / len, v[1] / len, v[2] / len];
        const ref: Vec3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const e1 = normalize(cross(d, ref));
        const e2 = cross(d, e1);
        const steps = Math.max(1, Math.ceil(len / (CELL * 0.8)));
        for (let s = 0; s <= steps; s++) {
          const f = s / steps;
          const r = c.r[i]! + (c.r[i + 1]! - c.r[i]!) * f;
          const n = Math.max(10, Math.ceil((2 * Math.PI * r) / (CELL * 0.8)));
          for (let j = 0; j < n; j++) {
            const th = (2 * Math.PI * j) / n;
            const cx = Math.cos(th) * r;
            const sz = Math.sin(th) * r;
            mark(a[0] + v[0] * f + e1[0] * cx + e2[0] * sz, a[1] + v[1] * f + e1[1] * cx + e2[1] * sz, a[2] + v[2] * f + e1[2] * cx + e2[2] * sz);
          }
        }
      }
    } else {
      const n = 2400;
      for (let i = 0; i < n; i++) {
        const yy = 1 - (2 * (i + 0.5)) / n;
        const rr = Math.sqrt(1 - yy * yy);
        const th = i * 2.399963;
        mark(c.c[0] + Math.cos(th) * rr * c.r[0], c.c[1] + yy * c.r[1], c.c[2] + Math.sin(th) * rr * c.r[2]);
      }
    }
  }
  return { grid, nx, ny, nz, origin, cell: CELL };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** 구 위에 고르게 퍼진 방향들 (피보나치) */
const DIRS: Vec3[] = (() => {
  const n = 40;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.399963;
    out.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return out;
})();

/** 점유 격자 비트: 옷 */
export const OCC_CLOTH = 1;
/** 점유 격자 비트: 마네킹 */
export const OCC_FORM = 2;

/**
 * 점 p에서 법선 n 쪽 반구로 몇 갈래 걸어 보고, 가까이 막힌 방향이 많을수록 어둡게.
 * mask로 무엇에 가리는지 고름 (마네킹은 자기 몸에만: 반투명한 옷 아래가 지저분해 보이지 않게)
 */
export function occlusionAt(occ: Occupancy, p: Vec3, n: Vec3, reach = 11, mask = OCC_CLOTH | OCC_FORM): number {
  const { grid, nx, ny, nz, origin, cell } = occ;
  let sum = 0;
  let wsum = 0;
  const start = 1.3;
  for (const d of DIRS) {
    const cosv = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    if (cosv <= 0.12) continue;
    let hit = 0;
    for (let s = start; s <= reach; s += cell) {
      const ix = Math.floor((p[0] + n[0] * 0.4 + d[0] * s - origin[0]) / cell);
      const iy = Math.floor((p[1] + n[1] * 0.4 + d[1] * s - origin[1]) / cell);
      const iz = Math.floor((p[2] + n[2] * 0.4 + d[2] * s - origin[2]) / cell);
      if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) break;
      if (grid[(iy * nz + iz) * nx + ix]! & mask) {
        // 가까이 막힐수록 더 어둡게
        hit = 1 - (s - start) / (reach - start) * 0.55;
        break;
      }
    }
    sum += hit * cosv;
    wsum += cosv;
  }
  return wsum > 0 ? 1 - sum / wsum : 1;
}

/** 격자에서 입자의 바깥 법선 */
export function gridNormal(p: ClothPanel, x: Float32Array, i: number, j: number): Vec3 {
  const C = p.cols;
  const at = (ii: number, jj: number): Vec3 => {
    const ci = Math.max(0, Math.min(p.rings - 1, ii));
    const cj = p.closed ? ((jj % C) + C) % C : Math.max(0, Math.min(C - 1, jj));
    const k = (ci * C + cj) * 3;
    return [x[k]!, x[k + 1]!, x[k + 2]!];
  };
  const a = at(i, j - 1);
  const b = at(i, j + 1);
  const c = at(i - 1, j);
  const d = at(i + 1, j);
  const n = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [d[0] - c[0], d[1] - c[1], d[2] - c[2]]);
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [(n[0] / l) * p.orient, (n[1] / l) * p.orient, (n[2] / l) * p.orient];
}

function bakeAO(p: ClothPanel, x: Float32Array, occ: Occupancy): Float32Array {
  const out = new Float32Array(p.rings * p.cols);
  for (let i = 0; i < p.rings; i++) {
    for (let j = 0; j < p.cols; j++) {
      const k = i * p.cols + j;
      out[k] = occlusionAt(occ, [x[k * 3]!, x[k * 3 + 1]!, x[k * 3 + 2]!], gridNormal(p, x, i, j));
    }
  }
  // 이웃과 평균 (격자 무늬가 보이지 않게)
  const smooth = new Float32Array(out.length);
  for (let i = 0; i < p.rings; i++) {
    for (let j = 0; j < p.cols; j++) {
      let s = 0;
      let n = 0;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const ii = i + di;
          let jj = j + dj;
          if (ii < 0 || ii >= p.rings) continue;
          if (p.closed) jj = (jj + p.cols) % p.cols;
          else if (jj < 0 || jj >= p.cols) continue;
          s += out[ii * p.cols + jj]!;
          n++;
        }
      }
      smooth[i * p.cols + j] = s / n;
    }
  }
  return smooth;
}
