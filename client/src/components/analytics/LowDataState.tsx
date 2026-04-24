export interface LowDataStateProps {
  current: number;
  required: number;
  unit: string; // "tasks", "weeks", "days"
  sectionName: string;
}

/**
 * A warm editorial-styled low-data state component that shows users how close
 * they are to unlocking a dashboard section. Renders a progress indicator and
 * contextual guidance message.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */
export default function LowDataState({
  current,
  required,
  unit,
  sectionName,
}: LowDataStateProps) {
  const remaining = Math.max(0, required - current);
  const progressPercent =
    required > 0 ? Math.min(100, Math.round((current / required) * 100)) : 0;
  const isZeroData = current === 0;

  return (
    <div
      className="rounded-lg border border-dark-border p-8 bg-dark-surface"
      role="status"
      aria-label={`${sectionName} requires more data`}
    >
      {isZeroData ? (
        /* Zero-data welcome state */
        <div className="text-center">
          {/* Decorative icon */}
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                stroke="#E8734A"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <h3 className="font-serif text-lg font-semibold text-text-primary">
            Welcome to {sectionName}
          </h3>
          <p className="mt-2 text-sm text-text-secondary">
            Start completing tasks to unlock insights here. You need at least{" "}
            {required} {unit} of data to see {sectionName.toLowerCase()}.
          </p>
        </div>
      ) : (
        /* Partial progress state */
        <div>
          <h3 className="font-serif text-base font-semibold text-text-primary">
            Almost there
          </h3>

          <p className="mt-1 text-sm text-text-secondary">
            <span className="font-medium text-text-primary">
              {current} of {required} {unit}
            </span>{" "}
            — {remaining} more to unlock {sectionName.toLowerCase()}
          </p>

          {/* Progress bar */}
          <div className="mt-3">
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-dark-border"
              role="progressbar"
              aria-valuenow={current}
              aria-valuemin={0}
              aria-valuemax={required}
              aria-label={`${current} of ${required} ${unit} completed`}
            >
              <div
                className="h-full rounded-full transition-all duration-300 bg-accent"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
