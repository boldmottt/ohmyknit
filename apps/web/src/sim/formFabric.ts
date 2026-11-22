import * as THREE from 'three';

/**
 * 마네킹을 감싼 천 (재봉용 드레스폼처럼 린넨을 팽팽하게 씌운 모습).
 *
 * 평직(날실·씨실이 한 올씩 엇갈림) 린넨: 실 굵기·밝기가 가닥마다 조금씩 다르고(슬럽),
 * 군데군데 짙은 섬유 티. 무광에 천 특유의 은은한 광택(sheen).
 * 모델 UV와 상관없이 결 방향·크기가 고르게 보이도록 세 방향에서 비춰 입혀요(트라이플래너, 물체 좌표 cm).
 */

/** 텍스처 한 변 픽셀 · 한 변에 들어가는 실 가닥 수 · 한 장이 덮는 길이(cm) → 실 간격 2.4mm */
const N = 512;
const THREADS = 40;
export const WEAVE_TILE_CM = 9.6;

/** 천 색 (표백하지 않은 무명·린넨의 크림 화이트) */
const LINEN: [number, number, number] = [238, 233, 222];

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Thread = { thick: number; tone: number; waves: { f: number; p: number; a: number }[] };

/** 실 한 가닥: 굵기·밝기와, 길이 방향으로 굵어졌다 가늘어지는 마디(텍스처 한 장에서 이어지게 정수 주기) */
function threads(rand: () => number): Thread[] {
  return Array.from({ length: THREADS }, () => ({
    thick: 0.78 + rand() * 0.34,
    tone: (rand() - 0.5) * 0.09,
    waves: Array.from({ length: 3 }, (_, k) => ({ f: 1 + Math.floor(rand() * (3 + k * 3)), p: rand() * Math.PI * 2, a: (0.05 + rand() * 0.07) / (k + 1) })),
  }));
}

function along(t: Thread, s: number): number {
  let v = 0;
  for (const w of t.waves) v += w.a * Math.sin(2 * Math.PI * w.f * s + w.p);
  return v;
}

let cached: Uint8Array<ArrayBuffer> | null = null;

/** 천 텍스처 한 장 (RGB = 색, A = 실의 높이), 타일처럼 이어짐 */
export function weaveData(): Uint8Array<ArrayBuffer> {
  if (cached) return cached;
  const rand = mulberry(20261121);
  const warp = threads(rand);
  const weft = threads(rand);
  const out = new Uint8Array(N * N * 4);
  const shade = new Float32Array(N * N);
  const cell = N / THREADS;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / cell;
      const v = y / cell;
      const i = Math.floor(u) % THREADS;
      const j = Math.floor(v) % THREADS;
      const fu = u - Math.floor(u) - 0.5;
      const fv = v - Math.floor(v) - 0.5;
      const wa = warp[i]!;
      const we = weft[j]!;
      // 실 굵기 (마디 포함): 칸 너비에 대한 반폭
      const hwWarp = 0.42 * wa.thick * (1 + along(wa, y / N));
      const hwWeft = 0.42 * we.thick * (1 + along(we, x / N));
      // 각 실의 둥근 단면 (가운데 1 → 가장자리 0)
      const prof = (d: number, hw: number) => (Math.abs(d) < hw ? Math.sqrt(1 - (d / hw) ** 2) : 0);
      const warpOnTop = (i + j) % 2 === 0;
      // 위에 올라온 실은 교차점 가운데가 가장 높고, 다음 칸에서 아래로 내려감
      const pw = prof(fu, hwWarp) * (warpOnTop ? 0.62 + 0.38 * Math.cos(Math.PI * fv) : 0.32 + 0.18 * Math.cos(Math.PI * fv));
      const pf = prof(fv, hwWeft) * (warpOnTop ? 0.32 + 0.18 * Math.cos(Math.PI * fu) : 0.62 + 0.38 * Math.cos(Math.PI * fu));
      const h = Math.max(pw, pf);
      const tone = pw >= pf ? wa.tone + 0.05 * along(wa, y / N) : we.tone + 0.05 * along(we, x / N) - 0.012;
      // 실 사이 틈은 살짝 어둡게 + 넓게 번지는 얼룩(천 전체가 고르게 같은 색이 아니게)
      const mottle = 0.025 * (Math.sin((2 * Math.PI * 2 * x) / N + 1.3) * Math.sin((2 * Math.PI * 3 * y) / N + 0.4) + Math.sin((2 * Math.PI * 5 * (x + y)) / N + 2.1) * 0.5);
      // 색에는 실마다 다른 밝기·마디(슬럽)만 — 실 사이 틈의 그늘은 셰이더에서 높이(A)로 (멀리서는 고르게 펴서 모아레 없이)
      shade[y * N + x] = 1 + tone * 0.3 + mottle;
      out[(y * N + x) * 4 + 3] = Math.max(0, Math.min(255, h * 255));
    }
  }
  // 짙은 섬유 티 (드문드문, 실 방향으로 길쭉) — 둘레 픽셀만
  for (let k = 0; k < 70; k++) {
    const fx = rand() * N;
    const fy = rand() * N;
    const r = 0.8 + rand() * 1.6;
    const d = 0.1 + rand() * 0.14;
    for (let dy = -Math.ceil(r * 3); dy <= Math.ceil(r * 3); dy++) {
      for (let dx = -Math.ceil(r * 0.6); dx <= Math.ceil(r * 0.6); dx++) {
        const q = (dx / (r * 0.6)) ** 2 + (dy / (r * 3)) ** 2;
        if (q >= 1) continue;
        const x = (((Math.round(fx) + dx) % N) + N) % N;
        const y = (((Math.round(fy) + dy) % N) + N) % N;
        shade[y * N + x] = shade[y * N + x]! - d * (1 - q);
      }
    }
  }
  for (let p = 0; p < N * N; p++) {
    for (let c = 0; c < 3; c++) out[p * 4 + c] = Math.max(0, Math.min(255, LINEN[c]! * shade[p]!));
  }
  cached = out;
  return out;
}

/**
 * 재질 셰이더에 천 결 붙이기: 물체 좌표(cm)를 세 방향에서 비춰 색을 곱하고, 높이로 결의 굴곡(범프)을 만듦.
 * 텍스처는 호출하는 쪽에서 만들어 넘김 (렌더러마다 하나)
 */
export function addWeave(
  shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> },
  tex: { weave: THREE.Texture; streak: THREE.Texture },
  opts: { scale?: number; bump?: number } = {},
) {
  shader.uniforms.tWeave = { value: tex.weave };
  shader.uniforms.tStreak = { value: tex.streak };
  shader.uniforms.uStreakScale = { value: 1 / STREAK_TILE_CM };
  shader.uniforms.uWeaveGapMean = { value: weaveGapMean() };
  shader.uniforms.uWeaveMean = { value: weaveMean() };
  shader.uniforms.uWeaveScale = { value: (opts.scale ?? 1) / WEAVE_TILE_CM };
  shader.uniforms.uWeaveBump = { value: opts.bump ?? 0.6 };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWeavePos;\nvarying vec3 vWeaveNrm;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWeavePos = position;\nvWeaveNrm = normal;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      varying vec3 vWeavePos;
      varying vec3 vWeaveNrm;
      uniform sampler2D tWeave;
      uniform sampler2D tStreak;
      uniform float uStreakScale;
      uniform float uWeaveGapMean;
      uniform vec3 uWeaveMean;
      uniform float uWeaveScale;
      uniform float uWeaveBump;
      // 실 한 가닥이 화면에서 3픽셀보다 작아지면 1 → 실 사이 틈 그늘·굴곡(규칙적인 격자)을 평균으로 고르게
      // (멀리서도 남기면 마름모 모아레가 생김). 실마다 다른 밝기 줄무늬는 그대로 남아 천 느낌이 나요
      float weaveFar() {
        float d = max(length(dFdx(vWeavePos)), length(dFdy(vWeavePos))) * uWeaveScale * ${THREADS}.0;
        return smoothstep(0.3, 0.6, d);
      }
      float weaveGap(float h) {
        return mix(0.88 + 0.12 * min(1.0, h * 1.6), uWeaveGapMean, weaveFar());
      }
      // 실마다 다른 밝기도 더 멀어지면 평균 색으로 (텍스처 한 장이 9.6cm마다 되풀이되며 격자무늬가 보이지 않게)
      vec3 weaveTone(vec3 c) {
        float d = max(length(dFdx(vWeavePos)), length(dFdy(vWeavePos))) * uWeaveScale * ${THREADS}.0;
        return mix(c, uWeaveMean, smoothstep(0.45, 0.9, d));
      }
      // 세 방향 무게는 아주 또렷하게 (겹치는 띠가 넓으면 두 결이 엇갈려 마름모 모아레가 생김) — 바뀌는 자리는 천 조각을 이은 자리처럼
      vec3 weaveW() {
        vec3 w = pow(abs(normalize(vWeaveNrm)), vec3(24.0));
        return w / max(1e-6, w.x + w.y + w.z);
      }
      // 세 방향: 옆(zy), 위아래(xz), 앞뒤(xy) — 날실이 늘 세로로 서게
      vec4 weaveSample() {
        vec3 p = vWeavePos * uWeaveScale;
        vec3 w = weaveW();
        return texture2D(tWeave, p.zy) * w.x + texture2D(tWeave, p.xz) * w.y + texture2D(tWeave, p.xy) * w.z;
      }
      vec4 weaveTexel;
      // 굵은 실 줄무늬: ±7% 밝기 (낮은 주파수라 멀리서도 그대로)
      float streakTone() {
        vec3 p = vWeavePos * uStreakScale;
        vec3 w = weaveW();
        float s = texture2D(tStreak, p.zy).r * w.x + texture2D(tStreak, p.xz).r * w.y + texture2D(tStreak, p.xy).r * w.z;
        return 1.0 + (s - 0.5) * 0.14;
      }
      vec3 weavePerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
        vec3 vSigmaX = normalize(dFdx(surf_pos));
        vec3 vSigmaY = normalize(dFdy(surf_pos));
        vec3 R1 = cross(vSigmaY, surf_norm);
        vec3 R2 = cross(surf_norm, vSigmaX);
        float fDet = dot(vSigmaX, R1) * faceDir;
        vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
        return normalize(abs(fDet) * surf_norm - vGrad);
      }`,
    )
    .replace('#include <color_fragment>', '#include <color_fragment>\nweaveTexel = weaveSample();\ndiffuseColor.rgb *= weaveTone(weaveTexel.rgb) * weaveGap(weaveTexel.a) * streakTone();')
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      {
        float hW = weaveTexel.a;
        vec2 dH = vec2(dFdx(hW), dFdy(hW)) * uWeaveBump * (1.0 - weaveFar());
        normal = weavePerturb(-vViewPosition, normal, dH, faceDirection);
      }`,
    );
}

/** 굵은 실 줄무늬(슬럽) 한 장이 덮는 길이 (cm) — 실 무늬(9.6cm)와 맞물리지 않는 길이라 되풀이가 눈에 안 띔 */
export const STREAK_TILE_CM = 41;
const SN = 256;
let streakCached: Uint8Array<ArrayBuffer> | null = null;

/**
 * 린넨의 굵은 실 줄무늬: 세로(날실)·가로(씨실) 방향으로 0.4~1.5cm 폭의 옅고 짙은 줄이 불규칙하게.
 * 앱에서 보통 보는 거리에서도 천 느낌이 나게 (가는 실 무늬는 멀면 안 보이므로)
 */
export function streakData(): Uint8Array<ArrayBuffer> {
  if (streakCached) return streakCached;
  const rand = mulberry(41);
  const line = () => {
    const v = new Float32Array(SN);
    // 둥근 혹 모양 줄 (폭 0.4~1.5cm, 밝거나 어둡게), 끝은 감겨 이어짐
    for (let k = 0; k < 34; k++) {
      const c = rand() * SN;
      const w = ((0.4 + rand() * 1.1) / STREAK_TILE_CM) * SN * 0.5;
      const a = (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.6);
      for (let i = 0; i < SN; i++) {
        let d = Math.abs(i - c);
        d = Math.min(d, SN - d);
        v[i] = v[i]! + a * Math.exp(-0.5 * (d / w) ** 2);
      }
    }
    let m = 0;
    for (let i = 0; i < SN; i++) m = Math.max(m, Math.abs(v[i]!));
    for (let i = 0; i < SN; i++) v[i] = v[i]! / (m || 1);
    return v;
  };
  const warp = line();
  const weft = line();
  const out = new Uint8Array(SN * SN * 4);
  for (let y = 0; y < SN; y++) {
    for (let x = 0; x < SN; x++) {
      const t = 0.6 * warp[x]! + 0.4 * weft[y]!;
      const k = (y * SN + x) * 4;
      out[k] = out[k + 1] = out[k + 2] = Math.round(128 + t * 120);
      out[k + 3] = 255;
    }
  }
  streakCached = out;
  return out;
}

let mean: THREE.Vector3 | null = null;
/** 천 텍스처의 평균 색 (셰이더 안의 선형 색) */
function weaveMean(): THREE.Vector3 {
  if (mean) return mean;
  const d = weaveData();
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const acc = [0, 0, 0];
  for (let p = 0; p < N * N; p++) for (let c = 0; c < 3; c++) acc[c]! += lin(d[p * 4 + c]!);
  mean = new THREE.Vector3(acc[0]! / (N * N), acc[1]! / (N * N), acc[2]! / (N * N));
  return mean;
}

let gapMean: number | null = null;
/** 실 사이 틈 그늘의 평균 (멀리서 고르게 펼 때 쓰는 값) */
function weaveGapMean(): number {
  if (gapMean !== null) return gapMean;
  const d = weaveData();
  let acc = 0;
  for (let p = 0; p < N * N; p++) acc += 0.88 + 0.12 * Math.min(1, (d[p * 4 + 3]! / 255) * 1.6);
  gapMean = acc / (N * N);
  return gapMean;
}

/** 천 텍스처 둘 (반복, 밉맵, 비스듬히 봐도 흐려지지 않게): 실 무늬(RGB sRGB 색 + A 높이), 굵은 실 줄무늬 */
export function weaveTexture(aniso = 8): { weave: THREE.Texture; streak: THREE.Texture } {
  const make = (data: Uint8Array<ArrayBuffer>, n: number, srgb: boolean) => {
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  return { weave: make(weaveData(), N, true), streak: make(streakData(), SN, false) };
}
