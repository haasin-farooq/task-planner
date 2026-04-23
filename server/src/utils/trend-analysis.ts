/**
 * Trend analysis utilities for the analytics dashboard.
 *
 * Pure functions for computing linear regression slopes, classifying
 * trends, and measuring estimation accuracy. No external dependencies.
 */

/**
 * Compute the slope of a simple linear regression on (index, value) pairs.
 *
 * Uses the ordinary least squares formula:
 *   slope = (n * Σ(x*y) - Σx * Σy) / (n * Σ(x²) - (Σx)²)
 *
 * where x = 0, 1, 2, … (array indices) and y = values[x].
 *
 * Returns 0 for arrays with fewer than 2 elements (no meaningful slope).
 */
export function linearRegressionSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) {
    return 0;
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) {
    return 0;
  }

  return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * Classify a slope as "Improving", "Stable", or "Declining".
 *
 * A positive slope above the threshold indicates improvement (values trending up).
 * A negative slope below the negative threshold indicates decline.
 * Anything in between is considered stable.
 *
 * @param slope - The linear regression slope to classify.
 * @param threshold - The minimum absolute slope to be considered non-stable. Defaults to 0.01.
 */
export function classifyTrend(
  slope: number,
  threshold: number = 0.01,
): "Improving" | "Stable" | "Declining" {
  if (slope > threshold) {
    return "Improving";
  }
  if (slope < -threshold) {
    return "Declining";
  }
  return "Stable";
}

/**
 * Compute per-task estimation accuracy.
 *
 * Formula: 1 - |actual - estimated| / estimated, clamped to [0, 1].
 * Returns 0 when estimated is 0 (division by zero guard).
 *
 * @param estimated - The estimated time for the task.
 * @param actual - The actual time the task took.
 */
export function estimationAccuracy(estimated: number, actual: number): number {
  if (estimated === 0) {
    return 0;
  }

  const accuracy = 1 - Math.abs(actual - estimated) / estimated;
  return Math.max(0, Math.min(1, accuracy));
}
