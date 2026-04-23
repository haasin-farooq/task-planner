export interface DifficultyRatingProps {
  level: number; // 1-5
}

/**
 * Pure component that renders 5 dots representing a difficulty level.
 *
 * Filled dots use warm orange/coral and unfilled dots use warm gray.
 * Each dot is an 8×8px circle rendered with Tailwind utility classes.
 *
 * Requirements: 5.6, 10.5
 */
export default function DifficultyRating({ level }: DifficultyRatingProps) {
  const clamped = Math.max(1, Math.min(5, Math.round(level)));

  return (
    <span
      className="inline-flex items-center gap-1"
      aria-label={`Difficulty: ${clamped} out of 5`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`inline-block h-2 w-2 rounded-full ${
            i < clamped ? "bg-accent" : "bg-dark-border"
          }`}
        />
      ))}
    </span>
  );
}
