import * as THREE from 'three';
import type { Palette } from '@knitcloset/knit-render';
import type { ArtPiece } from '../closet/assembledArt';
import type { BodyKind } from './body';
import { ensureCloth } from './drapeSim';
import { buildEmptyForm, buildModel, frameCamera, makeStage, TexCache } from './scene';

/**
 * 옷장에 걸 3D 정지 그림. 렌더러 하나를 돌려 쓰며 옷마다 한 장씩 찍어요 (WebGL 창을 여러 개 만들지 않게).
 * 같은 진행 상태·같은 몸이면 다시 찍지 않습니다. WebGL이 없으면 null → 2D 그림을 씀.
 * 머리부터 옷 밑단 조금 아래까지 담고, 다리·받침은 잘려도 돼요 (옷장에서 아래가 흐려짐).
 */
export const STILL_W = 560;
export const STILL_H = 500;

type Rig = { renderer: THREE.WebGLRenderer; stage: ReturnType<typeof makeStage>; tex: TexCache; camera: THREE.PerspectiveCamera };
let rig: Rig | null | undefined;
const done = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

function getRig(): Rig | null {
  if (rig !== undefined) return rig;
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(STILL_W * 2, STILL_H * 2, false);
    renderer.setClearColor(0x000000, 0);
    const stage = makeStage(renderer);
    const camera = new THREE.PerspectiveCamera(22, STILL_W / STILL_H, 1, 3000);
    rig = { renderer, stage, tex: new TexCache(renderer.capabilities.getMaxAnisotropy()), camera };
  } catch {
    rig = null;
  }
  return rig;
}

export function stillKey(id: string, pieces: ArtPiece[], palette: Palette, kind: BodyKind = 'female') {
  return `${kind}|${id}|${palette.map((c) => c.hex).join('')}|${pieces.map((p) => `${p.piece.id}:${p.piece.rows.length}:${p.completedRows}.${p.currentStitch ?? 0}:${p.gauge.st}x${p.gauge.row}`).join(',')}`;
}

export function cachedStill(key: string) {
  return done.get(key);
}

function shoot(r: Rig, group: THREE.Object3D, focus: THREE.Box3, key: string): string {
  r.stage.scene.add(group);
  try {
    r.stage.fit(new THREE.Box3().setFromObject(group));
    frameCamera(r.camera, focus, 0.42, 0.08, 1.0, 86);
    r.renderer.render(r.stage.scene, r.camera);
    const url = r.renderer.domElement.toDataURL('image/webp', 0.9);
    if (done.size > 60) done.clear();
    done.set(key, url);
    return url;
  } finally {
    r.stage.scene.remove(group);
  }
}

/** 한 번에 한 장씩 차례로 찍음 */
export function renderStill(key: string, pieces: ArtPiece[], palette: Palette, kind: BodyKind = 'female'): Promise<string | null> {
  const hit = done.get(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    await new Promise((r) => setTimeout(r, 0));
    const r = getRig();
    if (!r) return null;
    // 천이 다 늘어진 모양으로 찍음 (계산은 워커에서, 한 번 하면 기억)
    await ensureCloth(pieces, kind);
    const model = buildModel(pieces, palette, r.tex, { mannequin: true, body: kind });
    if (!model) return null;
    try {
      return shoot(r, model.group, model.focus, key);
    } finally {
      model.dispose();
    }
  });
  queue = job.catch(() => null);
  return job.catch(() => null);
}

/** 새 작품 자리: 아무것도 안 입은 마네킹 한 장 */
export function renderEmptyStill(kind: BodyKind = 'female'): Promise<string | null> {
  const key = `empty-form|${kind}`;
  const hit = done.get(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    const r = getRig();
    if (!r) return null;
    // 마네킹 도형은 캐시가 갖고 있어서 여기서 버리지 않음
    const { group, focus } = buildEmptyForm(kind);
    return shoot(r, group, focus, key);
  });
  queue = job.catch(() => null);
  return job.catch(() => null);
}
