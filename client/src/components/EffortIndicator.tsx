export interface EffortIndicatorProps {
  effortPercentage: number; // 0-100
}

const SIZE = 28;
const STROKE_WIDTH = 3;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Pure component that renders a small SVG ring showing effort percentage
 * with a numeric label beside it.
 *
 * The filled arc length equals (effortPercentage / 100) * circumference.
 * Uses warm orange/coral for the filled arc and warm gray for the background track.
 *
 * Requirements: 5.5, 10.6
 */
export default function EffortIndicator({
  effortPercentage,
}: EffortIndicatorProps) {
  const clamped = Math.max(0, Math.min(100, effortPercentage));
  const dashLength = (clamped / 100) * CIRCUMFERENCE;
  const dashOffset = CIRCUMFERENCE - dashLength;

  return (
    <span
      className="inline-flex items-center gap-1.5"
      aria-label={`Effort: ${Math.round(clamped)}%`}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="shrink-0 -rotate-90"
      >
        {/* Background track */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          className="text-dark-border"
        />
        {/* Filled arc */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className="text-accent"
        />
      </svg>
      <span className="text-sm text-[#6B6B6B]">{Math.round(clamped)}%</span>
    </span>
  );
}
