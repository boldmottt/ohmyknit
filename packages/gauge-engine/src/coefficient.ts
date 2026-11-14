import { assertPositive } from './gauge.js';

/** 완성 실측 가중치 기본값 (기획서 4.4: 스와치보다 완성 실측을 더 신뢰) */
export const FINISHED_WEIGHT = 2;

/**
 * 완성 실측에서 실제 보정 계수를 역산합니다.
 *
 * k_actual = (변환 후 예상 치수 / 실제 완성 치수) × k_used
 * 예: k_used 1.136, 예상 96cm, 실제 92cm → 1.186 (더 쫀쫀함)
 */
export function kFromFinished(expectedCm: number, actualCm: number, kUsed: number): number {
  assertPositive('expectedCm', expectedCm);
  assertPositive('actualCm', actualCm);
  assertPositive('kUsed', kUsed);
  return (expectedCm / actualCm) * kUsed;
}

export type Coefficient = {
  k: number;
  /** 지금까지 반영된 가중치 합 (스와치 1개 = 1, 완성 실측 1개 = w) */
  sampleCount: number;
};

/** k_new = (k_old × n + k_sample × w) / (n + w) */
export function updateCoefficient(
  current: Coefficient | undefined,
  kSample: number,
  weight = 1,
): Coefficient {
  assertPositive('kSample', kSample);
  assertPositive('weight', weight);
  if (!current || current.sampleCount <= 0) return { k: kSample, sampleCount: weight };
  const n = current.sampleCount;
  return {
    k: (current.k * n + kSample * weight) / (n + weight),
    sampleCount: n + weight,
  };
}
