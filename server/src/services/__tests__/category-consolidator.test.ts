/**
 * Unit tests for CategoryConsolidator.
 *
 * Uses a mock OpenAI client injected via the constructor to test suggestion
 * parsing, retry behavior, and error handling without hitting a real LLM.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CategoryConsolidator } from "../category-consolidator.js";
import type { CategoryEntity } from "../../db/category-repository.js";

// ---------------------------------------------------------------------------
// Mock OpenAI client helper
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock that satisfies the OpenAI client shape used by
 * CategoryConsolidator (only `chat.completions.create` is called).
 *
 * Accepts a sequence of responses; each call to `create` consumes the next
 * response in order. An Error instance causes the call to reject.
 */
function createMockClient(
  ...responses: Array<{ content: string | null } | Error>
) {
  let callIndex = 0;

  const create = vi.fn().mockImplementation(async () => {
    const res = responses[callIndex++];
    if (!res) {
      throw new Error("No more mock responses configured");
    }
    if (res instanceof Error) {
      throw res;
    }
    return {
      choices: [{ message: { content: res.content } }],
    };
  });

  return {
    client: { chat: { completions: { create } } } as any,
    create,
  };
}

// ---------------------------------------------------------------------------
// Test category fixtures
// ---------------------------------------------------------------------------

function makeCategory(
  id: number,
  name: string,
  userId: string = "user-1",
): CategoryEntity {
  return {
    id,
    name,
    userId,
    status: "active",
    createdBy: "llm",
    mergedIntoCategoryId: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

const sampleCategories: CategoryEntity[] = [
  makeCategory(1, "Development"),
  makeCategory(2, "Dev Work"),
  makeCategory(3, "Design"),
  makeCategory(4, "Misc"),
  makeCategory(5, "Work"),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CategoryConsolidator", () => {
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
  // Req 7.2, 7.3 — Merge suggestion parsing
  // -----------------------------------------------------------------------

  describe("merge suggestion parsing (Req 7.2, 7.3)", () => {
    it("parses a merge suggestion with resolved category IDs", async () => {
      const llmResponse = JSON.stringify([
        {
          action: "merge",
          sourceCategoryName: "Dev Work",
          targetCategoryName: "Development",
          reason: "These are synonyms referring to the same type of work",
        },
      ]);

      const { client } = createMockClient({ content: llmResponse });
      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].action).toBe("merge");
      expect(suggestions[0].sourceCategoryName).toBe("Dev Work");
      expect(suggestions[0].sourceCategoryId).toBe(2);
      expect(suggestions[0].targetCategoryName).toBe("Development");
      expect(suggestions[0].targetCategoryId).toBe(1);
      expect(suggestions[0].reason).toBe(
        "These are synonyms referring to the same type of work",
      );
      expect(suggestions[0].id).toBeDefined();
      expect(typeof suggestions[0].id).toBe("string");
    });

    it("handles merge suggestion where category name is not found in list", async () => {
      const llmResponse = JSON.stringify([
        {
          action: "merge",
          sourceCategoryName: "Unknown Category",
          targetCategoryName: "Development",
          reason: "Merge unknown into development",
        },
      ]);

      const { client } = createMockClient({ content: llmResponse });
      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].sourceCategoryId).toBeUndefined();
      expect(suggestions[0].targetCategoryId).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Req 7.2, 7.4 — Rename suggestion parsing
  // -----------------------------------------------------------------------

  describe("rename suggestion parsing (Req 7.2, 7.4)", () => {
    it("parses a rename suggestion with resolved category ID", async () => {
      const llmResponse = JSON.stringify([
        {
          action: "rename",
          currentName: "Misc",
          proposedName: "General Tasks",
          reason: "More descriptive and consistent with other category names",
        },
      ]);

      const { client } = createMockClient({ content: llmResponse });
      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].action).toBe("rename");
      expect(suggestions[0].categoryId).toBe(4);
      expect(suggestions[0].currentName).toBe("Misc");
      expect(suggestions[0].proposedName).toBe("General Tasks");
      expect(suggestions[0].reason).toBe(
        "More descriptive and consistent with other category names",
      );
      expect(suggestions[0].id).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Req 7.2, 7.5 — Split suggestion parsing
  // -----------------------------------------------------------------------

  describe("split suggestion parsing (Req 7.2, 7.5)", () => {
    it("parses a split suggestion with resolved category ID", async () => {
      const llmResponse = JSON.stringify([
        {
          action: "split",
          currentName: "Work",
          proposedNames: ["Client Work", "Internal Work"],
          reason: "Too broad — covers distinct task types",
        },
      ]);

      const { client } = createMockClient({ content: llmResponse });
      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].action).toBe("split");
      expect(suggestions[0].categoryId).toBe(5);
      expect(suggestions[0].currentName).toBe("Work");
      expect(suggestions[0].proposedNames).toEqual([
        "Client Work",
        "Internal Work",
      ]);
      expect(suggestions[0].reason).toBe(
        "Too broad — covers distinct task types",
      );
      expect(suggestions[0].id).toBeDefined();
    });

    it("skips split suggestions with fewer than 2 proposed names", async () => {
      const llmResponse = JSON.stringify([
        {
          action: "split",
          currentName: "Work",
          proposedNames: ["Only One"],
          reason: "Not enough proposed names",
        },
      ]);

      const { client } = createMockClient({ content: llmResponse });
      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      expect(suggestions).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Req 7.1 — Empty category list handling
  // -----------------------------------------------------------------------

  describe("empty category list (Req 7.1)", () => {
    it("returns empty array for empty category list", async () => {
      const { client, create } = createMockClient();
      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze([]);

      expect(suggestions).toEqual([]);
      // Should not call the LLM at all
      expect(create).not.toHaveBeenCalled();
    });

    it("returns empty array for single category", async () => {
      const { client, create } = createMockClient();
      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze([
        makeCategory(1, "Development"),
      ]);

      expect(suggestions).toEqual([]);
      expect(create).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Req 7.6, 7.7 — LLM failure handling (retry + empty array fallback)
  // -----------------------------------------------------------------------

  describe("LLM failure handling (Req 7.6, 7.7)", () => {
    it("retries with stricter prompt when first response is invalid JSON", async () => {
      const validResponse = JSON.stringify([
        {
          action: "rename",
          currentName: "Misc",
          proposedName: "General Tasks",
          reason: "Better name",
        },
      ]);

      const { client, create } = createMockClient(
        // First call: invalid JSON
        { content: "I think you should merge some categories..." },
        // Second call (retry): valid JSON
        { content: validResponse },
      );

      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      // Should have called the LLM twice
      expect(create).toHaveBeenCalledTimes(2);

      // The retry call should use the stricter prompt
      const retryCall = create.mock.calls[1][0];
      const retryMessages = retryCall.messages;
      expect(retryMessages).toHaveLength(1);
      expect(retryMessages[0].role).toBe("user");
      expect(retryMessages[0].content).toContain("MUST respond with ONLY");

      // Result should be correct from the retry
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].action).toBe("rename");
    });

    it("returns empty array when LLM throws on both attempts", async () => {
      const { client, create } = createMockClient(
        new Error("API rate limit exceeded"),
        new Error("API rate limit exceeded"),
      );

      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      expect(create).toHaveBeenCalledTimes(2);
      expect(suggestions).toEqual([]);
    });

    it("returns empty array when LLM returns empty content on both attempts", async () => {
      const { client, create } = createMockClient(
        { content: "" },
        { content: "" },
      );

      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      expect(create).toHaveBeenCalledTimes(2);
      expect(suggestions).toEqual([]);
    });

    it("returns empty array when LLM returns null content on both attempts", async () => {
      const { client, create } = createMockClient(
        { content: null },
        { content: null },
      );

      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      expect(create).toHaveBeenCalledTimes(2);
      expect(suggestions).toEqual([]);
    });

    it("logs a warning when falling back to empty array", async () => {
      const { client } = createMockClient(
        new Error("Network error"),
        new Error("Network error"),
      );

      const consolidator = new CategoryConsolidator(client);
      await consolidator.analyze(sampleCategories);

      expect(warnSpy).toHaveBeenCalled();
      const warnMessage = warnSpy.mock.calls[0][0];
      expect(warnMessage).toContain("[CategoryConsolidator]");
    });
  });

  // -----------------------------------------------------------------------
  // Mixed suggestions and edge cases
  // -----------------------------------------------------------------------

  describe("mixed suggestions and edge cases", () => {
    it("parses multiple suggestion types in a single response", async () => {
      const llmResponse = JSON.stringify([
        {
          action: "merge",
          sourceCategoryName: "Dev Work",
          targetCategoryName: "Development",
          reason: "Synonyms",
        },
        {
          action: "rename",
          currentName: "Misc",
          proposedName: "General Tasks",
          reason: "Better name",
        },
        {
          action: "split",
          currentName: "Work",
          proposedNames: ["Client Work", "Internal Work"],
          reason: "Too broad",
        },
      ]);

      const { client } = createMockClient({ content: llmResponse });
      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      expect(suggestions).toHaveLength(3);
      expect(suggestions[0].action).toBe("merge");
      expect(suggestions[1].action).toBe("rename");
      expect(suggestions[2].action).toBe("split");

      // Each suggestion should have a unique ID
      const ids = suggestions.map((s) => s.id);
      expect(new Set(ids).size).toBe(3);
    });

    it("skips invalid suggestion objects in the array", async () => {
      const llmResponse = JSON.stringify([
        // Valid merge
        {
          action: "merge",
          sourceCategoryName: "Dev Work",
          targetCategoryName: "Development",
          reason: "Synonyms",
        },
        // Invalid: missing required fields for merge
        {
          action: "merge",
          reason: "Missing names",
        },
        // Invalid: unknown action
        {
          action: "delete",
          currentName: "Misc",
          reason: "Not a valid action",
        },
        // Invalid: not an object
        "just a string",
        // Valid rename
        {
          action: "rename",
          currentName: "Misc",
          proposedName: "General Tasks",
          reason: "Better name",
        },
      ]);

      const { client } = createMockClient({ content: llmResponse });
      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      // Only the 2 valid suggestions should be returned
      expect(suggestions).toHaveLength(2);
      expect(suggestions[0].action).toBe("merge");
      expect(suggestions[1].action).toBe("rename");
    });

    it("returns empty array when LLM returns an empty JSON array", async () => {
      const { client } = createMockClient({ content: "[]" });
      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      expect(suggestions).toEqual([]);
    });

    it("handles LLM response wrapped in markdown code fences", async () => {
      const llmResponse =
        '```json\n[{"action": "rename", "currentName": "Misc", "proposedName": "General Tasks", "reason": "Better name"}]\n```';

      const { client } = createMockClient({ content: llmResponse });
      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].action).toBe("rename");
    });

    it("provides default reason when LLM omits it", async () => {
      const llmResponse = JSON.stringify([
        {
          action: "rename",
          currentName: "Misc",
          proposedName: "General Tasks",
          // no reason field
        },
      ]);

      const { client } = createMockClient({ content: llmResponse });
      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].reason).toBe("No reason provided");
    });

    it("resolves category IDs case-insensitively", async () => {
      const llmResponse = JSON.stringify([
        {
          action: "rename",
          currentName: "development",
          proposedName: "Software Dev",
          reason: "Shorter name",
        },
      ]);

      const { client } = createMockClient({ content: llmResponse });
      const consolidator = new CategoryConsolidator(client);
      const suggestions = await consolidator.analyze(sampleCategories);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].categoryId).toBe(1); // "Development" has id 1
    });
  });
});
