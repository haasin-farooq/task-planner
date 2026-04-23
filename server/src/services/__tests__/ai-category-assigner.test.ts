/**
 * Unit tests for AICategoryAssigner.
 *
 * Uses a mock OpenAI client injected via the constructor to test assignment
 * logic, retry behavior, fallback, and prompt construction without hitting
 * a real LLM.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4
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
 * returns a valid category response.
 */
function createCapturingMockClient(category: string, isExisting: boolean) {
  const capturedCalls: Array<{
    messages: Array<{ role: string; content: string }>;
  }> = [];

  const create = vi.fn().mockImplementation(async (params: any) => {
    capturedCalls.push({ messages: params.messages });
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({ category, isExisting }),
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
      });
    });
  });

  // -----------------------------------------------------------------------
  // Req 2.7 — LLM returns invalid JSON → retries with stricter prompt
  // -----------------------------------------------------------------------

  describe("retry on invalid JSON (Req 2.7)", () => {
    it("retries with stricter prompt when first response is invalid JSON, succeeds on retry", async () => {
      const { client, create } = createMockClient(
        // First call: invalid JSON
        { content: "I think this task is about development" },
        // Second call (retry): valid JSON
        {
          content: JSON.stringify({
            category: "Development",
            isExisting: true,
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
      });
    });
  });

  // -----------------------------------------------------------------------
  // Req 3.1, 3.2, 3.3 — LLM fails twice → falls back to keyword normalizer
  // -----------------------------------------------------------------------

  describe("fallback to keyword normalizer (Req 3.1, 3.2, 3.3)", () => {
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
      });
    });
  });

  // -----------------------------------------------------------------------
  // Req 2.4, 2.5 — Prompt contains instruction to prefer existing categories
  // -----------------------------------------------------------------------

  describe("prompt instructs to prefer existing categories (Req 2.4, 2.5)", () => {
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

      // Req 2.4: prefer existing categories
      expect(allContent).toMatch(/prefer.*existing/i);

      // Req 2.5: new category constraints
      expect(allContent).toMatch(/3 words/i);
      expect(allContent).toMatch(/title.?case/i);
    });
  });

  // -----------------------------------------------------------------------
  // Req 2.5 — Prompt contains formatting constraints for new categories
  // -----------------------------------------------------------------------

  describe("prompt contains formatting constraints (Req 2.5)", () => {
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
  // Req 3.4 — Fallback logs a warning
  // -----------------------------------------------------------------------

  describe("fallback logs a warning (Req 3.4)", () => {
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
        }),
      });

      const assigner = new AICategoryAssigner(client);
      await assigner.assign("Write documentation", ["Writing", "Development"]);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
