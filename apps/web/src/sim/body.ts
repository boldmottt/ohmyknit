import { armAxis, axisSheet, ringAt, type Axis, type Sheet, type Vec3 } from './drape';
import { smoothKeys } from './form';
import { ARM_ANGLE, type Layout, type Placement, type Ring, type SimRole, type Tube } from './shape';
import type { ArtPiece } from '../closet/assembledArt';

/**
 * 사람 모양 마네킹 (three.js 없이 숫자만 — 화면에 그릴 때도, 천 시뮬레이션의 부딪힘에도 같은 모양).
 *
 * 통짜 원통 대신 높이마다 단면을 쌓아요(로프트). 단면은 앞·뒤 깊이가 다른 둥근 사각형(초타원)이고,
 * 가슴·대흉근·견갑골·척추 골·엉덩이·쇄골 같은 굴곡을 더해요. 목은 턱 끝보다 4~5cm 뒤에서 올라가
 * 턱 밑이 드러나고 뒤통수가 목덜미 위로 나와요. 머리는 덩어리(머리뼈·뒤통수·얼굴·광대활·깨물근·아래턱·
 * 턱끝·코)를 부드럽게 합친 매장 마네킹(에그헤드) 얼굴. 팔은 삼각근 → 이두 → 팔꿈치 → 아래팔 → 손목 → 손,
 * 다리는 허벅지 중간까지. 받침대 위에 섭니다.
 *
 * 치수는 실제 사람 비율(여자: 가슴 88 · 허리 68 · 엉덩이 94, 남자: 가슴 98 · 허리 82 · 엉덩이 96 근처)이고,
 * 옷의 가슴둘레에 맞춰 크기를 줄이거나 키워요 (옷보다 6% 작게 = 보통 여유).
 * 단위 cm, y 위, +z 앞, +x 오른쪽. 높이는 겨드랑이 = 0 기준.
 */

export type BodyKind = 'female' | 'male';
export const BODY_KINDS: BodyKind[] = ['female', 'male'];

/** 높이마다 중심과 각도별 반지름. 각도 a ↔ φ = 2πa/A (0 = +x 오른쪽, π/2 = +z 앞) */
export type Loft = { y: number[]; cx: number[]; cz: number[]; A: number; r: number[] };

type Section = { y: number; w: number; df: number; db: number; cz?: number; n?: number };
/** 단면에 더하는 굴곡: 높이 y 근처(아래 below, 위 above 폭), 각도 phi(도, 90 = 앞) 근처(spread 폭)에 amp cm */
type Bump = { y: number; below: number; above: number; phi: number; spread: number; amp: number };

type P3 = [number, number, number];
/**
 * 머리 조각: 덩어리 목록 (cm, y = 턱 끝에서 잰 높이, z = 앞+). 큰 덩어리(머리뼈·얼굴·아래턱)는 아주 부드럽게,
 * 작은 것(턱끝·코)은 덜 부드럽게 붙여요. sym = 왼쪽에도, sub = 파냄. k = 앞 덩어리들과 이어 붙이는 부드러움 (cm).
 * 눈·입술·귀를 새기면 오히려 우스꽝스러워서(웃는 얼굴처럼 보임) 매장 마네킹처럼 코만 남김
 */
type Part =
  | { skull: { y: number; z: number; w: number; h: number; f: number; b: number; n: number } }
  | { e: P3; r: P3; k: number; sym?: boolean; sub?: boolean }
  | { rod: [P3, number, P3, number]; k: number; sym?: boolean };
type FaceSpec = Part[];

type Spec = {
  torso: Section[];
  bumps: Bump[];
  /** 머리 (덩어리를 부드럽게 합쳐 조각, cm · 턱 끝 = 0) */
  face: FaceSpec;
  /** 턱 끝 높이 (겨드랑이 기준) */
  chin: number;
  /** 팔: 어깨 꼭대기에서 잰 거리 s, 옆 반지름, 앞뒤 반지름 */
  arm: [number, number, number][];
  /** 허벅지: 가운데에서 떨어진 거리, 시작·끝 높이, 무릎 쪽으로 모이는 정도, 위에서 잰 거리별 반지름 */
  thigh: { x: number; top: number; bottom: number; inward: number; r: [number, number][] };
  neck: number;
  /** 목 밑동 높이 (요크 목둘레가 걸리는 자리)와 그 자리 목둘레를 정하는 반너비·반깊이 */
  neckY: number;
  neckFit: { w: number; d: number };
  /** 손목 (팔 위에서 잰 거리 s) */
  wrist: number;
  /** 손 크기: 길이·너비 배율 (여자 손이 기준) */
  hand: { s: number; w: number };
};

const FEMALE: Spec = {
  torso: [
    { y: -57, w: 1.5, df: 1.2, db: 1.5 },
    { y: -55.5, w: 8.5, df: 5, db: 6.5, cz: -0.3 },
    { y: -51, w: 16.3, df: 8.6, db: 10, cz: -0.4, n: 2.4 },
    { y: -43, w: 17.2, df: 9, db: 10.2, cz: -0.3, n: 2.3 },
    { y: -34, w: 15.2, df: 8.6, db: 9, cz: 0, n: 2.2 },
    { y: -25, w: 12.8, df: 8.2, db: 7.8, cz: 0.2, n: 2.1 },
    { y: -15, w: 13.6, df: 8.8, db: 8, cz: 0.4, n: 2.2 },
    { y: -7, w: 15, df: 9.6, db: 8.4, cz: 0.4, n: 2.4 },
    { y: 0, w: 15.2, df: 9.3, db: 8.6, cz: 0.2, n: 2.6 },
    { y: 5, w: 16.4, df: 8.4, db: 8.2, cz: 0, n: 2.9 },
    { y: 8.5, w: 17.4, df: 6.6, db: 7.2, cz: -0.3, n: 3 },
    { y: 10.6, w: 14, df: 5.4, db: 6.1, cz: -0.5, n: 2.7 },
    { y: 12.2, w: 8.6, df: 5, db: 5.6, cz: -0.3, n: 2.3 },
    // 목: 턱 끝보다 4~5cm 뒤에서 올라가 턱 밑이 드러남. 뒤쪽은 뒤통수 밑(머리뼈 아래)으로 들어감
    { y: 13.6, w: 5.7, df: 5, db: 5.2, cz: -0.8, n: 2 },
    { y: 15.6, w: 5.1, df: 4.75, db: 4.85, cz: -1.1, n: 2 },
    { y: 18.2, w: 4.9, df: 4.55, db: 4.6, cz: -1.35, n: 2 },
    { y: 20.7, w: 4.8, df: 4.4, db: 4.55, cz: -1.5, n: 2 },
    { y: 23.5, w: 4.7, df: 4.2, db: 4.6, cz: -1.8, n: 2 },
    { y: 25.8, w: 4.2, df: 3.6, db: 4.4, cz: -2.3, n: 2 },
    { y: 26.8, w: 2.6, df: 2.2, db: 2.8, cz: -2.5, n: 2 },
    { y: 27.2, w: 0.5, df: 0.5, db: 0.5, cz: -2.5 },
  ],
  bumps: [
    // 가슴
    { y: -7, below: 4.2, above: 7.5, phi: 67, spread: 17, amp: 4.3 },
    { y: -7, below: 4.2, above: 7.5, phi: 113, spread: 17, amp: 4.3 },
    // 견갑골
    { y: -1, below: 7, above: 5, phi: -126, spread: 20, amp: 0.9 },
    { y: -1, below: 7, above: 5, phi: -54, spread: 20, amp: 0.9 },
    // 척추 골
    { y: -14, below: 22, above: 16, phi: -90, spread: 6, amp: -0.55 },
    // 엉덩이
    { y: -45, below: 5.5, above: 7, phi: -120, spread: 24, amp: 2.6 },
    { y: -45, below: 5.5, above: 7, phi: -60, spread: 24, amp: 2.6 },
    // 아랫배
    { y: -37, below: 6, above: 7, phi: 90, spread: 38, amp: 0.7 },
    // 쇄골
    { y: 9.5, below: 1.3, above: 1.3, phi: 50, spread: 18, amp: 0.35 },
    { y: 9.5, below: 1.3, above: 1.3, phi: 130, spread: 18, amp: 0.35 },
  ],
  face: [
    { skull: { y: 15, z: -1, w: 7.5, h: 7.5, f: 8.4, b: 9, n: 2.4 } },
    // 뒤통수, 꼭지돌기(귀 뒤 목이 붙는 자리)
    { e: [0, 11.6, -5], r: [5.6, 4.6, 4.5], k: 2.5 },
    { e: [4.3, 8.6, -2.6], r: [2.2, 2.6, 2.6], k: 2, sym: true },
    // 얼굴: 이마 밑에서 턱까지 볼록한 달걀형 (눈자리가 꺼져 보이지 않게 눈 높이까지 꽉 참)
    { e: [0, 10, 1.8], r: [5.9, 7.5, 5.8], k: 3 },
    // 광대활(앞에서 볼 때 얼굴 폭), 깨물근(볼에서 턱모서리까지 살)
    { rod: [[5, 10.6, 3.2], 1, [5.6, 10.4, -0.8], 1], k: 2.5, sym: true },
    { e: [4.4, 6, 0.6], r: [1.5, 2.8, 2.2], k: 2.5, sym: true },
    // 아래턱(입 둘레까지 한 덩어리, 턱 밑이 드러남), 턱끝
    { e: [0, 4, 2.8], r: [4.2, 3.6, 4.6], k: 2.5 },
    { e: [0, 1.8, 5.2], r: [2.1, 1.9, 2.3], k: 2.5 },
    // 콧등과 둥근 코끝 — 눈·입·귀는 새기지 않는 매장 마네킹(에그헤드) 얼굴
    { rod: [[0, 12.7, 6.9], 0.58, [0, 8.6, 8.55], 0.66], k: 1.4 },
    { e: [0, 8.25, 8.4], r: [0.86, 0.7, 0.78], k: 1.2 },
  ],
  chin: 19.5,
  arm: [
    [0, 0.5, 0.5],
    [1.4, 3.5, 3.7],
    [4, 4.5, 4.6],
    [8, 4.4, 4.4],
    [14, 4.1, 4.1],
    [20, 3.8, 3.8],
    [26, 3.3, 3.5],
    [29.5, 3.5, 3.8],
    [35, 3.3, 3.4],
    [41, 2.6, 2.9],
    [45.5, 2, 2.55],
    // 손목 끝은 손 안에 숨는 둥근 마개
    [46.7, 1.75, 2.2],
    [47.4, 1.1, 1.3],
    [47.7, 0.3, 0.3],
  ],
  thigh: {
    x: 8.4,
    top: -44.5,
    bottom: -76,
    inward: 1.6,
    // 윗끝은 엉덩이 안에 숨는 둥근 머리 (납작한 단면이 옆으로 삐져나오지 않게)
    r: [
      [0, 5.2],
      [1.8, 7.6],
      [4.2, 8.8],
      [8, 8.95],
      [15, 8.2],
      [25, 7.2],
      [30, 6.8],
      [31, 5],
      [31.6, 0.4],
    ],
  },
  neck: 4.8,
  neckY: 13.6,
  neckFit: { w: 5.9, d: 5.2 },
  wrist: 45.5,
  hand: { s: 1, w: 1 },
};

const MALE: Spec = {
  torso: [
    { y: -59, w: 1.6, df: 1.2, db: 1.5 },
    { y: -57.5, w: 9.2, df: 5.4, db: 6.6, cz: -0.2 },
    { y: -53, w: 16.2, df: 9, db: 9.4, cz: -0.3, n: 2.4 },
    { y: -45, w: 17.3, df: 9.6, db: 10.2, cz: -0.2, n: 2.3 },
    { y: -36, w: 16.2, df: 10, db: 9.4, cz: 0.2, n: 2.25 },
    { y: -27, w: 15.6, df: 10.4, db: 9.2, cz: 0.4, n: 2.25 },
    { y: -16, w: 16.6, df: 10.6, db: 9.6, cz: 0.4, n: 2.4 },
    { y: -7, w: 17.4, df: 10.8, db: 9.9, cz: 0.3, n: 2.6 },
    { y: 0, w: 18, df: 10.4, db: 10, cz: 0.1, n: 2.8 },
    { y: 5, w: 19.4, df: 9.4, db: 9.6, cz: -0.1, n: 3.1 },
    { y: 9, w: 20.6, df: 7.6, db: 8.2, cz: -0.3, n: 3.2 },
    { y: 11.4, w: 16.6, df: 6.2, db: 7, cz: -0.5, n: 2.9 },
    { y: 13.1, w: 11.6, df: 6, db: 6.8, cz: -0.3, n: 2.4 },
    { y: 14.6, w: 6.6, df: 5.7, db: 6, cz: -0.9, n: 2 },
    { y: 16.8, w: 6, df: 5.4, db: 5.6, cz: -1.2, n: 2 },
    { y: 19.2, w: 5.8, df: 5.3, db: 5.5, cz: -1.45, n: 2 },
    { y: 21.8, w: 5.6, df: 5, db: 5.4, cz: -1.65, n: 2 },
    { y: 24.8, w: 5.4, df: 4.7, db: 5.3, cz: -2, n: 2 },
    { y: 27.2, w: 4.6, df: 4, db: 5, cz: -2.5, n: 2 },
    { y: 28.2, w: 2.8, df: 2.4, db: 3, cz: -2.7, n: 2 },
    { y: 28.6, w: 0.5, df: 0.5, db: 0.5, cz: -2.7 },
  ],
  bumps: [
    // 대흉근
    { y: -4, below: 3.6, above: 5.5, phi: 63, spread: 22, amp: 1.3 },
    { y: -4, below: 3.6, above: 5.5, phi: 117, spread: 22, amp: 1.3 },
    // 견갑골
    { y: -1, below: 7, above: 5, phi: -126, spread: 21, amp: 1.1 },
    { y: -1, below: 7, above: 5, phi: -54, spread: 21, amp: 1.1 },
    // 척추 골
    { y: -14, below: 22, above: 16, phi: -90, spread: 6, amp: -0.65 },
    // 엉덩이
    { y: -47, below: 5.5, above: 7, phi: -120, spread: 24, amp: 2 },
    { y: -47, below: 5.5, above: 7, phi: -60, spread: 24, amp: 2 },
    // 쇄골
    { y: 10, below: 1.3, above: 1.3, phi: 50, spread: 18, amp: 0.45 },
    { y: 10, below: 1.3, above: 1.3, phi: 130, spread: 18, amp: 0.45 },
    // 울대뼈
    { y: 18, below: 1.3, above: 1.1, phi: 90, spread: 13, amp: 0.55 },
  ],
  face: [
    { skull: { y: 15.6, z: -1.2, w: 7.75, h: 7.9, f: 8.8, b: 9.4, n: 2.5 } },
    { e: [0, 12, -5.3], r: [5.9, 4.8, 4.8], k: 2.5 },
    { e: [4.6, 8.9, -2.8], r: [2.4, 2.8, 2.7], k: 2, sym: true },
    { e: [0, 10.4, 1.8], r: [6.2, 7.8, 6], k: 3 },
    { rod: [[5.3, 11, 3.2], 1.05, [5.9, 10.8, -0.9], 1.05], k: 2.5, sym: true },
    { e: [4.8, 6.2, 0.5], r: [1.7, 3, 2.3], k: 2.5, sym: true },
    // 남자 아래턱은 넓고 각짐
    { e: [0, 4.2, 2.8], r: [4.6, 3.8, 4.8], k: 2.5 },
    { e: [0, 1.9, 5.3], r: [2.5, 2, 2.4], k: 2.5 },
    { rod: [[0, 13.1, 7.2], 0.64, [0, 9, 8.9], 0.72], k: 1.4 },
    { e: [0, 8.6, 8.75], r: [0.95, 0.76, 0.84], k: 1.2 },
  ],
  chin: 20.5,
  arm: [
    [0, 0.55, 0.55],
    [1.5, 4, 4.2],
    [4.3, 5.1, 5.2],
    [8.6, 5, 5],
    [15, 4.7, 4.6],
    [21.5, 4.3, 4.2],
    [28, 3.8, 3.9],
    [31.8, 4, 4.3],
    [37.8, 3.8, 3.9],
    [44.3, 3, 3.2],
    [49, 2.3, 2.85],
    [50.2, 2, 2.45],
    [50.9, 1.2, 1.4],
    [51.2, 0.3, 0.3],
  ],
  thigh: {
    x: 8.8,
    top: -46.5,
    bottom: -80,
    inward: 1.4,
    r: [
      [0, 5.5],
      [1.8, 8.1],
      [4.2, 9.3],
      [8, 9.45],
      [16, 8.6],
      [26, 7.6],
      [31.6, 7.2],
      [32.6, 5.3],
      [33.2, 0.4],
    ],
  },
  neck: 5.6,
  neckY: 14.6,
  neckFit: { w: 6.6, d: 6.05 },
  wrist: 49,
  hand: { s: 1.07, w: 1.12 },
};

export const BODY_SPECS: Record<BodyKind, Spec> = { female: FEMALE, male: MALE };

/**
 * 손 (여자 손 기준, 남자는 배율): 손목에서 잰 거리 a, 앞뒤 반너비, 옆 반두께.
 * 손바닥이 허벅지를 보는 자세라 너비는 앞뒤로. 손가락 끝은 둥글게 (벙어리장갑처럼 모은 손가락)
 */
const HAND: [number, number, number][] = [
  [-1.4, 2.55, 1.95],
  [0, 2.7, 1.95],
  [1.5, 3.15, 1.78],
  [3.5, 3.6, 1.62],
  [6, 3.85, 1.5],
  [8.6, 3.9, 1.35],
  [10.6, 3.75, 1.15],
  [12.6, 3.6, 1.05],
  [14.4, 3.45, 1],
  [15.6, 3.27, 0.96],
  [16.6, 2.75, 0.88],
  [17.3, 2, 0.74],
  [17.75, 1.2, 0.52],
  [18, 0.3, 0.18],
];
/** 엄지: 뿌리(손바닥 아래 앞 가장자리)에서 잰 거리, 반지름 */
const THUMB: [number, number][] = [
  [0, 1.6],
  [1.6, 1.42],
  [3.4, 1.14],
  [4.9, 1],
  [5.9, 0.84],
  [6.35, 0.68],
  [6.6, 0.42],
  [6.75, 0.1],
];

/* ───────── 단면 ───────── */

function superR(phi: number, s: Required<Section>): number {
  const c = Math.abs(Math.cos(phi));
  const si = Math.abs(Math.sin(phi));
  const d = Math.sin(phi) >= 0 ? s.df : s.db;
  return Math.pow(Math.pow(c / s.w, s.n) + Math.pow(si / d, s.n), -1 / s.n);
}

function bumpAt(b: Bump, y: number, phi: number): number {
  const dy = y - b.y;
  const sy = dy < 0 ? b.below : b.above;
  let dp = phi - (b.phi * Math.PI) / 180;
  dp = Math.atan2(Math.sin(dp), Math.cos(dp));
  const sp = (b.spread * Math.PI) / 180;
  return b.amp * Math.exp(-0.5 * (dy / sy) ** 2) * Math.exp(-0.5 * (dp / sp) ** 2);
}

const cr = (p0: number, p1: number, p2: number, p3: number, s: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s + (-p0 + 3 * p1 - 3 * p2 + p3) * s * s * s);

/** 단면 목록 → 촘촘한 단면 (Catmull-Rom), 각도마다 반지름 */
function loftFrom(sections: Section[], bumps: Bump[], o: { sw: number; sh: number; y0: number; A?: number; step?: number }): Loft {
  const A = o.A ?? 72;
  const step = o.step ?? 0.7;
  const ks = sections.map((s) => ({ y: s.y, w: s.w, df: s.df, db: s.db, cz: s.cz ?? 0, n: s.n ?? 2 }));
  const at = (i: number) => ks[Math.max(0, Math.min(ks.length - 1, i))]!;
  const out: Loft = { y: [], cx: [], cz: [], A, r: [] };
  const push = (s: Required<Section>) => {
    out.y.push(o.y0 + s.y * o.sh);
    out.cx.push(0);
    out.cz.push(s.cz * o.sw);
    for (let a = 0; a < A; a++) {
      const phi = (2 * Math.PI * a) / A;
      let r = superR(phi, s);
      for (const b of bumps) r += bumpAt(b, s.y, phi);
      out.r.push(Math.max(0.05, r) * o.sw);
    }
  };
  for (let i = 0; i < ks.length - 1; i++) {
    const n = Math.max(1, Math.ceil((ks[i + 1]!.y - ks[i]!.y) / step));
    for (let j = 0; j < n; j++) {
      const f = j / n;
      const p0 = at(i - 1);
      const p1 = at(i);
      const p2 = at(i + 1);
      const p3 = at(i + 2);
      push({
        y: p1.y + (p2.y - p1.y) * f,
        w: Math.max(0.2, cr(p0.w, p1.w, p2.w, p3.w, f)),
        df: Math.max(0.2, cr(p0.df, p1.df, p2.df, p3.df, f)),
        db: Math.max(0.2, cr(p0.db, p1.db, p2.db, p3.db, f)),
        cz: cr(p0.cz, p1.cz, p2.cz, p3.cz, f),
        n: Math.max(1.6, cr(p0.n, p1.n, p2.n, p3.n, f)),
      });
    }
  }
  push(ks[ks.length - 1]!);
  return out;
}

/** 단면 i에서 각도 phi의 반지름 (각도 사이는 부드럽게) */
export function loftRadius(L: Loft, i: number, phi: number): number {
  const A = L.A;
  const x = ((((phi / (2 * Math.PI)) % 1) + 1) % 1) * A;
  const a1 = Math.floor(x) % A;
  const f = x - Math.floor(x);
  const base = i * A;
  const g = (k: number) => L.r[base + ((k % A) + A) % A]!;
  return Math.max(0.01, cr(g(a1 - 1), g(a1), g(a1 + 1), g(a1 + 2), f));
}

/** 둘레 (cm) — 단면 i */
export function loftGirth(L: Loft, i: number, n = 180): number {
  let s = 0;
  let prev: [number, number] | null = null;
  let first: [number, number] | null = null;
  for (let k = 0; k < n; k++) {
    const phi = (2 * Math.PI * k) / n;
    const r = loftRadius(L, i, phi);
    const p: [number, number] = [r * Math.cos(phi), r * Math.sin(phi)];
    if (prev) s += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    else first = p;
    prev = p;
  }
  return s + Math.hypot(first![0] - prev![0], first![1] - prev![1]);
}

/** 단면을 쌓은 면 (u: 둘레, 앞이 u = 0.25 · k: 단면 번호) */
export function loftSheet(L: Loft, segs = 112): Sheet {
  const R = L.y.length - 1;
  const pt = (i: number, phi: number): Vec3 => {
    const ii = Math.max(0, Math.min(R, i));
    const r = loftRadius(L, ii, phi);
    return [L.cx[ii]! + r * Math.cos(phi), L.y[ii]!, L.cz[ii]! + r * Math.sin(phi)];
  };
  return {
    rows: R,
    closed: true,
    segs,
    at(u, k) {
      const phi = Math.PI - 2 * Math.PI * u;
      const kk = Math.max(0, Math.min(R, k));
      const i = Math.min(R - 1, Math.floor(kk));
      const f = kk - i;
      const a = pt(i, phi);
      const b = pt(i + 1, phi);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    },
    inside(_u, k) {
      const kk = Math.max(0, Math.min(R, k));
      const i = Math.min(R - 1, Math.floor(kk));
      const f = kk - i;
      return [0, L.y[i]! + (L.y[i + 1]! - L.y[i]!) * f, L.cz[i]! + (L.cz[i + 1]! - L.cz[i]!) * f];
    },
  };
}

/** 높이 y, 방향 theta에서 단면 겉면까지의 거리 (그 높이에 몸이 없으면 0) */
export function loftReach(L: Loft, theta: number, y: number): number {
  for (let i = 0; i < L.y.length - 1; i++) {
    const a = L.y[i]!;
    const b = L.y[i + 1]!;
    if (y < a || y > b || b <= a) continue;
    const f = (y - a) / (b - a);
    return loftRadius(L, i, theta) * (1 - f) + loftRadius(L, i + 1, theta) * f + (L.cz[i]! * (1 - f) + L.cz[i + 1]! * f) * Math.sin(theta);
  }
  return 0;
}

/* ───────── 머리: 덩어리를 부드럽게 합친 모양을 높이마다 잘라 단면으로 ───────── */

/** 거리 함수 하나 (안 < 0). lo..hi = 영향을 주는 높이 범위 */
type Prim = { lo: number; hi: number; k: number; sub: boolean; base?: boolean; d: (x: number, y: number, z: number) => number };

function ellipsoid(c: P3, r: P3, k: number, sub = false): Prim {
  // 부드럽게 붙는 범위까지 넉넉히 (범위를 너무 좁게 자르면 그 높이에서 겉면이 끊겨 줄무늬가 생김)
  return {
    lo: c[1] - r[1] - 2 * k - 0.5,
    hi: c[1] + r[1] + 2 * k + 0.5,
    k,
    sub,
    d(x, y, z) {
      const X = (x - c[0]) / r[0];
      const Y = (y - c[1]) / r[1];
      const Z = (z - c[2]) / r[2];
      const k0 = Math.sqrt(X * X + Y * Y + Z * Z);
      const k1 = Math.sqrt((X / r[0]) ** 2 + (Y / r[1]) ** 2 + (Z / r[2]) ** 2);
      return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
    },
  };
}

/** 굵기가 변하는 막대 (a에서 ra, b에서 rb) */
function rod(a: P3, ra: number, b: P3, rb: number, k: number): Prim {
  const ba: P3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const bb = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2] || 1;
  return {
    lo: Math.min(a[1] - ra, b[1] - rb) - 2 * k - 0.5,
    hi: Math.max(a[1] + ra, b[1] + rb) + 2 * k + 0.5,
    k,
    sub: false,
    d(x, y, z) {
      const px = x - a[0];
      const py = y - a[1];
      const pz = z - a[2];
      const h = Math.max(0, Math.min(1, (px * ba[0] + py * ba[1] + pz * ba[2]) / bb));
      return Math.hypot(px - ba[0] * h, py - ba[1] * h, pz - ba[2] * h) - (ra + (rb - ra) * h);
    },
  };
}

/** 머리뼈: 가로 단면은 앞뒤 깊이가 다른 둥근 사각형(지수 n), 세로는 타원 */
function skullPrim(s: Extract<Part, { skull: unknown }>['skull'], k: number): Prim {
  const m = Math.min(s.w, s.h, s.f, s.b);
  return {
    lo: s.y - s.h - k,
    hi: s.y + s.h + k,
    k,
    sub: false,
    d(x, y, z) {
      const dz = z - s.z;
      const X = Math.abs(x) / s.w;
      const Z = Math.abs(dz) / (dz >= 0 ? s.f : s.b);
      const Y = (y - s.y) / s.h;
      const hor = Math.pow(Math.pow(X, s.n) + Math.pow(Z, s.n), 2 / s.n);
      return (Math.sqrt(hor + Y * Y) - 1) * m;
    },
  };
}

const mirror = (p: P3): P3 => [-p[0], p[1], p[2]];

function skullOf(f: FaceSpec) {
  const s = f.find((p): p is Extract<Part, { skull: unknown }> => 'skull' in p);
  return s!.skull;
}

/** 덩어리 목록 → 거리 함수들 (왼쪽 짝 포함, 적힌 순서대로 붙이고 파냄) */
function headPrims(f: FaceSpec): Prim[] {
  const out: Prim[] = [];
  for (const p of f) {
    if ('skull' in p) out.push({ ...skullPrim(p.skull, 0), base: true });
    else if ('e' in p) {
      // 큰 덩어리(반지름 1.5cm 넘음)는 단면 가운데를 정할 때도 씀 (코·입술·귀처럼 작은 것은 빼서 가운데가 튀지 않게)
      const base = !p.sub && Math.min(...p.r) >= 1.5;
      out.push({ ...ellipsoid(p.e, p.r, p.k, p.sub), base });
      if (p.sym) out.push({ ...ellipsoid(mirror(p.e), p.r, p.k, p.sub), base });
    } else {
      const [a, ra, b, rb] = p.rod;
      out.push(rod(a, ra, b, rb, p.k));
      // 가운데를 가로지르는 막대(눈썹뼈)는 이미 양쪽
      if (p.sym) out.push(rod(mirror(a), ra, mirror(b), rb, p.k));
    }
  }
  return out;
}

function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function evalPrims(ps: Prim[], x: number, y: number, z: number): number {
  let d = Infinity;
  for (const p of ps) {
    const v = p.d(x, y, z);
    if (p.sub) d = -smin(-d, v, p.k);
    else d = d === Infinity || p.k <= 0 ? Math.min(d, v) : smin(d, v, p.k);
  }
  return d;
}

/**
 * 높이마다 잘라 단면으로 (가운데에서 바깥으로 가장 먼 겉면까지의 거리). 귀 뒤 틈처럼 가운데에서
 * 안 보이는 곳은 메워짐. 단면 가운데는 그 높이 가운데 줄(x = 0)의 앞뒤 중간
 */
function sampleHead(ps: Prim[], y0: number, y1: number, step: number, A: number): Loft {
  const out: Loft = { y: [], cx: [], cz: [], A, r: [] };
  const R = 16;
  type Row = { y: number; act: Prim[]; cz: number };
  const rows: Row[] = [];
  // 1) 높이마다 가운데 줄(x = 0)의 앞뒤 끝 (큰 덩어리만) → 가운데
  for (let y = y0; y <= y1 + 1e-9; y += step) {
    const act = ps.filter((p) => y >= p.lo && y <= p.hi);
    const base = act.filter((p) => p.base);
    const fb = (z: number) => evalPrims(base.length ? base : act, 0, y, z);
    let zmin = Infinity;
    let zmax = -Infinity;
    for (let z = -14; z <= 14; z += 0.2) {
      if (fb(z) < 0) {
        zmin = Math.min(zmin, z);
        zmax = Math.max(zmax, z);
      }
    }
    if (!Number.isFinite(zmin)) {
      rows.push({ y, act, cz: NaN });
      continue;
    }
    // 끝을 반으로 나눠 좁힘 (격자 0.2cm 계단이 단면마다 튀지 않게)
    const edge = (inside: number, outside: number) => {
      let a = inside;
      let b = outside;
      for (let k = 0; k < 10; k++) {
        const m = (a + b) / 2;
        if (fb(m) < 0) a = m;
        else b = m;
      }
      return (a + b) / 2;
    };
    rows.push({ y, act, cz: (edge(zmin, zmin - 0.2) + edge(zmax, zmax + 0.2)) / 2 });
  }
  const first = rows.findIndex((x) => !Number.isNaN(x.cz));
  const last = rows.length - 1 - [...rows].reverse().findIndex((x) => !Number.isNaN(x.cz));
  const keep = rows.slice(first, last + 1);
  // 2) 가운데를 위아래로 부드럽게 (단면마다 가운데가 흔들리면 겉면 그늘이 물결져 보임)
  const raw = keep.map((x) => x.cz);
  const w = [1, 2, 3, 2, 1];
  keep.forEach((row, i) => {
    let s = 0;
    let ws = 0;
    for (let d = -2; d <= 2; d++) {
      const v = raw[i + d];
      if (v === undefined) continue;
      s += v * w[d + 2]!;
      ws += w[d + 2]!;
    }
    row.cz = s / ws;
  });
  // 3) 가운데에서 바깥으로 가장 먼 겉면까지 (귀 뒤 틈처럼 가운데에서 안 보이는 곳은 메워짐)
  const radii = keep.map((row) => {
    const f = (x: number, z: number) => evalPrims(row.act, x, row.y, z);
    const r: number[] = [];
    for (let a = 0; a < A; a++) {
      const phi = (2 * Math.PI * a) / A;
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      // 바깥에서 안으로 걸어 들어오다 처음 안에 닿는 곳 → 그 사이를 반으로 나눠 좁힘
      let out0 = R;
      let t = R;
      let v = f(c * t, row.cz + sn * t);
      while (t > 0 && v >= 0) {
        out0 = t;
        t -= Math.max(0.12, Math.min(1.5, v * 0.6));
        v = f(c * t, row.cz + sn * t);
      }
      if (t <= 0) {
        r.push(0.05);
        continue;
      }
      let lo = t;
      let hi = out0;
      for (let k = 0; k < 12; k++) {
        const m = (lo + hi) / 2;
        if (f(c * m, row.cz + sn * m) < 0) lo = m;
        else hi = m;
      }
      r.push((lo + hi) / 2);
    }
    return r;
  });
  // 위아래는 옆 단면 가운데의 아주 작은 고리로 닫음
  const cap = new Array<number>(A).fill(0.05);
  const put = (y: number, cz: number, r: number[]) => {
    out.y.push(y);
    out.cx.push(0);
    out.cz.push(cz);
    out.r.push(...r);
  };
  put(keep[0]!.y - step * 0.5, keep[0]!.cz, cap);
  keep.forEach((row, i) => put(row.y, row.cz, radii[i]!));
  put(keep[keep.length - 1]!.y + step * 0.5, keep[keep.length - 1]!.cz, cap);
  return out;
}

const unitHeads = new Map<BodyKind, Loft>();
/** 기준 크기 머리 (턱 끝 y = 0) — 종류마다 한 번 만들어 둠 */
export function unitHead(kind: BodyKind): Loft {
  const hit = unitHeads.get(kind);
  if (hit) return hit;
  const f = BODY_SPECS[kind].face;
  const sk = skullOf(f);
  const L = sampleHead(headPrims(f), -0.8, sk.y + sk.h + 0.6, 0.35, 144);
  unitHeads.set(kind, L);
  return L;
}

/** 머리 꼭대기 (턱 끝에서 잰 높이, 기준 크기) */
export function headTop(kind: BodyKind): number {
  const L = unitHead(kind);
  return L.y[L.y.length - 1]!;
}

/** 단면 쌓기를 s배로 키워 턱 끝을 y0에 */
function scaleLoft(L: Loft, s: number, y0: number): Loft {
  return { y: L.y.map((y) => y0 + y * s), cx: L.cx.map((x) => x * s), cz: L.cz.map((z) => z * s), A: L.A, r: L.r.map((r) => r * s) };
}

/** 곧은 축 (허벅지, 받침 목): a에서 b로, t = a에서 잰 거리 */
export function lineAxis(a: Vec3, b: Vec3): Axis {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
  const y: Vec3 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
  // 축에 수직인 틀: z는 앞쪽에 가깝게
  let z: Vec3 = [-y[2] * y[0], -y[2] * y[1], 1 - y[2] * y[2]];
  const zl = Math.hypot(z[0], z[1], z[2]) || 1;
  z = [z[0] / zl, z[1] / zl, z[2] / zl];
  const x: Vec3 = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
  return { at: (t) => ({ p: [a[0] + y[0] * t, a[1] + y[1] * t, a[2] + y[2] * t], x, y, z }) };
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const along = (p: Vec3, d: Vec3, s: number): Vec3 => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];

/** 꺾은선을 따라가는 축 (굽은 손가락): t = 첫 점에서 잰 길이, 방향은 점 사이를 부드럽게. z는 fwd 쪽에 가깝게 */
export function pathAxis(pts: Vec3[], fwd: Vec3): Axis {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(...sub3(pts[i]!, pts[i - 1]!)));
  // 점마다 접선 (앞뒤 구간 평균)
  const tan = pts.map((_, i) => norm3(sub3(pts[Math.min(pts.length - 1, i + 1)]!, pts[Math.max(0, i - 1)]!)));
  return {
    at(t) {
      let i = 0;
      while (i < pts.length - 2 && cum[i + 1]! < t) i++;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const g = (t - cum[i]!) / (cum[i + 1]! - cum[i]! || 1);
      const p: Vec3 = [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, a[2] + (b[2] - a[2]) * g];
      const gc = Math.max(0, Math.min(1, g));
      const y = norm3([tan[i]![0] + (tan[i + 1]![0] - tan[i]![0]) * gc, tan[i]![1] + (tan[i + 1]![1] - tan[i]![1]) * gc, tan[i]![2] + (tan[i + 1]![2] - tan[i]![2]) * gc]);
      const z = norm3(along(fwd, y, -dot3(fwd, y)));
      const x: Vec3 = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
      return { p, x, y, z };
    },
  };
}

/** 관 모양 몸 부분의 면. 단면 n > 2면 둥근 사각형 (손바닥처럼 납작하고 모서리가 살짝 각짐) */
export function limbSheet(l: Limb, segs: number): Sheet {
  const base = axisSheet(l.rings, l.axis, segs);
  const n = l.n ?? 2;
  if (n === 2) return base;
  const e = 2 / n;
  return {
    ...base,
    at(u, k) {
      const r = ringAt(l.rings, k);
      const f = l.axis.at(r.t);
      const phi = Math.PI - 2 * Math.PI * u;
      const c = Math.cos(phi);
      const si = Math.sin(phi);
      const cx = r.rx * Math.sign(c) * Math.pow(Math.abs(c), e);
      const cz = r.rz * Math.sign(si) * Math.pow(Math.abs(si), e);
      return [f.p[0] + f.x[0] * cx + f.z[0] * cz, f.p[1] + f.x[1] * cx + f.z[1] * cz, f.p[2] + f.x[2] * cx + f.z[2] * cz];
    },
  };
}

/* ───────── 몸 맞추기 ───────── */

/** 관 모양 몸 부분. n: 단면 모양 (2 = 타원, 클수록 모서리가 각진 둥근 사각형) */
export type Limb = { axis: Axis; rings: Ring[]; n?: number };

export type BodyModel = {
  kind: BodyKind;
  /** 몸통 (목까지). 모자 받침이면 null */
  torso: Loft | null;
  head: Loft;
  /** 팔 (소매 축을 따라). 손목까지 */
  arms: Limb[];
  /** 손: 손바닥·손가락 덩어리와 엄지 */
  hands: Limb[];
  /** 허벅지, 받침의 목 */
  limbs: Limb[];
  pole: { a: Vec3; b: Vec3; r: number } | null;
  base: { c: Vec3; r: number; h: number } | null;
  /** 머리 꼭대기 높이 (카메라 맞출 때) */
  top: number;
  /** 목 밑동: 요크 목둘레가 걸리는 자리 */
  neck: { y: number; rx: number; rz: number };
};

const girthCache = new Map<BodyKind, number>();
/** 기준 몸의 가슴(가장 굵은 윗몸) 둘레 */
export function specChest(kind: BodyKind): number {
  const hit = girthCache.get(kind);
  if (hit) return hit;
  const L = loftFrom(BODY_SPECS[kind].torso, BODY_SPECS[kind].bumps, { sw: 1, sh: 1, y0: 0 });
  let g = 0;
  L.y.forEach((y, i) => {
    if (y >= -12 && y <= 0) g = Math.max(g, loftGirth(L, i));
  });
  girthCache.set(kind, g);
  return g;
}

const headCache = new Map<BodyKind, number>();
/** 기준 머리의 가장 굵은 둘레 (귀 바로 위 이마~뒤통수) */
export function specHeadGirth(kind: BodyKind): number {
  const hit = headCache.get(kind);
  if (hit) return hit;
  const H = unitHead(kind);
  const sk = skullOf(BODY_SPECS[kind].face);
  let g = 0;
  H.y.forEach((y, i) => {
    // 귀 위 이마~뒤통수 둘레 (모자 둘레를 재는 자리)
    if (y >= sk.y - 1.5 && y <= sk.y + 2.5) g = Math.max(g, loftGirth(H, i));
  });
  headCache.set(kind, g);
  return g;
}

function ellipsePerimeter(a: number, b: number) {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

function find(L: Layout, r: SimRole): ArtPiece | undefined {
  return [...L.roles].find(([, x]) => x === r)?.[0];
}

/** 팔 고리 (소매 축의 t 좌표): 어깨 꼭대기 tTop에서 아래로 */
function armRings(spec: Spec, tTop: number, sw: number, sh: number): Ring[] {
  const keys = spec.arm.map(([s, rx, rz]) => ({ t: tTop - s * sh, rx: rx * sw, rz: rz * sw })).sort((a, b) => a.t - b.t);
  return smoothKeys(keys, 4);
}

/**
 * 손목에 붙인 손: 손바닥이 허벅지 쪽을 보고 손가락은 그쪽으로 살짝 굽어요. 엄지는 앞 가장자리에서 앞·아래로.
 * 축 방향은 팔과 같게 (손끝 → 손목)
 */
function handFor(spec: Spec, arm: Limb, tTop: number, sw: number, sh: number): Limb[] {
  const f = arm.axis.at(tTop - spec.wrist * sh);
  const down: Vec3 = [-f.y[0], -f.y[1], -f.y[2]];
  const side = Math.sign(f.p[0]) || 1;
  const inw = norm3(along([-side, 0, 0], down, side * down[0]));
  const fwd = norm3(along(f.z, down, -dot3(f.z, down)));
  const ls = spec.hand.s * sh;
  const ws = spec.hand.w * sw;
  const a0 = HAND[0]![0] * ls;
  const L = HAND[HAND.length - 1]![0] * ls;
  const curl = 1.6 * ws;
  const pt = (a: number): Vec3 => along(along(f.p, down, a), inw, curl * Math.pow(Math.max(0, a) / L, 2));
  const M = 24;
  const pts: Vec3[] = [];
  for (let i = 0; i <= M; i++) pts.push(pt(L - ((L - a0) * i) / M));
  const hand: Limb = {
    axis: pathAxis(pts, fwd),
    rings: smoothKeys(
      HAND.map(([a, w, h]) => ({ t: L - a * ls, rx: h * ws, rz: w * ws })).sort((p, q) => p.t - q.t),
      4,
    ),
    n: 2.6,
  };
  const tl = THUMB[THUMB.length - 1]![0] * ls;
  const root = along(along(pt(2 * ls), fwd, 2.25 * ws), inw, 0.45 * ws);
  const dir = norm3([down[0] * 0.9 + fwd[0] * 0.3 + inw[0] * 0.28, down[1] * 0.9 + fwd[1] * 0.3 + inw[1] * 0.28, down[2] * 0.9 + fwd[2] * 0.3 + inw[2] * 0.28]);
  const thumb: Limb = {
    axis: lineAxis(along(root, dir, tl), root),
    rings: smoothKeys(
      THUMB.map(([a, r]) => ({ t: tl - a * ls, rx: r * ws, rz: r * ws * 0.88 })).sort((p, q) => p.t - q.t),
      4,
    ),
  };
  return [hand, thumb];
}

function thighs(spec: Spec, armpitY: number, sw: number, sh: number): Limb[] {
  const T = spec.thigh;
  return [-1, 1].map((side) => {
    const a: Vec3 = [side * T.x * sw, armpitY + T.top * sh, 0];
    const b: Vec3 = [side * (T.x - T.inward) * sw, armpitY + T.bottom * sh, 0.6 * sw];
    const axis = lineAxis(a, b);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const scale = len / Math.max(1, T.r[T.r.length - 1]![0]);
    const rings = smoothKeys(
      T.r.map(([s, r]) => ({ t: s * scale, rx: r * sw, rz: r * sw * 1.04 })),
      4,
    );
    return { axis, rings };
  });
}

/**
 * 옷(스웨터)에 맞춘 몸. 가슴둘레는 옷보다 6% 작게, 겨드랑이는 옷 윗단보다 조금 위,
 * 팔은 소매 축을 따라(손목이 소맷부리 근처). 소매가 없으면 기본 자세로 팔을 내림.
 */
export function bodyFor(kind: BodyKind, L: Layout, tubes: Map<ArtPiece, Tube>, axes: Map<ArtPiece, Axis>): BodyModel {
  const spec = BODY_SPECS[kind];
  const main = find(L, 'body') ?? find(L, 'front');
  const tube = main ? tubes.get(main) : undefined;
  let chest = specChest(kind) * 1.06;
  if (tube) {
    // 윗부분(겨드랑이 쪽 30%) 둘레의 평균
    const sorted = [...tube.rings].sort((a, b) => a.t - b.t);
    const top = sorted.slice(Math.floor(sorted.length * 0.6));
    chest = top.reduce((s, r) => s + ellipsePerimeter(r.rx, r.rz || r.rx * 0.76), 0) / Math.max(1, top.length);
  }
  const sw = Math.max(0.5, Math.min(1.3, chest / 1.06 / specChest(kind)));
  const sh = Math.max(0.6, Math.min(1.15, Math.pow(sw, 0.6)));
  const armpitY = L.topY + 1.5 * sh;
  const torso = loftFrom(spec.torso, spec.bumps, { sw, sh, y0: armpitY });
  const hs = (sw + sh) / 2;
  const chinY = armpitY + spec.chin * sh;
  const head = scaleLoft(unitHead(kind), hs, chinY);

  const arms: Limb[] = [];
  const hands: Limb[] = [];
  const addArm = (axis: Axis, tTop: number) => {
    const arm = { axis, rings: armRings(spec, tTop, sw, sh) };
    arms.push(arm);
    hands.push(...handFor(spec, arm, tTop, sw, sh));
  };
  for (const side of ['sleeveL', 'sleeveR'] as const) {
    const s = find(L, side);
    const t = s ? tubes.get(s) : undefined;
    const axis = s ? axes.get(s) : undefined;
    if (t && axis) addArm(axis, t.length + 5 * sh);
  }
  if (arms.length < 2) {
    // 소매가 없는 옷(조끼)이나 빈 마네킹: 어깨에서 비스듬히 내린 팔
    const acromion = (spec.torso.find((x) => x.y >= 8)?.w ?? 17) * sw;
    const len = 40 * sh;
    for (const sx of [-1, 1]) {
      if (arms.length >= 2) break;
      const tilt = sx * ARM_ANGLE;
      const anchor: Vec3 = [sx * (acromion + 1.2 * sw), armpitY + 2.5 * sh, 0];
      const dir = [-Math.sin(tilt), Math.cos(tilt)];
      const pl: Placement = { origin: [anchor[0] - dir[0]! * len, anchor[1] - dir[1]! * len, 0], tilt };
      addArm(armAxis(pl, len), len + 5 * sh);
    }
  }

  const limbs = thighs(spec, armpitY, sw, sh);
  const crotchY = armpitY + spec.torso[1]!.y * sh;
  const legBottom = armpitY + spec.thigh.bottom * sh;
  const baseY = legBottom - 20 * sh;
  const neckBase = spec.torso.find((x) => x.y === spec.neckY)!;
  return {
    kind,
    torso,
    head,
    arms,
    hands,
    limbs,
    pole: { a: [0, crotchY + 1, -0.6 * sw], b: [0, baseY, -0.6 * sw], r: 0.9 * Math.max(0.8, sw) },
    base: { c: [0, baseY - 0.8, -0.6 * sw], r: 13 * sw, h: 1.6 },
    top: chinY + headTop(kind) * hs,
    neck: { y: armpitY + neckBase.y * sh, rx: spec.neckFit.w * sw, rz: spec.neckFit.d * sw },
  };
}

/**
 * 모자를 펼친 타원 머리는 사람 머리보다 정수리 쪽이 길어서, 정수리를 맞추면 챙이 눈까지 내려와요.
 * 사람 머리를 이만큼(기준 cm) 내려 챙이 눈썹 바로 위 이마에 오게 (모자 꼭대기에 살짝 여유가 생김)
 */
const HAT_LIFT = -1;

/** 모자 받침: 사람 머리(모자 둘레에 맞춘 크기) + 목 + 받침대 */
export function standFor(kind: BodyKind, L: Layout): BodyModel {
  const spec = BODY_SPECS[kind];
  const h = L.head!;
  // 모자를 펼쳐 씌운 타원 머리와 둘레가 같게 (사람 머리는 앞뒤로 길고 조금 각져서, 너비로 맞추면
  // 둘레가 10% 커져 모자가 정수리에 얹혀 버려요)
  const hs = ellipsePerimeter(h.rh, h.rz) / specHeadGirth(kind);
  const crown = h.cy + h.rv;
  const top = headTop(kind);
  const chinY = crown - top * hs + HAT_LIFT * hs;
  const head = scaleLoft(unitHead(kind), hs, chinY);
  // 목: 몸에 붙은 목과 같은 자리 — 턱 끝보다 뒤에서 올라가 뒤통수 밑으로 들어가고, 아래는 받침으로 퍼짐
  const neckR = spec.neck * hs;
  const neckTop: Vec3 = [0, chinY + 6.8 * hs, -2.3 * hs];
  const neckBottom: Vec3 = [0, chinY - 9 * hs, -0.9 * hs];
  const nl = Math.hypot(neckBottom[0] - neckTop[0], neckBottom[1] - neckTop[1], neckBottom[2] - neckTop[2]);
  const neck: Limb = {
    axis: lineAxis(neckTop, neckBottom),
    rings: smoothKeys(
      [
        { t: 0, rx: 0.4, rz: 0.4 },
        { t: 0.7 * hs, rx: neckR * 0.72, rz: neckR * 0.7 },
        { t: 2.2 * hs, rx: neckR * 0.97, rz: neckR * 0.94 },
        { t: nl * 0.55, rx: neckR, rz: neckR * 0.96 },
        { t: nl * 0.9, rx: neckR * 1.16, rz: neckR * 1.06 },
        { t: nl, rx: neckR * 1.22, rz: neckR * 1.1 },
        { t: nl + 0.8, rx: neckR * 0.6, rz: neckR * 0.6 },
        { t: nl + 1, rx: 0.3, rz: 0.3 },
      ],
      4,
    ),
  };
  const baseY = neckBottom[1] - 14 * hs;
  return {
    kind,
    torso: null,
    head,
    arms: [],
    hands: [],
    limbs: [neck],
    pole: { a: [0, neckBottom[1] - 0.5, neckBottom[2]], b: [0, baseY, neckBottom[2]], r: 0.8 },
    base: { c: [0, baseY - 0.8, neckBottom[2]], r: h.rh * 1.05, h: 1.6 },
    top: chinY + top * hs,
    neck: { y: neckBottom[1], rx: neckR, rz: neckR },
  };
}

/** 아무것도 안 입은 마네킹 (새 작품 자리) */
export function emptyBody(kind: BodyKind): BodyModel {
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
  return bodyFor(kind, L, new Map(), new Map());
}

/** 입힌 모양에 맞는 마네킹 (판처럼 몸에 걸칠 수 없는 조각만 있으면 null) */
export function bodyOf(kind: BodyKind, L: Layout, tubes: Map<ArtPiece, Tube>, axes: Map<ArtPiece, Axis>): BodyModel | null {
  if (L.isHat && L.head) return standFor(kind, L);
  if ([...L.roles.values()].includes('panel')) return null;
  return bodyFor(kind, L, tubes, axes);
}
