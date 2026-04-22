/**
 * Configuration for displaying task priority as a visual badge.
 */
export interface PriorityConfig {
  label: "High" | "Medium" | "Low";
  colorClass: string;
  icon: string;
}

/**
 * Maps a numeric priority value (1–5) to display configuration
 * for the PriorityBadge component.
 *
 * - 4–5 → High (red/orange)
 * - 3   → Medium (yellow)
 * - 1–2 → Low (green/blue)
 */
export function getPriorityConfig(priority: number): PriorityConfig {
  if (priority >= 4) {
    return {
      label: "High",
      colorClass: "text-red-400",
      icon: "↑",
    };
  }

  if (priority === 3) {
    return {
      label: "Medium",
      colorClass: "text-yellow-400",
      icon: "→",
    };
  }

  return {
    label: "Low",
    colorClass: "text-green-400",
    icon: "↓",
  };
}
