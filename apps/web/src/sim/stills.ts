import * as THREE from 'three';
import type { Palette } from '@knitcloset/knit-render';
import type { ArtPiece } from '../closet/assembledArt';
import { ensureCloth } from './drapeSim';
import { buildEmptyForm, buildModel, frameCamera, makeStage, TexCache } from './scene';

/**
 * 옷장에 걸 3D 정지 그림. 렌더러 하나를 돌려 쓰며 옷마다 한 장씩 찍어요 (WebGL 창을 여러 개 만들지 않게).
 * 같은 진행 상태면 다시 찍지 않습니다. WebGL이 없으면 null → 2D 그림을 씀.
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

export function stillKey(id: string, pieces: ArtPiece[], palette: Palette) {
  return `${id}|${palette.map((c) => c.hex).join('')}|${pieces.map((p) => `${p.piece.id}:${p.piece.rows.length}:${p.completedRows}.${p.currentStitch ?? 0}:${p.gauge.st}x${p.gauge.row}`).join(',')}`;
}

export function cachedStill(key: string) {
  return done.get(key);
}

/** 한 번에 한 장씩 차례로 찍음 */
export function renderStill(key: string, pieces: ArtPiece[], palette: Palette): Promise<string | null> {
  const hit = done.get(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    await new Promise((r) => setTimeout(r, 0));
    const r = getRig();
    if (!r) return null;
    // 천이 다 늘어진 모양으로 찍음 (계산은 워커에서, 한 번 하면 기억)
    await ensureCloth(pieces);
    const model = buildModel(pieces, palette, r.tex, { mannequin: true });
    if (!model) return null;
    try {
      r.stage.scene.add(model.group);
      const box = new THREE.Box3().setFromObject(model.group);
      r.stage.fit(box);
      frameCamera(r.camera, box, 0.42, 0.08, 1.0, 86);
      r.renderer.render(r.stage.scene, r.camera);
      const url = r.renderer.domElement.toDataURL('image/webp', 0.9);
      if (done.size > 60) done.clear();
      done.set(key, url);
      return url;
    } finally {
      r.stage.scene.remove(model.group);
      model.dispose();
    }
  });
  queue = job.catch(() => null);
  return job.catch(() => null);
}

/** 새 작품 자리: 빈 마네킹 한 장 */
export function renderEmptyStill(): Promise<string | null> {
  const key = 'empty-form';
  const hit = done.get(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    const r = getRig();
    if (!r) return null;
    const g = buildEmptyForm();
    try {
      r.stage.scene.add(g);
      const box = new THREE.Box3().setFromObject(g);
      r.stage.fit(box);
      frameCamera(r.camera, box, 0.42, 0.08, 1.0, 86);
      r.renderer.render(r.stage.scene, r.camera);
      const url = r.renderer.domElement.toDataURL('image/webp', 0.9);
      done.set(key, url);
      return url;
    } finally {
      r.stage.scene.remove(g);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
  });
  queue = job.catch(() => null);
  return job.catch(() => null);
}
