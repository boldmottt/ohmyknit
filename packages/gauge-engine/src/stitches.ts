import { assertPositive, stitchesToCm } from './gauge.js';

export type StitchConversionOptions = {
  /** 배색 반복 단위(코). 주어지면 결과는 반드시 이 값의 배수 */
  repeat?: number;
  /** 반복 단위가 없을 때 적용할 홀짝 조건 */
  parity?: 'even' | 'odd' | 'any';
  /** 내 코 게이지 (10cm당 코 수). 치수 오차 계산에 사용 */
  myStGauge: number;
  /** 허용 오차(cm). 기본 1.5cm. 넘으면 바늘 교체 방식을 제안 */
  toleranceCm?: number;
};

export type StitchConversion = {
  /** 도안 콧수 × kSt (반올림 전) */
  raw: number;
  /** 최종 콧수 */
  value: number;
  /** |value − raw|를 내 게이지 기준 cm로 바꾼 값 */
  errorCm: number;
  withinTolerance: boolean;
  /** 사람이 읽는 근거 (계산식 보기) */
  explanation: string;
};

const DEFAULT_TOLERANCE_CM = 1.5;

/** 반복 단위의 배수 중 raw에 가장 가까운 값. 같은 거리면 큰 쪽(여유분) */
function nearestMultiple(raw: number, repeat: number): number {
  const lower = Math.max(repeat, Math.floor(raw / repeat) * repeat);
  const upper = Math.max(repeat, Math.ceil(raw / repeat) * repeat);
  return raw - lower < upper - raw ? lower : upper;
}

function roundWithParity(raw: number, parity: 'even' | 'odd' | 'any'): number {
  if (parity === 'any') return Math.max(1, Math.round(raw));
  const wantOdd = parity === 'odd';
  const lo = Math.floor(raw);
  const hi = Math.ceil(raw);
  const candidates = [lo - 1, lo, hi, hi + 1].filter(
    (n) => n >= 1 && (n % 2 === 1) === wantOdd,
  );
  // 가장 가까운 값, 같은 거리면 큰 쪽
  candidates.sort((a, b) => Math.abs(a - raw) - Math.abs(b - raw) || b - a);
  return candidates[0] ?? (wantOdd ? 1 : 2);
}

/**
 * 도안 콧수를 내 손에 맞게 변환합니다. (기획서 4.1)
 *
 * 예: 200코, kSt = 25/22, 반복 12코 → raw 227.3 → 228코 (12×19), 오차 0.27cm
 */
export function convertStitchCount(
  patternStitches: number,
  kSt: number,
  options: StitchConversionOptions,
): StitchConversion {
  assertPositive('patternStitches', patternStitches);
  assertPositive('kSt', kSt);
  assertPositive('myStGauge', options.myStGauge);

  const raw = patternStitches * kSt;
  const tolerance = options.toleranceCm ?? DEFAULT_TOLERANCE_CM;

  let value: number;
  let rule: string;
  if (options.repeat !== undefined) {
    assertPositive('repeat', options.repeat);
    if (!Number.isInteger(options.repeat)) {
      throw new RangeError(`repeat must be an integer (got ${options.repeat})`);
    }
    value = nearestMultiple(raw, options.repeat);
    rule = `${options.repeat}코 반복의 배수 (${options.repeat}×${value / options.repeat})`;
  } else {
    const parity = options.parity ?? 'any';
    value = roundWithParity(raw, parity);
    rule = parity === 'even' ? '짝수로 반올림' : parity === 'odd' ? '홀수로 반올림' : '반올림';
  }

  const errorCm = stitchesToCm(Math.abs(value - raw), options.myStGauge);
  return {
    raw,
    value,
    errorCm,
    withinTolerance: errorCm <= tolerance,
    explanation:
      `${patternStitches}코 × ${kSt.toFixed(3)} = ${raw.toFixed(1)}코 → ${rule} → ${value}코 ` +
      `(치수 차이 ${errorCm.toFixed(2)}cm)`,
  };
}
