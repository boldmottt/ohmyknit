export type PieceProgressInput = {
  /** 단별 콧수. index 0 = 1단 */
  rowStitchCounts: number[];
  /** 다 뜬 단 수 (0 = 아직 1단도 다 안 뜸) */
  completedRows: number;
  /** 현재 단에서 이미 뜬 코 수 */
  stitchesInCurrentRow?: number;
};

export type PieceProgress = {
  stitchesDone: number;
  totalStitches: number;
  /** 0 ~ 1 */
  ratio: number;
};

/**
 * 조각 진척도 = (Σ 완료한 단의 콧수 + 현재 단에서 뜬 코) / 조각 총 콧수 (기획서 4.3)
 */
export function pieceProgress(input: PieceProgressInput): PieceProgress {
  const { rowStitchCounts } = input;
  const completed = Math.max(0, Math.min(input.completedRows, rowStitchCounts.length));
  let total = 0;
  let done = 0;
  for (let i = 0; i < rowStitchCounts.length; i++) {
    const n = rowStitchCounts[i]!;
    total += n;
    if (i < completed) done += n;
  }
  if (completed < rowStitchCounts.length) {
    const current = rowStitchCounts[completed]!;
    done += Math.max(0, Math.min(input.stitchesInCurrentRow ?? 0, current));
  }
  return { stitchesDone: done, totalStitches: total, ratio: total === 0 ? 0 : done / total };
}

/** 전체 진척도 = Σ 조각별 뜬 코 / Σ 조각별 총 콧수 */
export function overallProgress(pieces: PieceProgress[]): PieceProgress {
  const stitchesDone = pieces.reduce((s, p) => s + p.stitchesDone, 0);
  const totalStitches = pieces.reduce((s, p) => s + p.totalStitches, 0);
  return {
    stitchesDone,
    totalStitches,
    ratio: totalStitches === 0 ? 0 : stitchesDone / totalStitches,
  };
}
