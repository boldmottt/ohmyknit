import { z } from 'zod';

/**
 * 도안 JSON 스키마 (기획서 3.2). 프론트엔드와 Worker가 함께 씁니다.
 *
 * 숫자 값 대부분은 SizeValue입니다: 모든 사이즈 공통이면 숫자 하나,
 * 사이즈별로 다르면 { "S": 180, "M": 200 } 같은 표.
 */

export const Technique = z.enum(['stockinette', 'ribbing', 'colorwork', 'garter', 'cable', 'lace', 'other']);
export type Technique = z.infer<typeof Technique>;

export const TECHNIQUE_LABEL: Record<Technique, string> = {
  stockinette: '메리야스뜨기',
  ribbing: '고무뜨기',
  colorwork: '배색뜨기',
  garter: '가터뜨기',
  cable: '케이블',
  lace: '레이스',
  other: '기타',
};

export const SizeValue = z.union([
  z.number().nonnegative(),
  z.record(z.string(), z.number().nonnegative()),
]);
export type SizeValue = z.infer<typeof SizeValue>;

/** 사이즈 라벨에 맞는 값을 꺼냅니다. 표에 없으면 오류. */
export function resolveSize(value: SizeValue, size: string): number {
  if (typeof value === 'number') return value;
  const v = value[size];
  if (v === undefined) {
    throw new Error(`사이즈 "${size}"에 해당하는 값이 없어요 (있는 사이즈: ${Object.keys(value).join(', ')})`);
  }
  return v;
}

export const Gauge = z.object({
  /** 10cm 안의 코 수 */
  st: z.number().positive(),
  /** 10cm 안의 단 수 */
  row: z.number().positive(),
  needleMm: z.number().positive().optional(),
  technique: Technique.optional(),
});
export type Gauge = z.infer<typeof Gauge>;

export const Chart = z.object({
  /**
   * 칸마다 팔레트 번호. grid[0]이 차트 맨 아래 단(1단),
   * 각 줄은 화면에 보이는 대로 왼쪽→오른쪽.
   * 실제 뜨기는 오른쪽→왼쪽으로 읽습니다.
   */
  grid: z.array(z.array(z.number().int().nonnegative())).min(1),
  /** 반복 단위 너비(코). 기본 = 차트 너비 */
  repeatW: z.number().int().positive().optional(),
});
export type Chart = z.infer<typeof Chart>;

export const Shaping = z.object({
  kind: z.enum(['inc', 'dec']),
  everyRows: SizeValue,
  times: SizeValue,
  stitchesPerEvent: z.number().int().positive(),
  /** "마커 양옆", "양끝" */
  position: z.string().default(''),
  /** 섹션 안에서 이 늘림·줄임이 시작되기 전 단 수 (기본 0) */
  afterRows: SizeValue.optional(),
});
export type Shaping = z.infer<typeof Shaping>;

export const PointEvent = z.object({
  kind: z.enum(['bindoff', 'split', 'pickup', 'color', 'note', 'checkin']),
  /** 섹션 안의 단 번호 (1부터). 'end'면 섹션 마지막 단 */
  atRow: z.union([z.number().int().positive(), z.literal('end')]),
  /** 코막음·줍기 콧수 (내 게이지로 변환됨) */
  stitches: SizeValue.optional(),
  text: z.string().default(''),
  /** 확인해야 다음 단으로 넘어가는 잠금 이벤트 */
  lock: z.boolean().default(false),
});
export type PointEvent = z.infer<typeof PointEvent>;

export const Section = z.object({
  name: z.string().min(1),
  technique: Technique.default('stockinette'),
  /** 원본 도안의 단 수. 배색 차트 구간은 무늬 보존을 위해 변환하지 않음 */
  rows: SizeValue,
  /** 이 구간의 기본 지시 ("겉뜨기", "2코 고무뜨기") */
  instruction: z.string().default(''),
  chart: Chart.optional(),
  shaping: z.array(Shaping).default([]),
  events: z.array(PointEvent).default([]),
});
export type Section = z.infer<typeof Section>;

export const Piece = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  construction: z.enum(['flat', 'round']).default('flat'),
  direction: z.enum(['top_down', 'bottom_up']).default('bottom_up'),
  castOn: SizeValue,
  /** 콧수가 반드시 이 값의 배수여야 할 때 (배색 반복, 고무뜨기 4코 등) */
  stitchMultiple: z.number().int().positive().optional(),
  /** 같은 조각을 여러 장 뜨는 경우 (소매 ×2) */
  count: z.number().int().positive().default(1),
  sections: z.array(Section).min(1),
});
export type Piece = z.infer<typeof Piece>;

export const Pattern = z.object({
  title: z.string().min(1),
  designer: z.string().default(''),
  gauge: Gauge,
  /** 색 팔레트 (#RRGGBB). 차트 grid의 번호가 이 순서를 가리킴 */
  palette: z.array(z.object({ name: z.string(), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).default([]),
  sizes: z
    .array(z.object({ label: z.string().min(1), finished: z.record(z.string(), z.number().positive()).default({}) }))
    .min(1),
  pieces: z.array(Piece).min(1),
  /** 실 정보 메모 */
  yarn: z.string().default(''),
});
export type Pattern = z.infer<typeof Pattern>;
export type PatternInput = z.input<typeof Pattern>;

/** 검증 + 기본값 채우기. 실패하면 사람이 읽을 수 있는 메시지로 던짐 */
export function parsePattern(input: unknown): Pattern {
  const r = Pattern.safeParse(input);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`도안 형식이 올바르지 않아요\n${msg}`);
  }
  return r.data;
}
export * from './sample.js';
