import { describe, expect, it } from 'vitest';
import { parsePattern, SAMPLE_PATTERN } from '@knitcloset/pattern-schema';
import { checkin, convertPattern, pieceProgress, recommendNeedle } from '../src/index.js';

const pattern = parsePattern(SAMPLE_PATTERN);
const myGauge = { st: 25, row: 33 };

describe('convertPattern — 샘플 스웨터 M 사이즈', () => {
  const conv = convertPattern(pattern, { size: 'M', myGauge });
  const body = conv.pieces.find((p) => p.id === 'body')!;
  const sleeve1 = conv.pieces.find((p) => p.id === 'sleeve-1')!;

  it('소매 ×2는 따로 진행할 수 있게 두 조각으로 나뉨', () => {
    expect(conv.pieces.map((p) => p.name)).toEqual(['몸판', '소매 1', '소매 2']);
  });

  it('몸판 200코 → 228코 (고무단 4코와 차트 12코 둘 다 맞춤)', () => {
    expect(body.castOn.original).toBe(200);
    expect(body.castOn.value).toBe(228);
    expect(body.castOn.value % 12).toBe(0);
    expect(body.castOn.designWidthCm).toBeCloseTo(90.9, 1); // 200 / 22 × 10
    expect(body.castOn.asIsWidthCm).toBe(80); // 그대로 뜨면 200 / 25 × 10 = 80cm (11cm 작아짐!)
    expect(body.castOn.expectedWidthCm).toBeCloseTo(91.2, 1); // 228 / 25 × 10
  });

  it('메리야스 구간 단 수는 kRow로, 배색 차트 구간은 그대로', () => {
    const [rib, plain, chart] = body.sections;
    expect(rib!.rows).toBe(20); // 18 × 1.1 = 19.8
    expect(plain!.rows).toBe(112); // 102 × 1.1 = 112.2
    expect(chart!.rows).toBe(19);
    expect(chart!.startRow).toBe(133);
    expect(body.totalRows).toBe(151);
  });

  it('차트 구간 단마다 chartRow가 붙음', () => {
    const r = body.rows.find((x) => x.row === 133)!;
    expect(r.chartRow).toBe(0);
    expect(body.rows.at(-1)!.chartRow).toBe(18);
  });

  it('몸판 마지막 단에 잠금된 분리 이벤트 (16코 × 1.136 ≈ 18코)', () => {
    const last = body.rows.at(-1)!;
    expect(last.events[0]!.kind).toBe('split');
    expect(last.events[0]!.stitches).toBe(18);
    expect(last.events[0]!.lock).toBe(true);
  });

  it('소매: 48코 → 56코, 늘림 14회로 84코까지', () => {
    expect(sleeve1.castOn.value).toBe(56);
    const incs = sleeve1.rows.filter((r) => r.events.some((e) => e.kind === 'inc'));
    expect(incs).toHaveLength(14);
    // 고무단 20단 + 늘림 시작 전 11단 + 79단 동안 늘림 → 마지막 늘림은 110단
    expect(incs[0]!.row).toBe(20 + 11 + 6);
    expect(incs.at(-1)!.row).toBe(20 + 11 + 79);
    const beforeBindoff = sleeve1.rows.at(-1)!.stitchesWorked;
    expect(beforeBindoff).toBe(84);
    expect(sleeve1.sections[1]!.shapingNotes[0]).toBe(
      '6단마다 늘림 9회, 5단마다 늘림 5회 (번갈아) · 마커 양옆 (원본 6단마다 12회)',
    );
  });

  it('총 콧수는 단마다 뜨는 코의 합', () => {
    const sum = body.rows.reduce((s, r) => s + r.stitchesWorked, 0);
    expect(body.totalStitches).toBe(sum);
    const p = pieceProgress({ rowStitchCounts: body.rows.map((r) => r.stitchesWorked), completedRows: body.totalRows });
    expect(p.ratio).toBe(1);
  });

  it('경고 없음', () => {
    expect(conv.pieces.flatMap((p) => p.warnings)).toEqual([]);
  });
});

describe('convertPattern — 바늘 교체 방식', () => {
  it('콧수는 원본 그대로', () => {
    const conv = convertPattern(pattern, { size: 'M', myGauge, mode: 'needle' });
    expect(conv.pieces[0]!.castOn.value).toBe(200);
    expect(conv.kSt).toBe(1);
    expect(conv.pieces[0]!.sections[1]!.rows).toBe(102);
  });
});

describe('convertPattern — 오류', () => {
  it('없는 사이즈', () => {
    expect(() => convertPattern(pattern, { size: 'XXL', myGauge })).toThrow('XXL');
  });
});

describe('recommendNeedle (F3-3)', () => {
  it('기록이 없으면 경험칙: 4mm·25코 → 22코 원하면 4.5mm', () => {
    const r = recommendNeedle(22, { needleMm: 4, st: 25 });
    expect(r.method).toBe('rule');
    expect(r.rawMm).toBeCloseTo(4.545, 2);
    expect(r.needleMm).toBe(4.5);
  });

  it('스와치 기록이 있으면 직선 회귀', () => {
    const r = recommendNeedle(22, { needleMm: 4, st: 25 }, [
      { needleMm: 4.5, st: 23.5 },
      { needleMm: 5, st: 22 },
    ]);
    expect(r.method).toBe('records');
    expect(r.needleMm).toBe(5);
  });
});

describe('checkin (F4-8)', () => {
  it('3% 이상 작으면 쫀쫀 경고', () => {
    const r = checkin(36, 38);
    expect(r.deviationPct).toBeCloseTo(-5.26, 2);
    expect(r.warn).toBe(true);
    expect(r.message).toContain('쫀쫀');
  });

  it('오차가 작으면 통과', () => {
    expect(checkin(37.5, 38).warn).toBe(false);
  });
});

import { SAMPLE_BEANIE, makeSwirlChart, realCells } from '@knitcloset/pattern-schema';

describe('코 없음 칸이 있는 차트 (소용돌이 정수리)', () => {
  const beanie = parsePattern(SAMPLE_BEANIE);
  const chart = makeSwirlChart();

  it('도안 게이지 그대로면 112코 = 16코 × 7회, 맨 위 7코', () => {
    const conv = convertPattern(beanie, { size: '성인', myGauge: { st: 22, row: 30 }, mode: 'needle' });
    const hat = conv.pieces[0]!;
    const crown = hat.sections[2]!;
    expect(crown.chart!.shaped).toBe(true);
    expect(crown.chart!.repeats).toBe(7);
    const crownRows = hat.rows.filter((r) => r.sectionIndex === 2);
    expect(crownRows[0]!.stitchCount).toBe(112);
    expect(crownRows.at(-1)!.stitchCount).toBe(7);
    // 단마다 콧수 = 차트 실제 칸 × 7
    crownRows.forEach((r, i) => expect(r.stitchCount).toBe(realCells(chart[i]!).length * 7));
    expect(hat.warnings).toEqual([]);
  });

  it('줄임 이벤트가 차트에서 자동으로 생김', () => {
    const conv = convertPattern(beanie, { size: '성인', myGauge: { st: 22, row: 30 }, mode: 'needle' });
    const crownRows = conv.pieces[0]!.rows.filter((r) => r.sectionIndex === 2);
    const decs = crownRows.filter((r) => r.events.some((e) => e.kind === 'dec'));
    expect(decs.length).toBeGreaterThan(10);
    const first = decs[0]!.events.find((e) => e.kind === 'dec')!;
    expect(first.text).toMatch(/차트대로 7코 줄임 \(반복마다 1코\)/);
    const totalDec = crownRows.flatMap((r) => r.events).filter((e) => e.kind === 'dec').reduce((s, e) => s + (e.stitches ?? 0), 0);
    expect(totalDec).toBe(112 - 7);
  });

  it('쫀손 게이지면 반복 횟수가 늘어 128코 = 16 × 8회', () => {
    const conv = convertPattern(beanie, { size: '성인', myGauge: { st: 25, row: 33 } });
    const hat = conv.pieces[0]!;
    expect(hat.castOn.value).toBe(128);
    expect(hat.sections[2]!.chart!.repeats).toBe(8);
    expect(hat.rows.at(-1)!.stitchCount).toBe(8);
  });
});
