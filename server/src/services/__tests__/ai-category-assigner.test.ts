/**
 * Unit tests for AICategoryAssigner.
 *
 * Uses a mock OpenAI client injected via the constructor to test assignment
 * logic, retry behavior, fallback, and prompt construction without hitting
 * a real LLM.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4,
 *            4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4,
 *            6.1, 6.2, 6.3, 6.4, 10.1, 10.2, 10.3, 10.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AICategoryAssigner } from "../ai-category-assigner.js";
import { normalize } from "../../utils/category-normalizer.js";

// ---------------------------------------------------------------------------
// Mock OpenAI client helper
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock that satisfies the OpenAI client shape used by
 * AICategoryAssigner (only `chat.completions.create` is called).
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

/**
 * Build a capturing mock that records the messages sent to the LLM and
 * returns a valid category response with confidence.
 */
function createCapturingMockClient(
  category: string,
  isExisting: boolean,
  confidence: number = 0.9,
) {
  const capturedCalls: Array<{
    messages: Array<{ role: string; content: string }>;
  }> = [];

  const create = vi.fn().mockImplementation(async (params: any) => {
    capturedCalls.push({ messages: params.messages });
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({ category, isExisting, confidence }),
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
// Tests
// ---------------------------------------------------------------------------

describe("AICategoryAssigner", () => {
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
  // Req 2.2 — LLM selects an existing category
  // -----------------------------------------------------------------------

  describe("LLM selects existing category (Req 2.2)", () => {
    it('returns correct result when LLM selects "Development"', async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Development",
          isExisting: true,
          confidence: 0.95,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Fix the login bug", [
        "Development",
        "Design",
        "Testing",
      ]);

      expect(result).toEqual({
        finalCategory: "Development",
        isNew: false,
        rawLLMCategory: "Development",
        confidence: 0.95,
        source: "llm",
        closestExisting: null,
        lowConfidence: false,
      });
    });
  });

  // -----------------------------------------------------------------------
  // Req 2.3 — LLM proposes a new category
  // -----------------------------------------------------------------------

  describe("LLM proposes new category (Req 2.3)", () => {
    it('returns correct result when LLM proposes "Data Entry"', async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Data Entry",
          isExisting: false,
          confidence: 0.8,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign(
        "Enter invoice data into spreadsheet",
        ["Development", "Design", "Testing"],
      );

      expect(result).toEqual({
        finalCategory: "Data Entry",
        isNew: true,
        rawLLMCategory: "Data Entry",
        confidence: 0.8,
        source: "llm",
        closestExisting: null,
        lowConfidence: false,
      });
    });
  });

  // -----------------------------------------------------------------------
  // Req 4.7 — LLM returns invalid JSON → retries with stricter prompt
  // -----------------------------------------------------------------------

  describe("retry on invalid JSON (Req 4.7)", () => {
    it("retries with stricter prompt when first response is invalid JSON, succeeds on retry", async () => {
      const { client, create } = createMockClient(
        // First call: invalid JSON
        { content: "I think this task is about development" },
        // Second call (retry): valid JSON
        {
          content: JSON.stringify({
            category: "Development",
            isExisting: true,
            confidence: 0.9,
          }),
        },
      );

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Fix the login bug", [
        "Development",
        "Design",
      ]);

      // Should have called the LLM twice
      expect(create).toHaveBeenCalledTimes(2);

      // The retry call should use the stricter prompt (user message only, no system message)
      const retryCall = create.mock.calls[1][0];
      const retryMessages = retryCall.messages;
      expect(retryMessages).toHaveLength(1);
      expect(retryMessages[0].role).toBe("user");
      expect(retryMessages[0].content).toContain("MUST respond with ONLY");

      // Result should be correct from the retry
      expect(result).toEqual({
        finalCategory: "Development",
        isNew: false,
        rawLLMCategory: "Development",
        confidence: 0.9,
        source: "llm",
        closestExisting: null,
        lowConfidence: false,
      });
    });
  });

  // -----------------------------------------------------------------------
  // Req 10.1, 10.2 — LLM fails twice → falls back to keyword normalizer
  // -----------------------------------------------------------------------

  describe("fallback to keyword normalizer (Req 10.1, 10.2)", () => {
    it("falls back to keyword normalizer when LLM throws on both attempts", async () => {
      const { client, create } = createMockClient(
        new Error("API rate limit exceeded"),
        new Error("API rate limit exceeded"),
      );

      const assigner = new AICategoryAssigner(client);
      const description = "Write a blog post about TypeScript";
      const result = await assigner.assign(description, [
        "Development",
        "Design",
      ]);

      expect(create).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        rawLLMCategory: null,
        finalCategory: normalize(description),
        isNew: false,
        confidence: 0.0,
        source: "fallback",
        closestExisting: null,
        lowConfidence: false,
      });
    });

    it("falls back when LLM returns empty content on both attempts", async () => {
      const { client, create } = createMockClient(
        { content: "" },
        { content: "" },
      );

      const assigner = new AICategoryAssigner(client);
      const description = "Deploy the application to production";
      const result = await assigner.assign(description, ["Development"]);

      expect(create).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        rawLLMCategory: null,
        finalCategory: normalize(description),
        isNew: false,
        confidence: 0.0,
        source: "fallback",
        closestExisting: null,
        lowConfidence: false,
      });
    });
  });

  // -----------------------------------------------------------------------
  // Req 4.1, 4.2 — Prompt contains instruction to prefer existing categories
  // -----------------------------------------------------------------------

  describe("prompt instructs to prefer existing categories (Req 4.1, 4.2)", () => {
    it("prompt contains instruction to prefer existing categories", async () => {
      const { client, capturedCalls } = createCapturingMockClient(
        "Development",
        true,
      );

      const assigner = new AICategoryAssigner(client);
      await assigner.assign("Fix the login bug", [
        "Development",
        "Design",
        "Testing",
      ]);

      expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
      const firstCall = capturedCalls[0];
      const allContent = firstCall.messages.map((m) => m.content).join("\n");

      // Req 4.2: prefer existing categories
      expect(allContent).toMatch(/prefer.*existing/i);

      // Req 4.3: new category constraints
      expect(allContent).toMatch(/3 words/i);
      expect(allContent).toMatch(/title.?case/i);
    });
  });

  // -----------------------------------------------------------------------
  // Req 5.1, 5.2, 5.3 — Prompt contains formatting constraints for new categories
  // -----------------------------------------------------------------------

  describe("prompt contains formatting constraints (Req 5.1, 5.2, 5.3)", () => {
    it("prompt instructs new categories must be at most 3 words, title-cased, general-purpose", async () => {
      const { client, capturedCalls } = createCapturingMockClient(
        "Research",
        true,
      );

      const assigner = new AICategoryAssigner(client);
      await assigner.assign("Investigate new frameworks", [
        "Research",
        "Development",
      ]);

      const firstCall = capturedCalls[0];
      const allContent = firstCall.messages.map((m) => m.content).join("\n");

      // Must mention the 3-word limit
      expect(allContent).toContain("3 words");

      // Must mention title-cased
      expect(allContent).toMatch(/[Tt]itle.?[Cc]ase/);

      // Must mention general-purpose
      expect(allContent).toMatch(/general.?purpose/i);
    });
  });

  // -----------------------------------------------------------------------
  // Req 10.3 — Fallback logs a warning
  // -----------------------------------------------------------------------

  describe("fallback logs a warning (Req 10.3)", () => {
    it("logs a warning via console.warn when falling back to keyword normalizer", async () => {
      const { client } = createMockClient(
        new Error("Network error"),
        new Error("Network error"),
      );

      const assigner = new AICategoryAssigner(client);
      await assigner.assign("Write documentation", ["Writing", "Development"]);

      expect(warnSpy).toHaveBeenCalled();
      const warnMessage = warnSpy.mock.calls[0][0];
      expect(warnMessage).toContain("[AICategoryAssigner]");
      expect(warnMessage).toContain("Falling back to keyword normalizer");
    });

    it("does NOT log a warning when LLM succeeds on first attempt", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Writing",
          isExisting: true,
          confidence: 0.9,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      await assigner.assign("Write documentation", ["Writing", "Development"]);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Req 4.4 — Confidence score is returned
  // -----------------------------------------------------------------------

  describe("confidence score (Req 4.4)", () => {
    it("returns the confidence score from the LLM response", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Development",
          isExisting: true,
          confidence: 0.85,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Fix the login bug", [
        "Development",
      ]);

      expect(result.confidence).toBe(0.85);
      expect(result.source).toBe("llm");
    });

    it("defaults confidence to 0.5 when LLM omits it", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Development",
          isExisting: true,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Fix the login bug", [
        "Development",
      ]);

      expect(result.confidence).toBe(0.5);
    });

    it("clamps confidence to [0.0, 1.0]", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Development",
          isExisting: true,
          confidence: 1.5,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Fix the login bug", [
        "Development",
      ]);

      expect(result.confidence).toBe(1.0);
    });
  });

  // -----------------------------------------------------------------------
  // Req 6.3 — >20 category threshold warning
  // -----------------------------------------------------------------------

  describe(">20 category threshold (Req 6.3)", () => {
    it("includes extra warning when activeCategoryCount > 20", async () => {
      const { client, capturedCalls } = createCapturingMockClient(
        "Development",
        true,
      );

      const assigner = new AICategoryAssigner(client);
      await assigner.assign("Fix the login bug", ["Development"], 25);

      const firstCall = capturedCalls[0];
      const allContent = firstCall.messages.map((m) => m.content).join("\n");

      expect(allContent).toContain("IMPORTANT");
      expect(allContent).toContain("25");
    });

    it("does NOT include extra warning when activeCategoryCount <= 20", async () => {
      const { client, capturedCalls } = createCapturingMockClient(
        "Development",
        true,
      );

      const assigner = new AICategoryAssigner(client);
      await assigner.assign("Fix the login bug", ["Development"], 15);

      const firstCall = capturedCalls[0];
      const allContent = firstCall.messages.map((m) => m.content).join("\n");

      expect(allContent).not.toContain("IMPORTANT");
    });

    it("uses existingCategories.length when activeCategoryCount is not provided", async () => {
      // Generate 25 categories
      const categories = Array.from({ length: 25 }, (_, i) => `Cat${i}`);
      const { client, capturedCalls } = createCapturingMockClient("Cat0", true);

      const assigner = new AICategoryAssigner(client);
      await assigner.assign("Fix the login bug", categories);

      const firstCall = capturedCalls[0];
      const allContent = firstCall.messages.map((m) => m.content).join("\n");

      expect(allContent).toContain("IMPORTANT");
      expect(allContent).toContain("25");
    });
  });

  // -----------------------------------------------------------------------
  // Req 5.4 — ≤3 word name enforcement (truncation)
  // -----------------------------------------------------------------------

  describe("≤3 word name enforcement (Req 5.4)", () => {
    it("truncates >3 word new category to first 3 words and falls back when no match", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Very Long Category Name Here",
          isExisting: false,
          confidence: 0.7,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const description = "Some random unique task xyz";
      const result = await assigner.assign(description, [
        "Development",
        "Design",
      ]);

      // Truncated "Very Long Category" doesn't match existing, so falls back
      expect(result.source).toBe("fallback");
      expect(result.isNew).toBe(false);
      expect(result.rawLLMCategory).toBe("Very Long Category Name Here");
    });

    it("truncates >3 word name and uses existing match if found", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Code Review Tasks Extra",
          isExisting: false,
          confidence: 0.8,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Review the pull request", [
        "Code Review Tasks",
        "Development",
      ]);

      // Truncated to "Code Review Tasks" (first 3 words) which matches existing
      expect(result.finalCategory).toBe("Code Review Tasks");
      expect(result.isNew).toBe(false);
      expect(result.rawLLMCategory).toBe("Code Review Tasks Extra");
      expect(result.source).toBe("llm");
    });

    it("allows ≤3 word new category names through", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Data Entry",
          isExisting: false,
          confidence: 0.85,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Enter invoice data", [
        "Development",
      ]);

      expect(result.finalCategory).toBe("Data Entry");
      expect(result.isNew).toBe(true);
      expect(result.source).toBe("llm");
    });
  });

  // -----------------------------------------------------------------------
  // Req 6.4 — closestExisting for low-confidence new categories
  // -----------------------------------------------------------------------

  describe("closestExisting for low-confidence new categories (Req 6.4)", () => {
    it("sets closestExisting when new category has confidence < 0.5", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Niche Task",
          isExisting: false,
          confidence: 0.3,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Do something niche", [
        "Development",
        "Design",
      ]);

      expect(result.isNew).toBe(true);
      expect(result.closestExisting).toBe("Development");
    });

    it("does NOT set closestExisting when confidence >= 0.5", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Data Entry",
          isExisting: false,
          confidence: 0.7,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Enter data", ["Development"]);

      expect(result.closestExisting).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Req 10.4 — "Other" fallback triggers lowConfidence
  // -----------------------------------------------------------------------

  describe('"Other" fallback triggers lowConfidence (Req 10.4)', () => {
    it('sets lowConfidence=true when normalizer produces "Other"', async () => {
      const { client } = createMockClient(
        new Error("LLM down"),
        new Error("LLM down"),
      );

      const assigner = new AICategoryAssigner(client);
      // Use a description that won't match any normalizer keyword
      const result = await assigner.assign("zzz completely unknown task zzz", [
        "Development",
      ]);

      expect(result.finalCategory).toBe("Other");
      expect(result.lowConfidence).toBe(true);
      expect(result.source).toBe("fallback");
      expect(result.confidence).toBe(0.0);
    });

    it("sets lowConfidence=false when normalizer produces a real category", async () => {
      const { client } = createMockClient(
        new Error("LLM down"),
        new Error("LLM down"),
      );

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Write a blog post", [
        "Development",
      ]);

      expect(result.finalCategory).toBe("Writing");
      expect(result.lowConfidence).toBe(false);
      expect(result.source).toBe("fallback");
    });
  });

  // -----------------------------------------------------------------------
  // Req 4.6 — Prompt instructs LLM to validate new names are not synonyms
  // -----------------------------------------------------------------------

  describe("synonym validation instruction (Req 4.6)", () => {
    it("prompt contains instruction to avoid synonyms/duplicates", async () => {
      const { client, capturedCalls } = createCapturingMockClient(
        "Development",
        true,
      );

      const assigner = new AICategoryAssigner(client);
      await assigner.assign("Fix the login bug", ["Development", "Design"]);

      const firstCall = capturedCalls[0];
      const allContent = firstCall.messages.map((m) => m.content).join("\n");

      expect(allContent).toMatch(/synonym/i);
    });
  });

  // -----------------------------------------------------------------------
  // Req 4.4 — Prompt requests confidence score
  // -----------------------------------------------------------------------

  describe("prompt requests confidence (Req 4.4)", () => {
    it("prompt contains instruction to return confidence score", async () => {
      const { client, capturedCalls } = createCapturingMockClient(
        "Development",
        true,
      );

      const assigner = new AICategoryAssigner(client);
      await assigner.assign("Fix the login bug", ["Development"]);

      const firstCall = capturedCalls[0];
      const allContent = firstCall.messages.map((m) => m.content).join("\n");

      expect(allContent).toMatch(/confidence/i);
      expect(allContent).toContain("0.0");
      expect(allContent).toContain("1.0");
    });
  });

  // -----------------------------------------------------------------------
  // Req 4.5 — source field correctness
  // -----------------------------------------------------------------------

  describe("source field correctness (Req 4.5)", () => {
    it("returns source='llm' when LLM succeeds on first attempt", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Design",
          isExisting: true,
          confidence: 0.92,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Create wireframes", [
        "Design",
        "Development",
      ]);

      expect(result.source).toBe("llm");
      expect(result.rawLLMCategory).toBe("Design");
    });

    it("returns source='llm' when LLM succeeds on retry", async () => {
      const { client } = createMockClient(
        { content: "not json" },
        {
          content: JSON.stringify({
            category: "Design",
            isExisting: true,
            confidence: 0.8,
          }),
        },
      );

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Create wireframes", ["Design"]);

      expect(result.source).toBe("llm");
    });

    it("returns source='fallback' when both LLM attempts fail", async () => {
      const { client } = createMockClient(
        { content: "invalid" },
        { content: "still invalid" },
      );

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Write documentation", ["Writing"]);

      expect(result.source).toBe("fallback");
      expect(result.rawLLMCategory).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // JSON extraction — markdown code fences
  // -----------------------------------------------------------------------

  describe("JSON extraction from markdown fences", () => {
    it("parses JSON wrapped in markdown code fences", async () => {
      const { client } = createMockClient({
        content:
          '```json\n{"category": "Development", "isExisting": true, "confidence": 0.88}\n```',
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Fix the login bug", [
        "Development",
      ]);

      expect(result.finalCategory).toBe("Development");
      expect(result.source).toBe("llm");
      expect(result.confidence).toBe(0.88);
    });

    it("parses JSON wrapped in plain code fences (no language tag)", async () => {
      const { client } = createMockClient({
        content:
          '```\n{"category": "Testing", "isExisting": true, "confidence": 0.75}\n```',
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Run the test suite", ["Testing"]);

      expect(result.finalCategory).toBe("Testing");
      expect(result.source).toBe("llm");
    });
  });

  // -----------------------------------------------------------------------
  // Null content from LLM
  // -----------------------------------------------------------------------

  describe("null content from LLM", () => {
    it("falls back when LLM returns null content on both attempts", async () => {
      const { client, create } = createMockClient(
        { content: null },
        { content: null },
      );

      const assigner = new AICategoryAssigner(client);
      const description = "Write a blog post";
      const result = await assigner.assign(description, ["Writing"]);

      expect(create).toHaveBeenCalledTimes(2);
      expect(result.source).toBe("fallback");
      expect(result.finalCategory).toBe(normalize(description));
    });
  });

  // -----------------------------------------------------------------------
  // Case-insensitive existing category matching
  // -----------------------------------------------------------------------

  describe("case-insensitive existing category matching", () => {
    it("treats LLM response as existing when it matches an existing category case-insensitively", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "development",
          isExisting: false,
          confidence: 0.9,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Fix the login bug", [
        "Development",
        "Design",
      ]);

      // "development" matches "Development" case-insensitively, so isNew should be false
      expect(result.isNew).toBe(false);
      expect(result.finalCategory).toBe("development");
    });
  });

  // -----------------------------------------------------------------------
  // Confidence clamping edge cases
  // -----------------------------------------------------------------------

  describe("confidence clamping edge cases", () => {
    it("clamps negative confidence to 0.0", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Development",
          isExisting: true,
          confidence: -0.5,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Fix the login bug", [
        "Development",
      ]);

      expect(result.confidence).toBe(0.0);
    });
  });

  // -----------------------------------------------------------------------
  // closestExisting edge cases
  // -----------------------------------------------------------------------

  describe("closestExisting edge cases", () => {
    it("sets closestExisting to null when no existing categories and confidence < 0.5", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "New Category",
          isExisting: false,
          confidence: 0.3,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Do something", []);

      expect(result.isNew).toBe(true);
      expect(result.closestExisting).toBeNull();
    });

    it("does NOT set closestExisting for existing category matches even with low confidence", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Development",
          isExisting: true,
          confidence: 0.3,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      const result = await assigner.assign("Fix the login bug", [
        "Development",
      ]);

      expect(result.isNew).toBe(false);
      expect(result.closestExisting).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // >20 threshold boundary (Req 6.3)
  // -----------------------------------------------------------------------

  describe(">20 threshold boundary (Req 6.3)", () => {
    it("does NOT include extra warning when activeCategoryCount is exactly 20", async () => {
      const { client, capturedCalls } = createCapturingMockClient(
        "Development",
        true,
      );

      const assigner = new AICategoryAssigner(client);
      await assigner.assign("Fix the login bug", ["Development"], 20);

      const firstCall = capturedCalls[0];
      const allContent = firstCall.messages.map((m) => m.content).join("\n");

      expect(allContent).not.toContain("IMPORTANT");
    });

    it("includes extra warning when activeCategoryCount is exactly 21", async () => {
      const { client, capturedCalls } = createCapturingMockClient(
        "Development",
        true,
      );

      const assigner = new AICategoryAssigner(client);
      await assigner.assign("Fix the login bug", ["Development"], 21);

      const firstCall = capturedCalls[0];
      const allContent = firstCall.messages.map((m) => m.content).join("\n");

      expect(allContent).toContain("IMPORTANT");
      expect(allContent).toContain("21");
    });
  });

  // -----------------------------------------------------------------------
  // 3-word truncation combined with "Other" fallback (Req 5.4, 10.4)
  // -----------------------------------------------------------------------

  describe("3-word truncation with Other fallback (Req 5.4, 10.4)", () => {
    it("sets lowConfidence=true when >3 word truncation falls back to normalizer producing Other", async () => {
      const { client } = createMockClient({
        content: JSON.stringify({
          category: "Extremely Specific Niche Task Category",
          isExisting: false,
          confidence: 0.7,
        }),
      });

      const assigner = new AICategoryAssigner(client);
      // Use a description that won't match any normalizer keyword
      const result = await assigner.assign("zzz completely unknown task zzz", [
        "Development",
      ]);

      expect(result.source).toBe("fallback");
      expect(result.finalCategory).toBe("Other");
      expect(result.lowConfidence).toBe(true);
      expect(result.rawLLMCategory).toBe(
        "Extremely Specific Niche Task Category",
      );
    });
  });

  // -----------------------------------------------------------------------
  // Prompt includes existing categories list (Req 6.2)
  // -----------------------------------------------------------------------

  describe("prompt includes existing categories (Req 6.2)", () => {
    it("prompt contains all existing category names", async () => {
      const { client, capturedCalls } = createCapturingMockClient(
        "Development",
        true,
      );

      const assigner = new AICategoryAssigner(client);
      await assigner.assign("Fix the login bug", [
        "Development",
        "Design",
        "Research",
      ]);

      const firstCall = capturedCalls[0];
      const allContent = firstCall.messages.map((m) => m.content).join("\n");

      expect(allContent).toContain("Development");
      expect(allContent).toContain("Design");
      expect(allContent).toContain("Research");
    });

    it("prompt indicates no existing categories when list is empty", async () => {
      const { client, capturedCalls } = createCapturingMockClient(
        "Development",
        false,
      );

      const assigner = new AICategoryAssigner(client);
      await assigner.assign("Fix the login bug", []);

      const firstCall = capturedCalls[0];
      const allContent = firstCall.messages.map((m) => m.content).join("\n");

      expect(allContent).toMatch(/no existing categories/i);
    });
  });

  // -----------------------------------------------------------------------
  // LLM response with missing/invalid category field
  // -----------------------------------------------------------------------

  describe("invalid LLM response structure", () => {
    it("falls back when LLM returns JSON with empty category string", async () => {
      const { client, create } = createMockClient(
        {
          content: JSON.stringify({
            category: "",
            isExisting: true,
            confidence: 0.9,
          }),
        },
        {
          content: JSON.stringify({
            category: "",
            isExisting: true,
            confidence: 0.9,
          }),
        },
      );

      const assigner = new AICategoryAssigner(client);
      const description = "Write a blog post";
      const result = await assigner.assign(description, ["Writing"]);

      expect(create).toHaveBeenCalledTimes(2);
      expect(result.source).toBe("fallback");
      expect(result.finalCategory).toBe(normalize(description));
    });

    it("falls back when LLM returns JSON without category field", async () => {
      const { client, create } = createMockClient(
        {
          content: JSON.stringify({
            name: "Development",
            isExisting: true,
          }),
        },
        {
          content: JSON.stringify({
            name: "Development",
            isExisting: true,
          }),
        },
      );

      const assigner = new AICategoryAssigner(client);
      const description = "Fix the login bug";
      const result = await assigner.assign(description, ["Development"]);

      expect(create).toHaveBeenCalledTimes(2);
      expect(result.source).toBe("fallback");
    });
  });
});
