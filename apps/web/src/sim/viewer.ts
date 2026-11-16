import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Palette } from '@knitcloset/knit-render';
import type { ArtPiece } from '../closet/assembledArt';
import { buildModel, frameCamera, makeStage, TexCache, type Model, type ModelOptions } from './scene';

/**
 * 드래그로 돌려 보는 3D 뷰어. 진행이 바뀌면(+1) 모양만 다시 만들고 카메라는 그대로 둬요.
 * 화면에 안 보이면 그리기를 멈춰 배터리를 아낍니다.
 */
export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(24, 1, 1, 2000);
  private controls: OrbitControls;
  private stage: ReturnType<typeof makeStage>;
  private tex: TexCache;
  private model: Model | null = null;
  private shapeKey = '';
  private raf = 0;
  private visible = true;
  private io: IntersectionObserver;
  private ro: ResizeObserver;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private down: { x: number; y: number } | null = null;

  constructor(
    private host: HTMLElement,
    private onPick?: (pieceId: string) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    host.appendChild(this.renderer.domElement);
    this.stage = makeStage(this.renderer);
    this.tex = new TexCache(this.renderer.capabilities.getMaxAnisotropy());
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.9;
    this.controls.minPolarAngle = Math.PI * 0.22;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
      clearTimeout(this.idle);
    });
    this.controls.addEventListener('end', () => {
      clearTimeout(this.idle);
      this.idle = setTimeout(() => (this.controls.autoRotate = true), 6000);
    });
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.io = new IntersectionObserver((es) => (this.visible = es.some((e) => e.isIntersecting)));
    this.io.observe(host);
    this.resize();
    this.loop();
  }

  set(pieces: ArtPiece[], palette: Palette, opts: ModelOptions) {
    const next = buildModel(pieces, palette, this.tex, opts);
    if (this.model) {
      this.stage.scene.remove(this.model.group);
      this.model.dispose();
    }
    this.model = next;
    if (!next) return;
    this.stage.scene.add(next.group);
    // 다른 옷(조각 구성·크기)이 오면 카메라를 다시 맞춤. +1만 했으면 보던 각도 그대로
    const key = JSON.stringify([pieces.map((p) => [p.piece.id, p.piece.rows.length, p.gauge.st, p.gauge.row]), opts.mannequin]);
    const box = new THREE.Box3().setFromObject(next.group);
    this.stage.fit(box);
    if (key !== this.shapeKey) {
      this.shapeKey = key;
      const { center } = frameCamera(this.camera, box, 0.5, 0.12, 1.02);
      this.controls.target.copy(center);
      const d = this.camera.position.distanceTo(center);
      this.controls.minDistance = d * 0.45;
      this.controls.maxDistance = d * 1.5;
      this.controls.update();
    }
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible || document.hidden) return;
    this.controls.update();
    this.renderer.render(this.stage.scene, this.camera);
  };

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || !this.onPick || !this.model || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = ray.intersectObjects(this.model.pickables, false)[0];
    const id = hit?.object.userData.pieceId as string | undefined;
    if (id) this.onPick(id);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.idle);
    this.ro.disconnect();
    this.io.disconnect();
    this.controls.dispose();
    this.model?.dispose();
    this.tex.dispose();
    this.stage.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
