/**
 * Represents a single arc segment in the SVG progress ring.
 */
export interface ProgressSegment {
  label: string;
  count: number;
  color: string;
  dashLength: number;
  dashOffset: number;
}

/**
 * Computes SVG arc segments for the progress ring donut chart.
 *
 * Segments are laid out sequentially around the ring:
 * 1. Done (green) — completed tasks
 * 2. In Progress (orange) — in-progress tasks
 * 3. Planned (purple) — remaining planned tasks (total - completed - inProgress)
 * 4. Remaining (dark/muted) — only when total is 0 (full ring as placeholder)
 *
 * Each segment's dashLength = (count / total) * circumference.
 * The dashOffset for each segment positions it after the previous segments.
 * The sum of all dashLength values equals the full circumference.
 */
export function getProgressSegments(
  total: number,
  completed: number,
  inProgress: number,
  circumference: number,
): ProgressSegment[] {
  if (total <= 0) {
    return [
      {
        label: "Remaining",
        count: 0,
        color: "#3a3a5a",
        dashLength: circumference,
        dashOffset: 0,
      },
    ];
  }

  const planned = total - completed - inProgress;

  const segments: ProgressSegment[] = [
    { label: "Done", count: completed, color: "#22c55e" },
    { label: "In Progress", count: inProgress, color: "#f97316" },
    { label: "Planned", count: planned, color: "#7c3aed" },
  ] as ProgressSegment[];

  let offset = 0;

  for (const segment of segments) {
    segment.dashLength = (segment.count / total) * circumference;
    segment.dashOffset = -offset;
    offset += segment.dashLength;
  }

  return segments;
}
