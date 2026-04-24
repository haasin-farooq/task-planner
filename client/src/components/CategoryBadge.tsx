import { getCategoryColor } from "../utils/category-color";

export interface CategoryBadgeProps {
  categoryName: string;
}

/**
 * Renders a small rounded pill with a soft background tint derived
 * deterministically from the category name. Text color is chosen
 * for WCAG AA contrast against the background.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.5, 11.6
 */
export default function CategoryBadge({ categoryName }: CategoryBadgeProps) {
  const { bg, text } = getCategoryColor(categoryName);

  return (
    <span
      data-testid="category-badge"
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: bg, color: text }}
    >
      {categoryName}
    </span>
  );
}
