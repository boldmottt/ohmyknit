import { describe, expect, it } from 'vitest';
import { convertPattern } from '@knitcloset/gauge-engine';
import { parsePattern, SAMPLE_BEANIE, SAMPLE_PATTERN } from '@knitcloset/pattern-schema';
import { simulate, type ClothPanel } from './cloth';
import { gridSheet, planCloth, RIB_REST, shapeKey } from './drapeSim';

const ringY = (pos: Float32Array, p: ClothPanel, i: number) => {
  let s = 0;
  for (let j = 0; j < p.cols; j++) s += pos[(i * p.cols + j) * 3 + 1]!;
  return s / p.cols;
};
const ringGirth = (pos: Float32Array, p: ClothPanel, i: number) => {
  let s = 0;
  for (let j = 0; j < p.cols; j++) {
    const a = (i * p.cols + j) * 3;
    const b = (i * p.cols + ((j + 1) % p.cols)) * 3;
    s += Math.hypot(pos[a]! - pos[b]!, pos[a + 1]! - pos[b + 1]!, pos[a + 2]! - pos[b + 2]!);
  }
  return s;
};

/** 윗고리를 잡아 둔 원통 하나 (치마처럼) */
function hangingTube(): ClothPanel {
  const cols = 24;
  const rings = 16;
  const r = 6;
  const pos = new Float32Array(cols * rings * 3);
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < cols; j++) {
      const a = (2 * Math.PI * j) / cols;
      pos.set([r * Math.cos(a), 20 - i * 1.2, r * Math.sin(a)], (i * cols + j) * 3);
    }
  }
  const chord = 2 * r * Math.sin(Math.PI / cols);
  return { id: 't', closed: true, cols, rings, pos, restU: new Float32Array(rings).fill(chord), restK: new Float32Array(rings - 1).fill(1.2), pin: [0], orient: 1 };
}

describe('천 시뮬레이션', () => {
  it('잡아 둔 원통은 자기 무게로 늘어지되 많이 늘어나지 않고, 잡은 고리는 그대로', () => {
    const p = hangingTube();
    const out = simulate({ panels: [p], seams: [], colliders: [], params: { frames: 40 } });
    expect(out.ok).toBe(true);
    const pos = out.pos[0]!;
    expect(ringY(pos, p, 0)).toBeCloseTo(20, 1);
    const len = ringY(pos, p, 0) - ringY(pos, p, p.rings - 1);
    expect(len).toBeGreaterThan(1.2 * (p.rings - 1) * 0.97);
    expect(len).toBeLessThan(1.2 * (p.rings - 1) * 1.08);
    for (const v of out.ao[0]!) expect(v).toBeGreaterThanOrEqual(0);
  });

  it.each(['female', 'male'] as const)('스웨터 (%s): 요크가 어깨에 걸려 옷이 흘러내리지 않고, 고무단은 몸에 붙음', (kind) => {
    const conv = convertPattern(parsePattern(SAMPLE_PATTERN), { size: 'M', myGauge: { st: 25, row: 33 } });
    const pieces = conv.pieces.map((piece) => ({ piece, completedRows: 0, gauge: { st: 25, row: 33 } }));
    const plan = planCloth(pieces, kind)!;
    expect(plan).not.toBeNull();
    expect(plan.input.seams.length).toBeGreaterThan(40);
    // 요크가 있으니 아무것도 고정하지 않음 (어깨가 받침)
    expect(plan.input.panels.every((p) => !p.pin?.length)).toBe(true);
    const out = simulate({ ...plan.input, params: { frames: 60 } });
    expect(out.ok).toBe(true);
    const bi = plan.input.panels.findIndex((p) => p.id === 'body');
    const body = plan.input.panels[bi]!;
    const after = out.pos[bi]!;
    // 밑단 높이가 몇 cm 안에서 그대로 (흘러내리지 않음)
    expect(Math.abs(ringY(after, body, 0) - ringY(body.pos, body, 0))).toBeLessThan(3);
    const hem = ringGirth(after, body, 0);
    const mid = ringGirth(after, body, body.rings >> 1);
    expect(hem).toBeGreaterThan(mid * RIB_REST * 0.9);
    // 남자는 엉덩이가 가슴보다 좁아 고무단이 오므라들고, 여자는 엉덩이에 걸쳐 붙음 (풍선처럼 벌어지지 않음)
    if (kind === 'male') expect(hem).toBeLessThan(mid * 0.95);
    else expect(hem).toBeLessThan(mid * 1.12);
  }, 30000);

  it('비니는 머리에 씌운 채로 있음 (위로 빠지지 않음)', () => {
    const conv = convertPattern(parsePattern(SAMPLE_BEANIE), { size: '성인', myGauge: { st: 22, row: 30 } });
    const pieces = conv.pieces.map((piece) => ({ piece, completedRows: 0, gauge: { st: 22, row: 30 } }));
    const plan = planCloth(pieces)!;
    const out = simulate({ ...plan.input, params: { frames: 60 } });
    expect(out.ok).toBe(true);
    const p = plan.input.panels[0]!;
    const brim = ringY(p.pos, p, 0) < ringY(p.pos, p, p.rings - 1) ? 0 : p.rings - 1;
    expect(Math.abs(ringY(out.pos[0]!, p, brim) - ringY(p.pos, p, brim))).toBeLessThan(2);
  }, 30000);

  it('늘어뜨린 격자를 면으로: 격자점은 그대로 지나고, 그늘은 0..1', () => {
    const p = hangingTube();
    const ao = new Float32Array(p.cols * p.rings).fill(0.5);
    const sheet = gridSheet(p, p.pos, ao, 30, 64);
    const q = sheet.at(0, 0);
    expect(q[0]).toBeCloseTo(p.pos[0]!, 4);
    expect(q[1]).toBeCloseTo(p.pos[1]!, 4);
    const mid = sheet.at(0.5, 15);
    expect(Math.hypot(mid[0], mid[2])).toBeCloseTo(6, 0);
    expect(sheet.ao!(0.3, 12)).toBeCloseTo(0.5, 5);
    // 안쪽 점은 축 쪽
    const inside = sheet.inside(0, 15);
    expect(Math.hypot(inside[0], inside[2])).toBeLessThan(Math.hypot(sheet.at(0, 15)[0], sheet.at(0, 15)[2]));
  });

  it('모양 열쇠는 뜬 단 수와 무관 (한 번 늘어뜨린 모양을 계속 씀)', () => {
    const conv = convertPattern(parsePattern(SAMPLE_PATTERN), { size: 'M', myGauge: { st: 25, row: 33 } });
    const a = conv.pieces.map((piece) => ({ piece, completedRows: 0, gauge: { st: 25, row: 33 } }));
    const b = conv.pieces.map((piece) => ({ piece, completedRows: 40, currentStitch: 3, gauge: { st: 25, row: 33 } }));
    expect(shapeKey(a)).toBe(shapeKey(b));
  });
});
