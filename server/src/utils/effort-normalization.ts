/**
 * Normalizes an array of positive numbers so they sum to exactly 100.
 *
 * This is used to convert raw effort estimates into effort percentages
 * that together account for 100% of the user's daily effort.
 *
 * Edge cases:
 * - Empty array → returns []
 * - Single value → returns [100]
 * - Zero values → treated as 0 effort; if ALL values are zero (or negative),
 *   effort is distributed equally among all items
 * - Negative values → clamped to 0 before normalization
 *
 * The result is rounded to two decimal places. A small rounding adjustment
 * is applied to the largest element so the array sums to exactly 100.
 */
export function normalizeEffort(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }

  if (values.length === 1) {
    return [100];
  }

  // Clamp negatives to 0
  const clamped = values.map((v) => Math.max(0, v));
  const total = clamped.reduce((sum, v) => sum + v, 0);

  let scaled: number[];

  if (total === 0) {
    // All values are zero (or were negative) — distribute equally
    const equal = Math.round((100 / values.length) * 100) / 100;
    scaled = values.map(() => equal);
  } else {
    // Scale proportionally and round to 2 decimal places
    scaled = clamped.map((v) => Math.round((v / total) * 100 * 100) / 100);
  }

  // Adjust the largest element so the total is exactly 100
  const roundedSum = scaled.reduce((sum, v) => sum + v, 0);
  const diff = Math.round((100 - roundedSum) * 100) / 100;

  if (diff !== 0) {
    // Find the index of the largest element to absorb the rounding error
    let maxIdx = 0;
    for (let i = 1; i < scaled.length; i++) {
      if (scaled[i] > scaled[maxIdx]) {
        maxIdx = i;
      }
    }
    scaled[maxIdx] = Math.round((scaled[maxIdx] + diff) * 100) / 100;
  }

  return scaled;
}
