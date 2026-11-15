import {
  convertPattern,
  knittingPace,
  normalizeEvents,
  pieceProgress,
  replayEvents,
  type ConvertedPattern,
  type ConversionMode,
  type ProgressEvent,
} from '@knitcloset/gauge-engine';
import { parsePattern, type Pattern } from '@knitcloset/pattern-schema';
import type { Db } from './db.js';
import { json, now, uid } from './db.js';

export type ProjectRow = {
  id: string;
  profile_id: string;
  pattern_id: string;
  name: string;
  size_label: string;
  status: 'active' | 'archived' | 'finished';
  started_at: number;
  last_worked_at: number | null;
  finished_at: number | null;
  hanger_order: number;
  conversion_mode: ConversionMode;
  my_gauge_st: number;
  my_gauge_row: number;
  gauge_basis: string;
  needle_mm: number | null;
  yarn: string;
  ball_grams: number | null;
  note: string;
  converted_json: string;
  total_stitches: number;
  cover_texture_key: string | null;
  created_at: number;
};

export type PieceRow = {
  id: string;
  project_id: string;
  piece_key: string;
  name: string;
  ord: number;
  construction: string;
  direction: string;
  total_rows: number;
  total_stitches: number;
};

export type ProgressRow = {
  piece_id: string;
  current_row: number;
  current_stitch: number;
  stitches_done: number;
  frog_count: number;
  frog_rows: number;
  updated_at: number;
};

export type PatternRow = {
  id: string;
  profile_id: string | null;
  title: string;
  designer: string;
  source_type: string;
  original_json: string;
  file_key: string | null;
  gauge_st: number;
  gauge_row: number;
  needle_mm: number | null;
  created_at: number;
  updated_at: number;
};

export async function loadPattern(db: Db, id: string): Promise<{ row: PatternRow; pattern: Pattern }> {
  const row = await db.first<PatternRow>('SELECT * FROM patterns WHERE id = ?', id);
  if (!row) throw new NotFound('도안을 찾을 수 없어요');
  const raw = JSON.parse(row.original_json) as unknown;
  try {
    return { row, pattern: parsePattern(raw) };
  } catch {
    // 검증 규칙이 더 엄격해지기 전에 저장된 도안: 그대로 열어서 편집 화면에서 고칠 수 있게 함
    // (저장할 때는 항상 parsePattern을 거치므로 기본값은 이미 채워져 있어요)
    return { row, pattern: raw as Pattern };
  }
}

export class NotFound extends Error {}

/** 옷장 카드/상세 패널용 요약 (진척도 포함) */
export async function projectSummaries(db: Db, where: string, ...params: (string | number)[]) {
  const projects = await db.all<ProjectRow & { pattern_title: string; designer: string }>(
    `SELECT p.*, pt.title AS pattern_title, pt.designer AS designer
       FROM projects p JOIN patterns pt ON pt.id = p.pattern_id
      WHERE ${where} ORDER BY p.hanger_order ASC, p.created_at ASC`,
    ...params,
  );
  if (projects.length === 0) return [];
  const ids = projects.map((p) => p.id);
  const marks = ids.map(() => '?').join(',');
  const pieces = await db.all<PieceRow & ProgressRow>(
    `SELECT pc.*, pr.current_row, pr.current_stitch, pr.stitches_done, pr.frog_count, pr.frog_rows, pr.updated_at
       FROM pieces pc LEFT JOIN progress pr ON pr.piece_id = pc.id
      WHERE pc.project_id IN (${marks}) ORDER BY pc.ord`,
    ...ids,
  );
  return projects.map((p) => {
    const ps = pieces.filter((x) => x.project_id === p.id);
    const done = ps.reduce((s, x) => s + (x.stitches_done ?? 0), 0);
    const total = ps.reduce((s, x) => s + x.total_stitches, 0);
    const converted = json<ConvertedPattern | null>(p.converted_json, null);
    return {
      id: p.id,
      profileId: p.profile_id,
      patternId: p.pattern_id,
      name: p.name,
      patternTitle: p.pattern_title,
      designer: p.designer,
      sizeLabel: p.size_label,
      status: p.status,
      startedAt: p.started_at,
      lastWorkedAt: p.last_worked_at,
      finishedAt: p.finished_at,
      hangerOrder: p.hanger_order,
      conversionMode: p.conversion_mode,
      myGauge: { st: p.my_gauge_st, row: p.my_gauge_row },
      needleMm: p.needle_mm,
      yarn: p.yarn,
      note: p.note,
      palette: converted?.palette ?? [],
      // 옷 그림에 쓸 배색 무늬 (첫 차트)와 옷 종류
      motif: converted?.pieces.flatMap((x) => x.sections).find((x) => x.chart)?.chart?.grid ?? null,
      kind: (/비니|모자|hat|beanie/i.test(`${p.name} ${p.pattern_title}`) ? 'hat' : 'sweater') as 'hat' | 'sweater',
      progress: total === 0 ? 0 : done / total,
      stitchesDone: done,
      totalStitches: total,
      pieces: ps.map((x) => ({
        id: x.id,
        name: x.name,
        currentRow: x.current_row ?? 0,
        totalRows: x.total_rows,
        progress: x.total_stitches ? (x.stitches_done ?? 0) / x.total_stitches : 0,
      })),
    };
  });
}

export type CreateProjectInput = {
  profileId: string;
  patternId: string;
  size: string;
  myGauge: { st: number; row: number };
  gaugeBasis?: Record<string, unknown>;
  mode?: ConversionMode;
  name?: string;
  yarn?: string;
  needleMm?: number | null;
  ballGrams?: number | null;
  startedAt?: number;
};

export async function createProject(db: Db, input: CreateProjectInput): Promise<string> {
  const { pattern } = await loadPattern(db, input.patternId);
  const converted = convertPattern(pattern, {
    size: input.size,
    myGauge: input.myGauge,
    mode: input.mode ?? 'recalc',
  });
  const id = uid();
  const t = now();
  const order = await db.first<{ m: number | null }>(
    "SELECT MAX(hanger_order) AS m FROM projects WHERE profile_id = ? AND status = 'active'",
    input.profileId,
  );
  const total = converted.pieces.reduce((s, p) => s + p.totalStitches, 0);
  const stmts = [
    db.stmt(
      `INSERT INTO projects (id, profile_id, pattern_id, name, size_label, status, started_at, hanger_order,
         conversion_mode, my_gauge_st, my_gauge_row, gauge_basis, needle_mm, yarn, ball_grams, converted_json,
         total_stitches, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.profileId,
      input.patternId,
      input.name?.trim() || pattern.title,
      input.size,
      input.startedAt ?? t,
      (order?.m ?? -1) + 1,
      converted.mode,
      input.myGauge.st,
      input.myGauge.row,
      JSON.stringify(input.gaugeBasis ?? {}),
      input.needleMm ?? pattern.gauge.needleMm ?? null,
      input.yarn ?? pattern.yarn,
      input.ballGrams ?? null,
      JSON.stringify(converted),
      total,
      t,
    ),
  ];
  converted.pieces.forEach((pc, i) => {
    const pieceId = `${id}:${pc.id}`;
    stmts.push(
      db.stmt(
        `INSERT INTO pieces (id, project_id, piece_key, name, ord, construction, direction, total_rows, total_stitches)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        pieceId,
        id,
        pc.id,
        pc.name,
        i,
        pc.construction,
        pc.direction,
        pc.totalRows,
        pc.totalStitches,
      ),
      db.stmt('INSERT INTO progress (piece_id, updated_at) VALUES (?, ?)', pieceId, t),
    );
  });
  await db.batch(stmts);
  return id;
}

/**
 * 손 프로필이 바뀌었을 때 다시 변환합니다. 뜬 단 수는 유지하되 새 총 단 수를 넘지 않게 맞춥니다.
 */
export type ReconvertResult = {
  /** 이미 뜨기 시작해서 그대로 둔 조각 */
  kept: string[];
  /** 새 게이지로 다시 계산한 조각 */
  updated: string[];
};

/**
 * 손 프로필이 바뀌었을 때 다시 변환합니다 (F2-6).
 *
 * 이미 뜨기 시작한 조각은 건드리지 않아요. 코잡기 콧수가 바뀌면 지금까지 뜬 것과 맞지 않으니까요.
 * 아직 시작하지 않은 조각만 새 게이지로 다시 계산하고, 도안이 바뀌어 조각이 늘거나 줄었으면 그것도 맞춥니다.
 */
export async function reconvertProject(
  db: Db,
  projectId: string,
  myGauge: { st: number; row: number },
  mode?: ConversionMode,
): Promise<ReconvertResult> {
  const p = await db.first<ProjectRow>('SELECT * FROM projects WHERE id = ?', projectId);
  if (!p) throw new NotFound('프로젝트를 찾을 수 없어요');
  const { pattern } = await loadPattern(db, p.pattern_id);
  const fresh = convertPattern(pattern, { size: p.size_label, myGauge, mode: mode ?? p.conversion_mode });
  const old = json<ConvertedPattern | null>(p.converted_json, null);
  const existing = await db.all<PieceRow & { current_row: number | null }>(
    'SELECT pc.*, pr.current_row FROM pieces pc LEFT JOIN progress pr ON pr.piece_id = pc.id WHERE pc.project_id = ?',
    projectId,
  );
  const started = new Set(existing.filter((x) => (x.current_row ?? 0) > 0).map((x) => x.piece_key));
  const have = new Set(existing.map((x) => x.piece_key));

  const result: ReconvertResult = { kept: [], updated: [] };
  const pieces = fresh.pieces.map((pc) => {
    const before = old?.pieces.find((x) => x.id === pc.id);
    if (started.has(pc.id) && before) {
      result.kept.push(before.name);
      // 예전 변환에는 조각별 게이지가 없을 수 있어서 채워 둠
      return { ...before, gauge: before.gauge ?? old!.myGauge };
    }
    result.updated.push(pc.name);
    return pc;
  });
  // 도안에서는 없어졌지만 이미 뜨던 조각은 남겨 둠
  for (const before of old?.pieces ?? []) {
    if (started.has(before.id) && !pieces.some((x) => x.id === before.id)) {
      result.kept.push(before.name);
      pieces.push({ ...before, gauge: before.gauge ?? old!.myGauge });
    }
  }
  const converted: ConvertedPattern = { ...fresh, pieces };

  const t = now();
  const stmts = [
    db.stmt(
      'UPDATE projects SET my_gauge_st = ?, my_gauge_row = ?, conversion_mode = ?, converted_json = ?, total_stitches = ? WHERE id = ?',
      myGauge.st,
      myGauge.row,
      converted.mode,
      JSON.stringify(converted),
      pieces.reduce((s, x) => s + x.totalStitches, 0),
      projectId,
    ),
  ];
  pieces.forEach((pc, i) => {
    const pieceId = `${projectId}:${pc.id}`;
    if (have.has(pc.id)) {
      stmts.push(
        db.stmt('UPDATE pieces SET name = ?, ord = ?, total_rows = ?, total_stitches = ? WHERE id = ?', pc.name, i, pc.totalRows, pc.totalStitches, pieceId),
      );
    } else {
      stmts.push(
        db.stmt(
          `INSERT INTO pieces (id, project_id, piece_key, name, ord, construction, direction, total_rows, total_stitches)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          pieceId,
          projectId,
          pc.id,
          pc.name,
          i,
          pc.construction,
          pc.direction,
          pc.totalRows,
          pc.totalStitches,
        ),
        db.stmt('INSERT INTO progress (piece_id, updated_at) VALUES (?, ?)', pieceId, t),
      );
    }
  });
  for (const x of existing) {
    if (!pieces.some((pc) => pc.id === x.piece_key)) stmts.push(db.stmt('DELETE FROM pieces WHERE id = ?', x.id));
  }
  await db.batch(stmts);
  for (const pc of pieces) await recomputeProgress(db, `${projectId}:${pc.id}`);
  return result;
}

/** 기기 시계가 이만큼 넘게 앞서 있으면 보정 */
const CLOCK_SKEW_TOLERANCE_MS = 60_000;

const EVENT_TYPES = new Set(['row_inc', 'row_dec', 'jump', 'frog', 'stitch', 'session_start', 'session_end']);

type EventRow = {
  id: string;
  piece_id: string;
  type: ProgressEvent['type'];
  from_row: number;
  to_row: number;
  at: number;
  device: string | null;
  meta: string | null;
};

export function toEvent(r: EventRow): ProgressEvent {
  return {
    id: r.id,
    pieceId: r.piece_id,
    type: r.type,
    fromRow: r.from_row,
    toRow: r.to_row,
    at: r.at,
    ...(r.device ? { device: r.device } : {}),
    ...(r.meta ? { meta: r.meta } : {}),
  };
}

/** 이벤트 로그 전체를 다시 재생해서 progress 스냅샷을 만듭니다 (기획서 3.3 동기화 규칙) */
export async function recomputeProgress(db: Db, pieceId: string) {
  const piece = await db.first<PieceRow & { converted_json: string }>(
    'SELECT pc.*, p.converted_json FROM pieces pc JOIN projects p ON p.id = pc.project_id WHERE pc.id = ?',
    pieceId,
  );
  if (!piece) throw new NotFound('조각을 찾을 수 없어요');
  const rows = await db.all<EventRow>('SELECT * FROM progress_events WHERE piece_id = ? ORDER BY at, id', pieceId);
  const snap = replayEvents(rows.map(toEvent), piece.total_rows);
  const converted = json<ConvertedPattern | null>(piece.converted_json, null);
  const cp = converted?.pieces.find((x) => x.id === piece.piece_key);
  const prog = cp
    ? pieceProgress({
        rowStitchCounts: cp.rows.map((r) => r.stitchesWorked),
        completedRows: snap.currentRow,
        stitchesInCurrentRow: snap.currentStitch,
      })
    : { stitchesDone: 0 };
  await db.run(
    `INSERT INTO progress (piece_id, current_row, current_stitch, stitches_done, frog_count, frog_rows, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (piece_id) DO UPDATE SET current_row = excluded.current_row, current_stitch = excluded.current_stitch,
       stitches_done = excluded.stitches_done, frog_count = excluded.frog_count, frog_rows = excluded.frog_rows,
       updated_at = excluded.updated_at`,
    pieceId,
    snap.currentRow,
    snap.currentStitch,
    prog.stitchesDone,
    snap.frogCount,
    snap.frogRows,
    now(),
  );
  return { ...snap, stitchesDone: prog.stitchesDone, eventCount: rows.length };
}

export async function ingestEvents(db: Db, pieceId: string, events: ProgressEvent[]) {
  const piece = await db.first<PieceRow>('SELECT * FROM pieces WHERE id = ?', pieceId);
  if (!piece) throw new NotFound('조각을 찾을 수 없어요');
  const t = now();
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  let clean = normalizeEvents(
    events
      .filter((e) => e && typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 80)
      .filter((e) => EVENT_TYPES.has(e.type) && num(e.at) && e.at > 0)
      .map((e) => ({ ...e, fromRow: num(e.fromRow) ? e.fromRow : 0, toRow: num(e.toRow) ? e.toRow : 0 })),
  );
  if (clean.length < events.length) {
    throw new Error(`형식이 올바르지 않은 진행 기록이 ${events.length - clean.length}개 있어요`);
  }
  // 기기 시계가 앞서 있으면 그 기록이 계속 "가장 나중"으로 재생돼서 다른 기기의 기록을 덮어요.
  // 묶음 전체를 같은 만큼 당겨서 순서는 지키고, 서버 시각보다 미래로는 가지 않게 합니다.
  const ahead = clean.reduce((m, e) => Math.max(m, e.at), 0) - t;
  if (ahead > CLOCK_SKEW_TOLERANCE_MS) clean = clean.map((e) => ({ ...e, at: Math.max(1, e.at - ahead) }));
  await db.batch(
    clean.map((e) =>
      db.stmt(
        `INSERT OR IGNORE INTO progress_events (id, piece_id, type, from_row, to_row, at, device, meta, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        e.id,
        pieceId,
        e.type,
        Math.trunc(e.fromRow ?? 0),
        Math.trunc(e.toRow ?? 0),
        Math.trunc(e.at),
        e.device ?? null,
        e.meta ?? null,
        t,
      ),
    ),
  );
  const snap = await recomputeProgress(db, pieceId);
  const latest = clean.reduce((m, e) => Math.max(m, e.at), 0);
  if (clean.some((e) => e.type !== 'session_start' && e.type !== 'session_end')) {
    await db.run(
      'UPDATE projects SET last_worked_at = MAX(COALESCE(last_worked_at, 0), ?) WHERE id = ?',
      Math.min(latest, t),
      piece.project_id,
    );
  }
  return snap;
}

/** 작업 속도 (분당 코 수). 최근 30일 이벤트, 5분 넘게 쉰 구간은 제외 */
/**
 * 작업 속도 (분당 코 수). 최근 30일 이벤트 기준.
 * 쉰 구간과 몰아서 누른 단은 knittingPace가 걸러 줍니다.
 */
export async function knittingSpeed(db: Db, projectId: string, converted: ConvertedPattern) {
  const since = now() - 30 * 24 * 3600_000;
  const rows = await db.all<EventRow>(
    `SELECT e.* FROM progress_events e JOIN pieces pc ON pc.id = e.piece_id
      WHERE pc.project_id = ? AND e.at >= ? ORDER BY e.at, e.id`,
    projectId,
    since,
  );
  const byKey = new Map(converted.pieces.map((pc) => [`${projectId}:${pc.id}`, pc]));
  const pace = knittingPace(rows.map(toEvent), (pieceId, rowIndex) => byKey.get(pieceId)?.rows[rowIndex]?.stitchesWorked ?? 0);
  return { activeMs: pace.activeMs, stitches: pace.stitches, stitchesPerMinute: pace.stitchesPerMinute };
}
