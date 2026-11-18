import * as THREE from 'three';
import type { Sheet, Vec3 } from './drape';

/** 면(Sheet)의 u0..u1 × k0..k1 사각 조각을 메시로. 법선과 앞면은 바깥쪽 */
export function patch(sheet: Sheet, k0: number, k1: number, u0: number, u1: number): THREE.BufferGeometry | null {
  if (k1 - k0 < 1e-6 || u1 - u0 < 1e-6) return null;
  const R = sheet.rows;
  const ks = [k0];
  for (let k = Math.floor(k0) + 1; k < k1 - 1e-6; k++) ks.push(k);
  ks.push(k1);
  const nu = Math.max(2, Math.ceil(sheet.segs * (u1 - u0)));
  const cols = nu + 1;
  const count = ks.length * cols;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const eu = 1e-3;
  const ek = 0.05;
  const edge = (u: number) => (sheet.closed ? u : Math.max(0, Math.min(1, u)));
  let i = 0;
  for (const k of ks) {
    for (let j = 0; j <= nu; j++) {
      const u = u0 + ((u1 - u0) * j) / nu;
      const p = sheet.at(u, k);
      const a = sheet.at(edge(u - eu), k);
      const b = sheet.at(edge(u + eu), k);
      const c = sheet.at(u, Math.max(0, k - ek));
      const d = sheet.at(u, Math.min(R, k + ek));
      const n = cross(sub(b, a), sub(d, c));
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      // 안쪽 점에서 멀어지는 쪽이 바깥
      const sign = dot(n, sub(p, sheet.inside(u, k))) < 0 ? -1 : 1;
      pos.set(p, i * 3);
      nor.set([(n[0] / len) * sign, (n[1] / len) * sign, (n[2] / len) * sign], i * 3);
      uv.set([u, R > 0 ? k / R : 0], i * 2);
      i++;
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < ks.length - 1; r++) {
    for (let j = 0; j < nu; j++) {
      const A = r * cols + j;
      const B = A + 1;
      const C = A + cols;
      const D = C + 1;
      idx.push(A, B, C, B, D, C);
    }
  }
  // 앞면이 바깥을 보게: 가운데 삼각형의 면 법선을 정점 법선과 비교해서 뒤집기
  const mid = Math.floor(idx.length / 6) * 3;
  const v = (q: number): Vec3 => [pos[q * 3]!, pos[q * 3 + 1]!, pos[q * 3 + 2]!];
  const fa = v(idx[mid]!);
  const face = cross(sub(v(idx[mid + 1]!), fa), sub(v(idx[mid + 2]!), fa));
  const vn: Vec3 = [nor[idx[mid]! * 3]!, nor[idx[mid]! * 3 + 1]!, nor[idx[mid]! * 3 + 2]!];
  if (dot(face, vn) < 0) {
    for (let q = 0; q < idx.length; q += 3) {
      const s = idx[q + 1]!;
      idx[q + 1] = idx[q + 2]!;
      idx[q + 2] = s;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** 줄바늘이 지나는 자리: k단 가장자리를 따라 바깥으로 lift만큼 띄운 점들 */
export function edgePath(sheet: Sheet, k: number, lift: number): THREE.Vector3[] {
  const n = sheet.closed ? 72 : 36;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    // 평면뜨기는 바늘 끝이 가장자리 밖으로 조금 나옴
    const u = sheet.closed ? i / n : -0.05 + (1.1 * i) / n;
    const uc = Math.max(0, Math.min(1, u));
    const p = sheet.at(uc, k);
    const out = sub(p, sheet.inside(uc, k));
    const len = Math.hypot(out[0], out[1], out[2]) || 1;
    const q = new THREE.Vector3(p[0] + (out[0] / len) * lift, p[1] + (out[1] / len) * lift, p[2] + (out[2] / len) * lift);
    if (u !== uc) {
      const next = sheet.at(u < 0 ? 0.02 : 0.98, k);
      q.x += (p[0] - next[0]) * 2.5 * Math.abs(u - uc) * 50;
      q.z += (p[2] - next[2]) * 2.5 * Math.abs(u - uc) * 50;
    }
    pts.push(q);
  }
  if (sheet.closed) pts.pop();
  return pts;
}
