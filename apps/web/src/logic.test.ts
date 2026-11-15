import { describe, expect, it } from 'vitest';
import { convertPattern } from '@knitcloset/gauge-engine';
import { parsePattern, SAMPLE_BEANIE, SAMPLE_PATTERN, type Pattern } from '@knitcloset/pattern-schema';
import type { WorkData } from './api';
import { checkinAdvice, colorRun, parseLooseJson, readsFromLeft } from './derive';
import { applyDesign, designFromPattern, designToPattern, isStandalone, resizeGrid } from './studio/design';

const sweater = parsePattern(SAMPLE_PATTERN);
const converted = convertPattern(sweater, { size: 'M', myGauge: { st: 25, row: 33 } });
const data = { project: { id: 'p', myGauge: { st: 25, row: 33 } }, converted } as unknown as WorkData;
const body = converted.pieces[0]!;

describe('중간 실측 조언', () => {
  it('길이가 계획보다 짧게 나오면 몇 단 더 떠야 하는지 알려 줌', () => {
    // 66단 = 예상 20cm인데 18cm → 실제 단 게이지 36.7
    const a = checkinAdvice(data, body, { dimension: 'length', measuredCm: 18, completedRows: 66, stitches: 228 });
    expect(a.suggested.row).toBeCloseTo(36.7, 1);
    // 목표 151/33×10 = 45.76cm, 남은 27.76cm ÷ (18/66) = 101.8단, 계획 85단 → 17단 더
    expect(a.text).toContain('102단이 필요');
    expect(a.text).toContain('약 17단을 더');
  });

  it('거의 맞으면 그대로 뜨라고 함', () => {
    const a = checkinAdvice(data, body, { dimension: 'length', measuredCm: 20, completedRows: 66, stitches: 228 });
    expect(a.text).toContain('거의 맞아요');
  });

  it('너비는 이미 잡은 코를 못 바꾸니 결과 치수와 다음 조각 게이지를 알려 줌', () => {
    // 228코 = 예상 91.2cm인데 86cm
    const a = checkinAdvice(data, body, { dimension: 'width', measuredCm: 86, completedRows: 30, stitches: 228 });
    expect(a.suggested.st).toBeCloseTo(26.5, 1);
    expect(a.text).toContain('작게');
    expect(a.text).toContain('시작하지 않은 조각');
  });

  it('다 뜬 조각이면 "몇 단 더" 대신 목표와의 차이를 알려 줌', () => {
    const a = checkinAdvice(data, body, { dimension: 'length', measuredCm: 41, completedRows: 151, stitches: 228 });
    expect(a.text).toContain('다 떴는데');
    expect(a.text).toContain('4.8cm 짧아요');
    expect(a.text).not.toContain('계획은 0단');
  });

  it('뜬 단이 너무 적으면 길이 조언을 미룸', () => {
    expect(checkinAdvice(data, body, { dimension: 'length', measuredCm: 1, completedRows: 3, stitches: 228 }).suggested).toEqual({});
  });
});

describe('스튜디오 저장', () => {
  it('스웨터의 차트 구간: 줄을 늘리면 구간 단 수도 같이 늘고, 코잡기·게이지는 그대로', () => {
    const ref = { pieceIndex: 0, sectionIndex: 2 };
    const d = designFromPattern(sweater, ref)!;
    expect(isStandalone(sweater, 'manual')).toBe(false);
    const taller = { ...d, grid: resizeGrid(d.grid, 12, 24), gauge: { st: 99, row: 99 }, description: '새 설명' };
    const next = applyDesign(sweater, ref, taller, false);
    const sec = next.pieces[0]!.sections[2]!;
    expect(sec.chart!.grid).toHaveLength(24);
    expect(sec.rows).toBe(24); // 19단 × 1회 → 24단 × 1회
    expect(sec.instruction).toBe('새 설명');
    expect(next.gauge.st).toBe(22);
    expect(next.pieces[0]!.castOn).toEqual(sweater.pieces[0]!.castOn);
    // 저장 결과가 그대로 변환까지 됨 (늘린 줄이 잘리지 않음)
    const conv = convertPattern(parsePattern(next), { size: 'M', myGauge: { st: 22, row: 30 }, mode: 'needle' });
    expect(conv.pieces[0]!.sections[2]!.rows).toBe(24);
  });

  it('스튜디오에서 만든 디자인: 반복·게이지·모양을 바꾸면 코잡기까지 다시 맞춤', () => {
    const d0 = designFromPattern(parsePattern(SAMPLE_BEANIE), { pieceIndex: 0, sectionIndex: 2 })!;
    const made = parsePattern(designToPattern(d0)) as Pattern;
    expect(isStandalone(made, 'design')).toBe(true);
    const d1 = { ...d0, repeatsX: 10, gauge: { st: 20, row: 20 } };
    const next = parsePattern(applyDesign(made, { pieceIndex: 0, sectionIndex: 0 }, d1, true));
    expect(next.pieces[0]!.castOn).toBe(160); // 16코 × 10회
    expect(next.gauge.st).toBe(20);
    const conv = convertPattern(next, { size: next.sizes[0]!.label, myGauge: { st: 20, row: 20 }, mode: 'needle' });
    expect(conv.pieces[0]!.warnings).toEqual([]);
    expect(conv.pieces[0]!.rows.at(-1)!.stitchCount).toBe(10);
  });

  it('격자 크기: 1코가 오른쪽이라 오른쪽을 기준으로 늘고 줄어듦', () => {
    const g = [[1, 2, 3]];
    expect(resizeGrid(g, 2, 1)).toEqual([[2, 3]]);
    expect(resizeGrid(g, 4, 1, 9)).toEqual([[9, 1, 2, 3]]);
  });
});

describe('배색 줄 읽는 방향', () => {
  const palette = [{ name: '바탕색', hex: '#000000' }, { name: '분홍', hex: '#ffffff' }];
  // 차트에 그려진 그대로 (왼쪽 → 오른쪽): 분홍 3, 바탕색 2, 분홍 1
  const line = [1, 1, 1, 0, 0, 1];

  it('겉면·원통뜨기는 오른쪽부터, 평면뜨기 안면 단은 왼쪽부터', () => {
    expect(colorRun(line, palette)).toBe('분홍 1 + 바탕색 2 + 분홍 3');
    expect(colorRun(line, palette, true)).toBe('분홍 3 + 바탕색 2 + 분홍 1');
  });

  it('평면뜨기의 짝수 단만 왼쪽부터 읽음', () => {
    expect(readsFromLeft({ construction: 'flat' }, 1)).toBe(false);
    expect(readsFromLeft({ construction: 'flat' }, 2)).toBe(true);
    expect(readsFromLeft({ construction: 'round' }, 2)).toBe(false);
  });
});

describe('AI가 준 JSON 읽기', () => {
  it('코드 표시·앞뒤 설명·확인 필요 목록이 붙어 있어도 읽음', () => {
    const body = '{"title":"조끼 {S}","pieces":[{"id":"a"}],"note":"따옴표 \\" 안의 } 괄호"}';
    expect(parseLooseJson(body)).toMatchObject({ title: '조끼 {S}' });
    expect(parseLooseJson('```json\n' + body + '\n```')).toMatchObject({ title: '조끼 {S}' });
    expect(parseLooseJson('여기 있어요:\n' + body + '\n\n확인 필요:\n- 진동 단 수 {흐림}')).toMatchObject({ pieces: [{ id: 'a' }] });
  });
  it('JSON이 아예 없으면 오류', () => {
    expect(() => parseLooseJson('도안을 못 읽었어요')).toThrow();
  });
});

import { artPieces, roles } from './closet/assembledArt';

describe('뜬 만큼 보이는 옷 (조립 그림 재료)', () => {
  const work = {
    ...data,
    pieces: converted.pieces.map((p, i) => ({
      id: `p:${p.id}`,
      key: p.id,
      name: p.name,
      totalRows: p.totalRows,
      totalStitches: 0,
      progress: { currentRow: i === 0 ? 40 : 10, currentStitch: 5, stitchesDone: 0, frogCount: 0, frogRows: 0, updatedAt: 0 },
    })),
  } as unknown as WorkData;

  it('조각마다 실제 진행 단과 게이지를 씀, 작업 중이면 실시간 진행이 우선', () => {
    const a = artPieces(work);
    expect(a).toHaveLength(converted.pieces.length);
    expect(a[0]!.completedRows).toBe(40);
    expect(a[1]!.completedRows).toBe(10);
    expect(a[0]!.gauge).toEqual({ st: 25, row: 33 });
    const live = artPieces(work, { [`p:${body.id}`]: { currentRow: 41, currentStitch: 0, frogCount: 0, frogRows: 0, lastAt: 0 } });
    expect(live[0]!.completedRows).toBe(41);
    expect(live[1]!.completedRows).toBe(10);
  });

  it('몸판은 가운데, 소매 두 장은 왼쪽·오른쪽', () => {
    const r = [...roles(artPieces(work)).entries()].map(([p, role]) => [p.piece.name, role]);
    expect(r).toContainEqual([body.name, 'main']);
    expect(r.filter(([, role]) => role === 'sleeveL' || role === 'sleeveR')).toHaveLength(2);
  });

  it('비니는 모자 한 조각만', () => {
    const hat = convertPattern(parsePattern(SAMPLE_BEANIE), { size: '성인', myGauge: { st: 22, row: 30 } });
    const r = roles(hat.pieces.map((piece) => ({ piece, completedRows: 0, gauge: { st: 22, row: 30 } })));
    expect([...r.values()]).toEqual(['main']);
  });
});
