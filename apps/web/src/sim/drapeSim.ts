import type { ArtPiece } from '../closet/assembledArt';
import { bakeCloth, occlusionAt, OCC_FORM, separate, simulate, type ClothInput, type ClothOutput, type ClothPanel, type Collider, type Occupancy, type Seam, type Vec3 } from './cloth';
import { drape, girth, type Draped, type Sheet } from './drape';
import { bodyOf, loftReach, type BodyKind, type BodyModel, type Limb } from './body';

/**
 * 입힌 모양(drape) → 천 시뮬레이션 → 다시 그릴 수 있는 면.
 *
 * 출발 모양은 drape가 계산한 자리(손으로 넣는 주름 없이). 각 조각을 입자 격자로 바꾸고
 * 길이는 도안 치수로, 고무단은 오므라든 길이로 두고, 요크 아랫단과 몸판·소매 윗단을 꿰매요.
 * 결과는 조각 모양에만 달려 있어서(뜬 단 수와 무관) 한 번 계산하면 계속 씁니다.
 */

/** 입자 사이 거리 (cm) */
const SPACING = 1.25;
/** 고무단이 쉴 때 둘레 비율 (겉2안2는 메리야스보다 많이 오므라듦) */
export const RIB_REST = 0.8;
/** 목둘레 고무단 */
const NECK_REST = 0.9;

type Owner = ArtPiece | 'impliedYoke';

export type ClothPlan = {
  key: string;
  input: ClothInput;
  /** 입력 조각 순서대로: 어느 조각의 면인지 */
  owners: Owner[];
  /** 조각의 단 수 (면의 k 범위) */
  rows: number[];
};

/** 조각 모양과 입힐 몸을 정하는 것만 모은 열쇠 (진행 상태와 무관) */
export function shapeKey(pieces: ArtPiece[], kind: BodyKind = 'female'): string {
  return JSON.stringify([
    kind,
    pieces.map((p) => [p.piece.id, p.piece.name, p.piece.construction, p.piece.direction, p.piece.rows.length, p.piece.totalStitches, p.gauge.st, p.gauge.row]),
  ]);
}

/** 입힐 몸에 맞춘 입힌 모양 (요크가 그 몸의 어깨·목에 얹힘) */
export function drapeFor(pieces: ArtPiece[], kind: BodyKind, wrinkles = false): Draped {
  return drape(pieces, {
    wrinkles,
    body: (L, tubes, axes) => {
      const b = bodyOf(kind, L, tubes, axes);
      return b?.torso ? { reach: (theta, y) => loftReach(b.torso!, theta, y), neck: b.neck } : null;
    },
  });
}

/** 입힌 모양의 마네킹 */
export function bodyOfDraped(D: Draped, kind: BodyKind): BodyModel | null {
  return bodyOf(kind, D.layout, D.tubes, D.axes);
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 조각 k단 경계의 도안 둘레(원통) 또는 너비(평면), cm */
function patternWidth(p: ArtPiece, k: number): number {
  const rows = p.piece.rows;
  const at = (kk: number) => {
    const n = kk <= 0 ? (rows[0]?.stitchesWorked ?? 1) : (rows[Math.min(rows.length, kk) - 1]?.stitchCount ?? 1);
    return (Math.max(1, n) / p.gauge.st) * 10;
  };
  const k0 = Math.floor(k);
  const f = k - k0;
  return at(k0) * (1 - f) + at(k0 + 1) * f;
}

/** k단 근처가 고무단이면 1 (경계는 섞어서) */
function ribAt(p: ArtPiece, k: number, halfSpan: number): number {
  const rows = p.piece.rows;
  let s = 0;
  let n = 0;
  for (let kk = Math.max(0, Math.floor(k - halfSpan)); kk <= Math.min(rows.length - 1, Math.ceil(k + halfSpan)); kk++) {
    s += p.piece.sections[rows[kk]?.sectionIndex ?? -1]?.technique === 'ribbing' ? 1 : 0;
    n++;
  }
  return n ? s / n : 0;
}

type SampleOpts = {
  /** k단 경계의 쉴 때 둘레(너비). 없으면 처음 모양 그대로 */
  width?: (k: number) => number;
  /** 한 단의 쉴 때 높이 (cm). 없으면 처음 모양 그대로 */
  rowHeight?: number;
  /** k단 경계의 둘레 비율 (고무단 오므라듦) */
  cinch?: (k: number, halfSpan: number) => number;
};

function sampleSheet(id: string, sheet: Sheet, o: SampleOpts): ClothPanel {
  const R = Math.max(1, sheet.rows);
  const g = Math.max(girth(sheet, 0), girth(sheet, R / 2), girth(sheet, R));
  const cols = sheet.closed ? Math.max(18, Math.min(150, Math.round(g / SPACING))) : Math.max(6, Math.min(90, Math.round(g / SPACING) + 1));
  let len = 0;
  for (let i = 0; i < 32; i++) len += dist(sheet.at(0.25, (R * i) / 32), sheet.at(0.25, (R * (i + 1)) / 32));
  const rings = Math.max(4, Math.min(110, Math.round(len / SPACING) + 1));
  const kOf = (i: number) => (i / (rings - 1)) * R;
  const uOf = (j: number) => (sheet.closed ? j / cols : j / (cols - 1));
  const pos = new Float32Array(rings * cols * 3);
  for (let i = 0; i < rings; i++) for (let j = 0; j < cols; j++) pos.set(sheet.at(uOf(j), kOf(i)), (i * cols + j) * 3);
  const P = (i: number, j: number): Vec3 => {
    const k = (i * cols + j) * 3;
    return [pos[k]!, pos[k + 1]!, pos[k + 2]!];
  };
  const span = R / (rings - 1) / 2;
  const restU = new Float32Array(rings);
  for (let i = 0; i < rings; i++) {
    let chords = 0;
    const segs = sheet.closed ? cols : cols - 1;
    for (let j = 0; j < segs; j++) chords += dist(P(i, j), P(i, (j + 1) % cols));
    const target = o.width ? o.width(kOf(i)) : chords;
    restU[i] = (target / segs) * (o.cinch ? o.cinch(kOf(i), span) : 1);
  }
  const restK = new Float32Array(rings - 1);
  for (let i = 0; i < rings - 1; i++) {
    if (o.rowHeight) restK[i] = o.rowHeight * (kOf(i + 1) - kOf(i));
    else {
      let s = 0;
      for (let j = 0; j < cols; j++) s += dist(P(i, j), P(i + 1, j));
      restK[i] = s / cols;
    }
  }
  // 바깥쪽 법선 부호: 가운데 점에서 du × dk 가 안쪽 점에서 멀어지는 쪽이면 +1
  const im = Math.floor(rings / 2);
  const jm = Math.floor(cols / 4);
  const n = cross(sub(P(im, Math.min(cols - 1, jm + 1)), P(im, Math.max(0, jm - 1))), sub(P(Math.min(rings - 1, im + 1), jm), P(Math.max(0, im - 1), jm)));
  const orient = dot(n, sub(P(im, jm), sheet.inside(uOf(jm), kOf(im)))) < 0 ? -1 : 1;
  return { id, closed: sheet.closed, cols, rings, pos, restU, restK, orient };
}

/** 고리 i의 평균 높이 */
function ringY(p: ClothPanel, i: number) {
  let s = 0;
  for (let j = 0; j < p.cols; j++) s += p.pos[(i * p.cols + j) * 3 + 1]!;
  return s / p.cols;
}

function topRing(p: ClothPanel) {
  return ringY(p, p.rings - 1) >= ringY(p, 0) ? p.rings - 1 : 0;
}

function bottomRing(p: ClothPanel) {
  return topRing(p) === 0 ? p.rings - 1 : 0;
}

/** 두 가장자리의 입자를 가까운 것끼리 서로 꿰맴 (양쪽 모두 빠짐없이) */
function stitchEdges(a: { off: number; pts: Vec3[]; idx: number[] }, b: { off: number; pts: Vec3[]; idx: number[] }, maxGap: number): Seam[] {
  const out: Seam[] = [];
  const seen = new Set<string>();
  const near = (p: Vec3, set: Vec3[]) => {
    let best = -1;
    let bd = Infinity;
    set.forEach((q, i) => {
      const d = dist(p, q);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return { best, bd };
  };
  const push = (ia: number, ib: number) => {
    const key = `${ia}:${ib}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push([a.off + a.idx[ia]!, b.off + b.idx[ib]!]);
  };
  a.pts.forEach((p, i) => {
    const { best, bd } = near(p, b.pts);
    if (best >= 0 && bd < maxGap) push(i, best);
  });
  b.pts.forEach((p, i) => {
    const { best, bd } = near(p, a.pts);
    if (best >= 0 && bd < maxGap) push(best, i);
  });
  return out;
}

function ringEdge(p: ClothPanel, ring: number) {
  const pts: Vec3[] = [];
  const idx: number[] = [];
  for (let j = 0; j < p.cols; j++) {
    const k = ring * p.cols + j;
    pts.push([p.pos[k * 3]!, p.pos[k * 3 + 1]!, p.pos[k * 3 + 2]!]);
    idx.push(k);
  }
  return { pts, idx };
}

function colEdge(p: ClothPanel, col: number) {
  const pts: Vec3[] = [];
  const idx: number[] = [];
  for (let i = 0; i < p.rings; i++) {
    const k = i * p.cols + col;
    pts.push([p.pos[k * 3]!, p.pos[k * 3 + 1]!, p.pos[k * 3 + 2]!]);
    idx.push(k);
  }
  return { pts, idx };
}

/** 마네킹을 부딪힘 모양으로: 몸통·머리는 단면 쌓기, 팔·허벅지·받침 목은 굵기가 변하는 관 */
export function bodyColliders(b: BodyModel, hat: boolean): Collider[] {
  const out: Collider[] = [];
  if (b.torso) out.push({ kind: 'loft', y: b.torso.y, cx: b.torso.cx, cz: b.torso.cz, A: b.torso.A, r: b.torso.r, margin: 0.45, friction: 0.7 });
  out.push({ kind: 'loft', y: b.head.y, cx: b.head.cx, cz: b.head.cz, A: b.head.A, r: b.head.r, margin: hat ? 0.35 : 0.4, friction: hat ? 0.95 : 0.6 });
  for (const limb of [...b.arms, ...b.hands, ...b.limbs]) out.push(...limbColliders(limb, hat ? 0.3 : 0.4, 0.5));
  return out;
}

/**
 * 팔·손·허벅지 → 관. 납작한 손은 앞뒤로 나란한 관 세 줄 (둥근 관 하나로 감싸면
 * 손등 위에 헛벽이 생겨 그늘이 얼룩지고, 소맷부리가 손 옆을 뚫고 지나갈 수 있어요)
 */
function limbColliders(limb: Limb, margin: number, friction: number): Collider[] {
  const t0 = limb.rings[0]!.t;
  const t1 = limb.rings[limb.rings.length - 1]!.t;
  const steps = Math.max(8, Math.ceil(Math.abs(t1 - t0) / 1.5));
  const at: { p: Vec3; z: Vec3; rx: number; rz: number }[] = [];
  let q = 0;
  let flat = false;
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    while (q < limb.rings.length - 2 && limb.rings[q + 1]!.t < t) q++;
    const a = limb.rings[q]!;
    const c = limb.rings[q + 1] ?? a;
    const f = c.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (c.t - a.t))) : 0;
    const rx = a.rx + (c.rx - a.rx) * f;
    const rz = a.rz + (c.rz - a.rz) * f;
    const fr = limb.axis.at(t);
    at.push({ p: fr.p, z: fr.z, rx, rz });
    if (rz - rx > 0.8) flat = true;
  }
  if (!flat) return [{ kind: 'tube', p: at.flatMap((s) => s.p), r: at.map((s) => Math.max(0.2, (s.rx + s.rz) / 2)), margin, friction }];
  return [-1, 0, 1].map((side) => ({
    kind: 'tube' as const,
    p: at.flatMap((s) => {
      const o = Math.max(0, s.rz - s.rx) * 0.92 * side;
      return [s.p[0] + s.z[0] * o, s.p[1] + s.z[1] * o, s.p[2] + s.z[2] * o];
    }),
    r: at.map((s) => Math.max(0.2, s.rx)),
    margin,
    friction,
  }));
}

/** 시뮬레이션 입력 만들기. 판(스카프 같은 한 장)은 아직 시뮬레이션하지 않아요 */
export function planCloth(pieces: ArtPiece[], kind: BodyKind = 'female'): ClothPlan | null {
  const D = drapeFor(pieces, kind);
  const roles = D.layout.roles;
  if ([...roles.values()].includes('panel') || D.sheets.size === 0) return null;
  const body = bodyOfDraped(D, kind);
  if (!body) return null;
  const panels: ClothPanel[] = [];
  const owners: Owner[] = [];
  const rows: number[] = [];
  const offsets: number[] = [];
  let N = 0;
  const add = (o: Owner, p: ClothPanel, R: number) => {
    offsets.push(N);
    N += p.cols * p.rings;
    panels.push(p);
    owners.push(o);
    rows.push(R);
  };
  for (const [p, sheet] of D.sheets) {
    const role = roles.get(p)!;
    if (role === 'extra' || sheet.rows === 0) continue;
    const panel = sampleSheet(p.piece.id, sheet, {
      width: (k) => patternWidth(p, k),
      rowHeight: 10 / p.gauge.row,
      cinch: (k, span) => 1 - (1 - RIB_REST) * ribAt(p, k, span),
    });
    add(p, panel, sheet.rows);
  }
  if (D.impliedYoke) {
    const s = D.impliedYoke.sheet;
    const R = s.rows;
    // 목둘레 고무단 (맨 위 몇 단)은 살짝 조여짐
    add('impliedYoke', sampleSheet('implied-yoke', s, { cinch: (k) => (k > R - 4 ? NECK_REST : 1) }), R);
  }

  // 솔기: 요크 아랫단 ↔ 몸판·소매 윗단. 요크 둘레 밖으로 숨은 겨드랑이 코는 요크가 아니라
  // 이웃 조각(몸판 ↔ 소매)의 겨드랑이 코와 꿰맴 (실제 요크 스웨터처럼). 그래서 몸판 옆이 요크 쪽으로 당겨지지 않음
  const seams: Seam[] = [];
  const yokeIdx = owners.findIndex((o) => (o === 'impliedYoke' ? true : roles.get(o) === 'yoke'));
  const isTopPiece = (o: Owner) => o !== 'impliedYoke' && ['body', 'front', 'back', 'sleeveL', 'sleeveR'].includes(roles.get(o)!);
  if (yokeIdx >= 0) {
    const y = panels[yokeIdx]!;
    const yb = ringEdge(y, bottomRing(y));
    const tops: { off: number; pts: Vec3[]; idx: number[]; piece: number }[] = [];
    owners.forEach((o, i) => {
      if (i === yokeIdx || !isTopPiece(o)) return;
      const p = panels[i]!;
      tops.push({ off: offsets[i]!, ...ringEdge(p, topRing(p)), piece: i });
    });
    const all = tops.flatMap((t) => t.pts.map((pt, k) => ({ pt, gi: t.off + t.idx[k]!, piece: t.piece })));
    const nearest = (pt: Vec3, pool: typeof all) => {
      let best: (typeof all)[number] | null = null;
      let bd = Infinity;
      for (const q of pool) {
        const d = dist(pt, q.pt);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      return { best, bd };
    };
    const tied = new Set<number>();
    // 요크 아랫단의 코마다 가장 가까운 윗단 코
    yb.pts.forEach((pt, k) => {
      const { best, bd } = nearest(pt, all);
      if (best && bd < 6) {
        seams.push([offsets[yokeIdx]! + yb.idx[k]!, best.gi]);
        tied.add(best.gi);
      }
    });
    // 아직 안 꿰맨 윗단 코: 가까우면 요크에, 아니면 다른 조각의 겨드랑이 코에
    for (const q of all) {
      if (tied.has(q.gi)) continue;
      let yk = -1;
      let yd = Infinity;
      yb.pts.forEach((pt, k) => {
        const d = dist(pt, q.pt);
        if (d < yd) {
          yd = d;
          yk = k;
        }
      });
      if (yk >= 0 && yd < 2.5) {
        seams.push([offsets[yokeIdx]! + yb.idx[yk]!, q.gi]);
        continue;
      }
      const { best, bd } = nearest(
        q.pt,
        all.filter((o) => o.piece !== q.piece),
      );
      if (best && bd < 6) seams.push([q.gi, best.gi]);
    }
  } else if (!D.layout.isHat) {
    // 잡아 줄 요크가 없으면 윗단을 그 자리에 고정 (옷걸이에 걸린 것처럼)
    panels.forEach((p, i) => {
      if (isTopPiece(owners[i]!)) p.pin = [topRing(p)];
    });
  }
  // 앞판·뒤판 옆선
  const fi = owners.findIndex((o) => o !== 'impliedYoke' && roles.get(o) === 'front');
  const bi = owners.findIndex((o) => o !== 'impliedYoke' && roles.get(o) === 'back');
  if (fi >= 0 && bi >= 0) {
    const f = panels[fi]!;
    const b = panels[bi]!;
    seams.push(...stitchEdges({ off: offsets[fi]!, ...colEdge(f, f.cols - 1) }, { off: offsets[bi]!, ...colEdge(b, 0) }, 4));
    seams.push(...stitchEdges({ off: offsets[fi]!, ...colEdge(f, 0) }, { off: offsets[bi]!, ...colEdge(b, b.cols - 1) }, 4));
  }
  const cols = bodyColliders(body, D.layout.isHat);
  // 몸이 옷보다 나온 곳(가슴·어깨·엉덩이)은 출발 모양을 몸 밖으로 밀어 둠
  separate(panels, cols);
  return { key: shapeKey(pieces, kind), input: { panels, seams, colliders: cols, seed: 11 }, owners, rows };
}

/* ───────── 결과를 면으로 ───────── */

/** Catmull-Rom 무게 4개 */
function crw(s: number): [number, number, number, number] {
  const s2 = s * s;
  const s3 = s2 * s;
  return [0.5 * (-s3 + 2 * s2 - s), 0.5 * (3 * s3 - 5 * s2 + 2), 0.5 * (-3 * s3 + 4 * s2 + s), 0.5 * (s3 - s2)];
}

/** 시뮬레이션한 입자 격자를 부드럽게 이은 면 (u, k는 원래 조각과 같은 뜻) */
export function gridSheet(panel: ClothPanel, pos: Float32Array, ao: Float32Array | null, rows: number, segs: number): Sheet {
  const C = panel.cols;
  const K = panel.rings;
  const idx = (i: number, j: number) => {
    const ii = Math.max(0, Math.min(K - 1, i));
    const jj = panel.closed ? ((j % C) + C) % C : Math.max(0, Math.min(C - 1, j));
    return ii * C + jj;
  };
  const coords = (u: number, k: number) => {
    const fu = panel.closed ? u * C : u * (C - 1);
    const fk = (Math.max(0, Math.min(rows, k)) / rows) * (K - 1);
    const j = Math.floor(fu);
    const i = Math.min(K - 2, Math.floor(fk));
    return { i, j, su: fu - j, sk: fk - i };
  };
  const at = (u: number, k: number): Vec3 => {
    const { i, j, su, sk } = coords(u, k);
    const wu = crw(su);
    const wk = crw(sk);
    let x = 0;
    let y = 0;
    let z = 0;
    for (let b = 0; b < 4; b++) {
      for (let a = 0; a < 4; a++) {
        const w = wu[a]! * wk[b]!;
        const q = idx(i + b - 1, j + a - 1) * 3;
        x += pos[q]! * w;
        y += pos[q + 1]! * w;
        z += pos[q + 2]! * w;
      }
    }
    return [x, y, z];
  };
  const normal = (u: number, k: number): Vec3 => {
    const eu = 0.5 / (panel.closed ? C : C - 1);
    const ek = (0.5 * rows) / (K - 1);
    const ua = panel.closed ? u - eu : Math.max(0, u - eu);
    const ub = panel.closed ? u + eu : Math.min(1, u + eu);
    const n = cross(sub(at(ub, k), at(ua, k)), sub(at(u, Math.min(rows, k + ek)), at(u, Math.max(0, k - ek))));
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [(n[0] / l) * panel.orient, (n[1] / l) * panel.orient, (n[2] / l) * panel.orient];
  };
  const sheet: Sheet = {
    rows,
    closed: panel.closed,
    segs,
    at,
    inside(u, k) {
      const p = at(u, k);
      const n = normal(u, k);
      return [p[0] - n[0], p[1] - n[1], p[2] - n[2]];
    },
  };
  if (ao) {
    sheet.ao = (u, k) => {
      const { i, j, su, sk } = coords(u, k);
      const a = ao[idx(i, j)]! * (1 - su) + ao[idx(i, j + 1)]! * su;
      const b = ao[idx(i + 1, j)]! * (1 - su) + ao[idx(i + 1, j + 1)]! * su;
      return a * (1 - sk) + b * sk;
    };
  }
  return sheet;
}

/** 아무 면에나 그늘 붙이기 (마네킹처럼 시뮬레이션하지 않은 면) */
export function withOcclusion(sheet: Sheet, occ: Occupancy): Sheet {
  return {
    ...sheet,
    ao(u, k) {
      const p = sheet.at(u, k);
      const e = 1e-3;
      const a = sheet.at(sheet.closed ? u - e : Math.max(0, u - e), k);
      const b = sheet.at(sheet.closed ? u + e : Math.min(1, u + e), k);
      const c = sheet.at(u, Math.max(0, k - 0.05));
      const d = sheet.at(u, Math.min(sheet.rows, k + 0.05));
      let n = cross(sub(b, a), sub(d, c));
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
      if (dot(n, sub(p, sheet.inside(u, k))) < 0) n = [-n[0], -n[1], -n[2]];
      // 마네킹은 자기 몸(팔·몸통 사이)에만 가림: 반투명한 옷 아래가 얼룩져 보이지 않게
      return 0.35 + 0.65 * occlusionAt(occ, p, n, 12, OCC_FORM);
    },
  };
}

/** 시뮬레이션 결과를 입힌 모양에 반영 (조각 면을 늘어뜨린 면으로 바꿈) */
export function applyCloth(pieces: ArtPiece[], kind: BodyKind, plan: ClothPlan, out: ClothOutput): Draped {
  const D = drapeFor(pieces, kind);
  const byId = new Map(pieces.map((p) => [p.piece.id, p]));
  plan.owners.forEach((o, i) => {
    const panel = plan.input.panels[i]!;
    if (o === 'impliedYoke') {
      if (D.impliedYoke) D.impliedYoke = { ...D.impliedYoke, sheet: gridSheet(panel, out.pos[i]!, out.ao[i]!, plan.rows[i]!, D.impliedYoke.sheet.segs) };
      return;
    }
    const piece = byId.get(o.piece.id);
    const old = piece ? D.sheets.get(piece) : undefined;
    if (!piece || !old) return;
    D.sheets.set(piece, gridSheet(panel, out.pos[i]!, out.ao[i]!, plan.rows[i]!, old.segs));
  });
  D.occ = out.occ;
  return D;
}

/* ───────── 계산은 워커에서, 결과는 기억 ───────── */

type Done = { plan: ClothPlan; out: ClothOutput };
const done = new Map<string, Done | null>();
const pending = new Map<string, Promise<Done | null>>();
let worker: Worker | null | undefined;
let seq = 0;
const waiting = new Map<number, (o: ClothOutput) => void>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./clothWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; out: ClothOutput }>) => {
      waiting.get(e.data.id)?.(e.data.out);
      waiting.delete(e.data.id);
    };
    worker.onerror = () => {
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function run(input: ClothInput): Promise<ClothOutput> {
  const w = getWorker();
  if (!w) return new Promise((r) => setTimeout(() => r(simulate(input)), 0));
  const id = ++seq;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    w.postMessage({ id, input });
  });
}

/** 이미 늘어뜨린 모양이 있으면 그것으로 입힌 모양 (없으면 null) */
export function clothDraped(pieces: ArtPiece[], kind: BodyKind = 'female'): Draped | null {
  const hit = done.get(shapeKey(pieces, kind));
  return hit ? applyCloth(pieces, kind, hit.plan, hit.out) : null;
}

/** 계산 방식이 바뀌면 올려서 예전에 저장한 모양을 쓰지 않게 */
const CLOTH_VERSION = 7;

/** 늘어뜨린 모양을 계산해 둠 (이미 했거나 하는 중이면 그대로). 한 번 계산한 모양은 기기에 저장 */
export function ensureCloth(pieces: ArtPiece[], kind: BodyKind = 'female'): Promise<boolean> {
  const key = shapeKey(pieces, kind);
  if (done.has(key)) return Promise.resolve(!!done.get(key));
  let job = pending.get(key);
  if (!job) {
    job = (async (): Promise<Done | null> => {
      const plan = planCloth(pieces, kind);
      if (!plan) return null;
      const store = `${CLOTH_VERSION}|${key}`;
      const saved = await loadCloth(store);
      const fits = saved && saved.length === plan.input.panels.length && saved.every((p, i) => p.length === plan.input.panels[i]!.pos.length);
      if (fits) return { plan, out: { ...bakeCloth(plan.input, saved), ok: true, ms: 0 } };
      const out = await run(plan.input);
      if (!out.ok) return null;
      void saveCloth(
        store,
        out.pos.map((p) => p.slice()),
      );
      return { plan, out };
    })()
      .catch(() => null)
      .then((r) => {
        if (done.size > 24) done.clear();
        done.set(key, r);
        pending.delete(key);
        return r;
      });
    pending.set(key, job);
  }
  return job.then((r) => !!r);
}

async function loadCloth(key: string): Promise<Float32Array[] | null> {
  try {
    const { db } = await import('../offline');
    return (await db.cloth.get(key))?.pos ?? null;
  } catch {
    return null;
  }
}

async function saveCloth(key: string, pos: Float32Array[]) {
  try {
    const { db } = await import('../offline');
    await db.cloth.put({ key, pos, savedAt: Date.now() });
  } catch {
    // 저장 공간을 못 쓰면 다음에 다시 계산
  }
}
