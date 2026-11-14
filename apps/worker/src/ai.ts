import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { Hono } from 'hono';
import * as z from 'zod/v4';
import { parsePattern, type PatternInput, type Technique } from '@knitcloset/pattern-schema';
import type { Env } from './index.js';
import { Db } from './db.js';

/**
 * AI 도안 파싱(F2-2)·생성(F2-5).
 *
 * 구조화 출력(JSON schema)은 record·union을 다루기 까다로워서,
 * AI에게는 평평한 "초안" 형식으로 받고 여기서 Pattern으로 바꾼 뒤 Zod로 다시 검증합니다.
 * 결과는 저장하지 않고 초안으로 돌려줘서, 사람이 검수 화면에서 확인한 뒤 저장합니다.
 */

const SizeVals = z
  .array(z.object({ size: z.string(), value: z.number() }))
  .describe('사이즈별 값. 모든 사이즈 공통이면 size를 "*" 하나로');

const TechniqueEnum = z.enum(['stockinette', 'ribbing', 'colorwork', 'garter', 'cable', 'lace', 'other']);

const DraftSchema = z.object({
  title: z.string(),
  designer: z.string(),
  yarn: z.string(),
  gauge: z.object({
    st: z.number().describe('10cm 안의 코 수'),
    row: z.number().describe('10cm 안의 단 수'),
    needleMm: z.number().nullable(),
    technique: TechniqueEnum,
  }),
  palette: z.array(z.object({ name: z.string(), hex: z.string().describe('#RRGGBB') })),
  sizes: z.array(
    z.object({
      label: z.string(),
      finished: z.array(z.object({ name: z.string().describe('예: 가슴둘레, 총장'), cm: z.number() })),
    }),
  ),
  pieces: z.array(
    z.object({
      id: z.string().describe('영문 소문자 id, 예: body, sleeve'),
      name: z.string(),
      construction: z.enum(['flat', 'round']),
      direction: z.enum(['top_down', 'bottom_up']),
      count: z.number().int().describe('같은 조각을 몇 장 뜨는지 (소매는 보통 2)'),
      castOn: SizeVals,
      stitchMultiple: z.number().int().nullable().describe('콧수가 반드시 이 값의 배수여야 하면'),
      sections: z.array(
        z.object({
          name: z.string(),
          technique: TechniqueEnum,
          rows: SizeVals,
          instruction: z.string(),
          chartRows: z
            .array(z.string())
            .nullable()
            .describe('배색 차트가 있으면 맨 위 단부터 한 줄씩, 칸마다 팔레트 번호 한 글자(0-9)'),
          shaping: z.array(
            z.object({
              kind: z.enum(['inc', 'dec']),
              everyRows: SizeVals,
              times: SizeVals,
              stitchesPerEvent: z.number().int(),
              position: z.string(),
              afterRows: SizeVals.describe('섹션 시작 후 늘림·줄임 전까지 단 수. 없으면 빈 배열'),
            }),
          ),
          events: z.array(
            z.object({
              kind: z.enum(['bindoff', 'split', 'pickup', 'color', 'note', 'checkin']),
              atRow: z.number().int().describe('섹션 안 단 번호, 섹션 마지막 단이면 0'),
              stitches: SizeVals.describe('콧수가 없으면 빈 배열'),
              text: z.string(),
            }),
          ),
        }),
      ),
    }),
  ),
  reviewNotes: z.array(z.string()).describe('확실하지 않아서 사람이 꼭 확인해야 하는 부분'),
});
type Draft = z.infer<typeof DraftSchema>;

function sizeValue(vals: { size: string; value: number }[]): number | Record<string, number> | undefined {
  if (vals.length === 0) return undefined;
  const star = vals.find((v) => v.size === '*' || v.size === '');
  if (star && vals.length === 1) return star.value;
  return Object.fromEntries(vals.map((v) => [v.size, v.value]));
}

/** AI 초안 → Pattern 입력 형식 */
export function draftToPattern(d: Draft): PatternInput {
  return {
    title: d.title,
    designer: d.designer,
    yarn: d.yarn,
    gauge: {
      st: d.gauge.st,
      row: d.gauge.row,
      ...(d.gauge.needleMm ? { needleMm: d.gauge.needleMm } : {}),
      technique: d.gauge.technique as Technique,
    },
    palette: d.palette.filter((p) => /^#[0-9a-fA-F]{6}$/.test(p.hex)),
    sizes: d.sizes.map((s) => ({
      label: s.label,
      finished: Object.fromEntries(s.finished.filter((f) => f.cm > 0).map((f) => [f.name, f.cm])),
    })),
    pieces: d.pieces.map((p) => ({
      id: p.id,
      name: p.name,
      construction: p.construction,
      direction: p.direction,
      count: Math.max(1, p.count),
      castOn: sizeValue(p.castOn) ?? 0,
      ...(p.stitchMultiple ? { stitchMultiple: p.stitchMultiple } : {}),
      sections: p.sections.map((s) => ({
        name: s.name,
        technique: s.technique as Technique,
        rows: sizeValue(s.rows) ?? 1,
        instruction: s.instruction,
        ...(s.chartRows && s.chartRows.length
          ? {
              chart: {
                grid: [...s.chartRows].reverse().map((line) => [...line].map((ch) => Number.parseInt(ch, 10) || 0)),
              },
            }
          : {}),
        shaping: s.shaping.map((sh) => {
          const after = sizeValue(sh.afterRows);
          return {
            kind: sh.kind,
            everyRows: sizeValue(sh.everyRows) ?? 1,
            times: sizeValue(sh.times) ?? 0,
            stitchesPerEvent: Math.max(1, sh.stitchesPerEvent),
            position: sh.position,
            ...(after !== undefined ? { afterRows: after } : {}),
          };
        }),
        events: s.events.map((e) => {
          const st = sizeValue(e.stitches);
          return {
            kind: e.kind,
            atRow: e.atRow > 0 ? e.atRow : ('end' as const),
            ...(st !== undefined ? { stitches: st } : {}),
            text: e.text,
          };
        }),
      })),
    })),
  };
}

const SYSTEM = `당신은 대바늘 뜨개 도안을 구조화하는 도우미입니다.
- 숫자는 도안에 적힌 값을 그대로 옮기고, 추측한 값은 reviewNotes에 반드시 적으세요.
- 게이지는 10cm 기준으로 바꿔 적으세요 (예: 4인치 = 10cm로 간주).
- "N단마다 M코 늘림 × K회"는 shaping 하나로, 코막음·분리·코줍기는 events로 적으세요.
- 단 수(rows)는 그 구간을 뜨는 총 단 수입니다. cm로만 적혀 있으면 게이지로 단 수를 계산하고 reviewNotes에 남기세요.
- 배색 차트는 칸 색을 팔레트 번호(0부터)로, 맨 위 단부터 한 줄씩 적으세요.`;

function client(env: Env): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AiUnavailable('AI 기능을 쓰려면 apps/worker/.dev.vars에 ANTHROPIC_API_KEY를 넣어 주세요');
  }
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

class AiUnavailable extends Error {}

async function runDraft(env: Env, content: Anthropic.Beta.BetaContentBlockParam[]) {
  const stream = client(env).beta.messages.stream({
    model: env.AI_MODEL || 'claude-opus-5-5',
    max_tokens: 64000,
    // 안전 분류기가 거절하면 서버가 기본 대체 모델로 다시 시도
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: betaZodOutputFormat(DraftSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') {
    throw new Error('AI가 이 요청을 처리하지 않았어요. 도안 내용을 확인해 주세요.');
  }
  if (msg.stop_reason === 'max_tokens') {
    throw new Error('도안이 너무 길어서 AI 응답이 잘렸어요. 조각별로 나눠서 시도해 주세요.');
  }
  const draft = msg.parsed_output;
  if (!draft) throw new Error('AI 응답을 도안 형식으로 읽지 못했어요');
  const pattern = draftToPattern(draft);
  // 저장 전 한 번 더 검증 (실패해도 초안은 돌려줘서 검수 화면에서 고칠 수 있게)
  let valid = true;
  let validationError: string | undefined;
  try {
    parsePattern(pattern);
  } catch (e) {
    valid = false;
    validationError = e instanceof Error ? e.message : String(e);
  }
  return { pattern, reviewNotes: draft.reviewNotes, valid, validationError, model: msg.model };
}

export const aiRoutes = new Hono<{ Bindings: Env; Variables: { db: Db } }>();

aiRoutes.onError((err, c) => {
  if (err instanceof AiUnavailable) return c.json({ error: err.message }, 501);
  if (err instanceof Anthropic.RateLimitError) return c.json({ error: 'AI 요청이 많아요. 잠시 뒤에 다시 해 주세요.' }, 429);
  if (err instanceof Anthropic.AuthenticationError) return c.json({ error: 'ANTHROPIC_API_KEY가 올바르지 않아요' }, 502);
  if (err instanceof Anthropic.APIError) return c.json({ error: `AI 오류 (${err.status}): ${err.message}` }, 502);
  return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
});

aiRoutes.get('/ai/status', (c) => c.json({ enabled: Boolean(c.env.ANTHROPIC_API_KEY), model: c.env.AI_MODEL || 'claude-opus-5-5' }));

/** PDF(R2에 올린 파일) → 구조화 초안 (F2-2) */
aiRoutes.post('/patterns/parse', async (c) => {
  const b = (await c.req.json()) as { fileKey: string; hint?: string };
  if (!b.fileKey) throw new Error('fileKey가 필요해요 (먼저 /api/files로 PDF를 올려 주세요)');
  const obj = await c.env.FILES.get(b.fileKey);
  if (!obj) throw new Error('파일을 찾을 수 없어요');
  const bytes = new Uint8Array(await obj.arrayBuffer());
  if (bytes.byteLength > 30 * 1024 * 1024) throw new Error('PDF가 30MB보다 커요');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const data = btoa(bin);
  const result = await runDraft(c.env, [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
    { type: 'text', text: `이 뜨개 도안을 구조화해 주세요.${b.hint ? `\n참고: ${b.hint}` : ''}` },
  ]);
  return c.json({ ...result, fileKey: b.fileKey });
});

/** 손 프로필을 반영한 AI 도안 생성 (F2-5) */
aiRoutes.post('/patterns/generate', async (c) => {
  const b = (await c.req.json()) as {
    request: string;
    myGauge?: { st: number; row: number; needleMm?: number };
    body?: Record<string, number>;
  };
  if (!b.request?.trim()) throw new Error('어떤 도안을 원하는지 적어 주세요');
  const lines = [
    `다음 요청에 맞는 대바늘 도안을 새로 만들어 주세요: ${b.request.trim()}`,
    b.myGauge
      ? `도안 게이지는 뜨는 사람의 실제 게이지로 맞춰 주세요: 10cm에 ${b.myGauge.st}코 ${b.myGauge.row}단${b.myGauge.needleMm ? `, 바늘 ${b.myGauge.needleMm}mm` : ''}.`
      : '',
    b.body && Object.keys(b.body).length
      ? `신체 치수(cm): ${Object.entries(b.body).map(([k, v]) => `${k} ${v}`).join(', ')}. 여유분을 더해 사이즈 하나(label "맞춤")로 만들어 주세요.`
      : '',
    '단 수와 콧수는 게이지로 직접 계산해서 서로 맞게 적어 주세요.',
  ].filter(Boolean);
  const result = await runDraft(c.env, [{ type: 'text', text: lines.join('\n') }]);
  return c.json(result);
});
