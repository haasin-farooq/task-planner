import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CategoryBadge from "../CategoryBadge";
import { getCategoryColor, CATEGORY_PALETTE } from "../../utils/category-color";

describe("CategoryBadge", () => {
  // --- Renders category name text (Req 11.1) ---

  it("renders the category name as text content", () => {
    render(<CategoryBadge categoryName="Development" />);

    expect(screen.getByTestId("category-badge")).toHaveTextContent(
      "Development",
    );
  });

  it("renders a different category name correctly", () => {
    render(<CategoryBadge categoryName="Health" />);

    expect(screen.getByTestId("category-badge")).toHaveTextContent("Health");
  });

  // --- Correct colors applied (Req 11.2, 11.3) ---

  it("applies the correct background color from getCategoryColor", () => {
    const categoryName = "Development";
    const { bg, text } = getCategoryColor(categoryName);

    render(<CategoryBadge categoryName={categoryName} />);

    const badge = screen.getByTestId("category-badge");
    expect(badge).toHaveStyle({ backgroundColor: bg, color: text });
  });

  it("applies the correct text color from getCategoryColor", () => {
    const categoryName = "Interview Prep";
    const { bg, text } = getCategoryColor(categoryName);

    render(<CategoryBadge categoryName={categoryName} />);

    const badge = screen.getByTestId("category-badge");
    expect(badge).toHaveStyle({ backgroundColor: bg, color: text });
  });

  // --- Renders as a small rounded pill (Req 11.2) ---

  it("has rounded-full class for pill shape", () => {
    render(<CategoryBadge categoryName="Design" />);

    const badge = screen.getByTestId("category-badge");
    expect(badge.className).toContain("rounded-full");
  });

  it("has text-xs class for small size", () => {
    render(<CategoryBadge categoryName="Design" />);

    const badge = screen.getByTestId("category-badge");
    expect(badge.className).toContain("text-xs");
  });

  it("has font-medium class", () => {
    render(<CategoryBadge categoryName="Design" />);

    const badge = screen.getByTestId("category-badge");
    expect(badge.className).toContain("font-medium");
  });

  it("renders as a span element", () => {
    render(<CategoryBadge categoryName="Research" />);

    const badge = screen.getByTestId("category-badge");
    expect(badge.tagName).toBe("SPAN");
  });

  // --- Different categories get different colors (Req 11.3) ---

  it("maps at least two different category names to different colors", () => {
    // Pick names that are known to hash to different palette indices
    const names = [
      "Development",
      "Health",
      "Design",
      "Research",
      "Planning",
      "Writing",
    ];
    const colors = names.map((n) => getCategoryColor(n));
    const uniqueBgs = new Set(colors.map((c) => c.bg));

    // With 6 names and 12 palette entries, we expect at least 2 distinct colors
    expect(uniqueBgs.size).toBeGreaterThanOrEqual(2);
  });

  it("same category name always gets the same color", () => {
    const { bg: bg1, text: text1 } = getCategoryColor("Job Search");
    const { bg: bg2, text: text2 } = getCategoryColor("Job Search");

    expect(bg1).toBe(bg2);
    expect(text1).toBe(text2);
  });

  // --- Color is from the palette ---

  it("applies a color that belongs to the CATEGORY_PALETTE", () => {
    const categoryName = "Client Work";
    const { bg, text } = getCategoryColor(categoryName);

    const match = CATEGORY_PALETTE.find(
      (entry) => entry.bg === bg && entry.text === text,
    );
    expect(match).toBeDefined();
  });
});
