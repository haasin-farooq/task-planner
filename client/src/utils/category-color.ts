/**
 * Deterministic category-to-color mapping utility.
 *
 * Maps category names to a fixed palette of soft, muted colors using
 * a djb2 hash. Every palette entry meets WCAG AA contrast (≥4.5:1)
 * between its text and background colors.
 */

/** Predefined palette of 12 soft, muted background/text color pairs. */
export const CATEGORY_PALETTE: { bg: string; text: string }[] = [
  { bg: "#DBEAFE", text: "#1E40AF" }, // blue
  { bg: "#D1FAE5", text: "#065F46" }, // green
  { bg: "#FEF3C7", text: "#92400E" }, // amber
  { bg: "#FCE7F3", text: "#9D174D" }, // pink
  { bg: "#E0E7FF", text: "#3730A3" }, // indigo
  { bg: "#CCFBF1", text: "#134E4A" }, // teal
  { bg: "#FEE2E2", text: "#991B1B" }, // red
  { bg: "#F3E8FF", text: "#6B21A8" }, // purple
  { bg: "#FEF9C3", text: "#854D0E" }, // yellow
  { bg: "#E2E8F0", text: "#334155" }, // slate
  { bg: "#FFE4E6", text: "#9F1239" }, // rose
  { bg: "#CFFAFE", text: "#155E75" }, // cyan
];

/**
 * Simple string hash (djb2 variant).
 *
 * Produces a numeric hash from a string by iterating over each character:
 *   hash = ((hash << 5) + hash) + charCode   (i.e. hash * 33 + charCode)
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
  }
  return hash;
}

/**
 * Deterministic hash-based color mapping.
 * Same category name always returns the same palette entry.
 */
export function getCategoryColor(name: string): { bg: string; text: string } {
  const index = Math.abs(hashString(name)) % CATEGORY_PALETTE.length;
  return CATEGORY_PALETTE[index];
}
