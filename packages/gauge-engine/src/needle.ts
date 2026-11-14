import { assertPositive } from './gauge.js';

/** 흔히 파는 대바늘 굵기 (mm) */
export const STANDARD_NEEDLES_MM = [
  2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8, 9, 10, 12, 15,
];

export function nearestStandardNeedle(mm: number): number {
  return STANDARD_NEEDLES_MM.reduce((best, n) => (Math.abs(n - mm) < Math.abs(best - mm) ? n : best));
}

export type SwatchPoint = { needleMm: number; st: number };

export type NeedleRecommendation = {
  needleMm: number;
  rawMm: number;
  method: 'records' | 'rule';
  explanation: string;
};

/**
 * 도안 코 게이지(targetSt)를 맞추려면 어떤 바늘을 써야 할지 추천합니다. (F3-3)
 *
 * - 같은 실로 바늘 굵기가 다른 스와치가 2개 이상 있으면: 내 기록으로 직선 회귀
 * - 아니면: 게이지는 바늘 굵기에 대략 반비례한다는 경험칙
 *   예: 4mm로 25코 → 22코를 원하면 4 × 25/22 = 4.55 → 4.5mm
 */
export function recommendNeedle(
  targetSt: number,
  current: SwatchPoint,
  records: SwatchPoint[] = [],
): NeedleRecommendation {
  assertPositive('targetSt', targetSt);
  assertPositive('current.needleMm', current.needleMm);
  assertPositive('current.st', current.st);

  const points = [current, ...records];
  const distinct = new Set(points.map((p) => p.needleMm));
  if (distinct.size >= 2) {
    const n = points.length;
    const mx = points.reduce((s, p) => s + p.needleMm, 0) / n;
    const my = points.reduce((s, p) => s + p.st, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (const p of points) {
      sxy += (p.needleMm - mx) * (p.st - my);
      sxx += (p.needleMm - mx) ** 2;
    }
    const slope = sxy / sxx; // 바늘 1mm당 게이지 변화 (보통 음수)
    if (slope < 0) {
      const rawMm = mx + (targetSt - my) / slope;
      if (rawMm > 0) {
        const needleMm = nearestStandardNeedle(rawMm);
        return {
          needleMm,
          rawMm,
          method: 'records',
          explanation: `내 스와치 ${n}개 기준, 바늘 1mm당 ${Math.abs(slope).toFixed(1)}코씩 변해요 → ${rawMm.toFixed(2)}mm → ${needleMm}mm`,
        };
      }
    }
  }

  const rawMm = (current.needleMm * current.st) / targetSt;
  const needleMm = nearestStandardNeedle(rawMm);
  return {
    needleMm,
    rawMm,
    method: 'rule',
    explanation: `${current.needleMm}mm × ${current.st}/${targetSt} = ${rawMm.toFixed(2)}mm → ${needleMm}mm (경험칙, 스와치로 꼭 확인)`,
  };
}

export type CheckinResult = {
  expectedCm: number;
  measuredCm: number;
  /** (측정 − 예상) / 예상 × 100. 음수면 작게(쫀쫀하게) 나오는 중 */
  deviationPct: number;
  warn: boolean;
  message: string;
};

/** 중간 실측 체크인 (F4-8). 오차 3% 이상이면 경고 */
export function checkin(measuredCm: number, expectedCm: number, thresholdPct = 3): CheckinResult {
  assertPositive('measuredCm', measuredCm);
  assertPositive('expectedCm', expectedCm);
  const deviationPct = ((measuredCm - expectedCm) / expectedCm) * 100;
  const warn = Math.abs(deviationPct) >= thresholdPct;
  const pct = Math.abs(deviationPct).toFixed(1);
  const message = !warn
    ? `예상과 거의 같아요 (${deviationPct >= 0 ? '+' : '−'}${pct}%) 👍`
    : deviationPct < 0
      ? `도안 기준보다 ${pct}% 쫀쫀해지고 있어요. 남은 부분의 단수를 조정할까요?`
      : `도안 기준보다 ${pct}% 느슨해지고 있어요. 남은 부분의 단수를 조정할까요?`;
  return { expectedCm, measuredCm, deviationPct, warn, message };
}
