import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DEFAULT_MAIN, type Palette } from '@knitcloset/knit-render';
import type { ArtPiece } from '../closet/assembledArt';
import type { Sheet } from './drape';
import { bodyOf, emptyBody, limbSheet, loftSheet, type BodyKind, type BodyModel } from './body';
import type { Occupancy } from './cloth';
import { makeKnitMaterial, rowDataTexture } from './fabric';
import { addOcclusion, edgePath, patch } from './mesh';
import { clothDraped, drapeFor, shapeKey, withOcclusion } from './drapeSim';
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

/** 마네킹: 매장 마네킹처럼 무광 회색 */
const FORM_COLOR = 0xbdbdbb;
const POLE_COLOR = 0x9a9aa2;
/** 발밑 판: 마네킹보다 조금 진한 회색 */
const BASE_COLOR = 0x9d9d9b;
/** 이음선: 마네킹 겉면의 가는 홈 */
const SEAM_COLOR = 0x8c8c8a;

function formMesh(sheet: Sheet, mat: THREE.Material, occ: Occupancy | undefined, name: string): THREE.Mesh {
  const m = new THREE.Mesh(patch(occ ? withOcclusion(sheet, occ) : sheet, 0, sheet.rows, 0, 1)!, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.name = name;
  return m;
}

function formMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({ color: FORM_COLOR, roughness: 0.62, metalness: 0, clearcoat: 0.06, clearcoatRoughness: 0.6 });
  mat.onBeforeCompile = (shader) => addOcclusion(shader, 0.75);
  mat.customProgramCacheKey = () => 'form-ao-2';
  return mat;
}

/** 같은 몸이면 다시 만들지 않음 (+1 할 때마다 마네킹 그늘까지 다시 계산하지 않게) */
const formCache = new Map<string, THREE.Group>();

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}

/** 사람 모양 마네킹: 몸통·머리(단면 쌓기), 팔·손·손가락·다리·발(관), 이음선, 발밑 판 */
function bodyGroup(b: BodyModel, occ: Occupancy | undefined, key: string): THREE.Group {
  const hit = formCache.get(key);
  if (hit) return hit.clone();
  const grp = new THREE.Group();
  grp.name = 'form';
  const mat = formMaterial();
  if (b.torso) grp.add(formMesh(loftSheet(b.torso, 128), mat, occ, 'torso'));
  grp.add(formMesh(loftSheet(b.head, 144), mat, occ, 'head'));
  for (const arm of b.arms) grp.add(formMesh(limbSheet(arm, 56), mat, occ, 'arm'));
  for (const hand of b.hands) grp.add(formMesh(limbSheet(hand, 48), mat, occ, 'hand'));
  for (const limb of b.limbs) grp.add(formMesh(limbSheet(limb, 48), mat, occ, 'limb'));
  for (const d of b.details) grp.add(formMesh(limbSheet(d, 24), mat, occ, 'detail'));
  if (b.seams.length) {
    const seamMat = new THREE.MeshStandardMaterial({ color: SEAM_COLOR, roughness: 0.8 });
    for (const line of b.seams) {
      const pts = line.map((p) => new THREE.Vector3(...p));
      const closed = pts.length > 2 && pts[0]!.distanceTo(pts[pts.length - 1]!) < 1e-6;
      if (closed) pts.pop();
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed, 'centripetal'), pts.length * 2, 0.08, 5, closed);
      const m = new THREE.Mesh(g, seamMat);
      m.name = 'seam';
      grp.add(m);
    }
  }
  if (b.pole) {
    const { a, b: e, r } = b.pole;
    const len = Math.hypot(e[0] - a[0], e[1] - a[1], e[2] - a[2]);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 20), new THREE.MeshStandardMaterial({ color: POLE_COLOR, metalness: 0.85, roughness: 0.3 }));
    pole.position.set((a[0] + e[0]) / 2, (a[1] + e[1]) / 2, (a[2] + e[2]) / 2);
    pole.castShadow = true;
    pole.name = 'pole';
    grp.add(pole);
  }
  if (b.base) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(b.base.r * 0.97, b.base.r, b.base.h, 64), new THREE.MeshStandardMaterial({ color: BASE_COLOR, roughness: 0.45, metalness: 0.1 }));
    base.position.set(...b.base.c);
    base.castShadow = true;
    base.receiveShadow = true;
    base.name = 'base';
    grp.add(base);
  }
  formCache.set(key, grp);
  if (formCache.size > 10) {
    const [first, old] = formCache.entries().next().value as [string, THREE.Group];
    formCache.delete(first);
    disposeGroup(old);
  }
  return grp.clone();
}

/** 보이는 부분: 몸통·머리·팔 (허벅지·받침 빼고) */
function formFocus(g: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && (o.name === 'torso' || o.name === 'head' || o.name === 'arm')) box.expandByObject(o);
  });
  return box;
}

/** 아무것도 안 입은 마네킹 (새 작품 자리) */
export function buildEmptyForm(kind: BodyKind = 'female'): { group: THREE.Group; focus: THREE.Box3 } {
  const group = bodyGroup(emptyBody(kind), undefined, `empty|${kind}`);
  const focus = formFocus(group);
  // 허리 아래 조금까지
  focus.min.y = Math.max(focus.min.y, focus.max.y - 82);
  return { group, focus };
}

export type ModelOptions = {
  mannequin: boolean;
  /** 입힐 몸 (여자·남자) */
  body?: BodyKind;
  activeId?: string;
};

export type Model = {
  group: THREE.Group;
  /** 조각 메시 (누르면 그 조각을 찾는 데 씀) */
  pickables: THREE.Mesh[];
  /** 카메라가 담을 범위: 옷과 머리 (마네킹 다리·받침은 빼고) */
  focus: THREE.Box3;
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

/** 원단 두께의 반 (cm): 밑단·소맷부리·목둘레가 종이처럼 얇게 잘려 보이지 않게 둥글게 감은 가장자리 */
const EDGE_R = 0.22;

/** 주름 그늘 값이 없는 도형(관)에는 1(트인 곳)을 채움: 셰이더가 0으로 읽어 까맣게 되지 않게 */
function openSky(g: THREE.BufferGeometry) {
  g.setAttribute('occlusion', new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count).fill(1), 1));
  return g;
}

/**
 * k단 가장자리를 따라 감은 관 (원단 두께). 코 격자 좌표(uv)를 그 단에 맞춰서
 * 니트 재질이 가장자리에도 같은 코·같은 색으로 이어져요.
 */
function edgeRoll(sheet: Sheet, k: number): THREE.BufferGeometry {
  const n = sheet.closed ? 160 : 80;
  const pts: THREE.Vector3[] = [];
  const us: number[] = [];
  for (let i = 0; i <= n; i++) {
    if (sheet.closed && i === n) break;
    const u = i / n;
    const p = sheet.at(u, k);
    const q = sheet.inside(u, k);
    // 가장자리 바로 안쪽으로 반만큼: 겉으로 반, 안으로 반 튀어나온 두께
    const out = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const l = Math.hypot(out[0]!, out[1]!, out[2]!) || 1;
    pts.push(new THREE.Vector3(p[0] - (out[0]! / l) * EDGE_R * 0.4, p[1] - (out[1]! / l) * EDGE_R * 0.4, p[2] - (out[2]! / l) * EDGE_R * 0.4));
    us.push(u);
  }
  const seg = sheet.closed ? n * 2 : n * 2;
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, sheet.closed, 'centripetal'), seg, EDGE_R, 8, sheet.closed);
  const uv = g.attributes.uv!;
  const v = sheet.rows > 0 ? Math.min(1, Math.max(0, k / sheet.rows)) : 0;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), k === 0 ? v + 0.25 / Math.max(1, sheet.rows) : v - 0.25 / Math.max(1, sheet.rows));
  return openSky(g);
}

/** 조각 하나: 뜬 단은 원단, 남은 단은 반투명, 경계에 줄바늘 */
function pieceMeshes(
  p: ArtPiece,
  sheet: Sheet,
  mats: ReturnType<typeof knitMaterials>,
  active: boolean,
  bin: Bin,
  pickables: THREE.Mesh[],
  /** 꿰매지 않은 가장자리 (단 번호 0 또는 R) */
  edges: number[],
): THREE.Group {
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

  // 원단 두께: 뜬 가장자리는 원단, 아직 안 뜬 가장자리는 반투명
  for (const k of edges) {
    const knitted = k === 0 ? done >= 1 : done >= R;
    add(edgeRoll(sheet, k), knitted ? mats.knit : mats.ghost, knitted);
  }

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
  // 천 시뮬레이션을 마쳤으면 늘어뜨린 모양, 아직이면 계산한 모양 (둘 다 고른 몸에 맞춤)
  const kind = opts.body ?? 'female';
  const D = clothDraped(pieces, kind) ?? drapeFor(pieces, kind, true);
  if (D.sheets.size === 0) return null;
  const group = new THREE.Group();
  const pickables: THREE.Mesh[] = [];
  const bin: Bin = [];
  const yarn = palette[0] ?? { name: '', hex: DEFAULT_MAIN };

  const roles = D.layout.roles;
  const hasYoke = !!D.impliedYoke || [...roles.values()].includes('yoke');
  for (const [p, sheet] of D.sheets) {
    if (sheet.rows === 0) continue;
    const active = opts.activeId === p.piece.id;
    const mats = knitMaterials(pieceMaps(p.piece, palette), yarn.hex, tex, active, bin);
    // 아래쪽 끝(밑단·소맷부리·챙)과, 요크가 없으면 위쪽 끝도 그대로 드러난 가장자리
    const role = roles.get(p);
    const R = sheet.rows;
    const lowK = sheet.at(0.25, 0)[1] <= sheet.at(0.25, R)[1] ? 0 : R;
    const edges: number[] = [];
    if (role === 'yoke') edges.push(R - lowK);
    else if (role === 'hat') edges.push(lowK);
    else {
      edges.push(lowK);
      if (!hasYoke) edges.push(R - lowK);
    }
    group.add(pieceMeshes(p, sheet, mats, active, bin, pickables, edges));
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
      // 목둘레 가장자리 두께
      const neck = edgeRoll(sheet, sheet.at(0.25, 0)[1] <= sheet.at(0.25, sheet.rows)[1] ? sheet.rows : 0);
      bin.push(neck);
      const nm = new THREE.Mesh(neck, mats.ghost);
      nm.renderOrder = 2;
      group.add(nm);
    }
  }

  // 카메라 범위: 옷 + 머리 (다리·받침은 화면 밖으로 잘려도 됨)
  const focus = new THREE.Box3().setFromObject(group);
  const body = bodyOf(kind, D.layout, D.tubes, D.axes);
  if (body) {
    focus.max.y = Math.max(focus.max.y, body.top + 1.5);
    if (!body.torso) focus.min.y = Math.min(focus.min.y, body.head.y[0]! - 2);
    else focus.min.y -= 6;
    if (opts.mannequin) group.add(bodyGroup(body, D.occ, `${shapeKey(pieces, kind)}|${D.occ ? 'occ' : ''}`));
  }

  return {
    group,
    pickables,
    focus,
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
  scene.environmentIntensity = 0.3;
  // 스튜디오 조명: 왼쪽 위 앞에서 주광(그림자), 오른쪽에서 약한 보조광, 뒤에서 윤곽광
  const hemi = new THREE.HemisphereLight(0xfff6ee, 0xcbb9a6, 0.5);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xf3f0ff, 0.45);
  scene.add(fill);
  const key = new THREE.DirectionalLight(0xfff4e8, 2.7);
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
    // 왼쪽 위 앞: 옆으로 비껴 들어와 주름의 굴곡이 드러나고, 그림자는 옷 아래에 짧게
    key.position.set(c.x - r * 1.05, c.y + r * 1.9, c.z + r * 0.95);
    fill.position.set(c.x + r * 1.2, c.y + r * 0.35, c.z + r * 0.7);
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
