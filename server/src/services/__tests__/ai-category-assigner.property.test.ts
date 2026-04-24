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

          // Skip rejected categories — they trigger a retry path
          const REJECTED = new Set([
            "task completion",
            "general",
            "misc",
            "miscellaneous",
            "other",
            "daily task",
            "personal task",
            "task",
            "activity",
            "to do",
            "various",
            "routine",
            "daily",
            "stuff",
            "things",
            "work",
            "personal",
            "life",
            "day",
            "todo",
            "chore",
            "chores",
          ]);
          fc.pre(!REJECTED.has(newCategory.toLowerCase().trim()));

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

// ---------------------------------------------------------------------------
// Property 5: Category Name Validation — Three Word Limit
//
// For any string proposed as a category name that contains more than three
// whitespace-separated words, the system SHALL either truncate it to three
// words or reject it and fall back to an existing category or the normalizer.
// The final resolved category name SHALL never contain more than three words.
//
// **Validates: Requirements 5.4**
// ---------------------------------------------------------------------------

describe("Property 5: Category Name Validation — Three Word Limit", () => {
  /**
   * Arbitrary for a single word — alphabetic, non-empty, title-cased.
   */
  const wordArb = fc
    .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), {
      minLength: 2,
      maxLength: 10,
    })
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));

  /**
   * Arbitrary for a multi-word category name with 1-10 words.
   * Words are joined by single spaces.
   */
  const multiWordNameArb = fc
    .array(wordArb, { minLength: 1, maxLength: 10 })
    .map((words) => words.join(" "));

  /**
   * Arbitrary for a non-empty task description.
   */
  const descArb = fc
    .stringOf(fc.char(), { minLength: 1, maxLength: 100 })
    .filter((s) => s.trim().length > 0);

  /**
   * Arbitrary for a list of existing category names (0-5 entries),
   * each ≤3 words to be valid existing categories.
   */
  const existingCategoriesArb = fc.array(
    fc
      .array(wordArb, { minLength: 1, maxLength: 3 })
      .map((words) => words.join(" ")),
    { minLength: 0, maxLength: 5 },
  );

  /**
   * Creates a mock OpenAI client that returns the given category name
   * as a NEW category proposal (isExisting: false).
   */
  function createMockClientProposingNew(
    categoryName: string,
    confidence: number = 0.8,
  ) {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              category: categoryName,
              isExisting: false,
              confidence,
            }),
          },
        },
      ],
    });
    return { chat: { completions: { create } } } as any;
  }

  // -------------------------------------------------------------------------
  // Core property: finalCategory never exceeds 3 words
  // -------------------------------------------------------------------------

  it("the final category name never exceeds three whitespace-separated words", async () => {
    await fc.assert(
      fc.asyncProperty(
        descArb,
        multiWordNameArb,
        existingCategoriesArb,
        async (description, proposedName, existingCategories) => {
          // Ensure the proposed name is NOT in the existing list so it's treated as new
          const existingLower = new Set(
            existingCategories.map((c) => c.toLowerCase()),
          );
          fc.pre(!existingLower.has(proposedName.toLowerCase()));

          // Skip rejected categories — they trigger a retry path
          const REJECTED = new Set([
            "task completion",
            "general",
            "misc",
            "miscellaneous",
            "other",
            "daily task",
            "personal task",
            "task",
            "activity",
            "to do",
            "various",
            "routine",
            "daily",
            "stuff",
            "things",
            "work",
            "personal",
            "life",
            "day",
            "todo",
            "chore",
            "chores",
          ]);
          fc.pre(!REJECTED.has(proposedName.toLowerCase().trim()));

          const client = createMockClientProposingNew(proposedName);
          const assigner = new AICategoryAssigner(client);
          const result = await assigner.assign(description, existingCategories);

          // **Validates: Requirements 5.4**
          const wordCount = result.finalCategory.trim().split(/\s+/).length;
          expect(wordCount).toBeLessThanOrEqual(3);
        },
      ),
      { numRuns: 200 },
    );
  });

  // -------------------------------------------------------------------------
  // Names with ≤3 words pass through unchanged when new
  // -------------------------------------------------------------------------

  it("names with 1-3 words are accepted as-is when they are new categories", async () => {
    const shortNameArb = fc
      .array(wordArb, { minLength: 1, maxLength: 3 })
      .map((words) => words.join(" "));

    await fc.assert(
      fc.asyncProperty(
        descArb,
        shortNameArb,
        existingCategoriesArb,
        async (description, proposedName, existingCategories) => {
          // Ensure the proposed name is NOT in the existing list
          const existingLower = new Set(
            existingCategories.map((c) => c.toLowerCase()),
          );
          fc.pre(!existingLower.has(proposedName.toLowerCase()));

          // Skip rejected categories — they trigger a retry path
          const REJECTED = new Set([
            "task completion",
            "general",
            "misc",
            "miscellaneous",
            "other",
            "daily task",
            "personal task",
            "task",
            "activity",
            "to do",
            "various",
            "routine",
            "daily",
            "stuff",
            "things",
            "work",
            "personal",
            "life",
            "day",
            "todo",
            "chore",
            "chores",
          ]);
          fc.pre(!REJECTED.has(proposedName.toLowerCase().trim()));

          const client = createMockClientProposingNew(proposedName);
          const assigner = new AICategoryAssigner(client);
          const result = await assigner.assign(description, existingCategories);

          // **Validates: Requirements 5.4**
          // Short names should pass through unchanged
          expect(result.finalCategory).toBe(proposedName);
          expect(result.isNew).toBe(true);
          expect(result.rawLLMCategory).toBe(proposedName);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Names with >3 words are truncated or rejected
  // -------------------------------------------------------------------------

  it("names with >3 words are truncated or fall back, never kept as-is", async () => {
    const longNameArb = fc
      .array(wordArb, { minLength: 4, maxLength: 10 })
      .map((words) => words.join(" "));

    await fc.assert(
      fc.asyncProperty(
        descArb,
        longNameArb,
        existingCategoriesArb,
        async (description, proposedName, existingCategories) => {
          // Ensure the proposed name is NOT in the existing list
          const existingLower = new Set(
            existingCategories.map((c) => c.toLowerCase()),
          );
          fc.pre(!existingLower.has(proposedName.toLowerCase()));

          const client = createMockClientProposingNew(proposedName);
          const assigner = new AICategoryAssigner(client);
          const result = await assigner.assign(description, existingCategories);

          // **Validates: Requirements 5.4**
          // The final category must NOT be the original >3 word name
          expect(result.finalCategory).not.toBe(proposedName);

          // The raw LLM category should still record what the LLM proposed
          expect(result.rawLLMCategory).toBe(proposedName);

          // The final category must have ≤3 words
          const wordCount = result.finalCategory.trim().split(/\s+/).length;
          expect(wordCount).toBeLessThanOrEqual(3);
        },
      ),
      { numRuns: 200 },
    );
  });

  // -------------------------------------------------------------------------
  // >3 word name truncated to 3 words matches existing → uses existing
  // -------------------------------------------------------------------------

  it("when truncated name matches an existing category, it uses that existing category", async () => {
    await fc.assert(
      fc.asyncProperty(
        descArb,
        fc.array(wordArb, { minLength: 3, maxLength: 3 }),
        fc.array(wordArb, { minLength: 1, maxLength: 7 }),
        async (description, firstThreeWords, extraWords) => {
          fc.pre(extraWords.length >= 1);

          const truncatedName = firstThreeWords.join(" ");
          const longName = [...firstThreeWords, ...extraWords].join(" ");

          // Set up existing categories to include the truncated name
          const existingCategories = [truncatedName, "Other Category"];

          const client = createMockClientProposingNew(longName);
          const assigner = new AICategoryAssigner(client);
          const result = await assigner.assign(description, existingCategories);

          // **Validates: Requirements 5.4**
          // The truncated name matches an existing category, so it should use it
          expect(result.finalCategory).toBe(truncatedName);
          expect(result.isNew).toBe(false);
          expect(result.rawLLMCategory).toBe(longName);
          expect(result.source).toBe("llm");
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Conservative Category Creation Threshold
//
// For any user with more than 20 active categories, the prompt sent to the
// LLM by the AICategoryAssigner SHALL contain an additional instruction
// emphasizing that new categories should only be created in exceptional cases.
// For any user with 20 or fewer active categories, this additional instruction
// SHALL NOT be present.
//
// Feature: dynamic-ai-categories, Property 6: Conservative Category Creation Threshold
//
// **Validates: Requirements 6.3**
// ---------------------------------------------------------------------------

describe("Property 6: Conservative Category Creation Threshold", () => {
  /**
   * Arbitrary for a non-empty task description string.
   */
  const descriptionArb = fc
    .stringOf(fc.char(), { minLength: 1, maxLength: 200 })
    .filter((s) => s.trim().length > 0);

  /**
   * Arbitrary for a single category name — non-empty, printable, trimmed.
   */
  const catNameArb = fc
    .stringOf(
      fc
        .char16bits()
        .filter((c) => c.trim().length > 0 && c !== "\n" && c !== "\r"),
      { minLength: 1, maxLength: 40 },
    )
    .filter((s) => s.trim().length > 0)
    .map((s) => s.trim());

  /**
   * Arbitrary for a small list of existing category names (0-10 entries).
   * We keep this small since the activeCategoryCount parameter is what
   * controls the threshold, not the list length.
   */
  const existingCategoriesArb = fc.array(catNameArb, {
    minLength: 0,
    maxLength: 10,
  });

  /**
   * Arbitrary for activeCategoryCount > 20 (21-50).
   */
  const highCountArb = fc.integer({ min: 21, max: 50 });

  /**
   * Arbitrary for activeCategoryCount ≤ 20 (0-20).
   */
  const lowCountArb = fc.integer({ min: 0, max: 20 });

  // -------------------------------------------------------------------------
  // When activeCategoryCount > 20, prompt contains conservative instruction
  // -------------------------------------------------------------------------

  it("when activeCategoryCount > 20, the prompt contains the conservative category creation instruction", async () => {
    await fc.assert(
      fc.asyncProperty(
        descriptionArb,
        existingCategoriesArb,
        highCountArb,
        async (description, categories, activeCategoryCount) => {
          const { client, capturedCalls } = createCapturingMockClient(
            categories.length > 0 ? categories[0] : "Other",
          );

          const assigner = new AICategoryAssigner(client);
          await assigner.assign(description, categories, activeCategoryCount);

          // The first call captures the non-strict prompt
          expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
          const firstCall = capturedCalls[0];

          const allContent = firstCall.messages
            .map((m) => m.content)
            .join("\n");

          // **Validates: Requirements 6.3**
          // The prompt must contain the conservative instruction with IMPORTANT
          expect(allContent).toContain("IMPORTANT");
          expect(allContent).toContain(String(activeCategoryCount));
          expect(allContent).toContain(
            "Only create a new category in truly exceptional cases",
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // When activeCategoryCount ≤ 20, prompt does NOT contain conservative instruction
  // -------------------------------------------------------------------------

  it("when activeCategoryCount ≤ 20, the prompt does NOT contain the conservative category creation instruction", async () => {
    await fc.assert(
      fc.asyncProperty(
        descriptionArb,
        existingCategoriesArb,
        lowCountArb,
        async (description, categories, activeCategoryCount) => {
          const { client, capturedCalls } = createCapturingMockClient(
            categories.length > 0 ? categories[0] : "Other",
          );

          const assigner = new AICategoryAssigner(client);
          await assigner.assign(description, categories, activeCategoryCount);

          // The first call captures the non-strict prompt
          expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
          const firstCall = capturedCalls[0];

          const allContent = firstCall.messages
            .map((m) => m.content)
            .join("\n");

          // **Validates: Requirements 6.3**
          // The prompt must NOT contain the conservative instruction
          expect(allContent).not.toContain("There are already");
          expect(allContent).not.toContain(
            "Only create a new category in truly exceptional cases",
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Fallback Produces Correct Metadata
//
// For any task description where the LLM fails after retry, the
// CategoryAssignmentResult SHALL have rawLLMCategory = null,
// source = 'fallback', confidence = 0.0, and isNew = false.
//
// Feature: dynamic-ai-categories, Property 9: Fallback Produces Correct Metadata
//
// **Validates: Requirements 10.2**
// ---------------------------------------------------------------------------

describe("Property 9: Fallback Produces Correct Metadata", () => {
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
  // Test case 1: LLM throws errors — verify fallback metadata fields
  // -------------------------------------------------------------------------

  it("when LLM always throws, result has source='fallback', confidence=0.0, isNew=false, rawLLMCategory=null", async () => {
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

          // **Validates: Requirements 10.2**
          expect(result.rawLLMCategory).toBeNull();
          expect(result.source).toBe("fallback");
          expect(result.confidence).toBe(0.0);
          expect(result.isNew).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Test case 2: LLM returns unparseable responses — verify fallback metadata
  // -------------------------------------------------------------------------

  it("when LLM returns unparseable JSON, result has source='fallback', confidence=0.0, isNew=false, rawLLMCategory=null", async () => {
    await fc.assert(
      fc.asyncProperty(
        descriptionArb,
        categoriesArb,
        async (description, categories) => {
          const create = vi.fn().mockResolvedValue({
            choices: [{ message: { content: "not valid json at all {{{" } }],
          });
          const client = { chat: { completions: { create } } } as any;

          const assigner = new AICategoryAssigner(client);
          const result = await assigner.assign(description, categories);

          // **Validates: Requirements 10.2**
          expect(result.rawLLMCategory).toBeNull();
          expect(result.source).toBe("fallback");
          expect(result.confidence).toBe(0.0);
          expect(result.isNew).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Test case 3: LLM returns empty content — verify fallback metadata
  // -------------------------------------------------------------------------

  it("when LLM returns empty content, result has source='fallback', confidence=0.0, isNew=false, rawLLMCategory=null", async () => {
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

          // **Validates: Requirements 10.2**
          expect(result.rawLLMCategory).toBeNull();
          expect(result.source).toBe("fallback");
          expect(result.confidence).toBe(0.0);
          expect(result.isNew).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: "Other" Fallback Triggers Low Confidence Flag
//
// For any task description where the fallback normalizer produces "Other" as
// the category, the CategoryAssignmentResult SHALL have lowConfidence = true.
//
// Feature: dynamic-ai-categories, Property 10: "Other" Fallback Triggers Low Confidence Flag
//
// **Validates: Requirements 10.4**
// ---------------------------------------------------------------------------

describe("Property 10: 'Other' Fallback Triggers Low Confidence Flag", () => {
  /**
   * All keywords used by the category normalizer. Any description containing
   * one of these (case-insensitive) will NOT normalize to "Other".
   * We generate descriptions that avoid all of them.
   */
  const NORMALIZER_KEYWORDS = [
    "write",
    "writing",
    "blog",
    "article",
    "draft",
    "copy",
    "content",
    "documentation",
    "docs",
    "report",
    "dev",
    "develop",
    "code",
    "coding",
    "programming",
    "implement",
    "build",
    "debug",
    "fix",
    "refactor",
    "deploy",
    "design",
    "ui",
    "ux",
    "mockup",
    "wireframe",
    "prototype",
    "layout",
    "figma",
    "sketch",
    "research",
    "investigate",
    "explore",
    "analyze",
    "analysis",
    "study",
    "review",
    "literature",
    "admin",
    "administrative",
    "organize",
    "file",
    "schedule",
    "booking",
    "invoice",
    "expense",
    "paperwork",
    "email",
    "meeting",
    "call",
    "chat",
    "discuss",
    "present",
    "presentation",
    "sync",
    "standup",
    "plan",
    "planning",
    "roadmap",
    "strategy",
    "prioritize",
    "backlog",
    "sprint",
    "estimate",
    "test",
    "testing",
    "qa",
    "quality",
    "verify",
    "validation",
    "check",
    "learn",
    "learning",
    "course",
    "tutorial",
    "training",
    "read",
    "reading",
  ];

  /**
   * Arbitrary that generates random strings guaranteed to normalize to "Other".
   * Uses digits and punctuation characters that cannot form any normalizer keyword.
   */
  const otherDescriptionArb = fc
    .stringOf(
      fc.constantFrom(..."0123456789!@#$%^&*()-_=+[]{}|;:,.<>?/~ ".split("")),
      { minLength: 1, maxLength: 100 },
    )
    .filter((s) => s.trim().length > 0)
    .filter((s) => {
      const lower = s.toLowerCase();
      return !NORMALIZER_KEYWORDS.some((kw) => lower.includes(kw));
    });

  /**
   * Arbitrary for a list of existing category names (0–10 entries).
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
    { minLength: 0, maxLength: 10 },
  );

  /**
   * Creates a mock OpenAI client that always fails (throws an error),
   * forcing the assigner to use the fallback normalizer.
   */
  function createFailingMockClient() {
    const create = vi.fn().mockRejectedValue(new Error("LLM unavailable"));
    return { chat: { completions: { create } } } as any;
  }

  // -------------------------------------------------------------------------
  // Core property: descriptions normalizing to "Other" produce lowConfidence=true
  // -------------------------------------------------------------------------

  it("when fallback normalizer produces 'Other', lowConfidence is true", async () => {
    await fc.assert(
      fc.asyncProperty(
        otherDescriptionArb,
        categoriesArb,
        async (description, categories) => {
          const client = createFailingMockClient();
          const assigner = new AICategoryAssigner(client);
          const result = await assigner.assign(description, categories);

          // Confirm we are in the fallback path
          expect(result.source).toBe("fallback");
          expect(result.finalCategory).toBe("Other");

          // **Validates: Requirements 10.4**
          expect(result.lowConfidence).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Contrast: descriptions that normalize to a non-"Other" category via
  // fallback should NOT have lowConfidence=true
  // -------------------------------------------------------------------------

  it("when fallback normalizer produces a non-'Other' category, lowConfidence is false", async () => {
    /**
     * Arbitrary that generates descriptions containing a known keyword,
     * ensuring the normalizer produces a category other than "Other".
     */
    const knownKeywordArb = fc.constantFrom(
      "write a poem",
      "develop the app",
      "design the logo",
      "research the topic",
      "admin tasks today",
      "email the team",
      "plan the sprint",
      "test the feature",
      "learn something new",
    );

    await fc.assert(
      fc.asyncProperty(
        knownKeywordArb,
        categoriesArb,
        async (description, categories) => {
          const client = createFailingMockClient();
          const assigner = new AICategoryAssigner(client);
          const result = await assigner.assign(description, categories);

          // Confirm we are in the fallback path
          expect(result.source).toBe("fallback");
          expect(result.finalCategory).not.toBe("Other");

          // Non-"Other" fallback should NOT flag low confidence
          expect(result.lowConfidence).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});
