import { updateCoefficient, FINISHED_WEIGHT } from '@knitcloset/gauge-engine';
import type { Db } from './db.js';
import { now } from './db.js';

export type SwatchRow = {
  id: string;
  profile_id: string;
  yarn_name: string;
  yarn_weight: string;
  fiber: string;
  needle_mm: number;
  needle_material: string;
  technique: string;
  sts_pre: number | null;
  rows_pre: number | null;
  sts_post: number | null;
  rows_post: number | null;
  photo_key: string | null;
  note: string;
  created_at: number;
};

export type CoefficientRow = {
  profile_id: string;
  technique: string;
  yarn_weight: string;
  needle_material: string;
  k_st: number;
  k_row: number;
  sample_count: number;
  updated_at: number;
};

/** 블로킹 후 값을 우선으로 스와치 게이지를 꺼냄 */
export function swatchGauge(s: SwatchRow): { st: number; row: number } | null {
  const st = s.sts_post ?? s.sts_pre;
  const row = s.rows_post ?? s.rows_pre;
  return st && row ? { st, row } : null;
}

export type GaugeSuggestion = {
  st: number;
  row: number;
  source: 'swatch+coef' | 'swatch' | 'pattern';
  swatchId?: string;
  swatchSt?: number;
  swatchRow?: number;
  kSt: number;
  kRow: number;
  explanation: string;
};

/**
 * 새 프로젝트에 쓸 내 게이지를 추천합니다.
 * 같은 실 두께·기법의 최근 스와치(블로킹 후 우선) × 큰 작품 보정 계수.
 */
export async function suggestGauge(
  db: Db,
  profileId: string,
  ctx: { technique?: string; yarnWeight?: string; needleMaterial?: string; patternSt: number; patternRow: number },
): Promise<GaugeSuggestion> {
  const swatches = await db.all<SwatchRow>(
    'SELECT * FROM swatches WHERE profile_id = ? ORDER BY created_at DESC',
    profileId,
  );
  const score = (s: SwatchRow) =>
    (ctx.yarnWeight && s.yarn_weight === ctx.yarnWeight ? 2 : 0) +
    (ctx.technique && s.technique === ctx.technique ? 1 : 0);
  const usable = swatches.filter((s) => swatchGauge(s));
  usable.sort((a, b) => score(b) - score(a) || b.created_at - a.created_at);
  const best = usable[0];

  if (!best) {
    return {
      st: ctx.patternSt,
      row: ctx.patternRow,
      source: 'pattern',
      kSt: 1,
      kRow: 1,
      explanation: '스와치 기록이 없어서 도안 게이지를 그대로 넣었어요. 스와치를 떠서 입력하면 더 정확해져요.',
    };
  }
  const g = swatchGauge(best)!;
  const coef = await db.first<CoefficientRow>(
    `SELECT * FROM hand_coefficients WHERE profile_id = ? AND technique = ? AND yarn_weight = ?
       AND needle_material IN (?, 'any') ORDER BY sample_count DESC LIMIT 1`,
    profileId,
    ctx.technique ?? best.technique,
    ctx.yarnWeight ?? best.yarn_weight,
    ctx.needleMaterial ?? best.needle_material,
  );
  const kSt = coef?.k_st ?? 1;
  const kRow = coef?.k_row ?? 1;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    st: round1(g.st * kSt),
    row: round1(g.row * kRow),
    source: coef ? 'swatch+coef' : 'swatch',
    swatchId: best.id,
    swatchSt: g.st,
    swatchRow: g.row,
    kSt,
    kRow,
    explanation: coef
      ? `스와치 ${g.st}코 ${g.row}단 × 큰 작품 보정 ${kSt.toFixed(3)} / ${kRow.toFixed(3)} (완성 기록 반영)`
      : `스와치 ${g.st}코 ${g.row}단 (${best.yarn_name || best.yarn_weight}, ${best.needle_mm}mm${best.sts_post ? ', 블로킹 후' : ''})`,
  };
}

const WIDTH_KEY = /둘레|너비|폭|width|chest|bust/i;
const LENGTH_KEY = /장|길이|length/i;

/**
 * 완성 실측으로 큰 작품 보정 계수를 갱신합니다. (기획서 4.4)
 * expected / actual 비율 × 이번에 쓴 게이지 = 실제 게이지 → ÷ 스와치 게이지 = 표본 계수
 */
export async function learnFromFinished(
  db: Db,
  input: {
    profileId: string;
    technique: string;
    yarnWeight: string;
    needleMaterial: string;
    usedSt: number;
    usedRow: number;
    swatchSt?: number;
    swatchRow?: number;
    expected: Record<string, number>;
    measured: Record<string, number>;
  },
): Promise<{ kActualSt?: number; kActualRow?: number; coefficient?: { kSt: number; kRow: number; samples: number } }> {
  const ratios = (re: RegExp) => {
    const list: number[] = [];
    for (const [key, actual] of Object.entries(input.measured)) {
      const exp = input.expected[key];
      if (re.test(key) && exp && actual > 0) list.push(exp / actual);
    }
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : undefined;
  };
  const wr = ratios(WIDTH_KEY);
  const lr = ratios(LENGTH_KEY);
  const actualSt = wr !== undefined ? input.usedSt * wr : undefined;
  const actualRow = lr !== undefined ? input.usedRow * lr : undefined;
  if (!input.swatchSt || !input.swatchRow || (actualSt === undefined && actualRow === undefined)) {
    return { kActualSt: actualSt, kActualRow: actualRow };
  }

  const existing = await db.first<CoefficientRow>(
    'SELECT * FROM hand_coefficients WHERE profile_id = ? AND technique = ? AND yarn_weight = ? AND needle_material = ?',
    input.profileId,
    input.technique,
    input.yarnWeight,
    input.needleMaterial,
  );
  // 스와치를 기준선(k=1, 가중치 1)으로 두고 완성 실측은 가중치 2
  const prior = existing ?? { k_st: 1, k_row: 1, sample_count: 1 };
  const st = actualSt !== undefined
    ? updateCoefficient({ k: prior.k_st, sampleCount: prior.sample_count }, actualSt / input.swatchSt, FINISHED_WEIGHT)
    : { k: prior.k_st, sampleCount: prior.sample_count + FINISHED_WEIGHT };
  const row = actualRow !== undefined
    ? updateCoefficient({ k: prior.k_row, sampleCount: prior.sample_count }, actualRow / input.swatchRow, FINISHED_WEIGHT)
    : { k: prior.k_row, sampleCount: prior.sample_count + FINISHED_WEIGHT };

  await db.run(
    `INSERT INTO hand_coefficients (profile_id, technique, yarn_weight, needle_material, k_st, k_row, sample_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (profile_id, technique, yarn_weight, needle_material)
     DO UPDATE SET k_st = excluded.k_st, k_row = excluded.k_row, sample_count = excluded.sample_count, updated_at = excluded.updated_at`,
    input.profileId,
    input.technique,
    input.yarnWeight,
    input.needleMaterial,
    st.k,
    row.k,
    st.sampleCount,
    now(),
  );
  return {
    kActualSt: actualSt !== undefined ? actualSt / input.swatchSt : undefined,
    kActualRow: actualRow !== undefined ? actualRow / input.swatchRow : undefined,
    coefficient: { kSt: st.k, kRow: row.k, samples: st.sampleCount },
  };
}
