import { useState, useEffect, useCallback, useRef } from "react";

const TIMER_STORAGE_KEY = "taskplanner_timer";

export interface TimerState {
  taskId: string;
  status: "running" | "paused";
  startedAt: number;
  accumulatedMs: number;
}

export interface UseTaskTimerReturn {
  /** Current timer state, or null if no timer is active */
  timerState: TimerState | null;
  /** Current elapsed time in milliseconds (updates every second when running) */
  elapsedMs: number;
  /** Start a timer for a task. Auto-pauses any currently running timer. */
  startTimer: (taskId: string) => void;
  /** Pause the current timer */
  pauseTimer: () => void;
  /** Resume the current paused timer */
  resumeTimer: () => void;
  /** Stop and clear the timer, returning the final elapsed minutes */
  stopTimer: () => number;
  /** Check if a specific task has the active timer */
  isTimerActiveForTask: (taskId: string) => boolean;
  /** Get the timer status for a specific task */
  getTaskTimerStatus: (taskId: string) => "running" | "paused" | "none";
}

function loadTimerState(): TimerState | null {
  try {
    const raw = localStorage.getItem(TIMER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TimerState;
  } catch {
    return null;
  }
}

function saveTimerState(state: TimerState | null): void {
  if (state) {
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(state));
  } else {
    localStorage.removeItem(TIMER_STORAGE_KEY);
  }
}

function computeElapsed(state: TimerState | null): number {
  if (!state) return 0;
  if (state.status === "paused") return state.accumulatedMs;
  return state.accumulatedMs + (Date.now() - state.startedAt);
}

export function useTaskTimer(): UseTaskTimerReturn {
  const [timerState, setTimerState] = useState<TimerState | null>(
    loadTimerState,
  );
  const [elapsedMs, setElapsedMs] = useState(() =>
    computeElapsed(loadTimerState()),
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update elapsed time every second when running
  useEffect(() => {
    if (timerState?.status === "running") {
      const tick = () => setElapsedMs(computeElapsed(timerState));
      tick(); // immediate update
      intervalRef.current = setInterval(tick, 1000);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    } else {
      setElapsedMs(computeElapsed(timerState));
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [timerState]);

  const startTimer = useCallback((taskId: string) => {
    const newState: TimerState = {
      taskId,
      status: "running",
      startedAt: Date.now(),
      accumulatedMs: 0,
    };
    saveTimerState(newState);
    setTimerState(newState);
  }, []);

  const pauseTimer = useCallback(() => {
    const current = loadTimerState();
    if (!current || current.status !== "running") return;

    const paused: TimerState = {
      ...current,
      status: "paused",
      accumulatedMs: current.accumulatedMs + (Date.now() - current.startedAt),
    };
    saveTimerState(paused);
    setTimerState(paused);
  }, []);

  const resumeTimer = useCallback(() => {
    const current = loadTimerState();
    if (!current || current.status !== "paused") return;

    const resumed: TimerState = {
      ...current,
      status: "running",
      startedAt: Date.now(),
    };
    saveTimerState(resumed);
    setTimerState(resumed);
  }, []);

  const stopTimer = useCallback((): number => {
    const current = loadTimerState();
    if (!current) return 0;

    const finalMs = computeElapsed(current);
    const finalMinutes = Math.max(1, Math.round(finalMs / 60000));

    saveTimerState(null);
    setTimerState(null);
    setElapsedMs(0);

    return finalMinutes;
  }, []);

  const isTimerActiveForTask = useCallback(
    (taskId: string): boolean => {
      return timerState?.taskId === taskId;
    },
    [timerState],
  );

  const getTaskTimerStatus = useCallback(
    (taskId: string): "running" | "paused" | "none" => {
      if (!timerState || timerState.taskId !== taskId) return "none";
      return timerState.status;
    },
    [timerState],
  );

  return {
    timerState,
    elapsedMs,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    isTimerActiveForTask,
    getTaskTimerStatus,
  };
}
