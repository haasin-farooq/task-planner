/**
 * Property-based tests for the category color utility.
 *
 * Property 7: Deterministic Color Mapping
 * Property 8: WCAG AA Contrast for Category Palette
 *
 * Feature: dynamic-ai-categories
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { getCategoryColor, CATEGORY_PALETTE } from "../category-color.js";

// ---------------------------------------------------------------------------
// WCAG contrast helpers
// ---------------------------------------------------------------------------

/**
 * Parse a hex color string (#RRGGBB) into [R, G, B] in 0–255 range.
 */
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/**
 * Linearize an sRGB channel value (0–255) to a linear-light value (0–1).
 * Per WCAG 2.x relative luminance spec.
 */
function linearize(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * Compute relative luminance of a color per WCAG 2.x.
 * L = 0.2126 * R + 0.7152 * G + 0.0722 * B
 */
function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Compute WCAG contrast ratio between two colors.
 * Ratio = (L_lighter + 0.05) / (L_darker + 0.05)
 */
function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Property 7: Deterministic Color Mapping
// ---------------------------------------------------------------------------

describe("Property 7: Deterministic Color Mapping", () => {
  /**
   * **Validates: Requirements 11.3, 12.1, 12.2**
   *
   * For any category name string, calling getCategoryColor(name) multiple
   * times always returns the same { bg, text } pair, and the returned pair
   * is a member of the predefined CATEGORY_PALETTE array.
   */
  it("same input always returns the same output and output is in CATEGORY_PALETTE", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (name) => {
        const result1 = getCategoryColor(name);
        const result2 = getCategoryColor(name);

        // Determinism: same input → same output
        expect(result1.bg).toBe(result2.bg);
        expect(result1.text).toBe(result2.text);

        // Membership: result is a member of CATEGORY_PALETTE
        const match = CATEGORY_PALETTE.some(
          (entry) => entry.bg === result1.bg && entry.text === result1.text,
        );
        expect(match).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("palette has at least 10 entries", () => {
    expect(CATEGORY_PALETTE.length).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Property 8: WCAG AA Contrast for Category Palette
// ---------------------------------------------------------------------------

describe("Property 8: WCAG AA Contrast for Category Palette", () => {
  /**
   * **Validates: Requirements 11.6**
   *
   * Every CATEGORY_PALETTE entry has a contrast ratio ≥ 4.5:1 between
   * its text and bg colors (WCAG AA for normal text).
   */
  it("every palette entry meets WCAG AA contrast ratio ≥ 4.5:1", () => {
    for (const entry of CATEGORY_PALETTE) {
      const ratio = contrastRatio(entry.text, entry.bg);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
});
