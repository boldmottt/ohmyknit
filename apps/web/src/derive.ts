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
    const repeats = Math.floor(row.stitchesWorked / sec.chart.repeatW);
    out.push({
      label: '차트',
      value: `${row.chartRow + 1} / ${sec.chart.repeatH}단`,
      detail: `${sec.chart.repeatW}코 무늬 반복 ×${repeats}`,
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

/** 지시 카드 배색 설명: 현재 차트 줄의 색 구성 */
export function colorRun(grid: number[], palette: { name: string; hex: string }[]): string {
  if (grid.length === 0) return '';
  const runs: { c: number; n: number }[] = [];
  for (const c of grid) {
    const last = runs.at(-1);
    if (last && last.c === c) last.n++;
    else runs.push({ c, n: 1 });
  }
  if (runs.length === 1) return `${palette[runs[0]!.c]?.name ?? '바탕색'}만`;
  // 실제로는 오른쪽에서 왼쪽으로 읽음
  return [...runs]
    .reverse()
    .map((r) => `${palette[r.c]?.name ?? `색${r.c}`} ${r.n}`)
    .join(' + ');
}

export function expectedLengthCm(data: WorkData, completedRows: number): number {
  return Math.round((completedRows / workingGauge(data).row) * 100) / 10;
}

export function expectedWidthCm(data: WorkData, stitches: number): number {
  return Math.round((stitches / workingGauge(data).st) * 100) / 10;
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
