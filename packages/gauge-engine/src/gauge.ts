/** 10cm 기준 게이지 (코 수 / 단 수). */
export type Gauge = {
  /** 10cm 안의 코 수 */
  st: number;
  /** 10cm 안의 단 수 */
  row: number;
};

export type GaugeRatio = {
  /** 내 코 게이지 / 도안 코 게이지. 1보다 크면 쫀쫀한 손 → 코를 더 잡아야 함 */
  kSt: number;
  /** 내 단 게이지 / 도안 단 게이지 */
  kRow: number;
};

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number (got ${value})`);
  }
}

/** 내 게이지와 도안 게이지로 보정 비율을 구합니다. (기획서 4.1) */
export function gaugeRatio(mine: Gauge, pattern: Gauge): GaugeRatio {
  assertPositive('mine.st', mine.st);
  assertPositive('mine.row', mine.row);
  assertPositive('pattern.st', pattern.st);
  assertPositive('pattern.row', pattern.row);
  return { kSt: mine.st / pattern.st, kRow: mine.row / pattern.row };
}

/** 콧수를 내 게이지 기준 너비(cm)로 바꿉니다. */
export function stitchesToCm(stitches: number, stGauge: number): number {
  assertPositive('stGauge', stGauge);
  return (stitches / stGauge) * 10;
}

/** 단수를 내 게이지 기준 길이(cm)로 바꿉니다. */
export function rowsToCm(rows: number, rowGauge: number): number {
  assertPositive('rowGauge', rowGauge);
  return (rows / rowGauge) * 10;
}

export { assertPositive };
