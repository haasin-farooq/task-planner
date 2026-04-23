/**
 * Property 2: Prompt construction includes description and all categories
 *
 * For any task description and for any list of existing category names, the
 * prompt sent to the LLM SHALL contain the task description and every category
 * name from the list. Additionally, for any category list with more than 30
 * entries, the prompt SHALL contain an additional instruction emphasizing
 * category reuse.
 *
 * Feature: ai-category-assignment, Property 2: Prompt construction includes description and all categories
 *
 * Validates: Requirements 2.1, 11.2, 11.3
 */

import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { AICategoryAssigner } from "../ai-category-assigner.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock OpenAI client that captures the messages sent to
 * `chat.completions.create` and returns a valid category response so the
 * assigner does not fall back or retry.
 */
function createCapturingMockClient(categoryToReturn: string) {
  const capturedCalls: Array<{
    messages: Array<{ role: string; content: string }>;
  }> = [];

  const create = vi.fn().mockImplementation(async (params: any) => {
    capturedCalls.push({ messages: params.messages });
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({
              category: categoryToReturn,
              isExisting: true,
            }),
          },
        },
      ],
    };
  });

  return {
    client: { chat: { completions: { create } } } as any,
    capturedCalls,
    create,
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Arbitrary for a non-empty task description string.
 * We use printable ASCII to avoid edge cases with control characters that
 * wouldn't appear in real task descriptions.
 */
const taskDescriptionArb = fc
  .stringOf(fc.char(), { minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

/**
 * Arbitrary for a single category name — non-empty, printable, trimmed.
 */
const categoryNameArb = fc
  .stringOf(
    fc
      .char16bits()
      .filter((c) => c.trim().length > 0 && c !== "\n" && c !== "\r"),
    { minLength: 1, maxLength: 40 },
  )
  .filter((s) => s.trim().length > 0)
  .map((s) => s.trim());

/**
 * Arbitrary for a list of category names with ≤ 30 entries.
 */
const smallCategoryListArb = fc.array(categoryNameArb, {
  minLength: 0,
  maxLength: 30,
});

/**
 * Arbitrary for a list of category names with > 30 entries (31–50).
 */
const largeCategoryListArb = fc.array(categoryNameArb, {
  minLength: 31,
  maxLength: 50,
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 2: Prompt construction includes description and all categories", () => {
  it("the prompt contains the task description and every category name", async () => {
    await fc.assert(
      fc.asyncProperty(
        taskDescriptionArb,
        smallCategoryListArb,
        async (description, categories) => {
          const { client, capturedCalls } = createCapturingMockClient(
            categories.length > 0 ? categories[0] : "Other",
          );

          const assigner = new AICategoryAssigner(client);
          await assigner.assign(description, categories);

          // The first call is the non-strict attempt — it uses a system message
          expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
          const firstCall = capturedCalls[0];

          // Collect all message content into a single string for searching
          const allContent = firstCall.messages
            .map((m) => m.content)
            .join("\n");

          // The prompt must contain the task description
          expect(allContent).toContain(description);

          // The prompt must contain every category name from the list
          for (const cat of categories) {
            expect(allContent).toContain(cat);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("when categories > 30, the prompt contains additional reuse emphasis", async () => {
    await fc.assert(
      fc.asyncProperty(
        taskDescriptionArb,
        largeCategoryListArb,
        async (description, categories) => {
          const { client, capturedCalls } = createCapturingMockClient(
            categories[0],
          );

          const assigner = new AICategoryAssigner(client);
          await assigner.assign(description, categories);

          expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
          const firstCall = capturedCalls[0];

          const allContent = firstCall.messages
            .map((m) => m.content)
            .join("\n");

          // The prompt must contain the task description
          expect(allContent).toContain(description);

          // The prompt must contain every category name
          for (const cat of categories) {
            expect(allContent).toContain(cat);
          }

          // With > 30 categories, the prompt must contain the reuse emphasis
          // The implementation adds "IMPORTANT:" and mentions the category count
          expect(allContent).toContain("IMPORTANT");
          expect(allContent).toContain(String(categories.length));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("when categories ≤ 30, the prompt does NOT contain the >30 reuse emphasis", async () => {
    await fc.assert(
      fc.asyncProperty(
        taskDescriptionArb,
        smallCategoryListArb,
        async (description, categories) => {
          const { client, capturedCalls } = createCapturingMockClient(
            categories.length > 0 ? categories[0] : "Other",
          );

          const assigner = new AICategoryAssigner(client);
          await assigner.assign(description, categories);

          expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
          const firstCall = capturedCalls[0];

          const allContent = firstCall.messages
            .map((m) => m.content)
            .join("\n");

          // With ≤ 30 categories, the prompt must NOT contain the extra
          // reuse emphasis paragraph that starts with "IMPORTANT: There are already"
          expect(allContent).not.toContain("There are already");
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Category assignment returns correct result for LLM responses
//
// For any LLM response that selects an existing category from the provided
// list, the finalCategory SHALL equal that category name and isNew SHALL be
// false. For any LLM response that proposes a new category name not in the
// provided list, the finalCategory SHALL equal the proposed name and isNew
// SHALL be true. In both cases, rawLLMCategory SHALL equal the LLM's returned
// category string.
//
// Feature: ai-category-assignment, Property 3: Category assignment returns correct result for LLM responses
//
// Validates: Requirements 2.2, 2.3, 2.6
// ---------------------------------------------------------------------------

describe("Property 3: Category assignment returns correct result for LLM responses", () => {
  /**
   * Creates a mock OpenAI client that returns a controlled JSON response
   * with the given category name and isExisting flag.
   */
  function createMockClientReturning(category: string, isExisting: boolean) {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ category, isExisting }),
          },
        },
      ],
    });

    return { chat: { completions: { create } } } as any;
  }

  /**
   * Arbitrary for a non-empty, trimmed category name that won't collide
   * with whitespace-only strings.
   */
  const catNameArb = fc
    .stringOf(
      fc.char().filter((c) => c.trim().length > 0 && c !== "\n" && c !== "\r"),
      { minLength: 1, maxLength: 30 },
    )
    .filter((s) => s.trim().length > 0)
    .map((s) => s.trim());

  /**
   * Arbitrary for a non-empty task description.
   */
  const descArb = fc
    .stringOf(fc.char(), { minLength: 1, maxLength: 200 })
    .filter((s) => s.trim().length > 0);

  /**
   * Arbitrary for a list of unique category names (1–20 entries).
   * Uses fc.uniqueArray to avoid duplicates.
   */
  const categoryListArb = fc.uniqueArray(catNameArb, {
    minLength: 1,
    maxLength: 20,
    comparator: (a, b) => a.toLowerCase() === b.toLowerCase(),
  });

  // -------------------------------------------------------------------------
  // Test case 1: LLM selects an existing category
  // -------------------------------------------------------------------------

  it("when LLM selects an existing category, finalCategory matches, isNew is false, rawLLMCategory matches", async () => {
    await fc.assert(
      fc.asyncProperty(
        descArb,
        categoryListArb,
        async (description, categories) => {
          // Pick a random existing category to be the LLM's selection
          const selectedIndex = Math.floor(Math.random() * categories.length);
          const selectedCategory = categories[selectedIndex];

          const client = createMockClientReturning(selectedCategory, true);
          const assigner = new AICategoryAssigner(client);
          const result = await assigner.assign(description, categories);

          // **Validates: Requirements 2.2, 2.6**
          expect(result.finalCategory).toBe(selectedCategory);
          expect(result.isNew).toBe(false);
          expect(result.rawLLMCategory).toBe(selectedCategory);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Test case 2: LLM proposes a new category not in the existing list
  // -------------------------------------------------------------------------

  it("when LLM proposes a new category, finalCategory matches, isNew is true, rawLLMCategory matches", async () => {
    await fc.assert(
      fc.asyncProperty(
        descArb,
        categoryListArb,
        catNameArb,
        async (description, categories, newCategoryBase) => {
          // Ensure the proposed category is NOT in the existing list
          // (case-insensitive). We append a unique suffix to guarantee this.
          const existingLower = new Set(categories.map((c) => c.toLowerCase()));
          let newCategory = newCategoryBase;
          if (existingLower.has(newCategory.toLowerCase())) {
            newCategory = newCategory + " Unique";
            // If still collides (unlikely), skip this iteration
            fc.pre(!existingLower.has(newCategory.toLowerCase()));
          }

          const client = createMockClientReturning(newCategory, false);
          const assigner = new AICategoryAssigner(client);
          const result = await assigner.assign(description, categories);

          // **Validates: Requirements 2.3, 2.6**
          expect(result.finalCategory).toBe(newCategory);
          expect(result.isNew).toBe(true);
          expect(result.rawLLMCategory).toBe(newCategory);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Fallback produces normalizer result with null raw category
//
// For any task description, when the LLM call fails (error, timeout, or empty
// response) after the retry attempt, the finalCategory SHALL equal the result
// of normalize(description) from the keyword normalizer, and rawLLMCategory
// SHALL be null.
//
// Feature: ai-category-assignment, Property 4: Fallback produces normalizer result with null raw category
//
// Validates: Requirements 3.1, 3.2, 3.3
// ---------------------------------------------------------------------------

import { normalize } from "../../utils/category-normalizer.js";

describe("Property 4: Fallback produces normalizer result with null raw category", () => {
  /**
   * Arbitrary for a non-empty task description string.
   * Uses printable ASCII to keep descriptions realistic.
   */
  const descriptionArb = fc
    .stringOf(fc.char(), { minLength: 1, maxLength: 200 })
    .filter((s) => s.trim().length > 0);

  /**
   * Arbitrary for a list of existing category names (0–20 entries).
   */
  const categoriesArb = fc.array(
    fc
      .stringOf(
        fc
          .char16bits()
          .filter((c) => c.trim().length > 0 && c !== "\n" && c !== "\r"),
        { minLength: 1, maxLength: 40 },
      )
      .filter((s) => s.trim().length > 0)
      .map((s) => s.trim()),
    { minLength: 0, maxLength: 20 },
  );

  // -------------------------------------------------------------------------
  // Test case 1: LLM throws an error on every call
  // -------------------------------------------------------------------------

  it("when LLM always throws an error, rawLLMCategory is null and finalCategory equals normalize(description)", async () => {
    await fc.assert(
      fc.asyncProperty(
        descriptionArb,
        categoriesArb,
        async (description, categories) => {
          const create = vi
            .fn()
            .mockRejectedValue(new Error("LLM unavailable"));
          const client = { chat: { completions: { create } } } as any;

          const assigner = new AICategoryAssigner(client);
          const result = await assigner.assign(description, categories);

          // **Validates: Requirements 3.1, 3.3**
          expect(result.rawLLMCategory).toBeNull();
          expect(result.finalCategory).toBe(normalize(description));
          expect(result.isNew).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Test case 2: LLM returns empty responses (no content)
  // -------------------------------------------------------------------------

  it("when LLM returns empty responses, rawLLMCategory is null and finalCategory equals normalize(description)", async () => {
    await fc.assert(
      fc.asyncProperty(
        descriptionArb,
        categoriesArb,
        async (description, categories) => {
          const create = vi.fn().mockResolvedValue({
            choices: [{ message: { content: "" } }],
          });
          const client = { chat: { completions: { create } } } as any;

          const assigner = new AICategoryAssigner(client);
          const result = await assigner.assign(description, categories);

          // **Validates: Requirements 3.2, 3.3**
          expect(result.rawLLMCategory).toBeNull();
          expect(result.finalCategory).toBe(normalize(description));
          expect(result.isNew).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Test case 3: LLM returns null content (simulating timeout / empty body)
  // -------------------------------------------------------------------------

  it("when LLM returns null content, rawLLMCategory is null and finalCategory equals normalize(description)", async () => {
    await fc.assert(
      fc.asyncProperty(
        descriptionArb,
        categoriesArb,
        async (description, categories) => {
          const create = vi.fn().mockResolvedValue({
            choices: [{ message: { content: null } }],
          });
          const client = { chat: { completions: { create } } } as any;

          const assigner = new AICategoryAssigner(client);
          const result = await assigner.assign(description, categories);

          // **Validates: Requirements 3.2, 3.3**
          expect(result.rawLLMCategory).toBeNull();
          expect(result.finalCategory).toBe(normalize(description));
          expect(result.isNew).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
