import type { Layout, Ring, Tube } from './shape';

/**
 * 마네킹 모양 (three.js 없이 숫자만). 옷이 마네킹 위에 얹히도록 옷 쪽 계산(drape)에서도 씀.
 */

/** 키프레임 사이를 부드럽게 (Catmull-Rom) 채운 고리들 */
export function smoothKeys(keys: Ring[], steps = 6): Ring[] {
  const out: Ring[] = [];
  const at = (i: number) => keys[Math.max(0, Math.min(keys.length - 1, i))]!;
  const cr = (p0: number, p1: number, p2: number, p3: number, s: number) =>
    0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s + (-p0 + 3 * p1 - 3 * p2 + p3) * s * s * s);
  for (let i = 0; i < keys.length - 1; i++) {
    for (let s = 0; s < steps; s++) {
      const f = s / steps;
      out.push({
        t: cr(at(i - 1).t, at(i).t, at(i + 1).t, at(i + 2).t, f),
        rx: Math.max(0.01, cr(at(i - 1).rx, at(i).rx, at(i + 1).rx, at(i + 2).rx, f)),
        rz: Math.max(0.01, cr(at(i - 1).rz, at(i).rz, at(i + 1).rz, at(i + 2).rz, f)),
      });
    }
  }
  out.push(keys[keys.length - 1]!);
  return out;
}

/** 옷 조각의 높이 y에서의 가로·세로 반지름 (마네킹이 옷 밖으로 나오지 않게) */
export function radiusAt(tube: Tube, y: number): [number, number] | null {
  const rs = tube.rings;
  let best: Ring | null = null;
  for (const r of rs) if (!best || Math.abs(r.t - y) < Math.abs(best.t - y)) best = r;
  if (!best) return null;
  const minT = Math.min(rs[0]!.t, rs[rs.length - 1]!.t);
  const maxT = Math.max(rs[0]!.t, rs[rs.length - 1]!.t);
  if (y < minT - 0.5 || y > maxT + 0.5) return null;
  return [best.rx, best.rz];
}

/** 목 굵기 */
export function neckRadius(L: Layout): number {
  return Math.max(4.2, L.topRx * 0.92 * 0.3);
}

/** 몸통: 받침 → 허리 → 가슴 → 어깨 → 목 */
export function torsoKeys(L: Layout): Ring[] {
  const Ty = L.topY;
  const rx = L.topRx * 0.92;
  const rz = L.topRz * 0.94;
  const neck = neckRadius(L);
  // 어깨 끝이 소매 윗단(팔이 시작하는 곳)까지 오도록
  const shoulderRx = Math.max(rx * 1.1, L.shoulder ? Math.abs(L.shoulder[0]) - 0.5 : 0);
  return [
    { t: -9, rx: 0.2, rz: 0.2 },
    { t: -7, rx: rx * 0.8, rz: rz * 0.82 },
    { t: -3, rx: rx * 0.96, rz: rz * 0.98 },
    { t: Ty * 0.45, rx: rx * 0.88, rz: rz * 0.9 },
    { t: Ty - 5, rx: rx * 0.98, rz: rz },
    { t: Ty + 2, rx: rx * 1.04, rz: rz * 0.96 },
    { t: Ty + 6.5, rx: shoulderRx, rz: rz * 0.84 },
    { t: Ty + 9.5, rx: shoulderRx * 0.92, rz: rz * 0.74 },
    { t: Ty + 11, rx: shoulderRx * 0.62, rz: rz * 0.6 },
    { t: Ty + 12.2, rx: neck * 1.5, rz: neck * 1.35 },
    { t: Ty + 13.5, rx: neck * 1.05, rz: neck },
    { t: Ty + 15, rx: neck, rz: neck * 0.95 },
    { t: Ty + 22, rx: neck * 0.94, rz: neck * 0.9 },
    { t: Ty + 23.2, rx: neck * 0.5, rz: neck * 0.5 },
    { t: Ty + 23.6, rx: 0.1, rz: 0.1 },
  ];
}

/** 높이 y, 방향 theta(위에서 본 각도)에서 몸통 겉면까지의 거리. 몸통 밖 높이면 0 */
export function torsoReach(rings: Ring[], theta: number, y: number): number {
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    if (y < a.t || y > b.t || b.t <= a.t) continue;
    const f = (y - a.t) / (b.t - a.t);
    const rx = a.rx + (b.rx - a.rx) * f;
    const rz = a.rz + (b.rz - a.rz) * f;
    return (rx * rz) / Math.hypot(rz * Math.cos(theta), rx * Math.sin(theta));
  }
  return 0;
}
