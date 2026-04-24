export interface TaskTimerControlsProps {
  taskId: string;
  timerStatus: "running" | "paused" | "none";
  elapsedMs: number;
  isCompleted: boolean;
  onStart: (taskId: string) => void;
  onPause: () => void;
  onResume: () => void;
  onComplete: (taskId: string) => void;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function TaskTimerControls({
  taskId,
  timerStatus,
  elapsedMs,
  isCompleted,
  onStart,
  onPause,
  onResume,
  onComplete,
}: TaskTimerControlsProps) {
  if (isCompleted) return null;

  return (
    <div className="flex items-center gap-2 mt-2 pl-9">
      {timerStatus === "none" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStart(taskId);
          }}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
          aria-label="Start timer"
        >
          <PlayIcon />
          Start
        </button>
      )}

      {timerStatus === "running" && (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-600 dark:text-green-400 tabular-nums">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            {formatElapsed(elapsedMs)}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPause();
            }}
            className="inline-flex items-center gap-1 rounded-full bg-dark-surface px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-dark-hover transition-colors border border-dark-border"
            aria-label="Pause timer"
          >
            <PauseIcon />
            Pause
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onComplete(taskId);
            }}
            className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-dark transition-colors"
            aria-label="Complete task"
          >
            <CheckIcon />
            Done
          </button>
        </>
      )}

      {timerStatus === "paused" && (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
            <PauseIcon />
            {formatElapsed(elapsedMs)}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onResume();
            }}
            className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
            aria-label="Resume timer"
          >
            <PlayIcon />
            Resume
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onComplete(taskId);
            }}
            className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-dark transition-colors"
            aria-label="Complete task"
          >
            <CheckIcon />
            Done
          </button>
        </>
      )}
    </div>
  );
}

// --- SVG Icons ---

function PlayIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
