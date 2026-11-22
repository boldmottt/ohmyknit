import type { FormMesh } from './formMesh';

/**
 * 마네킹 3D 모델을 높이마다 잘라 몸통·팔·다리를 나누고 자리를 찾아요.
 * (천 시뮬레이션은 몸을 '높이별 단면 + 팔다리 관'으로 보고 부딪혀서, 모델에서 같은 모양을 뽑아냄)
 *
 * 단위 cm, 모델 그대로 (발바닥 y = 0, 가운데 x = z = 0, +z 앞).
 */

/**
 * 한 높이의 단면: 삼각형이 평면과 만나는 선분들 [x1, z1, x2, z2, ...]와 선분마다 고리 번호
 * (끝점을 공유하는 선분끼리 한 고리 — 팔과 몸통이 x로 겹쳐도 따로 떨어져 있으면 다른 고리)
 */
export type Slice = { y: number; seg: Float32Array; loop: Int32Array; loops: Loop[]; /** 선분마다 잘린 두 모서리의 꼭짓점 4개 */ verts: Int32Array };
/** 고리 하나: 선분 번호들과 테두리 상자 */
export type Loop = { segs: number[]; x0: number; x1: number; z0: number; z1: number };

/** 단면: 높이, 가운데, 반너비 둘 (팔은 축에 수직으로 잰 값), rr = 축에서 가장 먼 꼭짓점까지 (팔만) */
export type Ring2 = { y: number; x: number; z: number; rx: number; rz: number; rr?: number };

export type FormFit = {
  step: number;
  slices: Slice[];
  height: number;
  /** 사타구니(두 다리가 붙는 곳) · 겨드랑이(팔이 몸통에서 떨어지는 곳) 높이 */
  crotch: number;
  armpit: number;
  /** 목에서 가장 가는 곳, 목 밑동(요크 목둘레 자리), 턱 끝 */
  neckMid: number;
  neckBase: { y: number; rx: number; rz: number };
  chin: number;
  /** 팔 (오른쪽 +x, 왼쪽 -x): 겨드랑이 아래 높이마다 가운데·반지름, 어깨·팔꿈치·손목 관절, 손끝 */
  arms: { side: 1 | -1; rings: Ring2[]; shoulder: [number, number, number]; elbow: [number, number, number]; wrist: [number, number, number]; tip: number }[];
  /** 다리: 사타구니 아래 높이마다 가운데·반지름 */
  legs: { side: 1 | -1; rings: Ring2[] }[];
  /** 꼭짓점마다 팔(1: 오른쪽 +x, -1: 왼쪽) 또는 몸(0) — 겨드랑이 아래 단면 고리로 나눔 */
  armLabel: Int8Array;
};

/** 모든 높이에서 자름 (step 간격) */
export function sliceForm(F: FormMesh, step: number): Slice[] {
  const P = F.pos;
  const I = F.index;
  let top = 0;
  for (let i = 1; i < P.length; i += 3) top = Math.max(top, P[i]!);
  const n = Math.floor(top / step) + 1;
  const buckets: number[][] = Array.from({ length: n + 1 }, () => []);
  for (let t = 0; t < I.length; t += 3) {
    const ya = P[I[t]! * 3 + 1]!;
    const yb = P[I[t + 1]! * 3 + 1]!;
    const yc = P[I[t + 2]! * 3 + 1]!;
    const lo = Math.ceil(Math.min(ya, yb, yc) / step);
    const hi = Math.floor(Math.max(ya, yb, yc) / step);
    for (let k = Math.max(0, lo); k <= Math.min(n, hi); k++) buckets[k]!.push(t);
  }
  const out: Slice[] = [];
  for (let k = 0; k <= n; k++) out.push(cutSlice(F, buckets[k]!, k * step));
  return out;
}

/**
 * 정한 높이들에서만 자름 (자세를 바꾼 모델의 어깨 높이처럼 일부만 다시 잴 때).
 * ys는 오름차순
 */
export function sliceAt(F: FormMesh, ys: number[]): Slice[] {
  const P = F.pos;
  const I = F.index;
  const buckets: number[][] = ys.map(() => []);
  // y 이상인 첫 칸
  const lower = (y: number) => {
    let lo = 0;
    let hi = ys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ys[mid]! < y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  // (넉넉히 담고 실제로 걸치는지는 cutSlice가 봄 — 꼭짓점이 자르는 높이 바로 근처면 빠지지 않게)
  for (let t = 0; t < I.length; t += 3) {
    const ya = P[I[t]! * 3 + 1]!;
    const yb = P[I[t + 1]! * 3 + 1]!;
    const yc = P[I[t + 2]! * 3 + 1]!;
    const hiY = Math.max(ya, yb, yc) + 0.01;
    for (let k = lower(Math.min(ya, yb, yc) - 0.01); k < ys.length && ys[k]! <= hiY; k++) buckets[k]!.push(t);
  }
  return ys.map((y, k) => cutSlice(F, buckets[k]!, y));
}

/** 삼각형들(tris: 첫 꼭짓점 번호 ×3)을 높이 y(+0.0001)에서 잘라 고리로 묶음 */
function cutSlice(F: FormMesh, tris: number[], y0: number): Slice {
  const P = F.pos;
  const I = F.index;
  const nv = P.length / 3;
  const y = y0 + 1e-4;
  const seg: number[] = [];
  const keys: number[] = [];
  const sv: number[] = [];
  for (const t of tris) {
    const pts: number[] = [];
    const ek: number[] = [];
    const ev: number[] = [];
    for (let e = 0; e < 3; e++) {
      const va = I[t + e]!;
      const vb = I[t + ((e + 1) % 3)]!;
      const a = va * 3;
      const b = vb * 3;
      const da = P[a + 1]! - y;
      const db = P[b + 1]! - y;
      if ((da < 0) !== (db < 0)) {
        const f = da / (da - db);
        pts.push(P[a]! + (P[b]! - P[a]!) * f, P[a + 2]! + (P[b + 2]! - P[a + 2]!) * f);
        ek.push(Math.min(va, vb) * nv + Math.max(va, vb));
        ev.push(va, vb);
      }
    }
    if (pts.length === 4) {
      seg.push(...pts);
      keys.push(ek[0]!, ek[1]!);
      sv.push(...ev);
    }
  }
  // 끝점(모서리)을 공유하는 선분끼리 한 고리
  const ns = seg.length / 4;
  const parent = Int32Array.from({ length: ns }, (_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const owner = new Map<number, number>();
  for (let i = 0; i < ns; i++) {
    for (const key of [keys[i * 2]!, keys[i * 2 + 1]!]) {
      const o = owner.get(key);
      if (o === undefined) owner.set(key, i);
      else parent[root(i)] = root(o);
    }
  }
  const loopOf = new Map<number, number>();
  const loops: Loop[] = [];
  const loop = new Int32Array(ns);
  for (let i = 0; i < ns; i++) {
    const r = root(i);
    let li = loopOf.get(r);
    if (li === undefined) {
      li = loops.length;
      loopOf.set(r, li);
      loops.push({ segs: [], x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
    }
    loop[i] = li;
    const L = loops[li]!;
    L.segs.push(i);
    L.x0 = Math.min(L.x0, seg[i * 4]!, seg[i * 4 + 2]!);
    L.x1 = Math.max(L.x1, seg[i * 4]!, seg[i * 4 + 2]!);
    L.z0 = Math.min(L.z0, seg[i * 4 + 1]!, seg[i * 4 + 3]!);
    L.z1 = Math.max(L.z1, seg[i * 4 + 1]!, seg[i * 4 + 3]!);
  }
  return { y: y0, seg: new Float32Array(seg), loop, loops, verts: new Int32Array(sv) };
}

/**
 * 높이마다 가운데에서 바깥으로 가장 먼 겉면까지의 거리 (각도 a ↔ φ = 2πa/A, 0 = +x, π/2 = +z 앞).
 * keep: 이 단면에서 쓸 선분 번호 (팔·다리를 뺀 몸통만)
 */
export function radial(s: Slice, keep: number[] | null, cx: number, cz: number, A: number): Float32Array {
  const r = new Float32Array(A);
  const list = keep ?? Array.from({ length: s.seg.length / 4 }, (_, i) => i);
  for (const i of list) {
    const ax = s.seg[i * 4]! - cx;
    const az = s.seg[i * 4 + 1]! - cz;
    const bx = s.seg[i * 4 + 2]! - cx;
    const bz = s.seg[i * 4 + 3]! - cz;
    let t0 = Math.atan2(az, ax);
    let t1 = Math.atan2(bz, bx);
    let d = t1 - t0;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    if (d < 0) {
      [t0, t1] = [t1, t0];
      d = -d;
    }
    const k0 = Math.ceil((t0 / (2 * Math.PI)) * A);
    const k1 = Math.floor(((t0 + d) / (2 * Math.PI)) * A);
    for (let k = k0; k <= k1; k++) {
      const th = (2 * Math.PI * k) / A;
      const ux = Math.cos(th);
      const uz = Math.sin(th);
      // 반직선과 선분이 만나는 거리
      const ex = bx - ax;
      const ez = bz - az;
      const den = ux * ez - uz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const tt = (ax * ez - az * ex) / den;
      const kk = ((k % A) + A) % A;
      if (tt > r[kk]!) r[kk] = tt;
    }
  }
  // 빈 각도는 이웃으로 메움
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 0; k < A; k++) {
      if (r[k]! > 0) continue;
      const a = r[(k + A - 1) % A]!;
      const b = r[(k + 1) % A]!;
      r[k] = a > 0 && b > 0 ? (a + b) / 2 : Math.max(a, b);
    }
  }
  return r;
}

/**
 * 바깥 고리들: 다른 고리 안에 들어간 고리(모델이 두께 있는 껍데기라 겉면 안쪽에 나란히 도는 속면)를 뺌
 */
export function outerLoops(s: Slice): Loop[] {
  const L = s.loops.filter((l) => l.segs.length >= 3);
  return L.filter((b) => !L.some((a) => a !== b && a.x0 <= b.x0 + 0.02 && a.x1 >= b.x1 - 0.02 && a.z0 <= b.z0 + 0.02 && a.z1 >= b.z1 - 0.02 && (a.x1 - a.x0) * (a.z1 - a.z0) > (b.x1 - b.x0) * (b.z1 - b.z0)));
}

const ringOfLoop = (y: number, l: { x0: number; x1: number; z0: number; z1: number }): Ring2 => ({ y, x: (l.x0 + l.x1) / 2, z: (l.z0 + l.z1) / 2, rx: (l.x1 - l.x0) / 2, rz: (l.z1 - l.z0) / 2 });
const union = (ls: Loop[]) => ls.reduce((a, q) => ({ x0: Math.min(a.x0, q.x0), x1: Math.max(a.x1, q.x1), z0: Math.min(a.z0, q.z0), z1: Math.max(a.z1, q.z1) }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
/** 가운데(x = 0)를 지나는 고리 = 몸통 (없으면 null) */
export const torsoLoop = (ls: Loop[]) => ls.filter((l) => l.x0 <= 0.3 && l.x1 >= -0.3).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0))[0] ?? null;

/** 모델에서 사타구니·겨드랑이·목·턱·팔·다리를 찾음 */
export function fitForm(F: FormMesh, step = 0.5): FormFit {
  const slices = sliceForm(F, step);
  // 키 = 가장 높은 꼭짓점 (마지막 단면은 정수리 위 빈 자리일 수 있음)
  let height = 0;
  for (let i = 1; i < F.pos.length; i += 3) height = Math.max(height, F.pos[i]!);
  const outer = slices.map(outerLoops);
  const kOf = (y: number) => Math.max(0, Math.min(slices.length - 1, Math.round(y / step)));
  // 사타구니: 아래에서 올라가며 가운데(x = 0)를 지나는 고리가 처음 생기는 높이
  let crotch = 0;
  for (let k = kOf(height * 0.3); k < slices.length; k++) {
    if (torsoLoop(outer[k]!)) {
      crotch = slices[k]!.y;
      break;
    }
  }
  // 겨드랑이: 팔 고리가 몸통 고리 양옆에 따로 있는 가장 높은 곳
  const sideLoops = (k: number, side: 1 | -1) => {
    const t = torsoLoop(outer[k]!);
    return outer[k]!.filter((l) => l !== t && Math.sign(l.x0 + l.x1) === side);
  };
  // (겨드랑이 틈이 막힌 한 줄은 건너뜀: 2cm 위까지 양쪽 팔이 다시 떨어져 있으면 계속 올라감)
  let armpit = crotch;
  const apart = (k: number) => sideLoops(k, 1).length > 0 && sideLoops(k, -1).length > 0;
  for (let k = kOf(crotch + 10); k < slices.length; k++) {
    if (apart(k)) armpit = slices[k]!.y;
    else if (slices[k]!.y > crotch + 25) {
      const ahead = Array.from({ length: Math.round(2 / step) }, (_, d) => k + 1 + d).some((q) => q < slices.length && apart(q));
      if (!ahead) break;
    }
  }
  // 가운데(x = 0)를 지나는 고리는 팔·다리가 아님 (몸통, 사타구니 아래 매달린 부분)
  const offCenter = (l: Loop) => !(l.x0 <= 0.3 && l.x1 >= -0.3);
  type Box = { x0: number; x1: number; z0: number; z1: number };
  const near = (l: Loop, b: Box, pad: number) => l.x1 >= b.x0 - pad && l.x0 <= b.x1 + pad && l.z1 >= b.z0 - pad && l.z0 <= b.z1 + pad;
  const area = (l: Box) => (l.x1 - l.x0) * (l.z1 - l.z0);
  // 다리: 사타구니 바로 아래 그쪽의 가장 큰 고리(허벅지)에서 시작해, 아래로 바로 위 단면 옆에 있는 가장 큰 고리를 따라감
  // (사타구니에 매달린 작은 덩어리나 손을 다리로 잡지 않게)
  const legs: FormFit['legs'] = [];
  const legLoop = new Map<string, Loop>();
  for (const side of [1, -1] as const) {
    const rings: Ring2[] = [];
    let prev: Box | null = null;
    for (let k = kOf(crotch) - 1; k >= 1; k--) {
      const ls = outer[k]!.filter((l) => offCenter(l) && Math.sign(l.x0 + l.x1) === side && (!prev || near(l, prev, 2)));
      const leg = ls.reduce<Loop | null>((a, b) => (!a || area(b) > area(a) ? b : a), null);
      if (!leg) {
        if (prev) break;
        continue;
      }
      rings.push(ringOfLoop(slices[k]!.y, leg));
      legLoop.set(`${side}:${k}`, leg);
      prev = leg;
    }
    legs.push({ side, rings });
  }
  // 팔: 겨드랑이 아래로 몸통 바깥 고리들(손가락까지 합침)을 손끝까지. 바로 위 단면 옆에 있는 고리만 따라가서
  // 사타구니·다리 쪽 덩어리를 팔로 잡지 않게 (사타구니 아래로는 그 높이의 다리 고리도 뺌).
  // 그 고리를 이루는 모서리의 꼭짓점은 팔, 겨드랑이 아래 나머지 고리의 꼭짓점은 몸으로 표시
  const nv = F.pos.length / 3;
  const armLabel = new Int8Array(nv);
  const marked = new Uint8Array(nv);
  for (let k = 1; k <= kOf(armpit); k++) {
    const sl = slices[k]!;
    for (const l of sl.loops) for (const si of l.segs) for (let e = 0; e < 4; e++) marked[sl.verts[si * 4 + e]!] = 1;
  }
  const arms: FormFit['arms'] = [];
  for (const side of [1, -1] as const) {
    const rings: Ring2[] = [];
    let prev: Box | null = null;
    for (let k = kOf(armpit); k >= 1; k--) {
      const y = slices[k]!.y;
      const leg = legLoop.get(`${side}:${k}`);
      const ls = sideLoops(k, side).filter((l) => offCenter(l) && l !== leg && (!prev || near(l, prev, 2.5)));
      if (!ls.length) {
        if (rings.length > 20) break;
        continue;
      }
      const u = union(ls);
      rings.push(ringOfLoop(y, u));
      prev = u;
      const sl = slices[k]!;
      for (const l of ls) for (const si of l.segs) for (let e = 0; e < 4; e++) armLabel[sl.verts[si * 4 + e]!] = side;
    }
    // 비스듬한 팔(넓게 벌린 A자세)은 수평 단면이 팔 방향으로 늘어나 보여서, 이웃 단면 가운데로 잰 기울기만큼 줄임
    // (팔에 수직인 굵기 → 천 부딪힘 관이 실제 팔 굵기)
    const K = Math.round(3 / step);
    const tilted = rings.map((r, i) => {
      const a = rings[Math.max(0, i - K)]!;
      const b = rings[Math.min(rings.length - 1, i + K)]!;
      const dy = Math.abs(a.y - b.y) || 1e-6;
      return { ...r, rx: r.rx * Math.max(0.6, dy / Math.hypot(a.x - b.x, dy)), rz: r.rz * Math.max(0.6, dy / Math.hypot(a.z - b.z, dy)) };
    });
    rings.splice(0, rings.length, ...tilted);
    const tip = rings.length ? rings[rings.length - 1]!.y : armpit;
    // 손목: 팔 아래쪽에서 가장 가는 곳 (손이 넓어지기 전)
    const len = armpit - tip;
    let wristI = 0;
    let best = Infinity;
    rings.forEach((r, i) => {
      const f = (armpit - r.y) / len;
      if (f > 0.5 && f < 0.85 && r.rx * r.rz < best) {
        best = r.rx * r.rz;
        wristI = i;
      }
    });
    const w = rings[wristI]!;
    const top = rings[0]!;
    // 어깨 관절: 겨드랑이 위 3.5cm, 위팔 축(겨드랑이 ~ 12cm 아래 단면 가운데)을 위로 이어서
    // (팔을 넓게 벌린 모델은 겨드랑이 높이의 팔 가운데가 관절보다 바깥에 있음)
    const low = rings.reduce((a, b) => (Math.abs(b.y - (armpit - 12)) < Math.abs(a.y - (armpit - 12)) ? b : a));
    const dyArm = top.y - low.y || 1;
    const shoulder: [number, number, number] = [top.x + ((top.x - low.x) / dyArm) * 3.5, armpit + 3.5, top.z + ((top.z - low.z) / dyArm) * 3.5];
    const wrist: [number, number, number] = [w.x, w.y, w.z];
    // 팔꿈치: 어깨~손목의 54% 자리의 팔 가운데
    const ey = shoulder[1] + (wrist[1] - shoulder[1]) * 0.54;
    const er = rings.reduce((a, b) => (Math.abs(b.y - ey) < Math.abs(a.y - ey) ? b : a));
    arms.push({ side, rings, shoulder, elbow: [er.x, er.y, er.z], wrist, tip });
  }
  // 목: 겨드랑이 위에서 너비×깊이가 가장 작은 곳, 그 아래로 1.3배 넓어지는 곳이 밑동
  const box = (y: number) => {
    const t = torsoLoop(outer[kOf(y)]!) ?? union(outer[kOf(y)]!);
    return { w: t.x1 - t.x0, d: t.z1 - t.z0, front: t.z1 };
  };
  let neckMid = armpit + 10;
  let minA = Infinity;
  for (let y = armpit + 8; y < height - 15; y += step) {
    const a = box(y);
    if (a.w * a.d < minA) {
      minA = a.w * a.d;
      neckMid = y;
    }
  }
  let nb = neckMid;
  while (nb > armpit && box(nb).w * box(nb).d < minA * 1.3) nb -= step;
  // 목이 짧고 굵어 바로 승모근으로 이어지는 몸은 그 자리가 이미 넓어서, 목 가장 가는 곳의 1.25배까지만 (요크 목둘레 자리)
  const mid = box(neckMid);
  const nbA = { ...box(nb), w: Math.min(box(nb).w, mid.w * 1.25), d: Math.min(box(nb).d, mid.d * 1.25) };
  // 턱 끝: 목 가장 가는 곳 위로 앞면이 2cm 넘게 튀어나오는 첫 높이
  const neckFront = box(neckMid).front;
  let chin = neckMid;
  for (let y = neckMid; y < height; y += step) {
    if (box(y).front > neckFront + 2) {
      chin = y;
      break;
    }
  }
  // 단면 사이에 끼어 표시가 안 된 꼭짓점(겨드랑이 아래)은 가장 가까운 표시된 이웃을 따름
  const nbr: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < F.index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = F.index[t + e]!;
      const b = F.index[t + ((e + 1) % 3)]!;
      nbr[a]!.push(b);
      nbr[b]!.push(a);
    }
  }
  const queue: number[] = [];
  for (let i = 0; i < nv; i++) if (marked[i]) queue.push(i);
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]!;
    for (const j of nbr[i]!) {
      if (marked[j] || F.pos[j * 3 + 1]! > armpit) continue;
      marked[j] = 1;
      armLabel[j] = armLabel[i]!;
      queue.push(j);
    }
  }
  // 팔 단면 굵기를 꼭짓점으로 다시 잼: 이웃 단면 가운데로 잡은 팔 축에 수직인 두 방향(앞뒤, 그와 수직)으로
  // 가장 먼 꼭짓점까지. 수평 단면의 테두리 상자는 비스듬한 팔에서 어긋나고, 천 부딪힘 관이 이보다 가늘면 살이 소매 밖으로 비침
  const K = Math.round(3 / step);
  for (const arm of arms) {
    const R = arm.rings;
    const at = new Map<number, number>();
    R.forEach((r, i) => at.set(Math.round(r.y / step), i));
    const frames = R.map((_, i) => {
      const a = R[Math.max(0, i - K)]!;
      const b = R[Math.min(R.length - 1, i + K)]!;
      let d: [number, number, number] = [a.x - b.x, a.y - b.y, a.z - b.z];
      const dl = Math.hypot(...d) || 1;
      d = [d[0] / dl, d[1] / dl, d[2] / dl];
      // 앞뒤 방향(z)에서 축 성분을 뺀 것, 그리고 축·앞뒤 둘 다에 수직인 것
      let za: [number, number, number] = [-d[2] * d[0], -d[2] * d[1], 1 - d[2] * d[2]];
      const zl = Math.hypot(...za) || 1;
      za = [za[0] / zl, za[1] / zl, za[2] / zl];
      const xa: [number, number, number] = [d[1] * za[2] - d[2] * za[1], d[2] * za[0] - d[0] * za[2], d[0] * za[1] - d[1] * za[0]];
      return { d, xa, za };
    });
    const ex = new Float32Array(R.length);
    const ez = new Float32Array(R.length);
    const er = new Float32Array(R.length);
    // 단면 가운데를 잇는 축을 따라 잰 자리 (겨드랑이 = 0, 손끝으로 갈수록 +)
    const cum = [0];
    for (let i = 1; i < R.length; i++) cum.push(cum[i - 1]! + Math.hypot(R[i]!.x - R[i - 1]!.x, R[i]!.y - R[i - 1]!.y, R[i]!.z - R[i - 1]!.z));
    const nearest = (s: number) => {
      let lo = 0;
      let hi = R.length - 1;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (cum[m]! < s) lo = m;
        else hi = m;
      }
      return Math.abs(cum[lo]! - s) <= Math.abs(cum[hi]! - s) ? lo : hi;
    };
    for (let v = 0; v < nv; v++) {
      if (armLabel[v] !== arm.side) continue;
      const i = at.get(Math.round(F.pos[v * 3 + 1]! / step));
      if (i === undefined) continue;
      const r = R[i]!;
      const f = frames[i]!;
      const rel = [F.pos[v * 3]! - r.x, F.pos[v * 3 + 1]! - r.y, F.pos[v * 3 + 2]! - r.z];
      const px = rel[0]! * f.xa[0] + rel[1]! * f.xa[1] + rel[2]! * f.xa[2];
      const pz = rel[0]! * f.za[0] + rel[1]! * f.za[1] + rel[2]! * f.za[2];
      // 비스듬한 팔은 수평 단면의 꼭짓점이 축을 따라 위아래로 퍼져 있어서, 축을 따라 잰 자리의 단면에 넣음
      const ax = rel[0]! * f.d[0] + rel[1]! * f.d[1] + rel[2]! * f.d[2];
      const j = nearest(cum[i]! - ax);
      ex[j] = Math.max(ex[j]!, Math.abs(px));
      ez[j] = Math.max(ez[j]!, Math.abs(pz));
      er[j] = Math.max(er[j]!, Math.hypot(px, pz));
    }
    R.forEach((r, i) => {
      if (ex[i]! > 0) r.rx = ex[i]!;
      if (ez[i]! > 0) r.rz = ez[i]!;
      if (er[i]! > 0) r.rr = er[i]!;
    });
  }
  return { step, slices, height, crotch, armpit, neckMid, neckBase: { y: nb, rx: nbA.w / 2, rz: nbA.d / 2 }, chin, arms, legs, armLabel };
}
