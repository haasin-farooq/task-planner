import type { TaskMetrics } from "../types/index.js";

/**
 * Validates that all fields of a TaskMetrics object are within their allowed ranges.
 *
 * - priority: integer in [1, 5]
 * - difficultyLevel: integer in [1, 5]
 * - estimatedTime: positive number (> 0)
 *
 * effortPercentage and dependsOn are not checked here — effort normalization
 * and dependency validation are handled by dedicated utilities.
 */
export function validateTaskMetrics(metrics: TaskMetrics): boolean {
  const { priority, difficultyLevel, estimatedTime } = metrics;

  if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
    return false;
  }

  if (
    !Number.isInteger(difficultyLevel) ||
    difficultyLevel < 1 ||
    difficultyLevel > 5
  ) {
    return false;
  }

  if (typeof estimatedTime !== "number" || estimatedTime <= 0) {
    return false;
  }

  return true;
}

/**
 * Clamps metric values into their valid ranges so downstream code can
 * safely consume them.
 *
 * - priority → clamped to [1, 5] and rounded to nearest integer
 * - difficultyLevel → clamped to [1, 5] and rounded to nearest integer
 * - estimatedTime → clamped to a minimum of 1 (must be positive)
 * - effortPercentage → clamped to [0, 100]
 * - dependsOn → passed through unchanged
 */
export function clampMetrics(metrics: TaskMetrics): TaskMetrics {
  return {
    priority: clampInt(metrics.priority, 1, 5),
    difficultyLevel: clampInt(metrics.difficultyLevel, 1, 5),
    estimatedTime: Math.max(1, Math.round(metrics.estimatedTime)),
    effortPercentage: clamp(metrics.effortPercentage, 0, 100),
    dependsOn: [...metrics.dependsOn],
  };
}

/** Clamp a number to [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Clamp a number to [min, max] and round to the nearest integer. */
function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}
