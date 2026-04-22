import { getPriorityConfig } from "../utils/priority-config";

export interface PriorityBadgeProps {
  priority: number; // 1-5
}

/**
 * Pure component that renders a priority badge with an icon and label.
 *
 * Maps priority 4–5 → "High" (red), 3 → "Medium" (yellow), 1–2 → "Low" (green).
 * Uses getPriorityConfig for label, color class, and icon.
 *
 * Requirements: 5.4
 */
export default function PriorityBadge({ priority }: PriorityBadgeProps) {
  const { label, colorClass, icon } = getPriorityConfig(priority);

  return (
    <span
      className={`inline-flex items-center gap-1 text-sm font-medium ${colorClass}`}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </span>
  );
}
