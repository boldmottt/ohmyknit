import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { checkin, convertPattern, type ConvertedPattern, type ProgressEvent } from '@knitcloset/gauge-engine';
import { parsePattern, SAMPLE_BEANIE, SAMPLE_PATTERN } from '@knitcloset/pattern-schema';
import { Db, json, now, uid } from './db.js';
import { learnFromFinished, suggestGauge, type CoefficientRow, type SwatchRow } from './hands.js';
import {
  createProject,
  ingestEvents,
  knittingSpeed,
  loadPattern,
  NotFound,
  projectSummaries,
  reconvertProject,
  type PieceRow,
  type ProgressRow,
  type ProjectRow,
} from './projects.js';
import { aiRoutes } from './ai.js';
import { yarnRoutes } from './yarns.js';

export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS?: Fetcher;
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
};

type Ctx = { Bindings: Env; Variables: { db: Db } };

export const app = new Hono<Ctx>();
const api = new Hono<Ctx>();

api.use('*', async (c, next) => {
  c.set('db', new Db(c.env.DB));
  await next();
});

api.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof NotFound) return c.json({ error: err.message }, 404);
  console.error(err);
  return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
});

const body = async <T>(c: { req: { json: () => Promise<unknown> } }): Promise<T> => {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HTTPException(400, { message: 'JSON 본문이 필요해요' });
  }
};

const num = (v: unknown, name: string): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${name} 값이 숫자가 아니에요`);
  return n;
};

api.get('/health', (c) => c.json({ ok: true, time: now() }));

/* ───────────── 프로필 (네임태그) ───────────── */

type ProfileRow = {
  id: string;
  name: string;
  avatar: string;
  color: string;
  skin_id: string;
  body_measurements: string;
  created_at: number;
};

const profileOut = (p: ProfileRow) => ({
  id: p.id,
  name: p.name,
  avatar: p.avatar,
  color: p.color,
  skinId: p.skin_id,
  bodyMeasurements: json<Record<string, number>>(p.body_measurements, {}),
});

api.get('/profiles', async (c) => {
  const rows = await c.var.db.all<ProfileRow & { active: number }>(
    `SELECT pr.*, (SELECT COUNT(*) FROM projects p WHERE p.profile_id = pr.id AND p.status = 'active') AS active
       FROM profiles pr ORDER BY pr.created_at`,
  );
  return c.json(rows.map((r) => ({ ...profileOut(r), activeCount: r.active })));
});

api.post('/profiles', async (c) => {
  const b = await body<{ name: string; avatar?: string; color?: string }>(c);
  if (!b.name?.trim()) throw new Error('이름을 입력해 주세요');
  const id = uid();
  await c.var.db.run(
    'INSERT INTO profiles (id, name, avatar, color, created_at) VALUES (?, ?, ?, ?, ?)',
    id,
    b.name.trim(),
    b.avatar ?? '🧶',
    b.color ?? '#7A1F2B',
    now(),
  );
  return c.json({ id }, 201);
});

api.patch('/profiles/:id', async (c) => {
  const b = await body<{ name?: string; avatar?: string; color?: string; skinId?: string; bodyMeasurements?: Record<string, number> }>(c);
  const p = await c.var.db.first<ProfileRow>('SELECT * FROM profiles WHERE id = ?', c.req.param('id'));
  if (!p) throw new NotFound('프로필을 찾을 수 없어요');
  await c.var.db.run(
    'UPDATE profiles SET name = ?, avatar = ?, color = ?, skin_id = ?, body_measurements = ? WHERE id = ?',
    b.name ?? p.name,
    b.avatar ?? p.avatar,
    b.color ?? p.color,
    b.skinId ?? p.skin_id,
    b.bodyMeasurements ? JSON.stringify(b.bodyMeasurements) : p.body_measurements,
    p.id,
  );
  return c.json({ ok: true });
});

api.get('/profiles/:id/projects', async (c) => {
  const status = c.req.query('status') ?? 'active';
  if (!['active', 'archived', 'finished'].includes(status)) throw new Error('status 값이 올바르지 않아요');
  return c.json(await projectSummaries(c.var.db, 'p.profile_id = ? AND p.status = ?', c.req.param('id'), status));
});

/* ───────────── 내 손 프로필 ───────────── */

const swatchOut = (s: SwatchRow) => ({
  id: s.id,
  yarnName: s.yarn_name,
  yarnWeight: s.yarn_weight,
  fiber: s.fiber,
  needleMm: s.needle_mm,
  needleMaterial: s.needle_material,
  technique: s.technique,
  stsPre: s.sts_pre,
  rowsPre: s.rows_pre,
  stsPost: s.sts_post,
  rowsPost: s.rows_post,
  photoKey: s.photo_key,
  note: s.note,
  createdAt: s.created_at,
});

api.get('/profiles/:id/hands', async (c) => {
  const id = c.req.param('id');
  const swatches = await c.var.db.all<SwatchRow>('SELECT * FROM swatches WHERE profile_id = ? ORDER BY created_at DESC', id);
  const coefs = await c.var.db.all<CoefficientRow>('SELECT * FROM hand_coefficients WHERE profile_id = ?', id);
  const finished = await c.var.db.all<{ project_id: string; name: string; measured: string; expected: string; k_actual_st: number | null; finished_at: number }>(
    `SELECT f.*, p.name FROM finished_records f JOIN projects p ON p.id = f.project_id
      WHERE p.profile_id = ? ORDER BY f.finished_at DESC`,
    id,
  );
  return c.json({
    swatches: swatches.map(swatchOut),
    coefficients: coefs.map((k) => ({
      technique: k.technique,
      yarnWeight: k.yarn_weight,
      needleMaterial: k.needle_material,
      kSt: k.k_st,
      kRow: k.k_row,
      sampleCount: k.sample_count,
      updatedAt: k.updated_at,
    })),
    finished: finished.map((f) => ({
      projectId: f.project_id,
      name: f.name,
      measured: json(f.measured, {}),
      expected: json(f.expected, {}),
      kActualSt: f.k_actual_st,
      finishedAt: f.finished_at,
    })),
  });
});

api.get('/profiles/:id/suggest-gauge', async (c) => {
  return c.json(
    await suggestGauge(c.var.db, c.req.param('id'), {
      technique: c.req.query('technique'),
      yarnWeight: c.req.query('yarnWeight'),
      needleMaterial: c.req.query('needleMaterial'),
      patternSt: num(c.req.query('patternSt'), 'patternSt'),
      patternRow: num(c.req.query('patternRow'), 'patternRow'),
    }),
  );
});

api.post('/profiles/:id/swatches', async (c) => {
  const b = await body<Partial<ReturnType<typeof swatchOut>>>(c);
  if (!b.needleMm) throw new Error('바늘 굵기를 입력해 주세요');
  if (!(b.stsPre || b.stsPost) || !(b.rowsPre || b.rowsPost)) throw new Error('게이지(코·단)를 입력해 주세요');
  const id = uid();
  await c.var.db.run(
    `INSERT INTO swatches (id, profile_id, yarn_name, yarn_weight, fiber, needle_mm, needle_material, technique,
       sts_pre, rows_pre, sts_post, rows_post, photo_key, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    c.req.param('id'),
    b.yarnName ?? '',
    b.yarnWeight ?? 'dk',
    b.fiber ?? '',
    num(b.needleMm, 'needleMm'),
    b.needleMaterial ?? 'any',
    b.technique ?? 'stockinette',
    b.stsPre ?? null,
    b.rowsPre ?? null,
    b.stsPost ?? null,
    b.rowsPost ?? null,
    b.photoKey ?? null,
    b.note ?? '',
    now(),
  );
  return c.json({ id }, 201);
});

api.delete('/swatches/:id', async (c) => {
  await c.var.db.run('DELETE FROM swatches WHERE id = ?', c.req.param('id'));
  return c.json({ ok: true });
});

/* ───────────── 도안 ───────────── */

const patternListOut = (r: { id: string; title: string; designer: string; source_type: string; gauge_st: number; gauge_row: number; needle_mm: number | null; file_key: string | null; updated_at: number }) => ({
  id: r.id,
  title: r.title,
  designer: r.designer,
  sourceType: r.source_type,
  gauge: { st: r.gauge_st, row: r.gauge_row },
  needleMm: r.needle_mm,
  fileKey: r.file_key,
  updatedAt: r.updated_at,
});

api.get('/patterns', async (c) => {
  const rows = await c.var.db.all<Parameters<typeof patternListOut>[0]>(
    'SELECT id, title, designer, source_type, gauge_st, gauge_row, needle_mm, file_key, updated_at FROM patterns ORDER BY updated_at DESC',
  );
  return c.json(rows.map(patternListOut));
});

api.get('/patterns/:id', async (c) => {
  const { row, pattern } = await loadPattern(c.var.db, c.req.param('id'));
  return c.json({ ...patternListOut(row), pattern });
});

async function savePattern(db: Db, id: string | null, input: unknown, meta: { profileId?: string; sourceType?: string; fileKey?: string | null }) {
  const pattern = parsePattern(input);
  const t = now();
  if (id) {
    const n = await db.run(
      `UPDATE patterns SET title = ?, designer = ?, original_json = ?, gauge_st = ?, gauge_row = ?, needle_mm = ?,
         file_key = COALESCE(?, file_key), updated_at = ? WHERE id = ?`,
      pattern.title,
      pattern.designer,
      JSON.stringify(pattern),
      pattern.gauge.st,
      pattern.gauge.row,
      pattern.gauge.needleMm ?? null,
      meta.fileKey ?? null,
      t,
      id,
    );
    if (n === 0) throw new NotFound('도안을 찾을 수 없어요');
    return id;
  }
  const newId = uid();
  await db.run(
    `INSERT INTO patterns (id, profile_id, title, designer, source_type, original_json, file_key, gauge_st, gauge_row,
       needle_mm, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId,
    meta.profileId ?? null,
    pattern.title,
    pattern.designer,
    meta.sourceType ?? 'manual',
    JSON.stringify(pattern),
    meta.fileKey ?? null,
    pattern.gauge.st,
    pattern.gauge.row,
    pattern.gauge.needleMm ?? null,
    t,
    t,
  );
  return newId;
}

api.post('/patterns', async (c) => {
  const b = await body<{ pattern: unknown; profileId?: string; sourceType?: string; fileKey?: string }>(c);
  const id = await savePattern(c.var.db, null, b.pattern, b);
  return c.json({ id }, 201);
});

api.post('/patterns/sample', async (c) => {
  const which = c.req.query('which') === 'beanie' ? SAMPLE_BEANIE : SAMPLE_PATTERN;
  const id = await savePattern(c.var.db, null, which, { sourceType: 'manual' });
  return c.json({ id }, 201);
});

api.put('/patterns/:id', async (c) => {
  const b = await body<{ pattern: unknown; fileKey?: string }>(c);
  await savePattern(c.var.db, c.req.param('id'), b.pattern, b);
  return c.json({ ok: true });
});

api.delete('/patterns/:id', async (c) => {
  const used = await c.var.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM projects WHERE pattern_id = ?', c.req.param('id'));
  if (used && used.n > 0) throw new Error('이 도안으로 만든 프로젝트가 있어서 지울 수 없어요');
  await c.var.db.run('DELETE FROM patterns WHERE id = ?', c.req.param('id'));
  return c.json({ ok: true });
});

/** 마법사 3단계: 원본과 변환 결과 미리보기 */
api.post('/patterns/:id/preview', async (c) => {
  const b = await body<{ size: string; myGauge: { st: number; row: number }; mode?: 'recalc' | 'needle' }>(c);
  const { pattern } = await loadPattern(c.var.db, c.req.param('id'));
  const conv = convertPattern(pattern, { size: b.size, myGauge: b.myGauge, mode: b.mode ?? 'recalc' });
  const size = pattern.sizes.find((s) => s.label === b.size);
  return c.json({
    kSt: conv.kSt,
    kRow: conv.kRow,
    finished: size?.finished ?? {},
    pieces: conv.pieces.map((p) => ({
      id: p.id,
      name: p.name,
      castOn: p.castOn,
      totalRows: p.totalRows,
      sections: p.sections.map((s) => ({ name: s.name, originalRows: s.originalRows, rows: s.rows, shapingNotes: s.shapingNotes })),
      warnings: p.warnings,
    })),
  });
});

/* ───────────── 파일 (R2) ───────────── */

api.post('/files', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file') as unknown as File | string | null;
  if (!file || typeof file === 'string') throw new Error('파일이 필요해요');
  const safe = file.name.replace(/[^\w.\-가-힣]/g, '_').slice(-80);
  const key = `uploads/${uid()}-${safe}`;
  await c.env.FILES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  return c.json({ key }, 201);
});

api.get('/files/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/api\/files\//, ''));
  const obj = await c.env.FILES.get(key);
  if (!obj) throw new NotFound('파일이 없어요');
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
});

/* ───────────── 프로젝트 ───────────── */

api.post('/projects', async (c) => {
  const b = await body<Parameters<typeof createProject>[1]>(c);
  if (!b.profileId || !b.patternId || !b.size) throw new Error('프로필, 도안, 사이즈가 필요해요');
  b.myGauge = { st: num(b.myGauge?.st, '내 코 게이지'), row: num(b.myGauge?.row, '내 단 게이지') };
  const id = await createProject(c.var.db, b);
  return c.json({ id }, 201);
});

api.get('/projects/:id', async (c) => {
  const [p] = await projectSummaries(c.var.db, 'p.id = ?', c.req.param('id'));
  if (!p) throw new NotFound('프로젝트를 찾을 수 없어요');
  return c.json(p);
});

api.patch('/projects/:id', async (c) => {
  const b = await body<{ name?: string; yarn?: string; needleMm?: number | null; note?: string; startedAt?: number; hangerOrder?: number; ballGrams?: number | null }>(c);
  const p = await c.var.db.first<ProjectRow>('SELECT * FROM projects WHERE id = ?', c.req.param('id'));
  if (!p) throw new NotFound('프로젝트를 찾을 수 없어요');
  await c.var.db.run(
    'UPDATE projects SET name = ?, yarn = ?, needle_mm = ?, note = ?, started_at = ?, hanger_order = ?, ball_grams = ? WHERE id = ?',
    b.name?.trim() || p.name,
    b.yarn ?? p.yarn,
    b.needleMm === undefined ? p.needle_mm : b.needleMm,
    b.note ?? p.note,
    b.startedAt ?? p.started_at,
    b.hangerOrder ?? p.hanger_order,
    b.ballGrams === undefined ? p.ball_grams : b.ballGrams,
    p.id,
  );
  return c.json({ ok: true });
});

api.post('/projects/:id/archive', async (c) => {
  await c.var.db.run("UPDATE projects SET status = 'archived' WHERE id = ?", c.req.param('id'));
  return c.json({ ok: true });
});

api.post('/projects/:id/restore', async (c) => {
  const p = await c.var.db.first<ProjectRow>('SELECT * FROM projects WHERE id = ?', c.req.param('id'));
  if (!p) throw new NotFound('프로젝트를 찾을 수 없어요');
  const order = await c.var.db.first<{ m: number | null }>(
    "SELECT MAX(hanger_order) AS m FROM projects WHERE profile_id = ? AND status = 'active'",
    p.profile_id,
  );
  await c.var.db.run("UPDATE projects SET status = 'active', finished_at = NULL, hanger_order = ? WHERE id = ?", (order?.m ?? -1) + 1, p.id);
  return c.json({ ok: true });
});

/** 영구 삭제: 서랍(보관)에 있는 프로젝트만, confirm 문자열로 2단계 확인 (F1-8) */
api.delete('/projects/:id', async (c) => {
  const p = await c.var.db.first<ProjectRow>('SELECT * FROM projects WHERE id = ?', c.req.param('id'));
  if (!p) throw new NotFound('프로젝트를 찾을 수 없어요');
  if (p.status !== 'archived') throw new Error('서랍에 보관한 프로젝트만 영구 삭제할 수 있어요');
  if (c.req.query('confirm') !== p.name) throw new Error('확인을 위해 프로젝트 이름을 정확히 입력해 주세요');
  await c.var.db.run('DELETE FROM projects WHERE id = ?', p.id);
  return c.json({ ok: true });
});

api.post('/projects/:id/finish', async (c) => {
  const b = await body<{ measured?: Record<string, number> }>(c);
  const db = c.var.db;
  const p = await db.first<ProjectRow>('SELECT * FROM projects WHERE id = ?', c.req.param('id'));
  if (!p) throw new NotFound('프로젝트를 찾을 수 없어요');
  const { pattern } = await loadPattern(db, p.pattern_id);
  const expected = pattern.sizes.find((s) => s.label === p.size_label)?.finished ?? {};
  const measured = Object.fromEntries(
    Object.entries(b.measured ?? {}).filter(([, v]) => typeof v === 'number' && v > 0),
  );
  const basis = json<{ swatchSt?: number; swatchRow?: number; swatchId?: string }>(p.gauge_basis, {});
  let swatch: SwatchRow | null = null;
  if (basis.swatchId) swatch = await db.first<SwatchRow>('SELECT * FROM swatches WHERE id = ?', basis.swatchId);
  const learned = Object.keys(measured).length
    ? await learnFromFinished(db, {
        profileId: p.profile_id,
        technique: pattern.gauge.technique ?? 'stockinette',
        yarnWeight: swatch?.yarn_weight ?? 'dk',
        needleMaterial: swatch?.needle_material ?? 'any',
        usedSt: p.my_gauge_st,
        usedRow: p.my_gauge_row,
        swatchSt: basis.swatchSt,
        swatchRow: basis.swatchRow,
        expected,
        measured,
      })
    : {};
  const t = now();
  await db.batch([
    db.stmt("UPDATE projects SET status = 'finished', finished_at = ? WHERE id = ?", t, p.id),
    db.stmt(
      `INSERT INTO finished_records (project_id, measured, expected, k_actual_st, finished_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET measured = excluded.measured, expected = excluded.expected,
         k_actual_st = excluded.k_actual_st, finished_at = excluded.finished_at`,
      p.id,
      JSON.stringify(measured),
      JSON.stringify(expected),
      learned.kActualSt ?? null,
      t,
    ),
  ]);
  return c.json({ ok: true, expected, measured, learned });
});

api.post('/projects/:id/reconvert', async (c) => {
  const b = await body<{ myGauge: { st: number; row: number }; mode?: 'recalc' | 'needle' }>(c);
  await reconvertProject(
    c.var.db,
    c.req.param('id'),
    { st: num(b.myGauge?.st, '내 코 게이지'), row: num(b.myGauge?.row, '내 단 게이지') },
    b.mode,
  );
  return c.json({ ok: true });
});

api.post('/projects/:id/yarn', async (c) => {
  const b = await body<{ gramsUsed: number }>(c);
  const done = await c.var.db.first<{ n: number }>(
    'SELECT COALESCE(SUM(pr.stitches_done), 0) AS n FROM pieces pc JOIN progress pr ON pr.piece_id = pc.id WHERE pc.project_id = ?',
    c.req.param('id'),
  );
  await c.var.db.run(
    'INSERT INTO yarn_logs (id, project_id, grams_used, stitches_done, created_at) VALUES (?, ?, ?, ?, ?)',
    uid(),
    c.req.param('id'),
    num(b.gramsUsed, '사용한 실 무게'),
    done?.n ?? 0,
    now(),
  );
  return c.json({ ok: true });
});

/** 작업 화면 초기 데이터를 한 번에 (기획서 3.3) */
api.get('/projects/:id/work', async (c) => {
  const db = c.var.db;
  const id = c.req.param('id');
  const p = await db.first<ProjectRow & { pattern_title: string; file_key: string | null; original_json: string }>(
    `SELECT p.*, pt.title AS pattern_title, pt.file_key, pt.original_json FROM projects p JOIN patterns pt ON pt.id = p.pattern_id WHERE p.id = ?`,
    id,
  );
  if (!p) throw new NotFound('프로젝트를 찾을 수 없어요');
  const converted = JSON.parse(p.converted_json) as ConvertedPattern;
  const pieces = await db.all<PieceRow & ProgressRow>(
    `SELECT pc.*, pr.current_row, pr.current_stitch, pr.stitches_done, pr.frog_count, pr.frog_rows, pr.updated_at
       FROM pieces pc LEFT JOIN progress pr ON pr.piece_id = pc.id WHERE pc.project_id = ? ORDER BY pc.ord`,
    id,
  );
  const notes = await db.all<{ id: string; piece_id: string; row: number; text: string; photo_key: string | null; created_at: number }>(
    'SELECT n.* FROM notes n JOIN pieces pc ON pc.id = n.piece_id WHERE pc.project_id = ? ORDER BY n.row, n.created_at',
    id,
  );
  const checkins = await db.all<{ id: string; piece_id: string; at_row: number; dimension: string; measured_cm: number; expected_cm: number; deviation_pct: number; created_at: number }>(
    'SELECT ck.* FROM checkins ck JOIN pieces pc ON pc.id = ck.piece_id WHERE pc.project_id = ? ORDER BY ck.created_at',
    id,
  );
  const yarn = await db.first<{ grams_used: number; stitches_done: number; created_at: number }>(
    'SELECT * FROM yarn_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1',
    id,
  );
  const speed = await knittingSpeed(db, id, converted);
  return c.json({
    project: {
      id: p.id,
      profileId: p.profile_id,
      name: p.name,
      patternTitle: p.pattern_title,
      patternFileKey: p.file_key,
      sizeLabel: p.size_label,
      status: p.status,
      startedAt: p.started_at,
      lastWorkedAt: p.last_worked_at,
      conversionMode: p.conversion_mode,
      myGauge: { st: p.my_gauge_st, row: p.my_gauge_row },
      needleMm: p.needle_mm,
      yarn: p.yarn,
      ballGrams: p.ball_grams,
    },
    converted,
    finished:
      json<{ sizes?: { label: string; finished?: Record<string, number> }[] }>(p.original_json, {}).sizes?.find(
        (s) => s.label === p.size_label,
      )?.finished ?? {},
    pieces: pieces.map((x) => ({
      id: x.id,
      key: x.piece_key,
      name: x.name,
      totalRows: x.total_rows,
      totalStitches: x.total_stitches,
      progress: {
        currentRow: x.current_row ?? 0,
        currentStitch: x.current_stitch ?? 0,
        stitchesDone: x.stitches_done ?? 0,
        frogCount: x.frog_count ?? 0,
        frogRows: x.frog_rows ?? 0,
        updatedAt: x.updated_at ?? 0,
      },
    })),
    notes: notes.map((n) => ({ id: n.id, pieceId: n.piece_id, row: n.row, text: n.text, photoKey: n.photo_key, createdAt: n.created_at })),
    checkins: checkins.map((k) => ({
      id: k.id,
      pieceId: k.piece_id,
      atRow: k.at_row,
      dimension: k.dimension,
      measuredCm: k.measured_cm,
      expectedCm: k.expected_cm,
      deviationPct: k.deviation_pct,
      createdAt: k.created_at,
    })),
    yarnLog: yarn ? { gramsUsed: yarn.grams_used, stitchesDone: yarn.stitches_done, at: yarn.created_at } : null,
    speed,
  });
});

/* ───────────── 조각 진행 ───────────── */

api.post('/pieces/:id/events', async (c) => {
  const b = await body<{ events: ProgressEvent[] }>(c);
  if (!Array.isArray(b.events)) throw new Error('events 배열이 필요해요');
  if (b.events.length > 2000) throw new Error('한 번에 2000개까지 보낼 수 있어요');
  const snap = await ingestEvents(c.var.db, c.req.param('id'), b.events);
  return c.json(snap);
});

api.get('/pieces/:id/events', async (c) => {
  const rows = await c.var.db.all<Record<string, unknown>>(
    'SELECT * FROM progress_events WHERE piece_id = ? ORDER BY at DESC, id DESC LIMIT ?',
    c.req.param('id'),
    Math.min(500, Number(c.req.query('limit') ?? 100)),
  );
  return c.json(rows);
});

api.post('/pieces/:id/checkins', async (c) => {
  const b = await body<{ atRow: number; measuredCm: number; expectedCm: number; dimension?: 'length' | 'width' }>(c);
  const r = checkin(num(b.measuredCm, '측정값'), num(b.expectedCm, '예상값'));
  const id = uid();
  await c.var.db.run(
    `INSERT INTO checkins (id, piece_id, at_row, dimension, measured_cm, expected_cm, deviation_pct, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    c.req.param('id'),
    Math.trunc(num(b.atRow, 'atRow')),
    b.dimension ?? 'length',
    r.measuredCm,
    r.expectedCm,
    r.deviationPct,
    now(),
  );
  return c.json({ id, ...r }, 201);
});

api.get('/pieces/:id/notes', async (c) => {
  return c.json(await c.var.db.all('SELECT * FROM notes WHERE piece_id = ? ORDER BY row, created_at', c.req.param('id')));
});

api.post('/pieces/:id/notes', async (c) => {
  const b = await body<{ row: number; text?: string; photoKey?: string }>(c);
  if (!b.text?.trim() && !b.photoKey) throw new Error('메모나 사진이 필요해요');
  const id = uid();
  await c.var.db.run(
    'INSERT INTO notes (id, piece_id, row, text, photo_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    c.req.param('id'),
    Math.trunc(num(b.row, 'row')),
    b.text?.trim() ?? '',
    b.photoKey ?? null,
    now(),
  );
  return c.json({ id }, 201);
});

api.delete('/notes/:id', async (c) => {
  await c.var.db.run('DELETE FROM notes WHERE id = ?', c.req.param('id'));
  return c.json({ ok: true });
});

/* ───────────── 백업 내보내기 ───────────── */

api.get('/export', async (c) => {
  const db = c.var.db;
  const tables = ['profiles', 'yarns', 'swatches', 'hand_coefficients', 'patterns', 'projects', 'pieces', 'progress', 'progress_events', 'checkins', 'notes', 'yarn_logs', 'finished_records'];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = await db.all(`SELECT * FROM ${t}`);
  return c.json({ exportedAt: now(), version: 1, tables: out });
});

api.route('/', aiRoutes);
api.route('/', yarnRoutes);

app.route('/api', api);
app.all('/api/*', (c) => c.json({ error: '없는 API예요' }, 404));
app.get('*', async (c) => {
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.text('웹 앱이 아직 빌드되지 않았어요. `pnpm --filter @knitcloset/web build`를 먼저 실행해 주세요.', 404);
});

export default app;
