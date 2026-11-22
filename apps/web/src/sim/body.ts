import { axisSheet, ringAt, type Axis, type Sheet, type Vec3 } from './drape';
import { smoothKeys } from './form';
import { type Layout, type Ring, type SimRole, type Tube } from './shape';
import type { ArtPiece } from '../closet/assembledArt';
import { femaleForm, type FormMesh } from './formMesh';
import { fitForm, outerLoops, radial, torsoLoop, type FormFit } from './formFit';

/**
 * 사람 모양 마네킹 (three.js 없이 숫자만 — 화면에 그릴 때도, 천 시뮬레이션의 부딪힘에도 같은 모양).
 * 매장 패션 마네킹 스타일: 무광 회색, 넓은 달걀형 에그헤드(콧대만 있는 얼굴), 도톰한 목, 이음선.
 * 비율은 레퍼런스 사진(패션 마네킹)을 머리 높이 기준으로 재서 맞췄어요 (턱·어깨·가슴·밑가슴·배꼽·사타구니 높이, 머리·목·어깨 너비).
 *
 * 몸통은 높이마다 단면(앞·뒤 깊이가 다른 둥근 사각형)을 쌓고(로프트) 가슴·견갑골·척추 골·엉덩이·쇄골·
 * 목빗근·배꼽·겨드랑이 같은 굴곡을 더해요. 목은 턱 끝보다 뒤에서 올라가 턱 밑이 드러나고 목덜미는 뒤통수 속으로.
 * 머리는 덩어리(머리뼈·뒤통수·넓은 달걀 얼굴·콧대·귀)를 부드럽게 합친 모양을 높이마다 잘라 단면으로.
 * 어깨는 몸통의 둥근 어깨 공(삼각근)으로 승모근 비탈에서 끊김 없이 이어지고, 팔은 그 아래에서 이두 → 팔꿈치 → 아래팔 → 손목,
 * 손은 손바닥·엄지·손가락 넷.
 * 옷을 입히면 소매 축을 따라, 빈 마네킹은 위팔을 몸 옆에 곧게 내림. 다리는 엉덩이 안에서 무릎·종아리·발목·발까지, 발밑에 얇은 판.
 *
 * 치수는 패션 마네킹 비율(여자: 가슴 82 · 허리 60 · 엉덩이 89, 남자: 가슴 93 · 허리 75 · 엉덩이 87)이고,
 * 옷의 가슴둘레에 맞춰 크기를 줄이거나 키워요 (옷보다 6% 작게 = 보통 여유).
 * 단위 cm, y 위, +z 앞, +x 오른쪽. 높이는 겨드랑이 = 0 기준.
 */

export type BodyKind = 'female' | 'male';
export const BODY_KINDS: BodyKind[] = ['female', 'male'];

/** 높이마다 중심과 각도별 반지름. 각도 a ↔ φ = 2πa/A (0 = +x 오른쪽, π/2 = +z 앞) */
export type Loft = { y: number[]; cx: number[]; cz: number[]; A: number; r: number[] };

type Section = { y: number; w: number; df: number; db: number; cz?: number; n?: number };
/** 단면에 더하는 굴곡: 높이 y 근처(아래 below, 위 above 폭), 각도 phi(도, 90 = 앞) 근처(spread 폭)에 amp cm */
type Bump = { y: number; below: number; above: number; phi: number; spread: number; amp: number; p?: number };
/**
 * 가슴: 꼭지 높이 y, 각도 phi(도), 안쪽(가운데 골 쪽)·바깥 반너비 wIn·wOut, 위로 up·아래로 down 퍼짐, 튀어나옴 d (cm).
 * 둥근 돔: 위쪽은 쇄골 아래에서 완만하게 차오르고, 아래쪽은 둥글게 차서 몸과 만나는 곳에서 접히고(밑가슴),
 * 바깥은 옆구리로 부드럽게, 안쪽은 둥글게 (두 가슴 사이는 얕은 골)
 */
type Breast = { y: number; phi: number; wIn: number; wOut: number; up: number; down: number; d: number };

function breastAt(b: Breast, y: number, phi: number, R: number): number {
  const v = y - b.y;
  if (v > b.up || v < -b.down) return 0;
  let dp = phi - (b.phi * Math.PI) / 180;
  dp = Math.atan2(Math.sin(dp), Math.cos(dp));
  const u = dp * R;
  // 오른쪽 가슴(phi < 90)은 phi가 커지는 쪽이 안쪽
  const inward = (b.phi < 90 ? u : -u) > 0;
  const U = Math.abs(u) / (inward ? b.wIn : b.wOut);
  const V = v >= 0 ? v / b.up : -v / b.down;
  const q = U * U + V * V;
  if (q >= 1) return 0;
  // 가장자리로 갈 때 낮아지는 모양 (지수가 작을수록 끝까지 둥글게 차서 또렷이 접힘):
  // 위 3 (쇄골 아래에서 완만한 비탈), 아래 0.95 (둥글게 차서 밑가슴 주름), 바깥 2 (옆구리로 스며듦), 안 1.6
  const s2 = q > 1e-9 ? (V * V) / q : 0;
  const side = inward ? 1.5 : 2;
  const p = side + ((v >= 0 ? 2.3 : 1.15) - side) * s2;
  return b.d * Math.pow(1 - q, p);
}

type P3 = [number, number, number];
/**
 * 머리 조각: 덩어리 목록 (cm, y = 턱 끝에서 잰 높이, z = 앞+). 큰 덩어리(머리뼈·얼굴·아래턱)는 아주 부드럽게,
 * 작은 것(턱끝·코)은 덜 부드럽게 붙여요. sym = 왼쪽에도, sub = 파냄. k = 앞 덩어리들과 이어 붙이는 부드러움 (cm).
 * 눈·입술·귀를 새기면 오히려 우스꽝스러워서(웃는 얼굴처럼 보임) 매장 마네킹처럼 코만 남김
 */
type Part =
  | { skull: { y: number; z: number; w: number; h: number; f: number; b: number; n: number; nv?: number } }
  | { e: P3; r: P3; k: number; sym?: boolean; sub?: boolean; tilt?: number; taper?: number; keel?: number }
  | { rod: [P3, number, P3, number]; k: number; sym?: boolean };
type FaceSpec = Part[];

type Spec = {
  torso: Section[];
  bumps: Bump[];
  /** 여자 가슴 */
  breasts?: Breast[];
  /** 머리 (덩어리를 부드럽게 합쳐 조각, cm · 턱 끝 = 0) */
  face: FaceSpec;
  /** 턱 끝 높이 (겨드랑이 기준) */
  chin: number;
  /** 팔 (옷을 입힐 때, 소매 길이에 맞춘 길이): 어깨 꼭대기에서 잰 거리 s, 옆 반지름, 앞뒤 반지름 */
  arm: [number, number, number][];
  /**
   * 빈 마네킹 팔 (사람 비율 길이): 굵기(arm과 같은 꼴), 손목·이음선 자리 s, 어깨 꼭대기 자리 [x, y, z],
   * 팔꿈치 s, 아래팔 방향 [바깥, 아래, 앞]
   */
  free: {
    arm: [number, number, number][];
    wrist: number;
    seams: number[];
    top: [number, number, number];
    upper: [number, number, number];
    elbow: number;
    fore: [number, number, number];
  };
  /** 다리: 허벅지 윗끝(엉덩이 안)·무릎·발목 [가운데에서 떨어진 거리, 높이], 발바닥 높이, 위에서 잰 거리 s별 [옆·앞뒤 반지름, 뒤로 치우침(종아리)], 발 */
  leg: {
    top: [number, number];
    knee: [number, number];
    ankle: [number, number];
    floor: number;
    r: [number, number, number, number][];
    foot: { len: number; w: number; h: number };
  };
  /** 매장 마네킹 이음선: 몸통 위 선들 [각도(도, 90 = 앞), 높이] (좌우 대칭은 sym), 팔 이음 자리(어깨에서 잰 s) */
  seams: { lines: { pts: [number, number][]; sym: boolean }[]; arm: number[] };
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
    { y: -53.4, w: 2, df: 1.5, db: 2 },
    // 몸통 아랫단은 허벅지 윗머리를 덮을 만큼 내려와 엉덩이 → 허벅지 선이 꺾이지 않게 (사타구니는 엉덩이 가장 넓은 곳 바로 아래)
    { y: -51.8, w: 10.5, df: 5, db: 6.8, cz: -0.3 },
    { y: -49, w: 15.4, df: 7.2, db: 9.2, cz: -0.4, n: 2.35 },
    // 골반이 넓고 허리가 잘록한 모래시계: 허리 바로 아래에서 엉덩이가 둥글게 퍼짐 (패션 마네킹: 가슴 84 · 허리 60 · 엉덩이 89)
    { y: -44, w: 16.5, df: 8.3, db: 10.2, cz: -0.4, n: 2.3 },
    { y: -38.5, w: 16, df: 8.2, db: 9.8, cz: -0.3, n: 2.25 },
    { y: -33, w: 14.6, df: 8, db: 8.9, cz: -0.1, n: 2.2 },
    { y: -28, w: 12.4, df: 7.8, db: 7.9, cz: 0.05, n: 2.12 },
    { y: -23, w: 10.4, df: 7.8, db: 7.6, cz: 0.15, n: 2.1 },
    { y: -17, w: 10.8, df: 8.2, db: 7.8, cz: 0.3, n: 2.15 },
    // 가슴통: 옆으로는 좁고(팔이 바로 옆에 곧게 내려옴) 앞뒤로 도톰하게
    { y: -11, w: 11.5, df: 9.2, db: 9.3, cz: 0.4, n: 2.3 },
    { y: -4, w: 12.1, df: 9.6, db: 10.2, cz: 0.3, n: 2.3 },
    { y: 1, w: 11.9, df: 9.1, db: 9.7, cz: 0.1, n: 2.3 },
    // 어깨: 몸통은 어깨뼈 끝까지, 둥근 어깨 끝은 팔 윗머리(삼각근)가 덮음. 목 가까이는 낮고 완만한 승모근 비탈
    // (어깨 끝 단면은 팔 윗머리 속에 숨을 만큼만 — 몸통 모서리가 둥근 어깨 앞으로 삐져나오지 않게)
    { y: 3.6, w: 12, df: 7.9, db: 8.6, cz: 0, n: 2.2 },
    { y: 5, w: 11.8, df: 7.3, db: 8.1, cz: -0.1, n: 2.05 },
    { y: 6.2, w: 11.6, df: 6.7, db: 7.5, cz: -0.2, n: 2 },
    { y: 7.2, w: 11.4, df: 6.1, db: 6.9, cz: -0.25, n: 2 },
    { y: 7.9, w: 11.1, df: 5.7, db: 6.5, cz: -0.3, n: 2 },
    { y: 8.4, w: 10.5, df: 5.4, db: 6.2, cz: -0.35, n: 2 },
    { y: 8.9, w: 9, df: 5.15, db: 5.85, cz: -0.4, n: 2 },
    { y: 9.4, w: 7.6, df: 4.9, db: 5.45, cz: -0.5, n: 2 },
    { y: 9.9, w: 6.6, df: 4.7, db: 5.15, cz: -0.6, n: 2 },
    // 목: 레퍼런스처럼 머리 너비의 0.6쯤 되는 도톰한 원기둥, 턱 끝보다 뒤에서 올라가 뒤통수 밑으로
    { y: 10.4, w: 5.8, df: 4.5, db: 4.9, cz: -0.7, n: 2 },
    { y: 11.4, w: 5.2, df: 4.4, db: 4.7, cz: -0.8, n: 2 },
    { y: 12.6, w: 4.9, df: 4.35, db: 4.6, cz: -0.95, n: 2 },
    { y: 15, w: 4.8, df: 4.3, db: 4.5, cz: -1.25, n: 2 },
    { y: 18, w: 4.75, df: 4.2, db: 4.5, cz: -1.65, n: 2 },
    { y: 21, w: 4.6, df: 4, db: 4.5, cz: -2.05, n: 2 },
    // 목덜미는 뒤통수 속까지 올라가 이어짐 (뒤통수 밑에 오목한 틈이 없게)
    { y: 23, w: 4.4, df: 3.6, db: 4.4, cz: -2.5, n: 2 },
    { y: 24.6, w: 4, df: 3, db: 4.2, cz: -2.8, n: 2 },
    { y: 26.2, w: 3, df: 2.2, db: 3.2, cz: -3, n: 2 },
    { y: 26.6, w: 0.5, df: 0.5, db: 0.5, cz: -3 },
  ],
  bumps: [
    // 견갑골
    { y: -1, below: 7, above: 5, phi: -126, spread: 20, amp: 0.9 },
    { y: -1, below: 7, above: 5, phi: -54, spread: 20, amp: 0.9 },
    // 겨드랑이 오목한 곳 (팔이 몸 옆에 바로 붙어 내려올 자리)
    { y: -5, below: 8, above: 4, phi: 0, spread: 18, amp: -1.6 },
    { y: -5, below: 8, above: 4, phi: 180, spread: 18, amp: -1.6 },
    // 둥근 어깨(삼각근): 승모근 비탈이 끊김 없이 둥근 어깨 공으로 이어지고, 팔은 그 아래에서 나옴
    { y: 4.8, below: 2.6, above: 2.6, phi: 0, spread: 25, amp: 4.8 },
    { y: 4.8, below: 2.6, above: 2.6, phi: 180, spread: 25, amp: 4.8 },
    // 척추 골
    { y: -14, below: 22, above: 16, phi: -90, spread: 6, amp: -0.55 },
    // 엉덩이
    { y: -43.5, below: 4.5, above: 7, phi: -120, spread: 24, amp: 2.5 },
    { y: -43.5, below: 4.5, above: 7, phi: -60, spread: 24, amp: 2.5 },
    // 아랫배(살짝), 배꼽
    { y: -37, below: 5, above: 6, phi: 90, spread: 32, amp: 0.45 },
    { y: -27.5, below: 0.7, above: 0.7, phi: 90, spread: 4.5, amp: -0.45 },
    // 쇄골, 목 아래 오목한 곳(흉골 위)
    { y: 7.7, below: 0.8, above: 0.8, phi: 55, spread: 20, amp: 0.45 },
    { y: 7.7, below: 0.8, above: 0.8, phi: 125, spread: 20, amp: 0.45 },
    { y: 9.1, below: 1.1, above: 0.8, phi: 90, spread: 13, amp: -0.35 },
    // 목빗근: 귀 뒤에서 흉골 위로 모이는 V
    { y: 11, below: 1, above: 1, phi: 72, spread: 10, amp: 0.2 },
    { y: 11, below: 1, above: 1, phi: 108, spread: 10, amp: 0.2 },
    { y: 12.8, below: 1, above: 1, phi: 61, spread: 10, amp: 0.22 },
    { y: 12.8, below: 1, above: 1, phi: 119, spread: 10, amp: 0.22 },
    { y: 14.6, below: 1, above: 1, phi: 51, spread: 10, amp: 0.2 },
    { y: 14.6, below: 1, above: 1, phi: 129, spread: 10, amp: 0.2 },
    { y: 16.4, below: 1, above: 1, phi: 42, spread: 10, amp: 0.17 },
    { y: 16.4, below: 1, above: 1, phi: 138, spread: 10, amp: 0.17 },
  ],
  breasts: [
    { y: -4.6, phi: 52, wIn: 6.8, wOut: 10.2, up: 6.8, down: 5.5, d: 3.85 },
    { y: -4.6, phi: 128, wIn: 6.8, wOut: 10.2, up: 6.8, down: 5.5, d: 3.85 },
  ],
  face: [
    // 매장 마네킹(에그헤드): 머리뼈와 갸름한 얼굴을 아주 부드럽게 합친 달걀 + 눈썹에서 코끝까지 이어진 부드러운 콧날
    { skull: { y: 13.5, z: -2.2, w: 6.9, h: 7.4, f: 7.5, b: 8.4, n: 2.2, nv: 2.3 } },
    { e: [0, 11.5, -5.6], r: [5.8, 5, 4.6], k: 3 },
    // 얼굴: 넓은 달걀 (턱까지 둥글게 내려오는 넓은 아래 얼굴, 둥근 턱끝) + 눈썹 사이에서 코끝까지 긴 콧날
    { e: [0, 9.7, 0.9], r: [6.85, 9.7, 6.2], k: 5, tilt: -0.12, taper: 0.12, keel: 1.5 },
    { rod: [[0, 14.1, 6.1], 0.5, [0, 7.8, 7.95], 1.05], k: 2.2 },
    // 작고 납작한 귀
    { e: [7.2, 9.2, -1.9], r: [0.6, 2.6, 1.3], k: 0.7, sym: true },
  ],
  chin: 18,
  // 가는 패션 마네킹 팔: 둥근 어깨 → 이두 → 팔꿈치 → 아래팔 → 손목 (손목 끝은 손 안에 숨는 둥근 마개)
  arm: [
    [0, 0.8, 0.8],
    [0.8, 2.6, 2.7],
    [2, 3.5, 3.6],
    [3.5, 4, 4.1],
    [5.5, 4.05, 4.1],
    [9, 3.85, 3.85],
    [15, 3.6, 3.55],
    [21, 3.3, 3.25],
    [25.5, 2.9, 3.05],
    [28.5, 3.05, 3.3],
    [34, 2.9, 3],
    [40, 2.35, 2.6],
    [44.5, 1.9, 2.35],
    [45.7, 1.65, 2.05],
    [46.4, 1, 1.2],
    [46.7, 0.3, 0.3],
  ],
  leg: {
    top: [8.6, -44.5],
    knee: [6.2, -91],
    ankle: [5.4, -131.5],
    floor: -138,
    // 윗끝은 엉덩이 안에 숨는 둥근 머리 → 가는 허벅지 → 무릎 → 뒤로 불룩한 종아리 → 가는 발목
    r: [
      [0, 5, 4.8, 0],
      [1.8, 7, 6.8, 0],
      [4.2, 7.7, 7.6, 0],
      [8, 7.8, 7.9, 0.2],
      [16, 7.1, 7.3, 0.4],
      [26, 6.1, 6.4, 0.4],
      [35, 5.1, 5.3, 0.3],
      [41, 4.75, 4.9, 0.1],
      [44, 4.65, 4.8, 0],
      [47.5, 4.4, 4.7, 0.3],
      [53, 4.55, 5.4, 0.9],
      [58, 4.3, 5.2, 0.9],
      [66, 3.45, 3.95, 0.5],
      [74, 2.7, 2.95, 0.2],
      [80, 2.6, 2.85, 0.1],
      [82, 2.4, 2.6, 0],
      [82.8, 0.4, 0.4, 0],
    ],
    foot: { len: 23.5, w: 4.2, h: 3.2 },
  },
  seams: {
    lines: [
      // 가슴 밑 (브래지어 와이어처럼 가운데에서 살짝 올라감)
      { pts: [[14, -9.6], [26, -10.4], [38, -10.9], [50, -11.1], [62, -10.7], [74, -9.9], [90, -9], [106, -9.9], [118, -10.7], [130, -11.1], [142, -10.9], [154, -10.4], [166, -9.6]], sym: false },
      // 가슴 밑에서 허리를 지나 다리 이음까지 내려가는 세로선
      { pts: [[60, -10.8], [61, -16], [62, -22], [61, -29], [58, -36], [54, -42.5]], sym: true },
      // 다리 이음: 엉덩이 옆 골반뼈 높이에서 거의 수평으로 오다가 사타구니로 휘어 내려감
      { pts: [[4, -34], [20, -36.5], [38, -39.5], [54, -42.5], [68, -46], [80, -49.4], [90, -50.6]], sym: true },
    ],
    arm: [3.2, 23, 44.3],
  },
  // 빈 마네킹: 위팔은 몸 옆에 곧게, 팔꿈치에서 아래팔이 살짝 바깥·앞으로 (손끝이 허벅지 중간쯤)
  free: {
    arm: [
      [0, 0.9, 0.9],
      [0.8, 2.7, 2.6],
      [2, 3.6, 3.45],
      [3.5, 3.95, 3.8],
      [5.5, 3.9, 3.85],
      [10, 3.6, 3.7],
      [17, 3.4, 3.35],
      [24, 3.15, 3.1],
      [30.5, 2.75, 2.9],
      [34.5, 2.95, 3.2],
      [40.5, 2.8, 2.9],
      [47.5, 2.3, 2.55],
      [53, 1.9, 2.35],
      [54.2, 1.65, 2.05],
      [54.9, 1, 1.2],
      [55.2, 0.3, 0.3],
    ],
    wrist: 53,
    seams: [28, 52.8],
    top: [13.6, 6.4, -0.3],
    upper: [0.03, -1, -0.02],
    elbow: 30.5,
    fore: [0.16, -0.975, 0.15],
  },
  neck: 4.8,
  neckY: 10.4,
  neckFit: { w: 6.6, d: 5.4 },
  wrist: 44.5,
  hand: { s: 1, w: 1 },
};

const MALE: Spec = {
  torso: [
    { y: -56, w: 2.2, df: 1.6, db: 2 },
    { y: -54.4, w: 11.4, df: 5.6, db: 7.2, cz: -0.2 },
    { y: -51.2, w: 16, df: 8, db: 9.3, cz: -0.3, n: 2.35 },
    // 넓은 어깨에서 좁은 허리·골반으로 (역삼각형: 가슴 98 · 허리 78 · 엉덩이 90)
    { y: -46, w: 16.8, df: 9.2, db: 10, cz: -0.2, n: 2.3 },
    { y: -37, w: 15, df: 9, db: 9.2, cz: 0.1, n: 2.25 },
    { y: -28, w: 13.9, df: 9.2, db: 8.6, cz: 0.3, n: 2.2 },
    { y: -18, w: 15, df: 9.8, db: 9, cz: 0.4, n: 2.3 },
    { y: -8, w: 17, df: 10.4, db: 9.7, cz: 0.3, n: 2.5 },
    { y: 0, w: 16.8, df: 10, db: 9.9, cz: 0.1, n: 2.45 },
    // 몸통은 어깨뼈 끝까지만, 둥근 어깨 끝은 팔 윗머리(삼각근)가 이룸 (넓은 등근육으로 역삼각형).
    // 목 가까이는 낮고 완만한 승모근 비탈
    { y: 3.6, w: 16.6, df: 9.4, db: 9.5, cz: -0.05, n: 2.45 },
    { y: 6.2, w: 16.2, df: 8.4, db: 8.7, cz: -0.2, n: 2.4 },
    { y: 7.4, w: 15.7, df: 7.6, db: 8.2, cz: -0.25, n: 2.35 },
    { y: 8.4, w: 14.6, df: 6.9, db: 7.6, cz: -0.35, n: 2.3 },
    { y: 9.3, w: 12.8, df: 6.3, db: 7.1, cz: -0.45, n: 2.25 },
    { y: 10.1, w: 10.6, df: 5.9, db: 6.6, cz: -0.55, n: 2.2 },
    { y: 10.9, w: 8.6, df: 5.6, db: 6.2, cz: -0.65, n: 2.1 },
    // 목: 굵은 원기둥, 턱 끝보다 뒤에서 올라가 턱 밑이 드러나고 뒤통수 밑으로 들어감
    { y: 11.8, w: 7, df: 5.4, db: 5.9, cz: -0.75, n: 2 },
    { y: 12.8, w: 6.1, df: 5.3, db: 5.7, cz: -0.9, n: 2 },
    { y: 14.2, w: 5.8, df: 5.2, db: 5.6, cz: -1.1, n: 2 },
    { y: 17, w: 5.7, df: 5.05, db: 5.45, cz: -1.5, n: 2 },
    { y: 20, w: 5.6, df: 4.85, db: 5.35, cz: -1.9, n: 2 },
    { y: 22.5, w: 5.4, df: 4.5, db: 5.3, cz: -2.25, n: 2 },
    // 목덜미는 뒤통수 속까지 올라가 이어짐
    { y: 24.5, w: 4.9, df: 4, db: 5.2, cz: -2.6, n: 2 },
    { y: 26.5, w: 4.4, df: 3.4, db: 4.8, cz: -3, n: 2 },
    { y: 28, w: 3.4, df: 2.4, db: 3.6, cz: -3.2, n: 2 },
    { y: 28.4, w: 0.5, df: 0.5, db: 0.5, cz: -3.2 },
  ],
  bumps: [
    // 대흉근
    { y: -4, below: 3.4, above: 5.5, phi: 63, spread: 22, amp: 1.6, p: 2.6 },
    { y: -4, below: 3.4, above: 5.5, phi: 117, spread: 22, amp: 1.6, p: 2.6 },
    // 견갑골
    { y: -1, below: 7, above: 5, phi: -126, spread: 21, amp: 1.1 },
    { y: -1, below: 7, above: 5, phi: -54, spread: 21, amp: 1.1 },
    // 둥근 어깨(삼각근): 승모근 비탈이 끊김 없이 둥근 어깨 공으로 이어지고, 팔은 그 아래에서 나옴
    { y: 5, below: 2.6, above: 3.4, phi: 0, spread: 25, amp: 3.8 },
    { y: 5, below: 2.6, above: 3.4, phi: 180, spread: 25, amp: 3.8 },
    // 척추 골
    { y: -14, below: 22, above: 16, phi: -90, spread: 6, amp: -0.65 },
    // 엉덩이
    { y: -45.5, below: 4.5, above: 7, phi: -120, spread: 24, amp: 1.9 },
    { y: -45.5, below: 4.5, above: 7, phi: -60, spread: 24, amp: 1.9 },
    // 배꼽
    { y: -28, below: 0.7, above: 0.7, phi: 90, spread: 4.5, amp: -0.45 },
    // 쇄골, 흉골 위 오목한 곳
    { y: 8.6, below: 1, above: 1, phi: 52, spread: 20, amp: 0.6 },
    { y: 8.6, below: 1, above: 1, phi: 128, spread: 20, amp: 0.6 },
    { y: 10.3, below: 1.2, above: 0.8, phi: 90, spread: 12, amp: -0.35 },
    // 울대뼈
    { y: 15.6, below: 1.3, above: 1.1, phi: 90, spread: 13, amp: 0.5 },
    // 목빗근
    { y: 12.2, below: 1.1, above: 1.1, phi: 72, spread: 10, amp: 0.26 },
    { y: 12.2, below: 1.1, above: 1.1, phi: 108, spread: 10, amp: 0.26 },
    { y: 14.2, below: 1.1, above: 1.1, phi: 61, spread: 10, amp: 0.28 },
    { y: 14.2, below: 1.1, above: 1.1, phi: 119, spread: 10, amp: 0.28 },
    { y: 16.2, below: 1.1, above: 1.1, phi: 51, spread: 10, amp: 0.26 },
    { y: 16.2, below: 1.1, above: 1.1, phi: 129, spread: 10, amp: 0.26 },
    { y: 18.2, below: 1.1, above: 1.1, phi: 42, spread: 10, amp: 0.22 },
    { y: 18.2, below: 1.1, above: 1.1, phi: 138, spread: 10, amp: 0.22 },
  ],
  face: [
    // 여자와 같은 에그헤드, 조금 크고 턱이 넓음
    { skull: { y: 14, z: -2.3, w: 7.2, h: 7.7, f: 7.8, b: 8.7, n: 2.25, nv: 2.3 } },
    { e: [0, 12, -5.8], r: [6, 5.2, 4.8], k: 3 },
    { e: [0, 10.1, 1], r: [7.15, 10.1, 6.4], k: 5, tilt: -0.12, taper: 0.07, keel: 1.5 },
    { rod: [[0, 14.7, 6.3], 0.55, [0, 8.1, 8.25], 1.1], k: 2.3 },
    { e: [7.5, 9.6, -2], r: [0.62, 2.8, 1.4], k: 0.7, sym: true },
  ],
  chin: 19.5,
  arm: [
    [0, 0.9, 0.9],
    [0.9, 3, 3.1],
    [2.2, 4.1, 4.2],
    [3.8, 4.65, 4.7],
    [5.9, 4.7, 4.75],
    [10, 4.5, 4.45],
    [16.5, 4.25, 4.1],
    [23, 3.85, 3.7],
    [28, 3.35, 3.5],
    [31.2, 3.55, 3.85],
    [37, 3.4, 3.5],
    [43.5, 2.75, 3],
    [48.4, 2.2, 2.75],
    [49.6, 1.9, 2.4],
    [50.4, 1.15, 1.35],
    [50.7, 0.3, 0.3],
  ],
  leg: {
    top: [8.5, -46.5],
    knee: [6.6, -95.5],
    ankle: [6, -138],
    floor: -145,
    r: [
      [0, 5.3, 5.3, 0],
      [1.8, 7.5, 7.7, 0],
      [4.2, 8.5, 8.8, 0],
      [8, 8.7, 9, 0.2],
      [17, 8.2, 8.5, 0.4],
      [27, 7.1, 7.4, 0.4],
      [37, 6, 6.2, 0.3],
      [42.5, 5.5, 5.7, 0.1],
      [45.6, 5.4, 5.6, 0],
      [49.5, 5.1, 5.45, 0.3],
      [55.5, 5.3, 6.3, 1],
      [61, 5.1, 6.1, 1],
      [69.5, 4.05, 4.6, 0.5],
      [78, 3.15, 3.45, 0.2],
      [84, 3.05, 3.35, 0.1],
      [86.2, 2.8, 3, 0],
      [87, 0.4, 0.4, 0],
    ],
    foot: { len: 26.5, w: 4.8, h: 3.6 },
  },
  seams: {
    lines: [{ pts: [[4, -36.5], [20, -39], [38, -42.5], [54, -46], [68, -49.5], [80, -52.4], [90, -53.4]], sym: true }],
    arm: [3.4, 24.5, 48.2],
  },
  free: {
    arm: [
      [0, 0.9, 0.9],
      [0.9, 3, 3.1],
      [2.2, 4.1, 4.2],
      [3.8, 4.6, 4.7],
      [6, 4.65, 4.7],
      [11, 4.45, 4.4],
      [18.5, 4.15, 4],
      [26, 3.75, 3.6],
      [33.5, 3.3, 3.45],
      [37.8, 3.55, 3.85],
      [44.5, 3.4, 3.5],
      [52, 2.75, 3],
      [58.3, 2.2, 2.75],
      [59.6, 1.9, 2.4],
      [60.4, 1.15, 1.35],
      [60.7, 0.3, 0.3],
    ],
    wrist: 58.3,
    seams: [31, 58.1],
    top: [16.1, 6.6, -0.4],
    upper: [0.25, -0.97, -0.03],
    elbow: 33.5,
    fore: [0.2, -0.97, 0.13],
  },
  neck: 5.6,
  neckY: 11.6,
  neckFit: { w: 7.4, d: 6.3 },
  wrist: 48.4,
  hand: { s: 1.07, w: 1.12 },
};

export const BODY_SPECS: Record<BodyKind, Spec> = { female: FEMALE, male: MALE };

/**
 * 손바닥 (여자 손 기준, 남자는 배율): 손목에서 잰 거리 a, 앞뒤 반너비, 옆 반두께.
 * 손바닥이 허벅지를 보는 자세라 너비는 앞뒤로. 끝은 손가락 뿌리 안에 숨음
 */
const PALM: [number, number, number][] = [
  [-1.4, 2.25, 1.7],
  [0, 2.35, 1.7],
  [1.5, 2.75, 1.5],
  [3.5, 3.15, 1.35],
  [6, 3.35, 1.25],
  [8.4, 3.4, 1.12],
  [9.5, 3.2, 1],
  [10.3, 2.4, 0.78],
  [10.7, 0.6, 0.3],
];
/**
 * 손가락 (검지 → 새끼): 손바닥 앞뒤 자리, 길이, 뿌리·끝 반지름, 벌어짐(앞쪽 +), 굽힘(라디안).
 * 힘을 뺀 손처럼 붙어서 살짝 굽음
 */
const FINGERS: { z: number; len: number; rb: number; rt: number; spread: number; curl: number }[] = [
  { z: 2.35, len: 7.8, rb: 0.74, rt: 0.5, spread: 0.05, curl: 0.4 },
  { z: 0.78, len: 8.7, rb: 0.76, rt: 0.52, spread: 0.02, curl: 0.45 },
  { z: -0.78, len: 8.1, rb: 0.72, rt: 0.49, spread: -0.02, curl: 0.5 },
  { z: -2.25, len: 6.5, rb: 0.64, rt: 0.44, spread: -0.06, curl: 0.55 },
];
/** 엄지: 뿌리(손바닥 아래 앞 가장자리)에서 잰 거리, 반지름 */
const THUMB: [number, number][] = [
  [0, 1.35],
  [1.6, 1.22],
  [3.4, 1],
  [4.9, 0.88],
  [5.9, 0.74],
  [6.35, 0.6],
  [6.6, 0.38],
  [6.75, 0.1],
];

/* ───────── 단면 ───────── *//* ───────── 단면 ───────── */

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
  // p > 2: 꼭대기가 둥글고 가장자리가 또렷한 돔 (가슴처럼)
  const q = (dy / sy) ** 2 + (dp / sp) ** 2;
  return b.amp * Math.exp(-0.5 * Math.pow(q, (b.p ?? 2) / 2));
}

const cr = (p0: number, p1: number, p2: number, p3: number, s: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s + (-p0 + 3 * p1 - 3 * p2 + p3) * s * s * s);

/** 단면 목록 → 촘촘한 단면 (Catmull-Rom), 각도마다 반지름 */
function loftFrom(sections: Section[], bumps: Bump[], o: { sw: number; sh: number; y0: number; A?: number; step?: number; breasts?: Breast[] }): Loft {
  const A = o.A ?? 144;
  const step = o.step ?? 0.5;
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
      // 둘을 더함 (큰 쪽만 고르면 가운데에 V자 주름이 생김) — 서로 떨어뜨려 가운데 골은 낮게
      if (o.breasts) for (const b of o.breasts) r += breastAt(b, s.y, phi, r);
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

function ellipsoid(c: P3, r: P3, k: number, sub = false, tilt = 0, taper = 0, keel = 2): Prim {
  // tilt: 음수면 아래(턱)가 앞으로, 위(이마)가 뒤로 기울어짐 (라디안, x축 둘레)
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  // 부드럽게 붙는 범위까지 넉넉히 (범위를 너무 좁게 자르면 그 높이에서 겉면이 끊겨 줄무늬가 생김)
  return {
    lo: c[1] - r[1] - 2 * k - 0.5,
    hi: c[1] + r[1] + 2 * k + 0.5,
    k,
    sub,
    d(x, y, z) {
      const dy = y - c[1];
      const dz = z - c[2];
      const Y = (dy * ct + dz * st) / r[1];
      // taper: 위로 갈수록 넓게, 아래(턱)로 갈수록 좁게
      const X = (x - c[0]) / (r[0] * Math.max(0.3, 1 + taper * Y));
      const Z = (-dy * st + dz * ct) / r[2];
      if (keel !== 2 && Z > 0) {
        // keel < 2: 앞쪽 가로 단면이 뾰족해져 얼굴 두 면이 가운데에서 만나는 콧날이 생김.
        // 눈썹 사이~코끝에서 가장 또렷하고 이마·턱 쪽으로 부드럽게 둥글어짐
        const sm = (a: number, b: number, v: number) => {
          const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
          return t * t * (3 - 2 * t);
        };
        const w = sm(-0.8, -0.2, Y) * (1 - sm(0.2, 0.75, Y));
        const p = 2 + (keel - 2) * w;
        const hor = Math.pow(Math.pow(Math.abs(X), p) + Math.pow(Z, p), 2 / p);
        const k0 = Math.sqrt(hor + Y * Y);
        const k1 = Math.sqrt((X / r[0]) ** 2 + (Y / r[1]) ** 2 + (Z / r[2]) ** 2);
        return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
      }
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
      const hor = Math.pow(Math.pow(X, s.n) + Math.pow(Z, s.n), 1 / s.n);
      // nv > 2: 정수리가 덜 뾰족하고 둥글넓적하게 (위에서 보면 둥근 달걀, 앞에서 보면 넓은 이마)
      const nv = s.nv ?? 2;
      return (Math.pow(Math.pow(hor, nv) + Math.pow(Math.abs(Y), nv), 1 / nv) - 1) * m;
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
  // 나중 덩어리가 앞 덩어리들과 부드럽게 붙는 범위까지는 앞 덩어리도 계산에 넣어야 함
  // (머리뼈를 제 높이에서 잘라 버리면 얼굴과 붙는 자리에서 가로 줄이 생김)
  const pad = 2 * Math.max(0, ...f.map((p) => ('k' in p ? p.k : 0))) + 0.5;
  for (const p of f) {
    if ('skull' in p) out.push({ ...skullPrim(p.skull, 0), base: true });
    else if ('e' in p) {
      // 큰 덩어리(반지름 1.5cm 넘음)는 단면 가운데를 정할 때도 씀 (코·입술·귀처럼 작은 것은 빼서 가운데가 튀지 않게)
      const base = !p.sub && Math.min(...p.r) >= 1.5;
      out.push({ ...ellipsoid(p.e, p.r, p.k, p.sub, p.tilt, p.taper, p.keel), base });
      if (p.sym) out.push({ ...ellipsoid(mirror(p.e), p.r, p.k, p.sub, p.tilt, p.taper, p.keel), base });
    } else {
      const [a, ra, b, rb] = p.rod;
      out.push(rod(a, ra, b, rb, p.k));
      // 가운데를 가로지르는 막대(눈썹뼈)는 이미 양쪽
      if (p.sym) out.push(rod(mirror(a), ra, mirror(b), rb, p.k));
    }
  }
  return out.map((p) => ({ ...p, lo: p.lo - pad, hi: p.hi + pad }));
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
  // 위로 넉넉히 (덩어리를 부드럽게 붙이면 정수리가 머리뼈보다 조금 올라감 — 잘리면 정수리가 평평해짐)
  const L = sampleHead(headPrims(f), -0.8, sk.y + sk.h + 3, 0.35, 144);
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
  /** 손: 손바닥과 엄지 (옷과 부딪힘) */
  hands: Limb[];
  /** 다리(엉덩이 안에서 발목까지), 받침의 목 */
  limbs: Limb[];
  /** 그리기만 하는 작은 부분: 손가락, 발 (옷이 닿지 않아 부딪힘 계산에서 뺌) */
  details: Limb[];
  /** 매장 마네킹 이음선 (몸 겉면을 따라가는 선) */
  seams: Vec3[][];
  pole: { a: Vec3; b: Vec3; r: number } | null;
  base: { c: Vec3; r: number; h: number } | null;
  /** 머리 꼭대기 높이 (카메라 맞출 때) */
  top: number;
  /** 목 밑동: 요크 목둘레가 걸리는 자리 */
  neck: { y: number; rx: number; rz: number };
  /** 3D 모델 마네킹이면 그 겉면 (옷에 맞춰 크기·팔 자세를 바꾼 꼭짓점, cm) — 화면에는 이것만 그림 */
  form?: { pos: Float32Array; index: Uint16Array | Uint32Array };
};

const girthCache = new Map<BodyKind, number>();
/** 기준 몸의 가슴(가장 굵은 윗몸) 둘레 */
export function specChest(kind: BodyKind): number {
  const hit = girthCache.get(kind);
  if (hit) return hit;
  const kit = formKit(kind);
  if (kit) {
    girthCache.set(kind, kit.chest);
    return kit.chest;
  }
  const L = loftFrom(BODY_SPECS[kind].torso, BODY_SPECS[kind].bumps, { sw: 1, sh: 1, y0: 0, breasts: BODY_SPECS[kind].breasts });
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
  const kit = formKit(kind);
  if (kit) {
    const g = modelHeadGirth(kit);
    headCache.set(kind, g);
    return g;
  }
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

/**
 * 팔 굵기·손목·이음선 자리 (옷을 입힐 때는 소매에 맞춘 길이, 빈 마네킹은 사람 비율 길이).
 * junction: 어깨 이음선을 고리 대신 팔과 몸통이 만나는 선으로 (레퍼런스처럼 어깨 앞을 세로로 지나 겨드랑이로)
 */
type ArmProfile = { keys: [number, number, number][]; wrist: number; seams: number[]; junction?: boolean };

/** 팔 고리 (축의 t 좌표): 어깨 꼭대기 tTop에서 아래로 */
function armRings(P: ArmProfile, tTop: number, sw: number, sh: number): Ring[] {
  const keys = P.keys.map(([s, rx, rz]) => ({ t: tTop - s * sh, rx: rx * sw, rz: rz * sw })).sort((a, b) => a.t - b.t);
  return smoothKeys(keys, 4);
}

/** 빈 마네킹 팔의 축: 어깨 꼭대기에서 위팔 방향으로 팔꿈치까지, 팔꿈치에서 부드럽게 꺾여 아래팔 방향으로 */
function freeArmAxis(spec: Spec, sx: number, armpitY: number, sw: number, sh: number): { axis: Axis; tTop: number } {
  const F = spec.free;
  const dir = (d: [number, number, number]): Vec3 => norm3([sx * d[0] * sw, d[1] * sh, d[2] * sw]);
  const up = dir(F.upper);
  const fore = dir(F.fore);
  const top: Vec3 = [sx * F.top[0] * sw, armpitY + F.top[1] * sh, F.top[2] * sw];
  const total = (F.arm[F.arm.length - 1]![0] + 1) * sh;
  const elbow = F.elbow * sh;
  const bend = 5 * sh;
  const pts: Vec3[] = [top];
  const N = Math.ceil(total / 0.8);
  for (let i = 1; i <= N; i++) {
    const s = (i - 0.5) * (total / N);
    // 팔꿈치 앞뒤 bend만큼에서 위팔 → 아래팔 방향으로 부드럽게
    const f = Math.max(0, Math.min(1, (s - (elbow - bend)) / (2 * bend)));
    const g = f * f * (3 - 2 * f);
    const d = norm3([up[0] + (fore[0] - up[0]) * g, up[1] + (fore[1] - up[1]) * g, up[2] + (fore[2] - up[2]) * g]);
    pts.push(along(pts[i - 1]!, d, total / N));
  }
  pts.reverse();
  // t는 아래 끝(손 쪽)에서 잰 길이 → 어깨 꼭대기 = total
  return { axis: pathAxis(pts, [0, 0, 1]), tTop: total };
}

/**
 * 손목에 붙인 손: 손바닥이 허벅지 쪽을 보고 손가락은 그쪽으로 살짝 굽어요. 엄지는 앞 가장자리에서 앞·아래로.
 * 축 방향은 팔과 같게 (손끝 → 손목)
 */
function handFor(spec: Spec, P: ArmProfile, arm: Limb, tTop: number, sw: number, sh: number): { hand: Limb[]; fingers: Limb[] } {
  const f = arm.axis.at(tTop - P.wrist * sh);
  const down: Vec3 = [-f.y[0], -f.y[1], -f.y[2]];
  const side = Math.sign(f.p[0]) || 1;
  const inw = norm3(along([-side, 0, 0], down, side * down[0]));
  const fwd = norm3(along(f.z, down, -dot3(f.z, down)));
  const ls = spec.hand.s * sh;
  const ws = spec.hand.w * sw;
  const a0 = PALM[0]![0] * ls;
  const L = PALM[PALM.length - 1]![0] * ls;
  const pt = (a: number): Vec3 => along(f.p, down, a);
  const palm: Limb = {
    axis: lineAxis(pt(L), pt(a0)),
    rings: smoothKeys(
      PALM.map(([a, w, h]) => ({ t: L - a * ls, rx: h * ws, rz: w * ws })).sort((p, q) => p.t - q.t),
      4,
    ),
    n: 2.6,
  };
  // 손가락: 손바닥 끝 안쪽에서 시작해 손바닥 쪽(몸 쪽)으로 조금씩 더 굽음
  const fingers = FINGERS.map((g) => {
    const len = g.len * ls;
    const start = along(along(pt(8.9 * ls), fwd, g.z * ws), inw, 0.15 * ws);
    const N = 16;
    const pts: Vec3[] = [start];
    for (let i = 1; i <= N; i++) {
      const u = (i - 0.5) / N;
      const th = g.curl * Math.pow(u, 1.4);
      const dir = norm3([
        down[0] * Math.cos(th) + inw[0] * Math.sin(th) + fwd[0] * g.spread,
        down[1] * Math.cos(th) + inw[1] * Math.sin(th) + fwd[1] * g.spread,
        down[2] * Math.cos(th) + inw[2] * Math.sin(th) + fwd[2] * g.spread,
      ]);
      pts.push(along(pts[i - 1]!, dir, len / N));
    }
    pts.reverse();
    const rb = g.rb * ws;
    const rt = g.rt * ws;
    const keys = [
      { t: 0, rx: rt * 0.15, rz: rt * 0.15 },
      { t: 0.25 * ls, rx: rt * 0.72, rz: rt * 0.72 },
      { t: 0.65 * ls, rx: rt, rz: rt * 0.95 },
      { t: len * 0.55, rx: (rt + rb) / 2, rz: ((rt + rb) / 2) * 0.95 },
      { t: len - 0.4 * ls, rx: rb, rz: rb * 0.95 },
      { t: len, rx: rb, rz: rb * 0.95 },
    ];
    return { axis: pathAxis(pts, fwd), rings: smoothKeys(keys, 4) } as Limb;
  });
  const tl = THUMB[THUMB.length - 1]![0] * ls;
  const root = along(along(pt(1.8 * ls), fwd, 2.1 * ws), inw, 0.5 * ws);
  const dir = norm3([down[0] * 0.9 + fwd[0] * 0.26 + inw[0] * 0.3, down[1] * 0.9 + fwd[1] * 0.26 + inw[1] * 0.3, down[2] * 0.9 + fwd[2] * 0.26 + inw[2] * 0.3]);
  const thumb: Limb = {
    axis: lineAxis(along(root, dir, tl), root),
    rings: smoothKeys(
      THUMB.map(([a, r]) => ({ t: tl - a * ls, rx: r * ws, rz: r * ws * 0.88 })).sort((p, q) => p.t - q.t),
      4,
    ),
  };
  return { hand: [palm, thumb], fingers };
}

/**
 * 다리: 엉덩이 안에서 무릎을 지나 발목까지 (종아리는 뒤로 불룩), 발은 바닥에 평평하게 놓이고 발끝이 살짝 바깥으로.
 * 발은 그리기만 함
 */
function legsFor(spec: Spec, armpitY: number, sw: number, sh: number): { legs: Limb[]; feet: Limb[]; floor: number } {
  const G = spec.leg;
  const floor = armpitY + G.floor * sh;
  const legs: Limb[] = [];
  const feet: Limb[] = [];
  for (const side of [-1, 1]) {
    const P = (q: [number, number]): Vec3 => [side * q[0] * sw, armpitY + q[1] * sh, 0];
    const top = P(G.top);
    const knee = P(G.knee);
    const ankle = P(G.ankle);
    const l1 = Math.hypot(knee[0] - top[0], knee[1] - top[1]);
    const l2 = Math.hypot(ankle[0] - knee[0], ankle[1] - knee[1]);
    const total = l1 + l2;
    const scale = total / G.r[G.r.length - 2]![0];
    // s(위에서 잰 거리) → 축 위 점 (종아리 쪽으로 뒤로 치우침)
    const back = (sv: number) => {
      let i = 0;
      while (i < G.r.length - 2 && G.r[i + 1]![0] * scale < sv) i++;
      const a = G.r[i]!;
      const b = G.r[i + 1]!;
      const f = Math.max(0, Math.min(1, (sv - a[0] * scale) / ((b[0] - a[0]) * scale || 1)));
      return (a[3] + (b[3] - a[3]) * f) * sw;
    };
    const at = (sv: number): Vec3 => {
      const q = sv <= l1 ? along(top, norm3([knee[0] - top[0], knee[1] - top[1], 0]), sv) : along(knee, norm3([ankle[0] - knee[0], ankle[1] - knee[1], 0]), sv - l1);
      return [q[0], q[1], q[2] - back(sv)];
    };
    const pts: Vec3[] = [];
    const end = G.r[G.r.length - 1]![0] * scale;
    for (let sv = 0; sv <= end + 1e-6; sv += 1.5) pts.push(at(Math.min(sv, end)));
    legs.push({
      axis: pathAxis(pts, [0, 0, 1]),
      rings: smoothKeys(
        G.r.map(([sv, rx, rz]) => ({ t: sv * scale, rx: rx * sw, rz: rz * sw })),
        4,
      ),
    });
    // 발: 뒤꿈치에서 발끝까지 (바닥에 닿게 높이를 맞추고 발끝은 바깥으로 10°)
    const fl = G.foot.len * sh;
    const fw = G.foot.w * sw;
    const fh = G.foot.h * sh;
    const prof: [number, number, number][] = [
      [0, 0.15, 0.15],
      [0.04, 0.75, 0.8],
      [0.15, 0.95, 0.72],
      [0.34, 0.98, 0.78],
      [0.55, 0.78, 0.94],
      [0.72, 0.6, 1],
      [0.86, 0.47, 0.93],
      [0.95, 0.34, 0.72],
      [0.99, 0.18, 0.38],
      [1, 0.04, 0.08],
    ];
    const toe = 0.17 * side;
    const heel: Vec3 = [ankle[0] - side * 0.4 * sw, 0, -0.22 * fl];
    const dirF: Vec3 = [Math.sin(toe), 0, Math.cos(toe)];
    const fpts = prof.map(([u, h]) => {
      const q = along(heel, dirF, u * fl);
      return [q[0], floor + h * fh * 0.98, q[2]] as Vec3;
    });
    // 꺾은선을 따라 잰 길이 = 고리 위치
    const cum = [0];
    for (let k = 1; k < fpts.length; k++) cum.push(cum[k - 1]! + Math.hypot(...sub3(fpts[k]!, fpts[k - 1]!)));
    feet.push({
      axis: pathAxis(fpts, [0, 1, 0]),
      rings: smoothKeys(
        prof.map(([, h, w], k) => ({ t: cum[k]!, rx: w * fw, rz: h * fh })),
        3,
      ),
      n: 2.4,
    });
  }
  return { legs, feet, floor };
}

/** 몸통 겉면 위 점 (각도 phi도, 높이 y) — 조금 띄워서 */
function torsoPoint(L: Loft, phiDeg: number, y: number, lift: number): Vec3 {
  const phi = (phiDeg * Math.PI) / 180;
  let i = 0;
  while (i < L.y.length - 2 && L.y[i + 1]! < y) i++;
  const f = Math.max(0, Math.min(1, (y - L.y[i]!) / (L.y[i + 1]! - L.y[i]! || 1)));
  const r = loftRadius(L, i, phi) * (1 - f) + loftRadius(L, i + 1, phi) * f + lift;
  const cz = L.cz[i]! * (1 - f) + L.cz[i + 1]! * f;
  return [r * Math.cos(phi), y, cz + r * Math.sin(phi)];
}

/** 이음선: 몸통 선들(부드럽게 이어 촘촘히)과 팔 이음 고리 */
/** 팔 축의 t → 고리 번호 (t는 고리마다 오름차순) */
function ringIndex(arm: Limb, t: number): number {
  let k = 0;
  while (k < arm.rings.length - 2 && arm.rings[k + 1]!.t < t) k++;
  const a = arm.rings[k]!;
  const b = arm.rings[k + 1]!;
  return k + Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t || 1)));
}

/**
 * 팔과 몸통이 만나는 선: 팔 겉면을 둘레마다 위에서 아래로 훑어 몸통 안 ↔ 밖이 바뀌는 곳.
 * 몸통 안으로 들어간 쪽(어깨 안쪽·겨드랑이)만 고리를 이룸 → 위 경계를 따라가다 아래 경계로 돌아옴
 */
function junctionSeam(torso: Loft, arm: Limb, tTop: number, sh: number, lift: number): Vec3[] {
  const sheet = limbSheet(arm, 64);
  const inside = (p: Vec3) => Math.hypot(p[0], p[2]) < loftReach(torso, Math.atan2(p[2], p[0]), p[1]);
  const pt = (u: number, sv: number) => sheet.at(u, ringIndex(arm, tTop - sv * sh));
  const N = 96;
  const step = 0.25;
  const span = 32;
  const cross = (u: number, a: number, b: number) => {
    // a(안/밖)와 b 사이를 반으로 나눠 좁힘
    const ia = inside(pt(u, a));
    for (let k = 0; k < 14; k++) {
      const m = (a + b) / 2;
      if (inside(pt(u, m)) === ia) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  const top: (number | null)[] = [];
  const bot: (number | null)[] = [];
  for (let j = 0; j < N; j++) {
    const u = j / N;
    let prev = inside(pt(u, 0));
    let first: number | null = prev ? 0 : null;
    let last: number | null = null;
    for (let sv = step; sv <= span; sv += step) {
      const now = inside(pt(u, sv));
      if (now && !prev && first === null) first = cross(u, sv - step, sv);
      if (!now && prev) last = cross(u, sv - step, sv);
      prev = now;
    }
    top.push(first !== null && last !== null ? first : null);
    bot.push(first !== null && last !== null ? last : null);
  }
  const lifted = (u: number, sv: number) => {
    const k = ringIndex(arm, tTop - sv * sh);
    const p = sheet.at(u, k);
    const o = norm3(sub3(p, sheet.inside(u, k)));
    return along(p, o, lift);
  };
  const on = top.map((v) => v !== null);
  if (!on.some(Boolean)) return [];
  if (on.every(Boolean)) {
    // 팔 윗머리가 통째로 어깨 속에 묻힘 → 팔이 어깨 밑에서 나오는 둘레 한 바퀴
    const ring = bot.map((sv, j) => lifted(j / N, sv!));
    ring.push(ring[0]!);
    return ring;
  }
  // 몸통 안으로 들어간 둘레 구간 (이어진 한 덩어리)을 찾아 그 시작부터
  const j0 = on.findIndex((v, j) => v && !on[(j + N - 1) % N]);
  const run: number[] = [];
  for (let j = j0; on[j % N] && run.length < N; j++) run.push(j % N);
  const loop: Vec3[] = [];
  for (const j of run) loop.push(lifted(j / N, top[j]!));
  for (const j of [...run].reverse()) loop.push(lifted(j / N, bot[j]!));
  loop.push(loop[0]!);
  return loop;
}

function seamsFor(spec: Spec, torso: Loft, arms: Limb[], armTops: number[], armSeams: ArmProfile[], armpitY: number, sh: number): Vec3[][] {
  const out: Vec3[][] = [];
  const lift = 0.02;
  for (const line of spec.seams.lines) {
    const runs = line.sym ? [line.pts, line.pts.map(([p, y]) => [180 - p, y] as [number, number])] : [line.pts];
    for (const run of runs) {
      const pts: Vec3[] = [];
      for (let i = 0; i < run.length - 1; i++) {
        const a = run[Math.max(0, i - 1)]!;
        const b = run[i]!;
        const c = run[i + 1]!;
        const d = run[Math.min(run.length - 1, i + 2)]!;
        for (let k = 0; k < 6; k++) {
          const u = k / 6;
          pts.push(torsoPoint(torso, cr(a[0], b[0], c[0], d[0], u), armpitY + cr(a[1], b[1], c[1], d[1], u) * sh, lift));
        }
      }
      const e = run[run.length - 1]!;
      pts.push(torsoPoint(torso, e[0], armpitY + e[1] * sh, lift));
      out.push(pts);
    }
  }
  arms.forEach((arm, ai) => {
    const sheet = limbSheet(arm, 48);
    const P = armSeams[ai]!;
    if (P.junction) {
      const j = junctionSeam(torso, arm, armTops[ai]!, sh, lift);
      if (j.length) out.push(j);
    }
    for (const sv of P.seams) {
      const kk = ringIndex(arm, armTops[ai]! - sv * sh);
      const ring: Vec3[] = [];
      for (let j = 0; j < 48; j++) {
        const p = sheet.at(j / 48, kk);
        const c = sheet.inside(j / 48, kk);
        const o = norm3(sub3(p, c));
        ring.push(along(p, o, lift));
      }
      ring.push(ring[0]!);
      out.push(ring);
    }
  });
  return out;
}

/* ───────── 3D 모델 마네킹 (여자: 무료 공개 모델) ───────── */

/**
 * 모델 하나를 몸으로 쓰는 준비물 (종류마다 한 번): 높이마다 자른 몸통·머리 단면(모델 좌표),
 * 팔 꼭짓점 무게(옷을 입힐 때 소매를 따라 팔을 돌림), 가슴둘레
 */
type FormKit = {
  F: FormMesh;
  fit: FormFit;
  torso: Loft;
  head: Loft;
  /** 꼭짓점마다: 팔(어깨 관절에서 돌아감) 무게, 아래팔(팔꿈치에서 한 번 더) 무게 */
  armW: Float32Array;
  foreW: Float32Array;
  chest: number;
};

const kits = new Map<BodyKind, FormKit | null>();

/**
 * 어떤 몸을 쓰는지 (3D 모델이면 꼭짓점 수, 아니면 계산으로 만든 몸). 천 계산 결과를 기억하는 열쇠에 넣어서
 * 모델 파일을 나중에 받거나 바꾸면 예전 몸에 맞춘 결과를 쓰지 않고 다시 계산하게
 */
export function bodySignature(kind: BodyKind): string {
  const F = kind === 'female' ? femaleForm() : null;
  return F ? `form${F.pos.length / 3}` : 'calc';
}

/** 3D 모델 마네킹이면 겨드랑이 높이 팔 단면 가운데의 앞뒤 자리 (소매를 여기에 맞춤), 아니면 0 */
export function sleeveOffsetZ(kind: BodyKind): number {
  const kit = formKit(kind);
  if (!kit) return 0;
  const zs = kit.fit.arms.map((a) => a.rings[0]!.z);
  return zs.reduce((s, z) => s + z, 0) / zs.length;
}
function formKit(kind: BodyKind): FormKit | null {
  if (kits.has(kind)) return kits.get(kind)!;
  const F = kind === 'female' ? femaleForm() : null;
  const kit = F ? buildKit(F) : null;
  kits.set(kind, kit);
  return kit;
}

const smooth01 = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function buildKit(F: FormMesh): FormKit {
  const fit = fitForm(F);
  const A = 144;
  const kOf = (y: number) => Math.max(0, Math.min(fit.slices.length - 1, Math.round(y / fit.step)));
  // 몸통: 사타구니에서 턱 위까지, 가운데를 지나는 겉 고리만 (겨드랑이 아래 팔은 따로 떨어진 고리라 빠짐)
  const torso: Loft = { y: [], cx: [], cz: [], A, r: [] };
  // (목 위쪽 끝은 턱 바로 아래까지 — 그 위는 머리 단면이 맡음)
  for (let k = kOf(fit.crotch); k <= kOf(fit.chin - 0.5); k++) {
    const sl = fit.slices[k]!;
    const t = torsoLoop(outerLoops(sl));
    if (!t) continue;
    const cz = (t.z0 + t.z1) / 2;
    torso.y.push(sl.y);
    torso.cx.push(0);
    torso.cz.push(cz);
    torso.r.push(...radial(sl, t.segs, 0, cz, A));
  }
  // 머리: 턱 아래부터 정수리까지 겉 고리 전부
  const head: Loft = { y: [], cx: [], cz: [], A, r: [] };
  for (let k = kOf(fit.chin - 1.5); k < fit.slices.length; k++) {
    const sl = fit.slices[k]!;
    const ls = outerLoops(sl);
    if (!ls.length) continue;
    const z0 = Math.min(...ls.map((l) => l.z0));
    const z1 = Math.max(...ls.map((l) => l.z1));
    const cz = (z0 + z1) / 2;
    head.y.push(sl.y);
    head.cx.push(0);
    head.cz.push(cz);
    head.r.push(...radial(sl, ls.flatMap((l) => l.segs), 0, cz, A));
  }
  // 가슴둘레: 겨드랑이 아래 12cm 안에서 가장 굵은 단면
  let chest = 0;
  torso.y.forEach((y, i) => {
    if (y >= fit.armpit - 12 && y <= fit.armpit) chest = Math.max(chest, loftGirth(torso, i));
  });
  // 팔 무게: 겨드랑이 아래는 팔 단면 고리의 꼭짓점이면 1 (손가락까지 통째로), 위로는 어깨 관절 바깥쪽으로 갈수록 1
  // (삼각근이 팔을 따라감). 겨드랑이 주름에서 팔과 몸이 이어지는 곳은 무게를 이웃끼리 고르게 펴서 찢어지지 않게
  const nv = F.pos.length / 3;
  const armW = new Float32Array(nv);
  const foreW = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    const x = F.pos[i * 3]!;
    const y = F.pos[i * 3 + 1]!;
    const arm = fit.arms.find((a) => a.side === (x >= 0 ? 1 : -1))!;
    let w = 0;
    if (y <= fit.armpit) w = fit.armLabel[i] !== 0 ? 1 : 0;
    else {
      const J = arm.shoulder;
      w = smooth01(Math.abs(J[0]) - 4.5, Math.abs(J[0]) + 0.5, Math.abs(x)) * (1 - smooth01(J[1] + 2, J[1] + 7.5, y));
    }
    armW[i] = w;
    foreW[i] = fit.armLabel[i] !== 0 ? smooth01(arm.elbow[1] + 3, arm.elbow[1] - 3, y) : 0;
  }
  {
    const nbr: number[][] = Array.from({ length: nv }, () => []);
    for (let t = 0; t < F.index.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = F.index[t + e]!;
        const b = F.index[t + ((e + 1) % 3)]!;
        nbr[a]!.push(b);
        nbr[b]!.push(a);
      }
    }
    const band: number[] = [];
    for (let i = 0; i < nv; i++) {
      const y = F.pos[i * 3 + 1]!;
      if (y > fit.armpit - 6 && y < fit.armpit + 12) band.push(i);
    }
    for (let it = 0; it < 12; it++) {
      const next = band.map((i) => {
        const n = nbr[i]!;
        let s = 0;
        for (const j of n) s += armW[j]!;
        return armW[i]! * 0.5 + (s / n.length) * 0.5;
      });
      band.forEach((i, k) => (armW[i] = next[k]!));
    }
  }
  return { F, fit, torso, head, armW, foreW, chest };
}

type M3 = [number, number, number, number, number, number, number, number, number];
/** a 방향을 b 방향으로 돌리는 회전 (행 우선 3×3) */
function rotFromTo(a: Vec3, b: Vec3): M3 {
  const u = norm3(a);
  const v = norm3(b);
  const c = dot3(u, v);
  const w: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const s2 = dot3(w, w);
  if (s2 < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const k = (1 - c) / s2;
  return [
    c + k * w[0] * w[0], k * w[0] * w[1] - w[2], k * w[0] * w[2] + w[1],
    k * w[1] * w[0] + w[2], c + k * w[1] * w[1], k * w[1] * w[2] - w[0],
    k * w[2] * w[0] - w[1], k * w[2] * w[1] + w[0], c + k * w[2] * w[2],
  ];
}
const apply = (m: M3, v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

/** 축을 위(tTop)에서 내려가며 점 c에서 거리 len인 곳 (모자라면 축을 이어 늘림) */
function pointAtDistance(axis: Axis, tTop: number, c: Vec3, len: number): Vec3 {
  let lo = tTop;
  let hi = tTop;
  for (let t = tTop; t > tTop - 400; t -= 0.5) {
    const d = Math.hypot(...sub3(axis.at(t).p, c));
    if (d >= len) {
      lo = t;
      break;
    }
    hi = t;
    lo = t - 0.5;
  }
  for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2;
    if (Math.hypot(...sub3(axis.at(m).p, c)) >= len) lo = m;
    else hi = m;
  }
  return axis.at((lo + hi) / 2).p;
}

/** 3D 모델 머리의 모자 둘레 (턱 끝에서 머리 높이의 62~80% 사이 가장 굵은 곳 = 귀 위 이마~뒤통수) */
function modelHeadGirth(kit: FormKit): number {
  const { fit, head } = kit;
  const H = fit.height - fit.chin;
  let g = 0;
  head.y.forEach((y, i) => {
    if (y >= fit.chin + 0.62 * H && y <= fit.chin + 0.8 * H) g = Math.max(g, loftGirth(head, i));
  });
  return g;
}

/**
 * 모자 받침 (3D 모델): 모델의 머리와 목(목 밑동까지)을 모자 둘레에 맞춰 키우고, 그 아래로 받침 목·기둥·판.
 * 모델 좌표 → 받침 좌표: 턱 끝을 chinY에, hs배
 */
function formStand(kind: BodyKind, kit: FormKit, L: Layout): BodyModel {
  const { F, fit } = kit;
  const h = L.head!;
  const hs = ellipsePerimeter(h.rh, h.rz) / modelHeadGirth(kit);
  const crown = h.cy + h.rv;
  const chinY = crown - (fit.height - fit.chin) * hs + HAT_LIFT * hs;
  const T = (x: number, y: number, z: number): Vec3 => [x * hs, chinY + (y - fit.chin) * hs, z * hs];
  // 목이 가장 가는 곳 조금 아래에서 평평하게 잘라 그 위만 (걸친 삼각형은 자르는 면에서 잘라 가장자리가 반듯하게)
  const cut = fit.neckMid - 1.5;
  const nv = F.pos.length / 3;
  const remap = new Int32Array(nv).fill(-1);
  const pos: number[] = [];
  const idx: number[] = [];
  const edgeVert = new Map<number, number>();
  const vert = (v: number) => {
    if (remap[v]! < 0) {
      remap[v] = pos.length / 3;
      pos.push(...T(F.pos[v * 3]!, F.pos[v * 3 + 1]!, F.pos[v * 3 + 2]!));
    }
    return remap[v]!;
  };
  // 모서리 a-b가 자르는 면과 만나는 점 (모서리마다 한 번만 만듦)
  const onCut = (a: number, b: number) => {
    const key = Math.min(a, b) * nv + Math.max(a, b);
    const hit = edgeVert.get(key);
    if (hit !== undefined) return hit;
    const ya = F.pos[a * 3 + 1]!;
    const yb = F.pos[b * 3 + 1]!;
    const f = (cut - ya) / (yb - ya);
    const p = T(F.pos[a * 3]! + (F.pos[b * 3]! - F.pos[a * 3]!) * f, cut, F.pos[a * 3 + 2]! + (F.pos[b * 3 + 2]! - F.pos[a * 3 + 2]!) * f);
    const i = pos.length / 3;
    pos.push(...p);
    edgeVert.set(key, i);
    return i;
  };
  for (let t = 0; t < F.index.length; t += 3) {
    const tri = [F.index[t]!, F.index[t + 1]!, F.index[t + 2]!];
    const up = tri.map((v) => F.pos[v * 3 + 1]! >= cut);
    const n = up.filter(Boolean).length;
    if (n === 0) continue;
    if (n === 3) {
      idx.push(vert(tri[0]!), vert(tri[1]!), vert(tri[2]!));
      continue;
    }
    // 위에 남는 쪽만 (돌림 순서 그대로)
    const poly: number[] = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!;
      const b = tri[(e + 1) % 3]!;
      if (up[e]) poly.push(vert(a));
      if (up[e] !== up[(e + 1) % 3]) poly.push(onCut(a, b));
    }
    for (let k = 1; k + 1 < poly.length; k++) idx.push(poly[0]!, poly[k]!, poly[k + 1]!);
  }
  const head: Loft = { y: kit.head.y.map((y) => chinY + (y - fit.chin) * hs), cx: kit.head.cx.map((x) => x * hs), cz: kit.head.cz.map((z) => z * hs), A: kit.head.A, r: kit.head.r.map((r) => r * hs) };
  // 받침 목: 잘린 목 끝의 타원(가운데·너비·깊이)에서 그대로 이어져 아래로 조금 퍼짐
  const ck = Math.max(0, Math.min(fit.slices.length - 1, Math.round(cut / fit.step)));
  const cl = torsoLoop(outerLoops(fit.slices[ck]!))!;
  const rx = ((cl.x1 - cl.x0) / 2) * hs;
  const rz = ((cl.z1 - cl.z0) / 2) * hs;
  const nz = ((cl.z0 + cl.z1) / 2) * hs;
  const nr = (rx + rz) / 2;
  const neckTop: Vec3 = [0, chinY + (cut - fit.chin) * hs, nz];
  const neckBottom: Vec3 = [0, neckTop[1] - 11 * hs, nz + 0.6 * hs];
  const nl = Math.hypot(...sub3(neckBottom, neckTop));
  const neck: Limb = {
    axis: lineAxis(neckTop, neckBottom),
    rings: smoothKeys(
      [
        { t: -0.4, rx: rx * 0.9, rz: rz * 0.9 },
        { t: 0, rx: rx + 0.05, rz: rz + 0.05 },
        { t: nl * 0.4, rx: rx * 1.02, rz: rz * 1.02 },
        { t: nl * 0.9, rx: rx * 1.16, rz: rz * 1.12 },
        { t: nl, rx: rx * 1.22, rz: rz * 1.16 },
        { t: nl + 0.8, rx: nr * 0.6, rz: nr * 0.6 },
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
    details: [neck],
    seams: [],
    pole: { a: [0, neckBottom[1] - 0.5, neckBottom[2]], b: [0, baseY, neckBottom[2]], r: 0.8 },
    base: { c: [0, baseY - 0.8, neckBottom[2]], r: h.rh * 1.05, h: 1.6 },
    top: crown + HAT_LIFT * hs,
    neck: { y: neckBottom[1], rx: nr, rz: nr },
    form: { pos: new Float32Array(pos), index: pos.length / 3 < 65536 ? new Uint16Array(idx) : new Uint32Array(idx) },
  };
}

/**
 * 드레스폼 박음선 (천 조각을 이은 자리): 앞·뒤 가운데, 가슴 꼭지를 지나는 앞뒤 공주선, 옆선, 목둘레, 허리 테이프.
 * 몸통 단면 위의 점들 (각도는 도, 90 = 앞)
 */
function formSeams(kit: FormKit, torso: Loft, armpitY: number, sh: number): Vec3[][] {
  const { fit } = kit;
  const Y = (y: number) => armpitY + (y - fit.armpit) * sh;
  const lift = 0.04;
  const out: Vec3[][] = [];
  const vertical = (phi: number, y0: number, y1: number) => {
    const pts: Vec3[] = [];
    for (let y = y1; y >= y0; y -= 0.75) pts.push(torsoPoint(torso, phi, Y(y), lift));
    out.push(pts);
  };
  const ring = (y: number) => {
    const pts: Vec3[] = [];
    for (let a = 0; a < 360; a += 5) pts.push(torsoPoint(torso, a, Y(y), lift));
    pts.push(pts[0]!);
    out.push(pts);
  };
  // 가슴 꼭지 각도 (가슴 높이에서 가장 앞으로 나온 곳)
  const kb = kit.torso.y.reduce((b, y, i) => (Math.abs(y - (fit.armpit - 0.5)) < Math.abs(kit.torso.y[b]! - (fit.armpit - 0.5)) ? i : b), 0);
  let best = 0;
  let phiB = 60;
  for (let a = 0; a < kit.torso.A / 4; a++) {
    const r = kit.torso.r[kb * kit.torso.A + a]!;
    const z = r * Math.sin((2 * Math.PI * a) / kit.torso.A);
    if (z > best) {
      best = z;
      phiB = (360 * a) / kit.torso.A;
    }
  }
  // 허리: 사타구니와 겨드랑이 사이에서 가장 가는 단면
  let waist = (fit.crotch + fit.armpit) / 2;
  let g = Infinity;
  kit.torso.y.forEach((y, i) => {
    if (y > fit.crotch + 12 && y < fit.armpit - 6) {
      const gi = loftGirth(kit.torso, i);
      if (gi < g) {
        g = gi;
        waist = y;
      }
    }
  });
  const bottom = fit.crotch + 3;
  vertical(90, bottom, fit.neckBase.y - 2.5);
  vertical(270, bottom, fit.neckBase.y);
  for (const phi of [phiB, 180 - phiB, 360 - phiB, 180 + phiB]) vertical(phi, bottom + 3, fit.armpit + 7);
  vertical(0, bottom + 1, fit.armpit - 0.5);
  vertical(180, bottom + 1, fit.armpit - 0.5);
  ring(fit.neckBase.y);
  ring(waist);
  return out;
}

/**
 * 3D 모델 몸: 옷 크기에 맞춰 늘이고(가로 sw, 세로 sh, 겨드랑이 기준), 소매가 있으면 팔을 소매 축을 따라
 * 어깨·팔꿈치에서 돌림(꼭짓점마다 무게만큼 섞음). 부딪힘용 몸통·머리 단면과 팔·다리 관도 같이.
 */
function formBody(kind: BodyKind, kit: FormKit, armpitY: number, sw: number, sh: number, sleeves: { side: 1 | -1; axis: Axis; tTop: number }[]): BodyModel {
  const { F, fit } = kit;
  const S = (p: Vec3): Vec3 => [p[0] * sw, armpitY + (p[1] - fit.armpit) * sh, p[2] * sw];
  const nv = F.pos.length / 3;
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const q = S([F.pos[i * 3]!, F.pos[i * 3 + 1]!, F.pos[i * 3 + 2]!]);
    pos[i * 3] = q[0];
    pos[i * 3 + 1] = q[1];
    pos[i * 3 + 2] = q[2];
  }
  // 팔마다 자세: 어깨 관절 J는 그대로, 팔꿈치 E와 손목 W를 소매 축 위로
  const poses = new Map<number, (p: Vec3, w: number, wf: number) => Vec3>();
  for (const sl of sleeves) {
    const arm = fit.arms.find((a) => a.side === sl.side)!;
    const J = S(arm.shoulder);
    const E = S(arm.elbow);
    const W = S(arm.wrist);
    const E2 = pointAtDistance(sl.axis, sl.tTop, J, Math.hypot(...sub3(E, J)));
    const W2 = pointAtDistance(sl.axis, sl.tTop, E2, Math.hypot(...sub3(W, E)));
    const Rs = rotFromTo(sub3(E, J), sub3(E2, J));
    const Re = rotFromTo(apply(Rs, sub3(W, E)), sub3(W2, E2));
    poses.set(sl.side, (p, w, wf) => {
      const up = apply(Rs, sub3(p, J));
      const ts: Vec3 = [J[0] + up[0], J[1] + up[1], J[2] + up[2]];
      const fe = apply(Re, apply(Rs, sub3(p, E)));
      const tf: Vec3 = [E2[0] + fe[0], E2[1] + fe[1], E2[2] + fe[2]];
      const g: Vec3 = [ts[0] + (tf[0] - ts[0]) * wf, ts[1] + (tf[1] - ts[1]) * wf, ts[2] + (tf[2] - ts[2]) * wf];
      return [p[0] + (g[0] - p[0]) * w, p[1] + (g[1] - p[1]) * w, p[2] + (g[2] - p[2]) * w];
    });
  }
  if (poses.size) {
    for (let i = 0; i < nv; i++) {
      const w = kit.armW[i]!;
      if (w <= 0) continue;
      const f = poses.get(F.pos[i * 3]! >= 0 ? 1 : -1);
      if (!f) continue;
      const q = f([pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!], w, kit.foreW[i]!);
      pos[i * 3] = q[0];
      pos[i * 3 + 1] = q[1];
      pos[i * 3 + 2] = q[2];
    }
  }
  const scaleLoftXZ = (L: Loft): Loft => ({ y: L.y.map((y) => armpitY + (y - fit.armpit) * sh), cx: L.cx.map((x) => x * sw), cz: L.cz.map((z) => z * sw), A: L.A, r: L.r.map((r) => r * sw) });
  // 팔·다리 관: 단면 가운데를 잇는 축 (팔은 자세대로 옮김), 굵기는 단면 반지름
  const arms: Limb[] = fit.arms.map((arm) => {
    const f = poses.get(arm.side);
    const rings = [...arm.rings].reverse(); // 손끝 → 겨드랑이
    const pts = rings.map((r) => {
      const p = S([r.x, r.y, r.z]);
      return f ? f(p, 1, smooth01(arm.elbow[1] + 3, arm.elbow[1] - 3, r.y)) : p;
    });
    let acc = 0;
    const ringsT: Ring[] = pts.map((p, i) => {
      if (i > 0) acc += Math.hypot(...sub3(p, pts[i - 1]!));
      return { t: acc, rx: rings[i]!.rx * sw, rz: rings[i]!.rz * sw };
    });
    return { axis: pathAxis(pts, [0, 0, 1]), rings: ringsT };
  });
  const limbs: Limb[] = fit.legs.map((leg) => {
    const pts = leg.rings.map((r) => S([r.x, r.y, r.z]));
    let acc = 0;
    const ringsT: Ring[] = pts.map((p, i) => {
      if (i > 0) acc += Math.hypot(...sub3(p, pts[i - 1]!));
      return { t: acc, rx: leg.rings[i]!.rx * sw, rz: leg.rings[i]!.rz * sw };
    });
    return { axis: pathAxis(pts, [0, 0, 1]), rings: ringsT };
  });
  const floor = armpitY - fit.armpit * sh;
  const torso = scaleLoftXZ(kit.torso);
  return {
    kind,
    torso,
    head: scaleLoftXZ(kit.head),
    arms,
    hands: [],
    limbs,
    details: [],
    seams: formSeams(kit, torso, armpitY, sh),
    pole: null,
    base: { c: [0, floor - 0.6, 2 * sw], r: 26 * sw, h: 1.2 },
    top: armpitY + (fit.height - fit.armpit) * sh,
    neck: { y: armpitY + (fit.neckBase.y - fit.armpit) * sh, rx: fit.neckBase.rx * sw, rz: fit.neckBase.rz * sw },
    form: { pos, index: F.index },
  };
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
  const kit = formKit(kind);
  if (kit) {
    const sleeves: { side: 1 | -1; axis: Axis; tTop: number }[] = [];
    for (const [role, side] of [['sleeveL', -1], ['sleeveR', 1]] as const) {
      const s = find(L, role);
      const t = s ? tubes.get(s) : undefined;
      const axis = s ? axes.get(s) : undefined;
      if (t && axis) sleeves.push({ side, axis, tTop: t.length });
    }
    return formBody(kind, kit, armpitY, sw, sh, sleeves);
  }
  const torso = loftFrom(spec.torso, spec.bumps, { sw, sh, y0: armpitY, breasts: spec.breasts });
  // 레퍼런스처럼 가는 목 위에 또렷한 머리 (머리 너비 ≈ 목의 두 배)
  const hs = ((sw + sh) / 2) * 1.04;
  const chinY = armpitY + spec.chin * sh;
  const head = scaleLoft(unitHead(kind), hs, chinY);

  const arms: Limb[] = [];
  const hands: Limb[] = [];
  const details: Limb[] = [];
  const armTops: number[] = [];
  const armSeams: ArmProfile[] = [];
  const addArm = (axis: Axis, tTop: number, P: ArmProfile) => {
    const arm = { axis, rings: armRings(P, tTop, sw, sh) };
    arms.push(arm);
    armTops.push(tTop);
    armSeams.push(P);
    const h = handFor(spec, P, arm, tTop, sw, sh);
    hands.push(...h.hand);
    details.push(...h.fingers);
  };
  const sleeveArm: ArmProfile = { keys: spec.arm, wrist: spec.wrist, seams: spec.seams.arm };
  // 팔 윗끝(둥근 어깨)은 소매 윗단보다 조금 위, 몸통 어깨 안에 묻힘
  for (const side of ['sleeveL', 'sleeveR'] as const) {
    const s = find(L, side);
    const t = s ? tubes.get(s) : undefined;
    const axis = s ? axes.get(s) : undefined;
    if (t && axis) addArm(axis, t.length + 0.6 * sh, sleeveArm);
  }
  if (arms.length < 2) {
    // 소매가 없는 옷(조끼)이나 빈 마네킹: 팔 윗머리(삼각근)가 어깨뼈 끝을 덮어 둥근 어깨를 이루고,
    // 위팔은 몸 옆에 내리고 아래팔은 팔꿈치에서 살짝 바깥·앞으로 (사람 비율 길이)
    const free: ArmProfile = { keys: spec.free.arm, wrist: spec.free.wrist, seams: spec.free.seams, junction: true };
    for (const sx of [-1, 1]) {
      if (arms.length >= 2) break;
      const { axis, tTop } = freeArmAxis(spec, sx, armpitY, sw, sh);
      addArm(axis, tTop, free);
    }
  }

  const { legs, feet, floor } = legsFor(spec, armpitY, sw, sh);
  details.push(...feet);
  return {
    kind,
    torso,
    head,
    arms,
    hands,
    limbs: legs,
    details,
    seams: seamsFor(spec, torso, arms, armTops, armSeams, armpitY, sh),
    // 발밑에 얇은 둥근 판
    pole: null,
    base: { c: [0, floor - 0.6, 3 * sw], r: 26 * sw, h: 1.2 },
    top: chinY + headTop(kind) * hs,
    neck: { y: armpitY + spec.neckY * sh, rx: spec.neckFit.w * sw, rz: spec.neckFit.d * sw },
  };
}

/**
 * 모자를 펼친 타원 머리는 사람 머리보다 정수리 쪽이 길어서, 정수리를 맞추면 챙이 눈까지 내려와요.
 * 사람 머리를 이만큼(기준 cm) 내려 챙이 눈썹 바로 위 이마에 오게 (모자 꼭대기에 살짝 여유가 생김)
 */
const HAT_LIFT = -1;

/** 모자 받침: 사람 머리(모자 둘레에 맞춘 크기) + 목 + 받침대 */
export function standFor(kind: BodyKind, L: Layout): BodyModel {
  const kit = formKit(kind);
  if (kit) return formStand(kind, kit, L);
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
    details: [],
    seams: [],
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
