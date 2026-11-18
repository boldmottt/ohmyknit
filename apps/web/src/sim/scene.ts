import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DEFAULT_MAIN, type Palette } from '@knitcloset/knit-render';
import type { ArtPiece } from '../closet/assembledArt';
import { axisSheet, drape, ringSheet, type Draped, type Sheet } from './drape';
import { makeKnitMaterial, rowDataTexture } from './fabric';
import { neckRadius, radiusAt, smoothKeys, torsoKeys } from './form';
import { edgePath, patch } from './mesh';
import type { Layout, Ring, SimRole } from './shape';
import { pieceMaps, plainMaps, type KnitMaps } from './textures';

/**
 * 3D 조립 시뮬레이션 (CLO 3D처럼 패턴판을 바느질한 자리에 입혀 봄).
 *
 * 조각마다 입힌 면(drape.ts)을 만들고 그 조각의 코 격자대로 니트 재질(fabric.ts)을 입혀요.
 * 다 뜬 단까지는 불투명한 원단, 남은 단은 같은 무늬가 반투명하게 비치는 완성 모습.
 * 지금 뜨는 단에서 뜬 코까지 불투명하고, 그 자리에 줄바늘이 걸려 있어요.
 * 마네킹(몸통·팔, 모자는 머리)에 입혀서 조각들이 어떻게 이어지는지 보여 줍니다.
 */

export const GHOST_OPACITY = 0.3;

/** 텍스처는 같은 캔버스면 다시 올리지 않음 (렌더러마다 하나) */
export class TexCache {
  private map = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
  constructor(private aniso: number) {}
  get(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
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

const FORM_COLOR = 0xe4ddd4;
const WOOD_COLOR = 0xb48a5c;

function formMesh(sheet: Sheet, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(patch(sheet, 0, sheet.rows, 0, 1)!, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 옷보다 살짝 작게 줄인 고리 (마네킹이 옷 밖으로 나오지 않게) */
function fitted(keys: Ring[], limit?: (y: number) => [number, number] | null): Ring[] {
  const rings = smoothKeys(keys);
  if (!limit) return rings;
  return rings.map((r) => {
    const c = limit(r.t);
    return c ? { t: r.t, rx: Math.min(r.rx, c[0] * 0.94), rz: Math.min(r.rz, c[1] * 0.92) } : r;
  });
}

function hatStand(D: Draped, mat: THREE.Material, wood: THREE.Material): THREE.Group {
  const grp = new THREE.Group();
  const L = D.layout;
  const { rh, rv, rz, cy } = L.head!;
  const hat = [...L.roles].find(([, x]) => x === 'hat')![0];
  const tube = D.tubes.get(hat)!;
  // 머리: 위는 모자가 씌워진 타원, 아래(턱)는 조금 길게
  const head: Ring[] = [];
  for (let i = 0; i <= 14; i++) {
    const ang = -Math.PI / 2 + (Math.PI * i) / 14;
    const v = ang < 0 ? rv * 1.12 : rv;
    head.push({ t: cy + Math.sin(ang) * v, rx: Math.max(0.05, Math.cos(ang) * rh), rz: Math.max(0.05, Math.cos(ang) * rz) });
  }
  grp.add(formMesh(ringSheet(fitted(head, (y) => radiusAt(tube, y))), mat));
  // 모자 가게의 머리 받침: 목 → 받침대 → 나무 원판
  const ny = cy - rv * 0.86;
  const neck: Ring[] = [
    { t: ny - 13, rx: rh * 0.32, rz: rh * 0.32 },
    { t: ny - 8, rx: rh * 0.36, rz: rh * 0.36 },
    { t: ny - 4, rx: rh * 0.5, rz: rh * 0.55 },
    { t: ny + 3, rx: rh * 0.5, rz: rh * 0.56 },
  ];
  grp.add(formMesh(ringSheet(fitted(neck)), mat));
  const base = new THREE.Mesh(new THREE.CylinderGeometry(rh * 0.95, rh * 1.05, 1.6, 48), wood);
  base.position.set(0, ny - 13.6, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  grp.add(base);
  return grp;
}

/** 마네킹: 스웨터는 몸통·목·팔, 모자는 머리·목·받침 */
function mannequin(D: Draped): THREE.Group {
  const L = D.layout;
  const mat = new THREE.MeshStandardMaterial({ color: FORM_COLOR, roughness: 0.78, metalness: 0 });
  const wood = new THREE.MeshStandardMaterial({ color: WOOD_COLOR, roughness: 0.55 });
  if (L.isHat && L.head) {
    const stand = hatStand(D, mat, wood);
    stand.name = 'form';
    return stand;
  }
  const grp = new THREE.Group();
  grp.name = 'form';
  const find = (r: SimRole) => [...L.roles].find(([, x]) => x === r)?.[0];
  const body = find('body') ?? find('front');
  const back = find('back');
  const bodyTube = body ? D.tubes.get(body) : undefined;
  const backTube = back ? D.tubes.get(back) : undefined;
  const limit = (y: number): [number, number] | null => {
    const a = bodyTube ? radiusAt(bodyTube, y) : null;
    const b = backTube ? radiusAt(backTube, y) : null;
    return a && b ? [Math.min(a[0], b[0]), Math.min(a[1], b[1])] : a;
  };
  grp.add(formMesh(ringSheet(fitted(torsoKeys(L), limit)), mat));
  // 목 위 나무 마개
  const neck = neckRadius(L);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(neck * 0.55, neck * 0.62, 2.2, 32), wood);
  cap.position.set(0, L.topY + 24.2, 0);
  cap.castShadow = true;
  grp.add(cap);

  for (const side of ['sleeveL', 'sleeveR'] as const) {
    const s = find(side);
    const tube = s ? D.tubes.get(s) : undefined;
    const axis = s ? D.axes.get(s) : undefined;
    if (!tube || !axis) continue;
    const sorted = [...tube.rings].sort((a, b) => a.t - b.t);
    const last = sorted[sorted.length - 1]!;
    const keys: Ring[] = [
      { t: -9, rx: 0.2, rz: 0.2 },
      { t: -7.5, rx: 2.1, rz: 1.6 },
      { t: -4, rx: 2.4, rz: 1.9 },
      ...[0.05, 0.3, 0.55, 0.8, 0.98].map((f) => {
        const r = sorted[Math.round(f * (sorted.length - 1))]!;
        return { t: r.t, rx: r.rx * 0.76, rz: r.rz * 0.74 };
      }),
      { t: tube.length + 2.5, rx: last.rx * 0.7, rz: last.rz * 0.68 },
      { t: tube.length + 4.5, rx: 0.3, rz: 0.3 },
    ];
    grp.add(formMesh(axisSheet(fitted(keys, (y) => radiusAt(tube, y)), axis, 48), mat));
  }
  return grp;
}

/** 아무것도 안 입은 마네킹 (새 작품 자리) */
export function buildEmptyForm(): THREE.Group {
  const layout: Layout = {
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
  return mannequin({ layout, sheets: new Map(), tubes: new Map(), axes: new Map(), impliedYoke: null });
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
/** 예상 요크의 목둘레 고무단 단 수 */
const NECKBAND_ROWS = 7;

type Bin = { dispose(): void }[];

function knitMaterials(maps: KnitMaps, yarn: string, tex: TexCache, active: boolean, bin: Bin) {
  const rowData = rowDataTexture(maps.rowData, maps.rows);
  const base = { map: tex.get(maps.color, true), rowData, rows: maps.rows, yarn };
  const knit = makeKnitMaterial({ ...base, glow: active ? 0.16 : 0 });
  const inner = makeKnitMaterial({ ...base, side: THREE.BackSide, tint: 0x8f8780 });
  const ghost = makeKnitMaterial({ ...base, side: THREE.DoubleSide, opacity: active ? GHOST_OPACITY + 0.14 : GHOST_OPACITY, glow: active ? 0.25 : 0 });
  bin.push(rowData, knit, inner, ghost);
  return { knit, inner, ghost };
}

/** 조각 하나: 뜬 단은 원단, 남은 단은 반투명, 경계에 줄바늘 */
function pieceMeshes(p: ArtPiece, sheet: Sheet, mats: ReturnType<typeof knitMaterials>, active: boolean, bin: Bin, pickables: THREE.Mesh[]): THREE.Group {
  const pg = new THREE.Group();
  pg.userData.pieceId = p.piece.id;
  const R = sheet.rows;
  const done = Math.max(0, Math.min(R, p.completedRows));
  const cur = p.piece.rows[done];
  const part = cur && p.currentStitch ? Math.min(1, p.currentStitch / Math.max(1, cur.stitchesWorked)) : 0;
  const add = (g: THREE.BufferGeometry | null, m: THREE.Material, solid: boolean) => {
    if (!g) return;
    bin.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.userData.pieceId = p.piece.id;
    mesh.castShadow = solid;
    mesh.receiveShadow = solid;
    mesh.renderOrder = solid ? 0 : 2;
    pg.add(mesh);
    if (m !== mats.inner) pickables.push(mesh);
  };
  const both = (g: THREE.BufferGeometry | null) => {
    add(g, mats.knit, true);
    if (g) add(g.clone(), mats.inner, true);
  };
  // 뜬 단, 그리고 지금 단의 뜬 코 (오른쪽부터)
  both(patch(sheet, 0, done, 0, 1));
  both(part > 0 ? patch(sheet, done, done + 1, 1 - part, 1) : null);
  // 남은 단: 반투명 완성 모습
  add(part > 0 ? patch(sheet, done, done + 1, 0, 1 - part) : null, mats.ghost, false);
  add(patch(sheet, part > 0 ? done + 1 : done, R, 0, 1), mats.ghost, false);

  if (done > 0 && done < R) {
    const ng = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edgePath(sheet, done, 0.35), sheet.closed), sheet.closed ? 160 : 60, active ? 0.28 : 0.22, 8, sheet.closed);
    bin.push(ng);
    const needle = new THREE.Mesh(ng, NEEDLE);
    needle.castShadow = true;
    pg.add(needle);
  }
  return pg;
}

export function buildModel(pieces: ArtPiece[], palette: Palette, tex: TexCache, opts: ModelOptions): Model | null {
  const D = drape(pieces);
  if (D.sheets.size === 0) return null;
  const group = new THREE.Group();
  const pickables: THREE.Mesh[] = [];
  const bin: Bin = [];
  const yarn = palette[0] ?? { name: '', hex: DEFAULT_MAIN };

  for (const [p, sheet] of D.sheets) {
    if (sheet.rows === 0) continue;
    const active = opts.activeId === p.piece.id;
    const mats = knitMaterials(pieceMaps(p.piece, palette), yarn.hex, tex, active, bin);
    group.add(pieceMeshes(p, sheet, mats, active, bin, pickables));
  }

  // 도안에 요크가 없으면: 몸판과 소매가 어깨에서 이어질 예상 모습을 반투명으로
  if (D.impliedYoke) {
    const { sheet, rowStitches } = D.impliedYoke;
    const mats = knitMaterials(plainMaps(rowStitches, yarn, NECKBAND_ROWS), yarn.hex, tex, false, bin);
    const g = patch(sheet, 0, sheet.rows, 0, 1);
    if (g) {
      bin.push(g);
      const mesh = new THREE.Mesh(g, mats.ghost);
      mesh.renderOrder = 2;
      mesh.name = 'implied-yoke';
      group.add(mesh);
    }
  }

  if (opts.mannequin) {
    const form = mannequin(D);
    form.traverse((o) => {
      if (o instanceof THREE.Mesh) bin.push(o.geometry, o.material as THREE.Material);
    });
    group.add(form);
  }

  return {
    group,
    pickables,
    dispose() {
      for (const d of bin) d.dispose();
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
