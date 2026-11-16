import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Palette } from '@knitcloset/knit-render';
import type { ArtPiece } from '../closet/assembledArt';
import { layoutOf, wrinkle, type Layout, type Ring, type SimRole, type Tube } from './shape';
import { pieceTextures } from './textures';

/**
 * 3D 조립 시뮬레이션 (CLO 3D처럼 패턴판을 바느질한 자리에 입혀 봄).
 *
 * 조각마다 원통(반원통·판)을 만들고 그 조각의 실제 니트 텍스처를 감아요.
 * 다 뜬 단까지는 불투명한 원단, 남은 단은 같은 무늬가 반투명하게 비치는 완성 모습.
 * 지금 뜨는 단에서 뜬 코까지 불투명하고, 그 자리에 줄바늘이 걸려 있어요.
 * 마네킹(몸통·팔, 모자는 머리)에 입혀서 조각들이 어떻게 이어지는지 보여 줍니다.
 */

export const GHOST_OPACITY = 0.3;

const tmp = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  p: new THREE.Vector3(),
  du: new THREE.Vector3(),
  dk: new THREE.Vector3(),
  n: new THREE.Vector3(),
};

/** 조각 표면의 한 점: u = 0..1 (가로 = 둘레), k = 0..R (단 경계, 소수 가능) */
function surface(tube: Tube, role: SimRole | 'form', u: number, k: number, out: THREE.Vector3, wr: boolean) {
  const R = tube.rings.length - 1;
  const kk = Math.max(0, Math.min(R, k));
  const k0 = Math.min(R - 1, Math.floor(kk));
  const f = kk - k0;
  const a = tube.rings[k0]!;
  const b = tube.rings[k0 + 1]!;
  const t = a.t + (b.t - a.t) * f;
  const rx = a.rx + (b.rx - a.rx) * f;
  const rz = a.rz + (b.rz - a.rz) * f;
  const cz = (a.cz ?? 0) + ((b.cz ?? 0) - (a.cz ?? 0)) * f;
  if (tube.kind === 'panel') return out.set((u - 0.5) * rx, t, Math.sin(u * Math.PI * 3 + t * 0.08) * 0.8);
  const phi = tube.kind === 'tube' ? Math.PI - 2 * Math.PI * u : role === 'back' ? -Math.PI * u : Math.PI - Math.PI * u;
  const d = wr && role !== 'form' ? wrinkle(role, phi, t, tube.length) : 0;
  return out.set((rx + d) * Math.cos(phi), t, (rz + d) * Math.sin(phi) + cz);
}

function czAt(tube: Tube, k: number) {
  const r = tube.rings[Math.max(0, Math.min(tube.rings.length - 1, Math.round(k)))];
  return r?.cz ?? 0;
}

/** u0..u1 × k0..k1 사각 조각면. 법선은 바깥쪽, 앞면도 바깥쪽 */
function patch(tube: Tube, role: SimRole | 'form', k0: number, k1: number, u0: number, u1: number, segTurn: number, wr = true) {
  if (k1 - k0 < 1e-6 || u1 - u0 < 1e-6) return null;
  const R = tube.rings.length - 1;
  const ks = [k0];
  for (let k = Math.floor(k0) + 1; k < k1 - 1e-6; k++) ks.push(k);
  ks.push(k1);
  const nu = Math.max(2, Math.ceil(segTurn * (u1 - u0)));
  const cols = nu + 1;
  const pos = new Float32Array(ks.length * cols * 3);
  const nor = new Float32Array(ks.length * cols * 3);
  const uv = new Float32Array(ks.length * cols * 2);
  const { a, b, p, du, dk, n } = tmp;
  const wrapU = tube.kind === 'tube';
  let i = 0;
  for (const k of ks) {
    for (let j = 0; j <= nu; j++) {
      const u = u0 + ((u1 - u0) * j) / nu;
      surface(tube, role, u, k, p, wr);
      const e = 1e-3;
      surface(tube, role, wrapU ? u - e : Math.max(0, u - e), k, a, wr);
      surface(tube, role, wrapU ? u + e : Math.min(1, u + e), k, b, wr);
      du.subVectors(b, a);
      surface(tube, role, u, Math.max(0, k - 0.05), a, wr);
      surface(tube, role, u, Math.min(R, k + 0.05), b, wr);
      dk.subVectors(b, a);
      n.crossVectors(du, dk).normalize();
      if (tube.kind === 'panel' ? n.z < 0 : n.x * p.x + n.z * (p.z - czAt(tube, k)) < 0) n.negate();
      pos.set([p.x, p.y, p.z], i * 3);
      nor.set([n.x, n.y, n.z], i * 3);
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
  // 앞면이 바깥을 보게: 첫 삼각형의 면 법선을 정점 법선과 비교해서 뒤집기
  const v = (q: number, out: THREE.Vector3) => out.set(pos[q * 3]!, pos[q * 3 + 1]!, pos[q * 3 + 2]!);
  const fa = v(idx[0]!, new THREE.Vector3());
  const fb = v(idx[1]!, new THREE.Vector3()).sub(fa);
  const fc = v(idx[2]!, new THREE.Vector3()).sub(fa);
  const fn = fb.cross(fc);
  const vn = new THREE.Vector3(nor[idx[0]! * 3]!, nor[idx[0]! * 3 + 1]!, nor[idx[0]! * 3 + 2]!);
  if (fn.dot(vn) < 0) {
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

/** 텍스처는 같은 캔버스면 다시 올리지 않음 (렌더러마다 하나) */
export class TexCache {
  private map = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
  constructor(private aniso: number) {}
  get(c: HTMLCanvasElement, srgb: boolean) {
    let t = this.map.get(c);
    if (!t) {
      t = new THREE.CanvasTexture(c);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = this.aniso;
      this.map.set(c, t);
      if (this.map.size > 40) {
        const [first, tex] = this.map.entries().next().value as [HTMLCanvasElement, THREE.CanvasTexture];
        tex.dispose();
        this.map.delete(first);
      }
    }
    return t;
  }
  dispose() {
    for (const t of this.map.values()) t.dispose();
    this.map.clear();
  }
}

function segOf(role: SimRole) {
  return role === 'sleeveL' || role === 'sleeveR' ? 64 : 128;
}

/** 키프레임 사이를 부드럽게 (Catmull-Rom) 채운 고리들 */
function smooth(keys: Ring[], steps = 6): Ring[] {
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
function radiusAt(tube: Tube, y: number): [number, number] | null {
  const rs = tube.rings;
  let best: Ring | null = null;
  for (const r of rs) if (!best || Math.abs(r.t - y) < Math.abs(best.t - y)) best = r;
  if (!best) return null;
  const minT = Math.min(rs[0]!.t, rs[rs.length - 1]!.t);
  const maxT = Math.max(rs[0]!.t, rs[rs.length - 1]!.t);
  if (y < minT - 0.5 || y > maxT + 0.5) return null;
  return [best.rx, best.rz];
}

const FORM_COLOR = 0xe4ddd4;

function formMesh(keys: Ring[], mat: THREE.Material, clamp?: (y: number) => [number, number] | null) {
  let rings = smooth(keys);
  if (clamp) {
    rings = rings.map((r) => {
      const c = clamp(r.t);
      return c ? { t: r.t, rx: Math.min(r.rx, c[0] * 0.94), rz: Math.min(r.rz, c[1] * 0.92) } : r;
    });
  }
  const g = patch({ kind: 'tube', rings, length: 0 }, 'form', 0, rings.length - 1, 0, 1, 64, false);
  const m = new THREE.Mesh(g!, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 마네킹: 스웨터는 몸통·목·팔, 모자는 머리·목·어깨 */
function mannequin(L: Layout): THREE.Group {
  const grp = new THREE.Group();
  grp.name = 'form';
  const mat = new THREE.MeshStandardMaterial({ color: FORM_COLOR, roughness: 0.78, metalness: 0 });
  const find = (r: SimRole) => [...L.roles].find(([, x]) => x === r)?.[0];

  if (L.isHat && L.head) {
    const { rh, rv, rz, cy } = L.head;
    const hat = find('hat')!;
    const tube = L.tubes.get(hat)!;
    // 머리: 위는 모자가 씌워진 타원, 아래(턱)는 조금 길게
    const head: Ring[] = [];
    for (let i = 0; i <= 14; i++) {
      const ang = -Math.PI / 2 + (Math.PI * i) / 14;
      const v = ang < 0 ? rv * 1.12 : rv;
      head.push({ t: cy + Math.sin(ang) * v, rx: Math.max(0.05, Math.cos(ang) * rh), rz: Math.max(0.05, Math.cos(ang) * rz) });
    }
    grp.add(formMesh(head, mat, (y) => radiusAt(tube, y)));
    // 모자 가게의 머리 받침: 목 → 받침대 → 나무 원판
    const ny = cy - rv * 0.86;
    grp.add(
      formMesh(
        [
          { t: ny - 13, rx: rh * 0.32, rz: rh * 0.32 },
          { t: ny - 8, rx: rh * 0.36, rz: rh * 0.36 },
          { t: ny - 4, rx: rh * 0.5, rz: rh * 0.55 },
          { t: ny + 3, rx: rh * 0.5, rz: rh * 0.56 },
        ],
        mat,
      ),
    );
    const base = new THREE.Mesh(new THREE.CylinderGeometry(rh * 0.95, rh * 1.05, 1.6, 48), new THREE.MeshStandardMaterial({ color: 0xb48a5c, roughness: 0.55 }));
    base.position.set(0, ny - 13.6, 0);
    base.castShadow = true;
    base.receiveShadow = true;
    grp.add(base);
    return grp;
  }

  const body = find('body') ?? find('front');
  const bodyTube = body ? L.tubes.get(body)! : null;
  const backTube = find('back') ? L.tubes.get(find('back')!)! : null;
  const Ty = L.topY;
  const rx = L.topRx * 0.92;
  const rz = L.topRz * 0.94;
  const neck = Math.max(4.2, rx * 0.3);
  // 어깨 끝이 소매 윗단(팔이 시작하는 곳)까지 오도록
  const shoulderRx = Math.max(rx * 1.1, L.shoulder ? Math.abs(L.shoulder[0]) - 0.5 : 0);
  const torso: Ring[] = [
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
  grp.add(
    formMesh(torso, mat, (y) => {
      const a = bodyTube ? radiusAt(bodyTube, y) : null;
      if (backTube && a) {
        const b = radiusAt(backTube, y);
        return b ? [Math.min(a[0], b[0]), Math.min(a[1], b[1])] : a;
      }
      return a;
    }),
  );
  // 목 위 나무 마개
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(neck * 0.55, neck * 0.62, 2.2, 32), new THREE.MeshStandardMaterial({ color: 0xb48a5c, roughness: 0.55 }));
  cap.position.set(0, Ty + 24.2, 0);
  cap.castShadow = true;
  grp.add(cap);

  for (const side of ['sleeveL', 'sleeveR'] as const) {
    const s = find(side);
    if (!s) continue;
    const tube = L.tubes.get(s)!;
    const pl = L.place.get(s)!;
    const sorted = [...tube.rings].sort((a, b) => a.t - b.t);
    const keys: Ring[] = [
      { t: -9, rx: 0.2, rz: 0.2 },
      { t: -7.5, rx: 2.1, rz: 1.6 },
      { t: -4, rx: 2.4, rz: 1.9 },
      ...[0.05, 0.3, 0.55, 0.8, 0.98].map((f) => {
        const r = sorted[Math.round(f * (sorted.length - 1))]!;
        return { t: r.t, rx: r.rx * 0.76, rz: r.rz * 0.74 };
      }),
      { t: tube.length + 2.5, rx: sorted[sorted.length - 1]!.rx * 0.7, rz: sorted[sorted.length - 1]!.rz * 0.68 },
      { t: tube.length + 4.5, rx: 0.3, rz: 0.3 },
    ];
    const arm = formMesh(keys, mat, (y) => radiusAt(tube, y));
    arm.position.set(...pl.origin);
    arm.rotation.z = pl.tilt;
    grp.add(arm);
  }
  return grp;
}

/** 아무것도 안 입은 마네킹 (새 작품 자리) */
export function buildEmptyForm(): THREE.Group {
  const L: Layout = {
    roles: new Map(),
    tubes: new Map(),
    place: new Map(),
    topY: 44,
    topRx: 16.5,
    topRz: 12.5,
    shoulder: null,
    isHat: false,
    head: null,
  };
  return mannequin(L);
}

export type ModelOptions = {
  mannequin: boolean;
  activeId?: string;
};

export type Model = {
  group: THREE.Group;
  /** 조각 메시 (누르면 그 조각을 찾는 데 씀) */
  pickables: THREE.Mesh[];
  dispose(): void;
};

const NEEDLE = new THREE.MeshStandardMaterial({ color: 0xdedee4, metalness: 0.92, roughness: 0.22 });

export function buildModel(pieces: ArtPiece[], palette: Palette, tex: TexCache, opts: ModelOptions): Model | null {
  const L = layoutOf(pieces);
  if (L.tubes.size === 0) return null;
  const group = new THREE.Group();
  const pickables: THREE.Mesh[] = [];
  const disposables: { dispose(): void }[] = [];

  for (const [p, role] of L.roles) {
    if (role === 'extra') continue;
    const tube = L.tubes.get(p)!;
    const pl = L.place.get(p)!;
    const R = p.piece.rows.length;
    if (R === 0) continue;
    const t = pieceTextures(p.piece, palette);
    const map = tex.get(t.color, true);
    const bump = tex.get(t.bump, false);
    const isActive = opts.activeId === p.piece.id;
    const knit = new THREE.MeshPhysicalMaterial({
      map,
      emissive: new THREE.Color(isActive ? 0xb5523b : 0x000000),
      emissiveIntensity: isActive ? 0.16 : 0,
      bumpMap: bump,
      bumpScale: 3,
      roughness: 0.95,
      sheen: 0.35,
      sheenRoughness: 0.7,
      sheenColor: new THREE.Color(palette[0]?.hex ?? '#ffffff').lerp(new THREE.Color(0xffffff), 0.5),
      side: THREE.FrontSide,
    });
    const inner = new THREE.MeshStandardMaterial({ map, color: 0x8f8780, roughness: 1, side: THREE.BackSide });
    const ghost = new THREE.MeshPhysicalMaterial({
      map,
      bumpMap: bump,
      bumpScale: 3,
      roughness: 0.92,
      transparent: true,
      opacity: isActive ? GHOST_OPACITY + 0.14 : GHOST_OPACITY,
      emissive: new THREE.Color(isActive ? 0xb5523b : 0x000000),
      emissiveIntensity: isActive ? 0.25 : 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    disposables.push(knit, inner, ghost);

    const pg = new THREE.Group();
    pg.position.set(...pl.origin);
    pg.rotation.z = pl.tilt;
    pg.userData.pieceId = p.piece.id;
    const seg = segOf(role);
    const done = Math.max(0, Math.min(R, p.completedRows));
    const cur = p.piece.rows[done];
    const part = cur && p.currentStitch ? Math.min(1, p.currentStitch / Math.max(1, cur.stitchesWorked)) : 0;
    const add = (g: THREE.BufferGeometry | null, m: THREE.Material, solid: boolean) => {
      if (!g) return;
      disposables.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.userData.pieceId = p.piece.id;
      mesh.castShadow = solid;
      mesh.receiveShadow = solid;
      if (solid) mesh.renderOrder = 0;
      else mesh.renderOrder = 2;
      pg.add(mesh);
      if (m !== inner) pickables.push(mesh);
    };
    // 뜬 단: 원단 + 안쪽
    const solid = patch(tube, role, 0, done, 0, 1, seg);
    add(solid, knit, true);
    if (solid) add(solid.clone(), inner, true);
    // 지금 단의 뜬 코 (오른쪽부터)
    const strip = part > 0 ? patch(tube, role, done, done + 1, 1 - part, 1, seg) : null;
    add(strip, knit, true);
    if (strip) add(strip.clone(), inner, true);
    // 남은 단: 반투명 완성 모습
    add(part > 0 ? patch(tube, role, done, done + 1, 0, 1 - part, seg) : null, ghost, false);
    add(patch(tube, role, part > 0 ? done + 1 : done, R, 0, 1, seg), ghost, false);

    // 줄바늘: 뜬 곳과 남은 곳 경계
    if (done > 0 && done < R) {
      const pts: THREE.Vector3[] = [];
      const N = tube.kind === 'tube' ? 72 : 36;
      for (let i = 0; i <= N; i++) {
        const u = tube.kind === 'tube' ? i / N : -0.06 + (1.12 * i) / N;
        const q = surface(tube, role, Math.max(0, Math.min(1, u)), done, new THREE.Vector3(), true);
        if (tube.kind !== 'panel') {
          const len = Math.hypot(q.x, q.z) || 1;
          q.x += (q.x / len) * 0.35;
          q.z += (q.z / len) * 0.35;
          if (u < 0 || u > 1) q.x += (u < 0 ? -1 : 1) * 1.2 * Math.sign(q.x || 1);
        } else q.z += 0.4;
        pts.push(q);
      }
      const closed = tube.kind === 'tube';
      if (closed) pts.pop();
      const ng = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), closed ? 160 : 60, opts.activeId === p.piece.id ? 0.28 : 0.22, 8, closed);
      disposables.push(ng);
      const needle = new THREE.Mesh(ng, NEEDLE);
      needle.castShadow = true;
      pg.add(needle);
    }
    group.add(pg);
  }

  if (opts.mannequin) {
    const form = mannequin(L);
    form.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        disposables.push(o.geometry);
        disposables.push(o.material as THREE.Material);
      }
    });
    group.add(form);
  }

  return {
    group,
    pickables,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** 조명·환경·바닥 그림자 (뷰어와 정지 그림이 같은 무대) */
export function makeStage(renderer: THREE.WebGLRenderer) {
  // 실 색이 바래지 않게 (ACES는 채도를 많이 빼서 버건디가 분홍처럼 보임)
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.32;
  const hemi = new THREE.HemisphereLight(0xfff6ee, 0xcfbfae, 0.7);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff4e8, 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.6;
  key.shadow.radius = 5;
  scene.add(key);
  scene.add(key.target);
  const rim = new THREE.DirectionalLight(0xffffff, 0.75);
  scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.ShadowMaterial({ opacity: 0.14 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  /** 모델 크기에 맞춰 빛·그림자·바닥을 맞춤 */
  const fit = (box: THREE.Box3) => {
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const r = Math.max(s.x, s.y, s.z);
    // 위에서 살짝 앞·왼쪽: 그림자가 옷 바로 아래에 짧게 떨어지게
    key.position.set(c.x - r * 0.45, c.y + r * 2.2, c.z + r * 0.75);
    key.target.position.copy(c);
    const cam = key.shadow.camera;
    cam.left = -r * 1.4;
    cam.right = r * 1.4;
    cam.top = r * 1.4;
    cam.bottom = -r * 1.4;
    cam.near = 1;
    cam.far = r * 6;
    cam.updateProjectionMatrix();
    rim.position.set(c.x + r, c.y + r * 0.6, c.z - r * 1.2);
    floor.position.set(c.x, box.min.y - 0.3, c.z);
    floor.scale.set(r * 1.3, r * 1.3, 1);
  };
  return {
    scene,
    fit,
    dispose() {
      env.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
    },
  };
}

/** 3/4 앞에서 보는 카메라를 모델에 맞춤 */
export function frameCamera(camera: THREE.PerspectiveCamera, box: THREE.Box3, az = 0.48, el = 0.14, margin = 1.08, minSize = 0) {
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  // 작은 옷(모자)도 실제 크기 비율로 보이게: 최소 크기만큼의 틀에 바닥을 맞춰 넣음
  if (minSize > 0) {
    s.set(Math.max(s.x, minSize * 0.9), Math.max(s.y, minSize), Math.max(s.z, minSize * 0.5));
    c.y = box.min.y + s.y / 2;
  }
  const fovV = (camera.fov * Math.PI) / 180;
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
  const w = Math.max(s.x, s.z) * 1.0;
  const dist = Math.max(s.y / 2 / Math.tan(fovV / 2), w / 2 / Math.tan(fovH / 2)) * margin + Math.max(s.x, s.z) * 0.5;
  camera.position.set(c.x + Math.sin(az) * dist * Math.cos(el), c.y + Math.sin(el) * dist, c.z + Math.cos(az) * dist * Math.cos(el));
  camera.near = dist / 50;
  camera.far = dist * 10;
  camera.lookAt(c);
  camera.updateProjectionMatrix();
  return { center: c, dist };
}
