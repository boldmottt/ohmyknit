import * as THREE from 'three';

/**
 * 니트 원단 재질.
 *
 * 코 하나의 입체(법선·높이)를 작은 타일로 한 번 만들어 두고, 셰이더가 조각의 코 격자
 * (단마다 다른 콧수)에 맞춰 반복해요. 그래서 가까이 봐도 코가 뭉개지지 않고,
 * 실 색은 코 단위로 읽어서 배색 경계가 코의 V자 모양을 따라갑니다.
 * 고무단은 겉뜨기 기둥이 앞으로 나오고 안뜨기 골이 들어가요.
 */

const TILE = 128;
/** 높이 → 기울기 세기 */
const RELIEF = 2.6;

type Sample = { h: number; owner: number };

/** 겉뜨기 코: 아래에서 모이는 V자 두 가닥. 위·아래 단의 코가 겹치므로 가장 위에 있는 가닥을 고름 */
function knitHeight(s: number, t: number): Sample {
  let best: Sample = { h: 0, owner: 0 };
  const r = 0.2;
  for (const dy of [-1, 0, 1]) {
    for (const side of [-1, 1]) {
      const ax = 0.5 + side * 0.07;
      const ay = -0.2 + dy;
      const bx = 0.5 + side * 0.37;
      const by = 0.98 + dy;
      const vx = bx - ax;
      const vy = by - ay;
      const along = Math.max(0, Math.min(1, ((s - ax) * vx + (t - ay) * vy) / (vx * vx + vy * vy)));
      const px = s - (ax + vx * along);
      const py = t - (ay + vy * along);
      // 가닥은 가운데가 통통하고 양 끝이 가늘어요
      const rr = r * (0.72 + 0.28 * Math.sin(Math.PI * along));
      const d = Math.hypot(px, py);
      if (d >= rr) continue;
      const across = (px * vy - py * vx) / Math.hypot(vx, vy) / rr;
      const round = Math.sqrt(1 - (d / rr) ** 2);
      // 실의 꼬임 결
      const ply = 0.06 * Math.sin((along * 4.5 + side * across * 0.6) * Math.PI * 2);
      // 가닥의 아래쪽이 위에 놓이고, 위쪽은 윗단 코 밑으로 들어감
      const h = round * (1 - 0.45 * along) * (1 + ply);
      if (h > best.h) best = { h, owner: dy };
    }
  }
  return best;
}

/** 안뜨기 코: 가로로 누운 혹 두 줄 (윗줄은 코 가운데, 아랫줄은 코 사이) */
function purlHeight(s: number, t: number): Sample {
  const r = 0.23;
  const bump = (x: number, centre: number, bend: number) => {
    if (Math.abs(x) > 0.48) return 0;
    const d = Math.abs(t - (centre + bend * x * x));
    if (d >= r) return 0;
    const end = Math.sqrt(Math.max(0, 1 - (x / 0.48) ** 2));
    const ply = 0.06 * Math.sin((x * 6 + (t - centre) * 2) * Math.PI * 2);
    return Math.sqrt(1 - (d / r) ** 2) * end ** 0.5 * (1 + ply);
  };
  const upper = bump(s - 0.5, 0.72, -0.5);
  const lower = Math.max(bump(s, 0.25, 0.5), bump(s - 1, 0.25, 0.5)) * 0.85;
  return { h: Math.max(upper, lower), owner: 0 };
}

/** RG = 법선 xy, B = 높이, A = 이 자리의 실이 어느 단 것인지 (아랫단 0 · 이 단 0.5 · 윗단 1) */
function makeTile(fn: (s: number, t: number) => Sample): THREE.DataTexture {
  const samples: Sample[] = [];
  for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) samples.push(fn((i + 0.5) / TILE, (j + 0.5) / TILE));
  const at = (i: number, j: number) => samples[((j + TILE) % TILE) * TILE + ((i + TILE) % TILE)]!.h;
  const data = new Uint8Array(TILE * TILE * 4);
  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      const dx = ((at(i + 1, j) - at(i - 1, j)) * TILE) / 2 / TILE;
      const dy = ((at(i, j + 1) - at(i, j - 1)) * TILE) / 2 / TILE;
      const nx = -dx * RELIEF * 8;
      const ny = -dy * RELIEF * 8;
      const len = Math.hypot(nx, ny, 1);
      const sample = samples[j * TILE + i]!;
      data.set(
        [
          Math.round((nx / len) * 127.5 + 127.5),
          Math.round((ny / len) * 127.5 + 127.5),
          Math.round(Math.min(1, sample.h) * 255),
          Math.round((sample.owner + 1) * 127.5),
        ],
        (j * TILE + i) * 4,
      );
    }
  }
  const tex = new THREE.DataTexture(data, TILE, TILE, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

let tiles: { knit: THREE.DataTexture; purl: THREE.DataTexture } | null = null;

function stitchTiles() {
  if (!tiles) tiles = { knit: makeTile(knitHeight), purl: makeTile(purlHeight) };
  return tiles;
}

/** 단마다 콧수·뜨기 종류를 담은 1 × R 텍스처 */
export function rowDataTexture(rowData: Uint8Array<ArrayBuffer>, rows: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(rowData, 1, rows, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const PARS = /* glsl */ `
uniform sampler2D knitRowData;
uniform sampler2D knitTile;
uniform sampler2D purlTile;
uniform float knitRows;
`;

const STITCH = /* glsl */ `
float kRowF = vMapUv.y * knitRows;
float kRow = clamp(floor(kRowF), 0.0, knitRows - 1.0);
vec4 kData = texture2D(knitRowData, vec2(0.5, (kRow + 0.5) / knitRows));
float kN = max(1.0, floor(kData.r * 255.0 + 0.5) + floor(kData.g * 255.0 + 0.5) * 256.0);
float kTech = floor(kData.b * 255.0 + 0.5);
float kColF = vMapUv.x * kN;
bool kRib = kTech > 0.5 && kTech < 1.5;
if (kRib) {
  // 고무단은 오므라들어서 겉뜨기 두 코가 넓게 보이고 안뜨기 두 코는 골 안으로 좁아져요
  float kRep = floor(kColF / 4.0);
  float kX = kColF - kRep * 4.0;
  kColF = kRep * 4.0 + (kX < 2.7 ? kX / 1.35 : 2.0 + (kX - 2.7) / 0.65);
}
float kCol = floor(kColF);
vec2 kDx = dFdx(vMapUv) * vec2(kN, knitRows);
vec2 kDy = dFdy(vMapUv) * vec2(kN, knitRows);
bool kPurl = kTech > 1.5 || (kTech > 0.5 && mod(kCol, 4.0) >= 2.0);
vec2 kSt = vec2(kColF, kRowF);
vec4 kTile = kPurl ? textureGrad(purlTile, kSt, kDx, kDy) : textureGrad(knitTile, kSt, kDx, kDy);
// 겹친 가닥은 그 가닥이 속한 단의 실 색으로
float kOwner = floor((kTile.a - 0.5) * 2.0 + 0.5);
float kColorRow = clamp(kRow + kOwner, 0.0, knitRows - 1.0);
vec2 kColorUv = vec2((kCol + 0.5) / kN, (kColorRow + 0.5) / knitRows);
vec4 sampledDiffuseColor = textureGrad(map, kColorUv, dFdx(vMapUv), dFdy(vMapUv));
diffuseColor *= sampledDiffuseColor;
// 코 사이 골은 어둡게
diffuseColor.rgb *= mix(kPurl ? 0.66 : 0.4, 1.06, smoothstep(0.0, 0.55, kTile.b));
// 고무단: 겉뜨기 두 코가 기둥으로 나오고 안뜨기 두 코가 골로 들어감
float kRibSlope = 0.0;
if (kRib) {
  float kFade = 1.0 - smoothstep(0.5, 1.6, max(length(kDx), length(kDy)));
  float kPhase = (kColF - 1.0) * 1.5707963;
  kRibSlope = -sin(kPhase) * 0.34 * kFade;
  diffuseColor.rgb *= mix(0.84, 0.5 + 0.5 * smoothstep(-0.9, 0.3, cos(kPhase)), kFade);
}
`;

const NORMAL = /* glsl */ `
vec3 mapN = vec3(kTile.rg * 2.0 - 1.0, 0.0);
mapN.x -= kRibSlope;
mapN.xy *= normalScale;
mapN.z = sqrt(max(0.05, 1.0 - min(1.0, dot(kTile.rg * 2.0 - 1.0, kTile.rg * 2.0 - 1.0))));
normal = normalize(tbn * mapN);
`;

export type KnitMaterialOptions = {
  /** 코마다 실 색 */
  map: THREE.Texture;
  rowData: THREE.Texture;
  rows: number;
  /** 실의 대표 색 (보풀의 빛깔) */
  yarn: string;
  side?: THREE.Side;
  /** 1보다 작으면 반투명 (아직 안 뜬 완성 모습) */
  opacity?: number;
  /** 옷 안쪽처럼 어둡게 */
  tint?: number;
  /** 고른 조각 강조 */
  glow?: number;
};

const GLOW = 0xb5523b;

export function makeKnitMaterial(o: KnitMaterialOptions): THREE.MeshPhysicalMaterial {
  const t = stitchTiles();
  const ghost = o.opacity !== undefined && o.opacity < 1;
  const mat = new THREE.MeshPhysicalMaterial({
    map: o.map,
    color: o.tint ?? 0xffffff,
    // 법선 맵 경로(접선 틀)를 켜기 위한 자리. 실제 법선은 아래 셰이더가 코 타일에서 읽음
    normalMap: t.knit,
    normalScale: new THREE.Vector2(1, 1),
    roughness: 0.96,
    metalness: 0,
    // 울의 보풀: 비스듬히 볼 때 가장자리가 부드럽게 밝아짐
    sheen: 0.9,
    sheenRoughness: 0.62,
    sheenColor: new THREE.Color(o.yarn).lerp(new THREE.Color(0xffffff), 0.55),
    emissive: new THREE.Color(o.glow ? GLOW : 0x000000),
    emissiveIntensity: o.glow ?? 0,
    side: o.side ?? THREE.FrontSide,
    transparent: ghost,
    opacity: o.opacity ?? 1,
    depthWrite: !ghost,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.knitRowData = { value: o.rowData };
    shader.uniforms.knitRows = { value: o.rows };
    shader.uniforms.knitTile = { value: t.knit };
    shader.uniforms.purlTile = { value: t.purl };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n${PARS}`)
      .replace('#include <map_fragment>', STITCH)
      .replace('#include <normal_fragment_maps>', NORMAL);
  };
  mat.customProgramCacheKey = () => 'knit-fabric';
  return mat;
}
