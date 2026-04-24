/**
 * Property 17: Consolidation Suggestion Structural Validity
 *
 * For any ConsolidationSuggestion returned by the CategoryConsolidator:
 * - if action = 'merge', then sourceCategoryId, sourceCategoryName,
 *   targetCategoryId, and targetCategoryName SHALL all be defined
 * - if action = 'rename', then categoryId, currentName, and proposedName
 *   SHALL all be defined
 * - if action = 'split', then categoryId, currentName, and proposedNames
 *   (with length ≥ 2) SHALL all be defined
 *
 * Test file: server/src/services/__tests__/category-consolidator.property.test.ts
 *
 * **Validates: Requirements 7.2, 7.3, 7.4, 7.5**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { CategoryConsolidator } from "../category-consolidator.js";
import type { ConsolidationSuggestion } from "../category-consolidator.js";
import type { CategoryEntity } from "../../db/category-repository.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a CategoryEntity from an id and name.
 */
function makeCategory(id: number, name: string): CategoryEntity {
  return {
    id,
    name,
    userId: "user-1",
    status: "active",
    createdBy: "llm",
    mergedIntoCategoryId: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

/**
 * Creates a mock OpenAI client that returns the given content string
 * from `chat.completions.create`.
 */
function createMockClient(content: string) {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content } }],
  });
  return { chat: { completions: { create } } } as any;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Arbitrary for a valid category name — alphabetic words, title-cased,
 * 1-3 words. These are realistic category names.
 */
const wordArb = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), {
    minLength: 2,
    maxLength: 10,
  })
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1));

const categoryNameArb = fc
  .array(wordArb, { minLength: 1, maxLength: 3 })
  .map((words) => words.join(" "));

/**
 * Arbitrary for a unique list of category entities (2-10 entries).
 * We need at least 2 categories since the consolidator returns [] for ≤1.
 */
const categoryListArb = fc
  .uniqueArray(categoryNameArb, {
    minLength: 2,
    maxLength: 10,
    comparator: (a, b) => a.toLowerCase() === b.toLowerCase(),
  })
  .map((names) => names.map((name, i) => makeCategory(i + 1, name)));

/**
 * Arbitrary for a reason string.
 */
const reasonArb = fc
  .stringOf(fc.char(), { minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

/**
 * Given a list of categories, generate a random valid merge suggestion
 * (raw LLM format) that references two distinct categories from the list.
 */
function mergeSuggestionArb(categories: CategoryEntity[]) {
  return fc
    .record({
      sourceIdx: fc.integer({ min: 0, max: categories.length - 1 }),
      targetIdx: fc.integer({ min: 0, max: categories.length - 1 }),
      reason: reasonArb,
    })
    .filter((r) => r.sourceIdx !== r.targetIdx)
    .map((r) => ({
      action: "merge" as const,
      sourceCategoryName: categories[r.sourceIdx].name,
      targetCategoryName: categories[r.targetIdx].name,
      reason: r.reason,
    }));
}

/**
 * Given a list of categories, generate a random valid rename suggestion
 * (raw LLM format) that references a category from the list.
 */
function renameSuggestionArb(categories: CategoryEntity[]) {
  return fc
    .record({
      idx: fc.integer({ min: 0, max: categories.length - 1 }),
      proposedName: categoryNameArb,
      reason: reasonArb,
    })
    .map((r) => ({
      action: "rename" as const,
      currentName: categories[r.idx].name,
      proposedName: r.proposedName,
      reason: r.reason,
    }));
}

/**
 * Given a list of categories, generate a random valid split suggestion
 * (raw LLM format) that references a category from the list and proposes
 * 2-5 new names.
 */
function splitSuggestionArb(categories: CategoryEntity[]) {
  return fc
    .record({
      idx: fc.integer({ min: 0, max: categories.length - 1 }),
      proposedNames: fc.array(categoryNameArb, { minLength: 2, maxLength: 5 }),
      reason: reasonArb,
    })
    .map((r) => ({
      action: "split" as const,
      currentName: categories[r.idx].name,
      proposedNames: r.proposedNames,
      reason: r.reason,
    }));
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 17: Consolidation Suggestion Structural Validity", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Merge suggestions have all required structural fields
  // -----------------------------------------------------------------------

  it("merge suggestions have sourceCategoryId, sourceCategoryName, targetCategoryId, and targetCategoryName defined", async () => {
    await fc.assert(
      fc.asyncProperty(categoryListArb, async (categories) => {
        // Generate a random merge suggestion referencing categories in the list
        const suggestion = await fc.sample(
          mergeSuggestionArb(categories),
          1,
        )[0];

        const llmResponse = JSON.stringify([suggestion]);
        const client = createMockClient(llmResponse);
        const consolidator = new CategoryConsolidator(client);
        const results = await consolidator.analyze(categories);

        expect(results.length).toBe(1);
        const result = results[0];

        // **Validates: Requirements 7.2, 7.3**
        expect(result.action).toBe("merge");
        expect(result.sourceCategoryId).toBeDefined();
        expect(typeof result.sourceCategoryId).toBe("number");
        expect(result.sourceCategoryName).toBeDefined();
        expect(typeof result.sourceCategoryName).toBe("string");
        expect(result.targetCategoryId).toBeDefined();
        expect(typeof result.targetCategoryId).toBe("number");
        expect(result.targetCategoryName).toBeDefined();
        expect(typeof result.targetCategoryName).toBe("string");
        expect(typeof result.id).toBe("string");
        expect(result.id.length).toBeGreaterThan(0);
        expect(typeof result.reason).toBe("string");
      }),
      { numRuns: 100 },
    );
  });

  // -----------------------------------------------------------------------
  // Rename suggestions have all required structural fields
  // -----------------------------------------------------------------------

  it("rename suggestions have categoryId, currentName, and proposedName defined", async () => {
    await fc.assert(
      fc.asyncProperty(categoryListArb, async (categories) => {
        const suggestion = await fc.sample(
          renameSuggestionArb(categories),
          1,
        )[0];

        const llmResponse = JSON.stringify([suggestion]);
        const client = createMockClient(llmResponse);
        const consolidator = new CategoryConsolidator(client);
        const results = await consolidator.analyze(categories);

        expect(results.length).toBe(1);
        const result = results[0];

        // **Validates: Requirements 7.2, 7.4**
        expect(result.action).toBe("rename");
        expect(result.categoryId).toBeDefined();
        expect(typeof result.categoryId).toBe("number");
        expect(result.currentName).toBeDefined();
        expect(typeof result.currentName).toBe("string");
        expect(result.proposedName).toBeDefined();
        expect(typeof result.proposedName).toBe("string");
        expect(typeof result.id).toBe("string");
        expect(result.id.length).toBeGreaterThan(0);
        expect(typeof result.reason).toBe("string");
      }),
      { numRuns: 100 },
    );
  });

  // -----------------------------------------------------------------------
  // Split suggestions have all required structural fields
  // -----------------------------------------------------------------------

  it("split suggestions have categoryId, currentName, and proposedNames (length ≥ 2) defined", async () => {
    await fc.assert(
      fc.asyncProperty(categoryListArb, async (categories) => {
        const suggestion = await fc.sample(
          splitSuggestionArb(categories),
          1,
        )[0];

        const llmResponse = JSON.stringify([suggestion]);
        const client = createMockClient(llmResponse);
        const consolidator = new CategoryConsolidator(client);
        const results = await consolidator.analyze(categories);

        expect(results.length).toBe(1);
        const result = results[0];

        // **Validates: Requirements 7.2, 7.5**
        expect(result.action).toBe("split");
        expect(result.categoryId).toBeDefined();
        expect(typeof result.categoryId).toBe("number");
        expect(result.currentName).toBeDefined();
        expect(typeof result.currentName).toBe("string");
        expect(result.proposedNames).toBeDefined();
        expect(Array.isArray(result.proposedNames)).toBe(true);
        expect(result.proposedNames!.length).toBeGreaterThanOrEqual(2);
        for (const name of result.proposedNames!) {
          expect(typeof name).toBe("string");
        }
        expect(typeof result.id).toBe("string");
        expect(result.id.length).toBeGreaterThan(0);
        expect(typeof result.reason).toBe("string");
      }),
      { numRuns: 100 },
    );
  });

  // -----------------------------------------------------------------------
  // Mixed suggestions all satisfy their respective structural constraints
  // -----------------------------------------------------------------------

  it("mixed suggestions (merge, rename, split) all satisfy their respective structural constraints", async () => {
    await fc.assert(
      fc.asyncProperty(categoryListArb, async (categories) => {
        // Generate one of each type
        const merge = fc.sample(mergeSuggestionArb(categories), 1)[0];
        const rename = fc.sample(renameSuggestionArb(categories), 1)[0];
        const split = fc.sample(splitSuggestionArb(categories), 1)[0];

        const llmResponse = JSON.stringify([merge, rename, split]);
        const client = createMockClient(llmResponse);
        const consolidator = new CategoryConsolidator(client);
        const results = await consolidator.analyze(categories);

        expect(results.length).toBe(3);

        for (const result of results) {
          // Every suggestion must have an id and reason
          expect(typeof result.id).toBe("string");
          expect(result.id.length).toBeGreaterThan(0);
          expect(typeof result.reason).toBe("string");

          if (result.action === "merge") {
            // **Validates: Requirements 7.3**
            expect(result.sourceCategoryId).toBeDefined();
            expect(result.sourceCategoryName).toBeDefined();
            expect(result.targetCategoryId).toBeDefined();
            expect(result.targetCategoryName).toBeDefined();
          } else if (result.action === "rename") {
            // **Validates: Requirements 7.4**
            expect(result.categoryId).toBeDefined();
            expect(result.currentName).toBeDefined();
            expect(result.proposedName).toBeDefined();
          } else if (result.action === "split") {
            // **Validates: Requirements 7.5**
            expect(result.categoryId).toBeDefined();
            expect(result.currentName).toBeDefined();
            expect(result.proposedNames).toBeDefined();
            expect(result.proposedNames!.length).toBeGreaterThanOrEqual(2);
          } else {
            // Should never reach here — unknown action type
            expect.unreachable(
              `Unexpected action type: ${(result as any).action}`,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
