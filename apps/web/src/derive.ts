import { pieceProgress, type ConvertedPiece, type ConvertedRow, type ConvertedSection, type ProgressSnapshot } from '@knitcloset/gauge-engine';
import type { WorkData } from './api';

/**
 * 작업 화면의 파생값. 상태에 따로 저장하지 않고 progress + rowTable에서 매번 계산합니다 (기획서 5.9).
 */

export function convertedPiece(data: WorkData, pieceId: string): ConvertedPiece | undefined {
  return data.converted.pieces.find((p) => `${data.project.id}:${p.id}` === pieceId);
}

export function workingGauge(data: WorkData) {
  return data.converted.mode === 'needle' ? data.converted.patternGauge : data.project.myGauge;
}

export type RowView = {
  /** 지금 뜨는 단 (1부터). 다 뜬 조각이면 undefined */
  row?: ConvertedRow;
  section?: ConvertedSection;
  completedRows: number;
  done: boolean;
};

export function currentRowView(piece: ConvertedPiece, snap: ProgressSnapshot): RowView {
  const row = piece.rows[snap.currentRow];
  return {
    row,
    section: row ? piece.sections[row.sectionIndex] : piece.sections.at(-1),
    completedRows: snap.currentRow,
    done: snap.currentRow >= piece.rows.length,
  };
}

export function pieceStitchProgress(piece: ConvertedPiece, snap: ProgressSnapshot) {
  return pieceProgress({
    rowStitchCounts: piece.rows.map((r) => r.stitchesWorked),
    completedRows: snap.currentRow,
    stitchesInCurrentRow: snap.currentStitch,
  });
}

export function overall(data: WorkData, snapshots: Record<string, ProgressSnapshot>) {
  let done = 0;
  let total = 0;
  for (const p of data.pieces) {
    const conv = convertedPiece(data, p.id);
    if (!conv) continue;
    const pr = pieceStitchProgress(conv, snapshots[p.id] ?? { currentRow: 0, currentStitch: 0, frogCount: 0, frogRows: 0, lastAt: 0 });
    done += pr.stitchesDone;
    total += pr.totalStitches;
  }
  return { done, total, ratio: total ? done / total : 0 };
}

export type Upcoming = { row: number; rowsAway: number; kind: string; text: string; lock: boolean; icon: string };

const ICON: Record<string, string> = {
  inc: '⚠',
  dec: '⚠',
  bindoff: '◇',
  split: '◇',
  pickup: '◇',
  color: '●',
  note: '✎',
  checkin: '📏',
};

/** 앞으로 lookahead 단 안의 이벤트 + 배색 구간 시작 (F4-5) */
export function upcoming(piece: ConvertedPiece, completedRows: number, lookahead = 20): Upcoming[] {
  const out: Upcoming[] = [];
  for (let r = completedRows; r < Math.min(piece.rows.length, completedRows + lookahead); r++) {
    const row = piece.rows[r]!;
    for (const e of row.events) {
      out.push({ row: row.row, rowsAway: row.row - completedRows, kind: e.kind, text: e.text, lock: e.lock, icon: ICON[e.kind] ?? '•' });
    }
    if (row.sectionRow === 1 && row.row > completedRows + 1) {
      const sec = piece.sections[row.sectionIndex]!;
      out.push({
        row: row.row,
        rowsAway: row.row - completedRows,
        kind: sec.chart ? 'color' : 'section',
        text: `${sec.name} 시작${sec.instruction ? ` · ${sec.instruction}` : ''}`,
        lock: false,
        icon: sec.chart ? '●' : '▸',
      });
    }
  }
  return out;
}

export type LinkedCounter = { label: string; value: string; detail?: string };

/** 메인 단수에서 자동 계산되는 보조 카운터 (기획서 5.4 ③) */
export function linkedCounters(piece: ConvertedPiece, completedRows: number, custom: { label: string; every: number }[] = []): LinkedCounter[] {
  const out: LinkedCounter[] = [];
  const row = piece.rows[completedRows];
  if (!row) return out;
  const sec = piece.sections[row.sectionIndex]!;
  out.push({ label: sec.name, value: `${row.sectionRow} / ${sec.rows}단` });
  if (sec.chart && row.chartRow !== undefined) {
    const line = sec.chart.grid[row.chartRow] ?? [];
    const real = line.filter((c) => c !== -1).length;
    const repeats = sec.chart.shaped ? (sec.chart.repeats ?? 1) : Math.floor(row.stitchesWorked / sec.chart.repeatW);
    out.push({
      label: '차트',
      value: `${row.chartRow + 1} / ${sec.chart.repeatH}단`,
      detail: sec.chart.shaped ? `이 단 ${real}코 × ${repeats}회 = ${real * repeats}코` : `${sec.chart.repeatW}코 무늬 반복 ×${repeats}`,
    });
  }
  // 다음 늘림·줄임까지
  let prevShape = 0;
  for (let r = completedRows - 1; r >= 0; r--) {
    if (piece.rows[r]!.events.some((e) => e.kind === 'inc' || e.kind === 'dec')) {
      prevShape = r + 1;
      break;
    }
  }
  for (let r = completedRows; r < piece.rows.length; r++) {
    const ev = piece.rows[r]!.events.find((e) => e.kind === 'inc' || e.kind === 'dec');
    if (ev) {
      const next = r + 1;
      const interval = next - Math.max(prevShape, sec.startRow - 1);
      const inInterval = completedRows + 1 - Math.max(prevShape, sec.startRow - 1);
      out.push({
        label: ev.kind === 'inc' ? '늘림 간격' : '줄임 간격',
        value: `${Math.max(1, inInterval)} / ${interval}단`,
        detail: next === completedRows + 1 ? '이번 단에 해요!' : `${next - completedRows}단 뒤`,
      });
      break;
    }
  }
  for (const c of custom) {
    if (c.every > 0) out.push({ label: c.label, value: `${(completedRows % c.every) + 1} / ${c.every}단` });
  }
  return out;
}

/**
 * 그 단을 차트 왼쪽부터 읽는지. 차트는 겉면에서 본 그림이라
 * 평면뜨기의 안면 단(짝수 단)은 왼쪽 → 오른쪽으로, 그 밖에는 오른쪽 → 왼쪽으로 읽어요.
 */
export function readsFromLeft(piece: { construction: string }, row: number): boolean {
  return piece.construction !== 'round' && row % 2 === 0;
}

/** 지시 카드 배색 설명: 현재 차트 줄의 색 구성을 뜨는 순서대로 */
export function colorRun(line: number[], palette: { name: string; hex: string }[], fromLeft = false): string {
  const grid = line.filter((c) => c !== -1);
  if (grid.length === 0) return '';
  const runs: { c: number; n: number }[] = [];
  for (const c of grid) {
    const last = runs.at(-1);
    if (last && last.c === c) last.n++;
    else runs.push({ c, n: 1 });
  }
  if (runs.length === 1) return `${palette[runs[0]!.c]?.name ?? '바탕색'}만`;
  // 차트 칸은 왼쪽부터 들어 있음. 겉면·원통뜨기는 오른쪽에서 왼쪽으로, 평면뜨기 안면 단은 왼쪽에서 오른쪽으로 뜸
  return (fromLeft ? runs : [...runs].reverse())
    .map((r) => `${palette[r.c]?.name ?? `색${r.c}`} ${r.n}`)
    .join(' + ');
}

/** 그 조각을 변환할 때 쓴 게이지 (게이지를 바꾼 뒤에도 시작한 조각은 예전 값을 유지) */
export function pieceGauge(data: WorkData, piece?: ConvertedPiece) {
  return piece?.gauge ?? workingGauge(data);
}

export function expectedLengthCm(data: WorkData, completedRows: number, piece?: ConvertedPiece): number {
  return Math.round((completedRows / pieceGauge(data, piece).row) * 100) / 10;
}

export function expectedWidthCm(data: WorkData, stitches: number, piece?: ConvertedPiece): number {
  return Math.round((stitches / pieceGauge(data, piece).st) * 100) / 10;
}

export type CheckinAdvice = {
  /** 사람이 읽는 조언. 조정이 필요 없으면 빈 문자열 */
  text: string;
  /** 이 실측대로라면 내 실제 게이지 (다음 조각 변환에 쓸 값) */
  suggested: { st?: number; row?: number };
};

/**
 * 중간 실측 결과를 "그래서 무엇을 하면 되는지"로 바꿉니다 (F4-8).
 * 길이: 지금 떠지는 비율로 목표 길이까지 몇 단이 필요한지.
 * 너비: 이미 뜬 콧수는 바꿀 수 없으니 완성 치수가 얼마나 달라질지.
 */
export function checkinAdvice(
  data: WorkData,
  piece: ConvertedPiece,
  o: { dimension: 'length' | 'width'; measuredCm: number; completedRows: number; stitches: number },
): CheckinAdvice {
  const g = pieceGauge(data, piece);
  if (!(o.measuredCm > 0)) return { text: '', suggested: {} };
  const r1 = (n: number) => Math.round(n * 10) / 10;
  if (o.dimension === 'length') {
    if (o.completedRows < 10) return { text: '아직 뜬 단이 적어서 길이 조언은 10단 넘게 뜬 뒤에 드릴게요.', suggested: {} };
    const actualRow = (o.completedRows / o.measuredCm) * 10;
    const targetCm = (piece.totalRows / g.row) * 10;
    const planned = piece.totalRows - o.completedRows;
    const needed = Math.max(0, Math.round(((targetCm - o.measuredCm) / o.measuredCm) * o.completedRows));
    const diff = needed - planned;
    const short = r1(targetCm - o.measuredCm);
    const text =
      planned === 0
        ? Math.abs(short) < 1
          ? `다 뜬 길이가 목표 ${r1(targetCm)}cm에 거의 맞아요.`
          : `이 조각은 계획한 단을 다 떴는데 목표 ${r1(targetCm)}cm보다 ${Math.abs(short)}cm ${short > 0 ? '짧아요' : '길어요'}.${short > 0 ? ` 코막음 전이라면 약 ${needed}단을 더 뜨면 맞아요.` : ''} 블로킹으로 1~2cm는 조절할 수 있어요.`
        : Math.abs(diff) < 2
        ? `지금처럼 뜨면 목표 길이 ${r1(targetCm)}cm에 거의 맞아요.`
        : `지금처럼 뜨면 목표 길이 ${r1(targetCm)}cm까지 ${needed}단이 필요해요. 계획은 ${planned}단이라 약 ${Math.abs(diff)}단을 ${diff > 0 ? '더' : '덜'} 뜨면 돼요. (무늬 구간이 아닌 곳에서 조절하세요)`;
    return { text, suggested: { row: r1(actualRow) } };
  }
  const actualSt = (o.stitches / o.measuredCm) * 10;
  const pctOff = ((o.measuredCm - (o.stitches / g.st) * 10) / ((o.stitches / g.st) * 10)) * 100;
  const text =
    Math.abs(pctOff) < 3
      ? ''
      : `이미 잡은 콧수는 바꿀 수 없어서, 이 조각은 완성 치수가 약 ${Math.abs(r1(pctOff))}% ${pctOff < 0 ? '작게' : '크게'} 나와요. 아직 시작하지 않은 조각은 게이지를 다시 맞추면 그 차이를 반영할 수 있어요.`;
  return { text, suggested: { st: r1(actualSt) } };
}

export function remainingMinutes(data: WorkData, remainingStitches: number): number | null {
  const spm = data.speed.stitchesPerMinute;
  return spm && spm > 0 ? remainingStitches / spm : null;
}

export function yarnForecast(data: WorkData, done: number, total: number) {
  const log = data.yarnLog;
  if (!log || log.stitchesDone <= 0) return null;
  const perStitch = log.gramsUsed / log.stitchesDone;
  const remainingGrams = perStitch * Math.max(0, total - done);
  const balls = data.project.ballGrams ? remainingGrams / data.project.ballGrams : null;
  return { remainingGrams, balls, totalGrams: perStitch * total };
}

export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const s = Math.floor((ms % 60_000) / 1000);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatHours(min: number): string {
  if (min < 60) return `${Math.round(min)}분`;
  const h = min / 60;
  return h < 10 ? `${h.toFixed(1)}시간` : `${Math.round(h)}시간`;
}
