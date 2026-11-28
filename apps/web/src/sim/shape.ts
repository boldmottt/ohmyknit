import type { ArtPiece } from '../closet/assembledArt';

/**
 * 패턴판 → 3D 모양 계산 (three.js 없이 숫자만).
 *
 * 조각마다 단 경계(0..R)의 둘레를 콧수/게이지로 구하고, 단 높이(10cm/단 게이지)만큼
 * 위로 쌓아 원통(또는 반원통·판)을 만듭니다. 줄임이 급한 곳(모자 정수리)은 단 높이가
 * 옆으로 눕기 때문에 그만큼 덜 올라가요. 그래서 모자는 저절로 둥근 돔이 됩니다.
 * 조각을 어디에 붙일지(몸판 가운데, 소매 어깨, 요크 위)는 이름과 뜨는 방식으로 정해요.
 */

export type SimRole = 'body' | 'front' | 'back' | 'yoke' | 'sleeveL' | 'sleeveR' | 'hat' | 'panel' | 'extra';

const NAME = {
  sleeve: /소매|sleeve|arm/i,
  yoke: /요크|yoke/i,
  hat: /비니|모자|hat|beanie|cap/i,
  front: /앞판|앞몸판|front/i,
  back: /뒤판|뒤몸판|back/i,
  body: /몸판|몸통|몸체|body/i,
};

/** 조각마다 옷의 어느 자리인지. 자리가 없는 조각(주머니 등)은 extra: 3D에는 안 붙이고 패턴판에만 보여요 */
export function simRoles(pieces: ArtPiece[]): Map<ArtPiece, SimRole> {
  const out = new Map<ArtPiece, SimRole>();
  const left = [...pieces];
  const take = (p: ArtPiece, r: SimRole) => {
    out.set(p, r);
    left.splice(left.indexOf(p), 1);
  };
  const sleeves = pieces.filter((p) => NAME.sleeve.test(p.piece.name));
  if (sleeves[0]) take(sleeves[0], 'sleeveL');
  if (sleeves[1]) take(sleeves[1], 'sleeveR');
  const yoke = left.find((p) => NAME.yoke.test(p.piece.name));
  if (yoke) take(yoke, 'yoke');
  const front = left.find((p) => NAME.front.test(p.piece.name));
  const back = left.find((p) => NAME.back.test(p.piece.name));
  if (front && back) {
    take(front, 'front');
    take(back, 'back');
  } else {
    const hat = sleeves.length === 0 ? left.find((p) => NAME.hat.test(p.piece.name)) : undefined;
    if (hat) take(hat, 'hat');
    else {
      const bodies = left.filter((p) => NAME.body.test(p.piece.name));
      if (bodies.length >= 2 && bodies[0]!.piece.construction === 'flat' && bodies[1]!.piece.construction === 'flat') {
        // "몸판 1, 몸판 2"처럼 평면으로 두 장 뜨는 몸판 = 앞판·뒤판
        take(bodies[0]!, 'front');
        take(bodies[1]!, 'back');
      } else {
        const main = bodies[0] ?? [...left].sort((a, b) => b.piece.totalStitches - a.piece.totalStitches)[0];
        if (main) take(main, main.piece.construction === 'flat' && sleeves.length === 0 ? 'panel' : 'body');
      }
    }
  }
  for (const p of [...left]) take(p, 'extra');
  return out;
}

export type Ring = { t: number; rx: number; rz: number; /** 고리 중심이 앞뒤로 밀린 정도 (모자가 뒤로 처질 때) */ cz?: number };
export type TubeKind = 'tube' | 'half' | 'panel';
export type Tube = {
  kind: TubeKind;
  /** 단 경계 k = 0..R. k번째는 k단을 다 뜬 뒤의 가장자리 (0 = 코잡은 가장자리) */
  rings: Ring[];
  /** 축 방향 길이 (cm). t = 0이 아래쪽 끝 (밑단·소맷부리·챙), t = length가 위쪽 끝 */
  length: number;
};

/** 몸통은 앞뒤로 납작한 타원 (둘레는 원과 거의 같게), 소매는 살짝 납작, 모자는 둥글게 */
export function ellipseOf(role: SimRole): [number, number] {
  if (role === 'body' || role === 'yoke' || role === 'front' || role === 'back') return [1.13, 0.86];
  if (role === 'hat') return [1, 0.97];
  return [1.03, 0.94];
}

export function tubeOf(p: ArtPiece, role: SimRole): Tube {
  const rows = p.piece.rows;
  const R = rows.length;
  const kind: TubeKind = role === 'front' || role === 'back' ? 'half' : role === 'panel' ? 'panel' : 'tube';
  const h = 10 / p.gauge.row;
  const widthAt = (k: number) => {
    const n = k === 0 ? (rows[0]?.stitchesWorked ?? 1) : (rows[k - 1]?.stitchCount ?? 1);
    return (Math.max(1, n) / p.gauge.st) * 10;
  };
  // 둘레 → 반지름 (반원통은 너비가 둘레의 절반, 판은 너비 그대로)
  const raw = Array.from({ length: R + 1 }, (_, k) => {
    const w = widthAt(k);
    return kind === 'tube' ? w / (2 * Math.PI) : kind === 'half' ? w / Math.PI : w;
  });
  // 늘림·줄임 계단을 살짝 펴기
  const r = raw.map((_, k) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, k - 2); j <= Math.min(R, k + 2); j++) {
      s += raw[j]!;
      n++;
    }
    return s / n;
  });
  const cum = [0];
  for (let k = 1; k <= R; k++) {
    const dr = kind === 'panel' ? 0 : Math.abs(r[k]! - r[k - 1]!);
    // 단 높이 h가 비스듬히 누우면 그만큼 덜 올라감 (최소 35%는 올라가서 둥근 돔이 되게)
    const dy = Math.sqrt(Math.max(h * h - dr * dr, (0.35 * h) ** 2));
    cum.push(cum[k - 1]! + dy);
  }
  const length = cum[R]!;
  const [ex, ez] = ellipseOf(role);
  const topDown = p.piece.direction === 'top_down';
  const rings = r.map((rad, k) => ({
    t: topDown ? length - cum[k]! : cum[k]!,
    rx: kind === 'panel' ? rad : rad * ex,
    rz: kind === 'panel' ? 0 : rad * ez,
  }));
  return { kind, rings, length };
}

/** 높이 t에서의 고리 (사이는 선형으로) */
function ringAtT(rings: Ring[], t: number): Ring {
  const rs = [...rings].sort((a, b) => a.t - b.t);
  if (t <= rs[0]!.t) return rs[0]!;
  for (let i = 1; i < rs.length; i++) {
    const a = rs[i - 1]!;
    const b = rs[i]!;
    if (t > b.t) continue;
    const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    return { t, rx: a.rx + (b.rx - a.rx) * f, rz: a.rz + (b.rz - a.rz) * f };
  }
  return rs[rs.length - 1]!;
}

/**
 * 몸판의 겨드랑이 높이 (cm, 아래 끝에서).
 * - 진동 시작: 위로 가다가 너비가 4cm 안에 7% 넘게 줄고 다시 넓어지지 않는 곳 (진동 코막음·줄임,
 *   래글런 겨드랑이 코막음). 그런 곳이 여럿이면(목 파임, 페플럼 허리) 조각 아래 45%보다 위이고
 *   그 위로 진동 깊이만큼(조각의 20%, 길면 9cm) 이어지는 것 중 가장 낮은 것
 * - 진동 줄임 없이 어깨까지 곧게 뜨는 앞판·뒤판(드롭숄더)은 어깨선에서 보통 진동 깊이만큼 아래
 *   (가슴둘레의 15.5%: 가슴 91cm → 14cm)
 * - 그 밖(겨드랑이까지만 뜨는 요크 스웨터 몸판 등)은 윗단
 */
export function underarmOf(tube: Tube, flatToShoulder = false): number {
  const rs = [...tube.rings].sort((a, b) => a.t - b.t);
  const n = rs.length;
  const top = tube.length;
  if (n < 3 || top <= 0) return top;
  const above = new Array<number>(n);
  above[n - 1] = rs[n - 1]!.rx;
  for (let i = n - 2; i >= 0; i--) above[i] = Math.max(above[i + 1]!, rs[i]!.rx);
  const depth = Math.max(4, Math.min(top * 0.2, 9));
  for (let i = 1; i < n; i++) {
    // 바로 아래 4cm 안에서 가장 넓은 곳
    let j = i;
    for (let q = i - 1; q >= 0 && rs[i]!.t - rs[q]!.t <= 4; q--) if (rs[q]!.rx > rs[j]!.rx) j = q;
    const wide = rs[j]!.rx;
    if (rs[i]!.rx > wide * 0.93 || above[i]! > wide * 0.97) continue;
    const start = rs[j]!.t;
    if (start >= top * 0.45 && top - start >= depth) return start;
  }
  if (!flatToShoulder) return top;
  const widest = rs.reduce((a, b) => (b.rx > a.rx ? b : a));
  const a = widest.rx;
  const b = widest.rz || widest.rx * 0.76;
  const chest = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  return Math.max(top * 0.5, top - chest * 0.155);
}

/**
 * 어깨까지 뜨는 판의 목 파임이 시작하는 높이: 진동 줄임(겨드랑이 위 2cm) 위에서 다시 4cm 안에 7% 넘게 좁아지고
 * 다시 넓어지지 않는 곳 중 가장 낮은 것. 없으면 null
 */
export function necklineOf(tube: Tube, underarm: number): number | null {
  const rs = [...tube.rings].sort((a, b) => a.t - b.t);
  const n = rs.length;
  const above = new Array<number>(n);
  above[n - 1] = rs[n - 1]!.rx;
  for (let i = n - 2; i >= 0; i--) above[i] = Math.max(above[i + 1]!, rs[i]!.rx);
  for (let i = 1; i < n; i++) {
    if (rs[i]!.t <= underarm + 2) continue;
    let j = i;
    for (let q = i - 1; q >= 0 && rs[i]!.t - rs[q]!.t <= 4 && rs[q]!.t > underarm + 2; q--) if (rs[q]!.rx > rs[j]!.rx) j = q;
    const wide = rs[j]!.rx;
    if (rs[i]!.rx > wide * 0.93 || above[i]! > wide * 0.97) continue;
    return rs[j]!.t;
  }
  return null;
}

/** 조각을 놓는 자리: t = 0 끝의 위치(cm)와 z축 기울기(라디안, 축이 위를 향하는 데서) */
export type Placement = { origin: [number, number, number]; tilt: number };

/** 팔이 몸에서 벌어지는 각도 */
export const ARM_ANGLE = 0.42;

export type Layout = {
  roles: Map<ArtPiece, SimRole>;
  tubes: Map<ArtPiece, Tube>;
  place: Map<ArtPiece, Placement>;
  /** 몸판 윗단 높이 (겨드랑이) */
  topY: number;
  /** 몸판 윗단의 가로·세로 반지름 */
  topRx: number;
  topRz: number;
  /** 소매 윗단이 붙는 어깨 자리 (왼쪽) */
  shoulder: [number, number, number] | null;
  isHat: boolean;
  /** 모자를 씌운 머리 (가로·세로·앞뒤 반지름, 중심 높이) */
  head: { rh: number; rv: number; rz: number; cy: number } | null;
  /** 어깨까지 뜨는 앞판·뒤판의 목 파임이 시작하는 단 경계 k (이 뒤의 단은 이 단 너비로 봄) */
  necks?: Map<ArtPiece, number>;
};

/**
 * 모자를 머리에 씌운 모양: 챙(첫 단 쪽)은 이마에, 나머지는 머리 곡면을 따라 정수리까지.
 * 모자는 머리보다 조금 작게 떠서 늘어나 붙고, 머리보다 길면 남는 만큼 뒤로 처져요(슬라우치).
 */
export function wearHat(tube: Tube): { tube: Tube; head: NonNullable<Layout['head']> } {
  const brim = tube.rings.reduce((a, b) => (a.t < b.t ? a : b));
  const rh = brim.rx * 1.08;
  const rv = rh * 1.2;
  const rzh = rh * 1.13;
  const thB = -0.3;
  const cy = -rv * Math.sin(thB);
  // 이마에서 정수리까지 머리 곡선 길이
  let sHead = 0;
  const N = 60;
  for (let i = 0; i < N; i++) {
    const a = thB + ((Math.PI / 2 - thB) * (i + 0.5)) / N;
    sHead += Math.hypot(rh * Math.sin(a), rv * Math.cos(a)) * ((Math.PI / 2 - thB) / N);
  }
  const S = tube.length || 1;
  const excess = Math.max(0, Math.min(0.8, S / sHead - 1));
  const rings = tube.rings.map((r) => {
    const f = Math.max(0, Math.min(1, r.t / S));
    const th = thB + (Math.PI / 2 - thB) * f ** 0.92;
    const bulge = 1 + 0.3 * excess * Math.sin(Math.PI * f);
    const fit = Math.cos(th);
    return {
      t: cy + rv * Math.sin(th) + 0.3 + excess * rv * 0.25 * Math.sin(Math.PI * f),
      rx: Math.max(0.05, (rh * fit + 0.35) * bulge),
      rz: Math.max(0.05, (rzh * fit + 0.35) * bulge),
      cz: -excess * rh * 0.7 * f * f,
    };
  });
  return { tube: { ...tube, rings }, head: { rh, rv, rz: rzh, cy } };
}

export function layoutOf(pieces: ArtPiece[]): Layout {
  const roles = simRoles(pieces);
  const tubes = new Map<ArtPiece, Tube>();
  const place = new Map<ArtPiece, Placement>();
  for (const [p, r] of roles) if (r !== 'extra') tubes.set(p, tubeOf(p, r));
  const find = (r: SimRole) => [...roles].find(([, x]) => x === r)?.[0];
  const body = find('body') ?? find('front') ?? find('panel') ?? find('hat');
  const isHat = !!find('hat') && !find('body');
  let head: Layout['head'] = null;
  const hatPiece = find('hat');
  if (isHat && hatPiece) {
    const worn = wearHat(tubes.get(hatPiece)!);
    tubes.set(hatPiece, worn.tube);
    head = worn.head;
  }

  let topY = 0;
  let topRx = 8;
  let topRz = 6;
  if (body && !isHat) {
    const t = tubes.get(body)!;
    // 겨드랑이: 요크 스웨터처럼 겨드랑이까지만 뜨는 몸판은 윗단, 어깨까지 뜨는 앞판·뒤판은 진동이 시작하는 곳
    // (요크 조각이 따로 있으면 앞판·뒤판도 겨드랑이까지만 뜸)
    topY = underarmOf(t, roles.get(body) === 'front' && !find('yoke'));
    const top = ringAtT(t.rings, topY);
    topRx = top.rx;
    topRz = top.rz || top.rx * 0.76;
  }
  // 어깨까지 뜨는 앞판·뒤판의 목 파임: 목에서 코막음·줄임한 코는 너비가 준 게 아니라 구멍이라,
  // 목 파임이 시작한 뒤의 단도 그 전 너비로 둠 (줄어든 너비로 두면 짧아진 윗단이 어깨 끝과 끝을 목 쪽으로 끌어당겨
  // 옷 전체가 목에 뭉쳐 올라갔음)
  const necks = new Map<ArtPiece, number>();
  for (const [p, r] of roles) {
    if (isHat || (r !== 'front' && r !== 'back')) continue;
    const t = tubes.get(p)!;
    if (t.length <= topY + 3) continue;
    const start = necklineOf(t, topY);
    if (start === null) continue;
    const keep = ringAtT(t.rings, start);
    let k = 0;
    t.rings.forEach((ring, i) => {
      if (Math.abs(ring.t - start) < Math.abs(t.rings[k]!.t - start)) k = i;
    });
    necks.set(p, k);
    tubes.set(p, { ...t, rings: t.rings.map((ring) => (ring.t > start ? { ...ring, rx: keep.rx, rz: keep.rz } : ring)) });
  }
  for (const [p, r] of roles) {
    if (r === 'body' || r === 'front' || r === 'back' || r === 'hat' || r === 'panel') place.set(p, { origin: [0, 0, 0], tilt: 0 });
  }
  const yoke = find('yoke');
  if (yoke) place.set(yoke, { origin: [0, topY, 0], tilt: 0 });

  let shoulder: [number, number, number] | null = null;
  for (const side of ['sleeveL', 'sleeveR'] as const) {
    const s = find(side);
    if (!s) continue;
    const t = tubes.get(s)!;
    const up = t.rings.reduce((a, b) => (b.t > a.t ? b : a));
    const sx = side === 'sleeveL' ? -1 : 1;
    // 소매 윗단 가운데를 겨드랑이 바깥 어깨 자리에
    const anchor: [number, number, number] = [sx * (topRx + up.rx * 0.45), topY + up.rx * 0.55, 0];
    if (side === 'sleeveL') shoulder = anchor;
    const tilt = sx * ARM_ANGLE; // 왼쪽 소매: 축(소맷부리 → 어깨)이 오른쪽 위로
    const dir = [-Math.sin(tilt), Math.cos(tilt)];
    place.set(s, { origin: [anchor[0] - dir[0]! * t.length, anchor[1] - dir[1]! * t.length, 0], tilt });
    if (!shoulder && side === 'sleeveR') shoulder = [-anchor[0], anchor[1], 0];
  }
  return { roles, tubes, place, topY, topRx, topRz, shoulder, isHat, head, necks };
}

/**
 * 천의 자연스러운 주름 (cm, 바깥쪽으로). 소매는 팔꿈치·소맷부리 위가 접히고,
 * 몸판은 옆구리 아래로 세로 주름이 살짝.
 */
export function wrinkle(role: SimRole, phi: number, t: number, length: number): number {
  const f = length > 0 ? t / length : 0;
  if (role === 'sleeveL' || role === 'sleeveR') {
    const elbow = Math.exp(-(((f - 0.48) / 0.13) ** 2)) * 0.55 + Math.exp(-(((f - 0.2) / 0.07) ** 2)) * 0.35;
    return elbow * Math.sin(t * 1.35 + 1.6 * Math.sin(phi * 2)) * (0.6 + 0.4 * Math.cos(phi - 0.4));
  }
  if (role === 'body' || role === 'front' || role === 'back' || role === 'yoke') {
    const hem = Math.max(0, 0.6 - f) / 0.6;
    const side = Math.abs(Math.cos(phi)) ** 3;
    return 0.32 * side * hem * Math.sin(phi * 7 + t * 0.12) + 0.12 * Math.sin(phi * 13 - t * 0.21) * hem;
  }
  if (role === 'hat') return 0.1 * Math.sin(phi * 9 + t * 0.4) * (1 - f);
  return 0;
}
