// 마네킹 3D 모델(GLB) → 앱에 넣는 작은 바이너리 (src/sim/assets/*.bin)
//
//   node scripts/form-mesh.mjs <입력.glb> <출력.bin> [키 cm]
//
// - 노드 변환을 적용해 cm 단위, 발바닥 y = 0, 가운데 x = z = 0, 키를 맞춤
// - 같은 자리 꼭짓점을 하나로 (UV 이음 때문에 갈라진 것) — 법선은 앱에서 다시 계산
// - 매장 마네킹처럼 가슴 꼭지를 매끈하게 (가장 앞으로 나온 점 둘레를 부드럽게 폄)
// - 위치는 0.01cm 단위 16비트 정수, 삼각형 번호는 차이값 가변 길이로 압축
//
// 외부 패키지 없이 Node만으로 돌아가요.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath, heightArg] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node scripts/form-mesh.mjs <in.glb> <out.bin> [heightCm]');
  process.exit(1);
}
const HEIGHT = Number(heightArg ?? 178);

/* ── GLB 읽기 ── */
const buf = readFileSync(inPath);
let off = 12;
const chunks = [];
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  chunks.push(buf.subarray(off + 8, off + 8 + len));
  off += 8 + len;
}
const gltf = JSON.parse(chunks[0].toString('utf8'));
const bin = chunks[1];

function accessor(i) {
  const a = gltf.accessors[i];
  const bv = gltf.bufferViews[a.bufferView];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const o = bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
  return new T(bin.buffer.slice(o, o + a.count * n * T.BYTES_PER_ELEMENT));
}

/** 4x4 행렬 (열 우선, glTF 그대로) */
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function local(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, tx, ty, tz, 1];
  return r.map((v, i) => (i < 12 ? v * [sx, sx, sx, 1, sy, sy, sy, 1, sz, sz, sz, 1][i] : v));
}
// 메시가 달린 노드까지 내려가며 변환을 곱함
const parent = new Map();
gltf.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
const meshNode = gltf.nodes.findIndex((n) => n.mesh !== undefined);
let world = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (let k = meshNode; k !== undefined; k = parent.get(k)) world = mul(local(gltf.nodes[k]), world);

const prim = gltf.meshes[gltf.nodes[meshNode].mesh].primitives[0];
const P0 = accessor(prim.attributes.POSITION);
const I0 = accessor(prim.indices);

/* ── 같은 자리 꼭짓점 합치기 ── */
const nv0 = P0.length / 3;
const W = [];
for (let i = 0; i < nv0; i++) {
  const x = P0[i * 3];
  const y = P0[i * 3 + 1];
  const z = P0[i * 3 + 2];
  W.push([world[0] * x + world[4] * y + world[8] * z + world[12], world[1] * x + world[5] * y + world[9] * z + world[13], world[2] * x + world[6] * y + world[10] * z + world[14]]);
}
const remap = new Int32Array(nv0);
const seen = new Map();
const pos = [];
for (let i = 0; i < nv0; i++) {
  const key = W[i].map((v) => Math.round(v * 1e6)).join(',');
  let k = seen.get(key);
  if (k === undefined) {
    k = pos.length;
    seen.set(key, k);
    pos.push(W[i]);
  }
  remap[i] = k;
}
let tris = [];
for (let t = 0; t < I0.length; t += 3) {
  const a = remap[I0[t]];
  const b = remap[I0[t + 1]];
  const c = remap[I0[t + 2]];
  if (a !== b && b !== c && a !== c) tris.push([a, b, c]);
}

/* ── 겉면만 남기기 ──
 * 두께를 준 껍데기 모델이라 겉면 안쪽 0.3~0.4cm에 나란한 속면이 있고, 둘이 매끈하게 이어져 있어요.
 * 0.25cm 격자에 면을 찍어 벽을 세우고 바깥에서 공기를 채운 뒤, 면 바로 바깥(법선 쪽)이 바깥 공기인 삼각형만 남겨요.
 */
{
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pos) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], p[k])), (hi[k] = Math.max(hi[k], p[k]));
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const cell = size / 720; // 키 180cm면 0.25cm
  const pad = 3;
  const n = [0, 1, 2].map((k) => Math.ceil((hi[k] - lo[k]) / cell) + pad * 2);
  const idx = (x, y, z) => (z * n[1] + y) * n[0] + x;
  const grid = new Uint8Array(n[0] * n[1] * n[2]); // 1 벽, 2 바깥 공기
  const vox = (p) => [0, 1, 2].map((k) => Math.floor((p[k] - lo[k]) / cell) + pad);
  for (const [a, b, c] of tris) {
    const A = pos[a];
    const B = pos[b];
    const C = pos[c];
    const e = Math.max(Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), Math.hypot(C[0] - A[0], C[1] - A[1], C[2] - A[2]), Math.hypot(C[0] - B[0], C[1] - B[1], C[2] - B[2]));
    const m = Math.max(1, Math.ceil(e / (cell * 0.4)));
    for (let i = 0; i <= m; i++) {
      for (let j = 0; j <= m - i; j++) {
        const u = i / m;
        const v = j / m;
        const w = 1 - u - v;
        const [x, y, z] = vox([A[0] * w + B[0] * u + C[0] * v, A[1] * w + B[1] * u + C[1] * v, A[2] * w + B[2] * u + C[2] * v]);
        grid[idx(x, y, z)] = 1;
      }
    }
  }
  // 바깥에서 공기 채우기 (6방향)
  const stack = [idx(0, 0, 0)];
  grid[stack[0]] = 2;
  while (stack.length) {
    const q = stack.pop();
    const x = q % n[0];
    const y = Math.floor(q / n[0]) % n[1];
    const z = Math.floor(q / (n[0] * n[1]));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const X = x + dx;
      const Y = y + dy;
      const Z = z + dz;
      if (X < 0 || Y < 0 || Z < 0 || X >= n[0] || Y >= n[1] || Z >= n[2]) continue;
      const r = idx(X, Y, Z);
      if (grid[r] === 0) {
        grid[r] = 2;
        stack.push(r);
      }
    }
  }
  // 남은 공기 덩어리: 몸 속 빈 공간(가장 큰 덩어리)과 손가락 사이·겨드랑이처럼 벽에 막힌 좁은 틈(작은 덩어리)
  let hollow = -1;
  let hollowSize = 0;
  const label = new Int32Array(grid.length);
  let next = 3;
  for (let s = 0; s < grid.length; s++) {
    if (grid[s] !== 0 || label[s]) continue;
    const id = next++;
    const st = [s];
    label[s] = id;
    let size = 0;
    while (st.length) {
      const q = st.pop();
      size++;
      const x = q % n[0];
      const y = Math.floor(q / n[0]) % n[1];
      const z = Math.floor(q / (n[0] * n[1]));
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const X = x + dx;
        const Y = y + dy;
        const Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= n[0] || Y >= n[1] || Z >= n[2]) continue;
        const r = idx(X, Y, Z);
        if (grid[r] === 0 && !label[r]) {
          label[r] = id;
          st.push(r);
        }
      }
    }
    if (size > hollowSize) {
      hollowSize = size;
      hollow = id;
    }
  }
  console.log('air pockets', next - 3, 'hollow voxels', hollowSize);
  // 삼각형마다 법선 쪽으로 조금 나간 자리가 몸 속 빈 공간이면 속면 → 뺌
  const keepTri = tris.filter(([a, b, c]) => {
    const A = pos[a];
    const B = pos[b];
    const C = pos[c];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...nn) || 1;
    const cen = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    let inside = 0;
    let outside = 0;
    for (const d of [1.5, 2.5, 3.5]) {
      const [x, y, z] = vox([cen[0] + (nn[0] / l) * cell * d, cen[1] + (nn[1] / l) * cell * d, cen[2] + (nn[2] / l) * cell * d]);
      const q = idx(x, y, z);
      if (label[q] === hollow) inside++;
      else if (grid[q] !== 1) outside++;
    }
    return !(inside > 0 && outside === 0);
  });
  // 겨드랑이·손가락 사이처럼 좁은 틈에서는 겉면도 속면처럼 보일 수 있어서, 뺄 삼각형 중
  // 서로 이어진 가장 큰 덩어리(진짜 속면)만 빼고 작은 조각은 되살림
  {
    const keepSet = new Set(keepTri);
    const removed = tris.map((t, i) => (keepSet.has(t) ? -1 : i)).filter((i) => i >= 0);
    const edgeOwner = new Map();
    const isRemoved = new Uint8Array(tris.length);
    for (const i of removed) isRemoved[i] = 1;
    for (const i of removed) {
      const t = tris[i];
      for (let e = 0; e < 3; e++) {
        const a = t[e];
        const b = t[(e + 1) % 3];
        const k = Math.min(a, b) * pos.length + Math.max(a, b);
        let arr = edgeOwner.get(k);
        if (!arr) edgeOwner.set(k, (arr = []));
        arr.push(i);
      }
    }
    const comp = new Int32Array(tris.length).fill(-1);
    const sizes = [];
    for (const i of removed) {
      if (comp[i] >= 0) continue;
      const id = sizes.length;
      const st = [i];
      comp[i] = id;
      let size = 0;
      while (st.length) {
        const q = st.pop();
        size++;
        const t = tris[q];
        for (let e = 0; e < 3; e++) {
          const a = t[e];
          const b = t[(e + 1) % 3];
          for (const r of edgeOwner.get(Math.min(a, b) * pos.length + Math.max(a, b))) {
            if (comp[r] < 0) {
              comp[r] = id;
              st.push(r);
            }
          }
        }
      }
      sizes.push(size);
    }
    const big = sizes.indexOf(Math.max(...sizes));
    let restored = 0;
    for (const i of removed) {
      if (comp[i] !== big) {
        keepTri.push(tris[i]);
        restored++;
      }
    }
    console.log('removed groups', sizes.length, 'inner', sizes[big], 'restored', restored);
  }
  console.log('outer tris', keepTri.length, 'of', tris.length);
  // 쓰는 꼭짓점만
  const used = new Int32Array(pos.length).fill(-1);
  const kept = [];
  tris = keepTri.map((t) =>
    t.map((v) => {
      if (used[v] < 0) {
        used[v] = kept.length;
        kept.push(pos[v]);
      }
      return used[v];
    }),
  );
  pos.length = 0;
  pos.push(...kept);
  console.log('verts', pos.length);
}

/* ── cm, 발바닥 0, 가운데, 키 ── */
let lo = [Infinity, Infinity, Infinity];
let hi = [-Infinity, -Infinity, -Infinity];
for (const p of pos) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], p[k])), (hi[k] = Math.max(hi[k], p[k]));
const s = HEIGHT / (hi[1] - lo[1]);
// 앞뒤 가운데는 허리(키의 60~64%) 단면의 앞뒤 끝 가운데 (발끝·엉덩이 때문에 전체 상자 가운데는 치우침)
let w0 = Infinity;
let w1 = -Infinity;
for (const p of pos) {
  const f = (p[1] - lo[1]) / (hi[1] - lo[1]);
  if (f > 0.6 && f < 0.64 && Math.abs(p[0] - (lo[0] + hi[0]) / 2) < (hi[0] - lo[0]) * 0.2) (w0 = Math.min(w0, p[2])), (w1 = Math.max(w1, p[2]));
}
const zc = (w0 + w1) / 2;
for (const p of pos) {
  p[0] = (p[0] - (lo[0] + hi[0]) / 2) * s;
  p[1] = (p[1] - lo[1]) * s;
  p[2] = (p[2] - zc) * s;
}

/* ── 가슴 꼭지 매끈하게 ── */
const nv = pos.length;
const nbr = Array.from({ length: nv }, () => new Set());
for (const [a, b, c] of tris) {
  nbr[a].add(b).add(c);
  nbr[b].add(a).add(c);
  nbr[c].add(a).add(b);
}
function smoothAround(tip, R, iters) {
  const near = [];
  for (let i = 0; i < nv; i++) {
    const d = Math.hypot(pos[i][0] - tip[0], pos[i][1] - tip[1], pos[i][2] - tip[2]);
    if (d < R) near.push([i, (1 - (d / R) ** 2) ** 2]);
  }
  for (let it = 0; it < iters; it++) {
    const next = near.map(([i, w]) => {
      const n = [...nbr[i]];
      const avg = [0, 0, 0];
      for (const j of n) for (let k = 0; k < 3; k++) avg[k] += pos[j][k] / n.length;
      return [i, pos[i].map((v, k) => v + (avg[k] - v) * 0.6 * w)];
    });
    for (const [i, p] of next) pos[i] = p;
  }
  return near.length;
}
/** 4×4 연립방정식 (가우스 소거) */
function solve4(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[4] / r[i]);
}
/**
 * 가슴 꼭지 없애기: 꼭지에서 3.5~6cm 떨어진 가슴 둥근 면에 맞춘 공 위로 안쪽 점들을 옮겨, 가슴의 둥근 면은 살리고 꼭지만 지움
 */
function flattenNipple(tip) {
  const ring = [];
  for (let i = 0; i < nv; i++) {
    const d = Math.hypot(pos[i][0] - tip[0], pos[i][1] - tip[1], pos[i][2] - tip[2]);
    if (d > 3.5 && d < 6 && pos[i][2] > tip[2] - 5) ring.push(pos[i]);
  }
  // x² + y² + z² + Dx + Ey + Fz + G = 0 를 최소제곱으로
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const b = [0, 0, 0, 0];
  for (const [x, y, z] of ring) {
    const row = [x, y, z, 1];
    const rhs = -(x * x + y * y + z * z);
    for (let r = 0; r < 4; r++) {
      b[r] += row[r] * rhs;
      for (let c = 0; c < 4; c++) A[r][c] += row[r] * row[c];
    }
  }
  const [D, E, Fz, G] = solve4(A, b);
  const c = [-D / 2, -E / 2, -Fz / 2];
  const rho = Math.sqrt(c[0] ** 2 + c[1] ** 2 + c[2] ** 2 - G);
  let moved = 0;
  for (let i = 0; i < nv; i++) {
    const d = Math.hypot(pos[i][0] - tip[0], pos[i][1] - tip[1], pos[i][2] - tip[2]);
    if (d >= 4.4) continue;
    const t = Math.min(1, Math.max(0, (d - 3) / 1.4));
    const w = 1 - t * t * (3 - 2 * t);
    const v = [pos[i][0] - c[0], pos[i][1] - c[1], pos[i][2] - c[2]];
    const l = Math.hypot(...v) || 1;
    const on = [c[0] + (v[0] / l) * rho, c[1] + (v[1] / l) * rho, c[2] + (v[2] / l) * rho];
    pos[i] = pos[i].map((p, k) => p + (on[k] - p) * w);
    moved++;
  }
  return { rho, moved };
}
for (const side of [-1, 1]) {
  // 가슴 높이(키의 68~78%)에서 가장 앞으로 나온 점
  let best = -1;
  for (let i = 0; i < nv; i++) {
    const [x, y, z] = pos[i];
    if (Math.sign(x) !== side || Math.abs(x) < 3 || Math.abs(x) > 16) continue;
    if (y < HEIGHT * 0.68 || y > HEIGHT * 0.78) continue;
    if (best < 0 || z > pos[best][2]) best = i;
  }
  const tip = [...pos[best]];
  const f = flattenNipple(tip);
  // 공에 맞춘 자리와 그 바깥이 만나는 곳을 살짝 고르게
  smoothAround(tip, 5, 8);
  console.log('nipple', side, tip.map((v) => v.toFixed(1)).join(','), 'dome radius', f.rho.toFixed(1), 'moved', f.moved);
}

/* ── 쓰기 ── */
const Q = 0.01; // cm
const qpos = new Int16Array(nv * 3);
for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) qpos[i * 3 + k] = Math.round(pos[i][k] / Q);
const bytes = [];
let prev = 0;
for (const t of tris) {
  for (const v of t) {
    const d = v - prev;
    prev = v;
    let z = d >= 0 ? d * 2 : -d * 2 - 1; // 지그재그
    do {
      let b = z & 0x7f;
      z >>>= 7;
      if (z) b |= 0x80;
      bytes.push(b);
    } while (z);
  }
}
const head = Buffer.alloc(24);
head.write('KCFM', 0, 'ascii');
head.writeUInt32LE(1, 4);
head.writeUInt32LE(nv, 8);
head.writeUInt32LE(tris.length, 12);
head.writeFloatLE(Q, 16);
head.writeUInt32LE(bytes.length, 20);
const out = Buffer.concat([head, Buffer.from(qpos.buffer), Buffer.from(bytes)]);
writeFileSync(outPath, out);
console.log(`verts ${nv} tris ${tris.length} → ${out.length} bytes (${(out.length / 1024).toFixed(0)} KB)`);
