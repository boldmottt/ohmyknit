import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertPattern } from '@knitcloset/gauge-engine';
import { parsePattern, SAMPLE_BEANIE, SAMPLE_PATTERN } from '@knitcloset/pattern-schema';
import { BODY_KINDS, emptyBody, loftGirth, loftReach, specHeadGirth, type BodyKind, type Loft } from './body';
import { readBody, writeBody } from './bodyPref';
import { separate, type ClothPanel } from './cloth';
import { bodyColliders, bodyOfDraped, drapeFor } from './drapeSim';

/** 높이 y에 가장 가까운 단면의 둘레 */
function girthAt(L: Loft, y: number): number {
  let best = 0;
  L.y.forEach((v, i) => {
    if (Math.abs(v - y) < Math.abs(L.y[best]! - y)) best = i;
  });
  return loftGirth(L, best);
}

/** y0..y1 사이 가장 굵은 둘레 */
function maxGirth(L: Loft, y0: number, y1: number): number {
  let g = 0;
  L.y.forEach((v, i) => {
    if (v >= y0 && v <= y1) g = Math.max(g, loftGirth(L, i));
  });
  return g;
}

function ellipsePerimeter(a: number, b: number) {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

function sweater(kind: BodyKind) {
  const conv = convertPattern(parsePattern(SAMPLE_PATTERN), { size: 'M', myGauge: { st: 25, row: 33 } });
  const pieces = conv.pieces.map((piece) => ({ piece, completedRows: 0, gauge: { st: 25, row: 33 } }));
  const D = drapeFor(pieces, kind);
  return { D, body: bodyOfDraped(D, kind)! };
}

// 빈 마네킹은 겨드랑이가 y = 44 + 1.5
const ARMPIT = 45.5;

describe('사람 모양 마네킹', () => {
  it('여자 몸: 허리가 가슴·엉덩이보다 가늘고, 치수가 실제 사람 비율', () => {
    const L = emptyBody('female').torso!;
    const bust = maxGirth(L, ARMPIT - 12, ARMPIT);
    const waist = girthAt(L, ARMPIT - 25);
    const hip = girthAt(L, ARMPIT - 43);
    expect(bust).toBeGreaterThan(80);
    expect(bust).toBeLessThan(92);
    expect(waist).toBeLessThan(bust * 0.85);
    expect(waist).toBeLessThan(hip * 0.8);
    expect(hip).toBeGreaterThan(bust);
    // 목은 통짜가 아니라 가늘게
    expect(girthAt(L, ARMPIT + 17)).toBeLessThan(36);
  });

  it('남자 몸: 가슴이 엉덩이보다 넓고, 어깨가 여자보다 넓음', () => {
    const m = emptyBody('male').torso!;
    const f = emptyBody('female').torso!;
    expect(girthAt(m, ARMPIT - 7)).toBeGreaterThan(girthAt(m, ARMPIT - 45));
    expect(girthAt(m, ARMPIT - 7)).toBeGreaterThan(girthAt(f, ARMPIT - 7));
    const half = (L: Loft, y: number) => Math.max(loftReach(L, 0, y), loftReach(L, Math.PI, y));
    expect(half(m, ARMPIT + 9)).toBeGreaterThan(half(f, ARMPIT + 8.5) + 1);
    expect(girthAt(m, ARMPIT + 17)).toBeLessThan(40);
  });

  it.each(BODY_KINDS)('머리와 목 (%s): 목은 턱 끝보다 뒤에서 올라가 턱 밑이 드러나고, 뒤통수가 목덜미 위로 나옴', (kind) => {
    const b = emptyBody(kind);
    const H = b.head;
    const T = b.torso!;
    const chin = H.y[0]!;
    const front = (L: Loft, y: number) => loftReach(L, Math.PI / 2, y);
    const back = (L: Loft, y: number) => -loftReach(L, -Math.PI / 2, y);
    // 턱 끝 바로 위: 목 앞면(목젖 쪽)이 턱 앞면보다 3cm 넘게 뒤 (예전엔 목이 턱 앞까지 나와 턱과 붙어 보였음)
    expect(front(H, chin + 2.2) - front(T, chin + 2.2)).toBeGreaterThan(3);
    // 뒤통수(턱 끝 위 10cm)가 목덜미(턱 끝 위 4cm)보다 1.5cm 넘게 뒤로
    expect(back(H, chin + 10)).toBeLessThan(back(T, chin + 4) - 1.5);
    // 머리 높이(턱 끝 ~ 정수리)는 사람 비율 (여자 22.5, 남자 23.5 근처)
    const height = b.top - chin;
    expect(height).toBeGreaterThan(21);
    expect(height).toBeLessThan(25);
    // 머리 둘레도 사람 크기
    expect(specHeadGirth(kind)).toBeGreaterThan(52);
    expect(specHeadGirth(kind)).toBeLessThan(59);
  });

  it.each(BODY_KINDS)('옷에 맞춘 몸 (%s): 가슴둘레가 옷보다 조금 작음 (보통 여유)', (kind) => {
    const { D, body } = sweater(kind);
    const main = [...D.layout.roles].find(([, r]) => r === 'body')![0];
    const rings = [...D.tubes.get(main)!.rings].sort((a, b) => a.t - b.t);
    const top = rings.slice(Math.floor(rings.length * 0.6));
    const garment = top.reduce((s, r) => s + ellipsePerimeter(r.rx, r.rz || r.rx * 0.76), 0) / top.length;
    const armpit = D.layout.topY + 1.5;
    const chest = maxGirth(body.torso!, armpit - 13, armpit + 1);
    expect(chest).toBeLessThan(garment);
    expect(chest).toBeGreaterThan(garment * 0.88);
    // 소매를 따라 팔 두 개, 팔마다 손바닥과 엄지
    expect(body.arms.length).toBe(2);
    expect(body.hands.length).toBe(4);
  });

  it.each(BODY_KINDS)('손 (%s): 납작한 손바닥, 엄지, 따로 떨어진 손가락 넷이 손바닥 아래로', (kind) => {
    const b = emptyBody(kind);
    const palms = b.hands.filter((h) => (h.n ?? 2) > 2);
    const thumbs = b.hands.filter((h) => (h.n ?? 2) === 2);
    expect(palms.length).toBe(2);
    expect(thumbs.length).toBe(2);
    for (const h of palms) {
      // 가장 넓은 자리(손가락 뿌리)에서 너비가 두께의 두 배 넘게
      const knuckle = h.rings.reduce((a, r) => (r.rz > a.rz ? r : a));
      expect(knuckle.rz).toBeGreaterThan(knuckle.rx * 2);
      expect(knuckle.rz).toBeGreaterThan(3.3);
    }
    // 손가락: 팔마다 넷 (+ 발 둘), 손바닥 끝보다 아래로 내려가고 끝은 둥글게
    const fingers = b.details.filter((d) => (d.n ?? 2) === 2);
    expect(fingers.length).toBe(8);
    for (const f of fingers) {
      const tip = f.axis.at(f.rings[0]!.t).p;
      const root = f.axis.at(f.rings[f.rings.length - 1]!.t).p;
      expect(root[1] - tip[1]).toBeGreaterThan(4.5);
      const near = f.rings.find((r) => r.t >= f.rings[0]!.t + 0.25)!;
      expect(near.rx).toBeGreaterThan(0.25);
    }
  });

  it.each(BODY_KINDS)('다리 (%s): 엉덩이 안에서 발목까지, 발은 바닥 판 위에', (kind) => {
    const b = emptyBody(kind);
    expect(b.limbs.length).toBe(2);
    const feet = b.details.filter((d) => (d.n ?? 2) > 2);
    expect(feet.length).toBe(2);
    const floor = b.base!.c[1] + b.base!.h / 2;
    for (const f of feet) {
      // 발바닥이 판에 닿음 (1cm 안)
      let low = Infinity;
      for (const r of f.rings) low = Math.min(low, f.axis.at(r.t).p[1] - r.rz);
      expect(Math.abs(low - floor)).toBeLessThan(1);
    }
    // 키: 패션 마네킹 (여자 175~185, 남자 182~192)
    const height = b.top - floor;
    if (kind === 'female') expect(height).toBeGreaterThan(175);
    else expect(height).toBeGreaterThan(182);
    expect(height).toBeLessThan(kind === 'female' ? 185 : 192);
    // 이음선: 팔마다 셋 + 몸통 선
    expect(b.seams.length).toBeGreaterThan(6);
  });

  it.each(BODY_KINDS)('허벅지 (%s): 윗끝이 엉덩이 옆으로 삐져나오지 않음', (kind) => {
    const b = emptyBody(kind);
    const L = b.torso!;
    for (const th of b.limbs) {
      const t0 = th.rings[0]!.t;
      for (const r of th.rings) {
        // 윗부분 3cm (둥근 머리)는 몸통 안
        if (r.t > t0 + 3) continue;
        const f = th.axis.at(r.t);
        const theta = f.p[0] > 0 ? 0 : Math.PI;
        expect(Math.abs(f.p[0]) + r.rx).toBeLessThan(loftReach(L, theta, f.p[1]) + 0.3);
      }
    }
  });

  it.each(BODY_KINDS)('모자 받침 (%s): 사람 머리 둘레가 모자를 씌운 둘레와 같음', (kind) => {
    const conv = convertPattern(parsePattern(SAMPLE_BEANIE), { size: '성인', myGauge: { st: 22, row: 30 } });
    const pieces = conv.pieces.map((piece) => ({ piece, completedRows: 0, gauge: { st: 22, row: 30 } }));
    const D = drapeFor(pieces, kind);
    const b = bodyOfDraped(D, kind)!;
    expect(b.torso).toBeNull();
    expect(b.hands.length).toBe(0);
    const h = D.layout.head!;
    const head = maxGirth(b.head, b.head.y[0]!, b.top);
    expect(head / ellipsePerimeter(h.rh, h.rz)).toBeGreaterThan(0.97);
    expect(head / ellipsePerimeter(h.rh, h.rz)).toBeLessThan(1.06);
    expect(specHeadGirth(kind)).toBeGreaterThan(50);
  });

  it('몸 안에 들어간 천은 바깥으로 밀려남 (몸통 단면 부딪힘)', () => {
    const b = emptyBody('female');
    const cols = 48;
    const rings = 3;
    const pos = new Float32Array(cols * rings * 3);
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < cols; j++) {
        const a = (2 * Math.PI * j) / cols;
        // 허리 높이에서 몸 속 (반지름 5cm)
        pos.set([5 * Math.cos(a), ARMPIT - 24 - i, 5 * Math.sin(a)], (i * cols + j) * 3);
      }
    }
    const panel: ClothPanel = { id: 'w', closed: true, cols, rings, pos, restU: new Float32Array(rings).fill(1), restK: new Float32Array(rings - 1).fill(1), orient: 1 };
    separate([panel], bodyColliders(b, false));
    for (let k = 0; k < cols * rings; k++) {
      const x = pos[k * 3]!;
      const y = pos[k * 3 + 1]!;
      const z = pos[k * 3 + 2]!;
      const th = Math.atan2(z, x);
      expect(Math.hypot(x, z)).toBeGreaterThan(loftReach(b.torso!, th, y) - 0.05);
    }
  });
});

describe('마네킹 몸 고르기', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('옷장 주인마다 기억하고, 바꾸면 열린 화면에 알림', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    const events: unknown[] = [];
    vi.stubGlobal('window', { dispatchEvent: (e: CustomEvent) => events.push(e.detail) });
    vi.stubGlobal(
      'CustomEvent',
      class {
        constructor(
          public type: string,
          public init?: { detail?: unknown },
        ) {}
        get detail() {
          return this.init?.detail;
        }
      },
    );
    expect(readBody('a')).toBe('female');
    writeBody('a', 'male');
    expect(readBody('a')).toBe('male');
    expect(readBody('b')).toBe('female');
    expect(events).toEqual([{ profileId: 'a', kind: 'male' }]);
  });

  it('저장 공간을 못 쓰면 여자 몸으로', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readBody('a')).toBe('female');
  });
});
