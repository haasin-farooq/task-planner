/**
 * Converts a duration in minutes to a human-readable string.
 *
 * - Values < 60 → "{N} min" (e.g., "45 min")
 * - Values ≥ 60 with no remainder → "{H}h" (e.g., "2h")
 * - Values ≥ 60 with remainder → "{H}h {M}m" (e.g., "1h 30m")
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (remainder === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainder}m`;
}
