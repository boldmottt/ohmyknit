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

/** 단 수·콧수처럼 정수여야 하는 값 (min 이상). 소수나 0이 들어오면 변환이 조용히 어긋나서 저장할 때 막아요 */
const intSize = (min: number, what: string) => {
  const n = z
    .number()
    .int(`${what}는 정수여야 해요`)
    .min(min, `${what}는 ${min} 이상이어야 해요`);
  return z.union([n, z.record(z.string(), n)]);
};

/** 사이즈 라벨에 맞는 값을 꺼냅니다. 표에 없으면 오류. */
export function resolveSize(value: SizeValue, size: string): number {
  if (typeof value === 'number') return value;
  const v = value[size];
  if (v === undefined) {
    throw new Error(`사이즈 "${size}"에 해당하는 값이 없어요 (있는 사이즈: ${Object.keys(value).join(', ')})`);
  }
  return v;
}

/** 차트 칸 값: 0 이상 = 팔레트 번호, -1 = 코 없음 (줄임으로 사라진 자리) */
export const NO_STITCH = -1;
const NO_STITCH_VALUE = -1;

/**
 * 실 한 가지. hex2·heather가 있으면 두 색이 섞인 얼룩실(헤더·마알)로 그려요.
 */
export const Yarn = z.object({
  name: z.string(),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  brand: z.string().optional(),
  /** 섞인 두 번째 색 */
  hex2: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** 얼룩 정도 0(단색) ~ 1(많이 섞임) */
  heather: z.number().min(0).max(1).optional(),
  /** 실 보관함 id */
  yarnId: z.string().optional(),
  photoKey: z.string().optional(),
});
export type Yarn = z.infer<typeof Yarn>;

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
  grid: z
    .array(z.array(z.number().int().min(NO_STITCH_VALUE)).min(1, '차트에 빈 줄이 있어요'))
    .min(1)
    .refine((g) => g.every((line) => line.length === g[0]!.length), '차트의 모든 줄은 칸 수가 같아야 해요')
    .refine((g) => g.every((line) => line.some((c) => c !== NO_STITCH_VALUE)), '차트에 뜨는 코가 하나도 없는 줄이 있어요'),
  /** 반복 단위 너비(코). 기본 = 차트 너비 */
  repeatW: z.number().int().positive().optional(),
  /** 디자인 스튜디오 미리보기 설정 (뜨기에는 영향 없음) */
  preview: z
    .object({
      repeatsX: z.number().int().min(1).max(40).default(5),
      repeatsY: z.number().int().min(1).max(20).default(1),
      renderAs: z.enum(['flat', 'circle']).default('flat'),
    })
    .optional(),
});
export type Chart = z.infer<typeof Chart>;

/** 차트 한 줄에서 실제로 뜨는 칸만 (코 없음 칸 제외) */
export function realCells(line: readonly number[]): number[] {
  return line.filter((c) => c !== NO_STITCH);
}

/** 코 없음 칸이 있는 차트 = 차트 자체가 늘림·줄임을 담고 있음 (예: 정수리 소용돌이) */
export function chartHasNoStitch(grid: readonly (readonly number[])[]): boolean {
  return grid.some((line) => line.includes(NO_STITCH));
}

export const Shaping = z.object({
  kind: z.enum(['inc', 'dec']),
  everyRows: intSize(1, '늘림·줄임 간격(단)'),
  times: intSize(0, '늘림·줄임 횟수'),
  stitchesPerEvent: z.number().int().positive(),
  /** "마커 양옆", "양끝" */
  position: z.string().default(''),
  /** 섹션 안에서 이 늘림·줄임이 시작되기 전 단 수 (기본 0) */
  afterRows: intSize(0, '시작 전 단 수').optional(),
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
  rows: intSize(1, '단 수'),
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
  castOn: intSize(1, '코잡기 콧수'),
  /** 콧수가 반드시 이 값의 배수여야 할 때 (배색 반복, 고무뜨기 4코 등) */
  stitchMultiple: z.number().int().positive().optional(),
  /** 같은 조각을 여러 장 뜨는 경우 (소매 ×2) */
  count: z.number().int().positive().default(1),
  sections: z.array(Section).min(1),
});
export type Piece = z.infer<typeof Piece>;

/** 조각을 펼쳤을 때의 id (소매 ×2 → sleeve-1, sleeve-2). 변환 엔진과 같은 규칙 */
export function expandedPieceIds(piece: { id: string; count?: number }): string[] {
  const count = piece.count ?? 1;
  return count > 1 ? Array.from({ length: count }, (_, i) => `${piece.id}-${i + 1}`) : [piece.id];
}

const PatternShape = z.object({
  title: z.string().min(1),
  designer: z.string().default(''),
  gauge: Gauge,
  /** 색 팔레트 (#RRGGBB). 차트 grid의 번호가 이 순서를 가리킴 */
  palette: z.array(Yarn).default([]),
  sizes: z
    .array(z.object({ label: z.string().min(1), finished: z.record(z.string(), z.number().positive()).default({}) }))
    .min(1),
  pieces: z.array(Piece).min(1),
  /** 실 정보 메모 */
  yarn: z.string().default(''),
});

export const Pattern = PatternShape.superRefine((p, ctx) => {
  // 조각 id는 진행 기록의 열쇠라서 겹치면 안 돼요 (여러 장 뜨는 조각을 펼친 id까지 포함)
  const seen = new Set<string>();
  p.pieces.forEach((piece, i) => {
    for (const id of expandedPieceIds(piece)) {
      if (seen.has(id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pieces', i, 'id'], message: `조각 id "${id}"가 겹쳐요. 조각마다 다른 id를 써 주세요` });
      }
      seen.add(id);
    }
  });
  p.pieces.forEach((piece, pi) =>
    piece.sections.forEach((sec, si) => {
      const w = sec.chart?.grid[0]?.length;
      if (sec.chart?.repeatW !== undefined && w !== undefined && sec.chart.repeatW > w) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pieces', pi, 'sections', si, 'chart', 'repeatW'], message: `반복 너비(${sec.chart.repeatW})가 차트 너비(${w})보다 커요` });
      }
    }),
  );
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
