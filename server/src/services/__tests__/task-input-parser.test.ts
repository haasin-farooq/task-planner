/**
 * Unit tests for TaskInputParser.
 *
 * Uses a mock OpenAI client injected via the constructor to test parsing
 * logic, retry behavior, and error handling without hitting a real LLM.
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 */

import { describe, it, expect, vi } from "vitest";
import { TaskInputParser } from "../task-input-parser.js";

// ---------------------------------------------------------------------------
// Mock OpenAI client helper
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock that satisfies the OpenAI client shape used by
 * TaskInputParser (only `chat.completions.create` is called).
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

  // Cast to `any` — we only need the subset of the OpenAI interface that
  // TaskInputParser actually uses.
  return {
    client: { chat: { completions: { create } } } as any,
    create,
  };
}

/**
 * Convenience: wrap a tasks array in the JSON string the LLM would return.
 */
function llmJson(
  tasks: Array<{
    rawText: string;
    description: string;
    isAmbiguous?: boolean;
    splitFrom?: string | null;
  }>,
): string {
  return JSON.stringify({
    tasks: tasks.map((t) => ({
      rawText: t.rawText,
      description: t.description,
      isAmbiguous: t.isAmbiguous ?? false,
      splitFrom: t.splitFrom ?? null,
    })),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskInputParser", () => {
  // -----------------------------------------------------------------------
  // Req 1.3 — Empty / whitespace input
  // -----------------------------------------------------------------------

  describe("empty and whitespace input (Req 1.3)", () => {
    it("returns error for empty string input", async () => {
      const { client } = createMockClient();
      const parser = new TaskInputParser(client);

      const result = await parser.parse("");

      expect(result.tasks).toHaveLength(0);
      expect(result.ambiguousItems).toHaveLength(0);
      expect(result.errors).toContain(
        "No tasks detected. Please enter at least one task.",
      );
    });

    it("returns error for whitespace-only input", async () => {
      const { client } = createMockClient();
      const parser = new TaskInputParser(client);

      const result = await parser.parse("   \n\t  ");

      expect(result.tasks).toHaveLength(0);
      expect(result.ambiguousItems).toHaveLength(0);
      expect(result.errors).toContain(
        "No tasks detected. Please enter at least one task.",
      );
    });
  });

  // -----------------------------------------------------------------------
  // Req 1.1 — Parsed results contain expected fields
  // -----------------------------------------------------------------------

  describe("successful parsing (Req 1.1)", () => {
    it("returns ParsedTask objects with all expected fields", async () => {
      const { client } = createMockClient({
        content: llmJson([
          {
            rawText: "Buy groceries",
            description: "Buy groceries from the store",
            isAmbiguous: false,
            splitFrom: null,
          },
        ]),
      });
      const parser = new TaskInputParser(client);

      const result = await parser.parse("Buy groceries");

      expect(result.errors).toHaveLength(0);
      expect(result.tasks).toHaveLength(1);

      const task = result.tasks[0];
      expect(task).toHaveProperty("id");
      expect(typeof task.id).toBe("string");
      expect(task.id.length).toBeGreaterThan(0);
      expect(task.rawText).toBe("Buy groceries");
      expect(task.description).toBe("Buy groceries from the store");
      expect(task.isAmbiguous).toBe(false);
    });

    it("parses multiple tasks from a single input", async () => {
      const { client } = createMockClient({
        content: llmJson([
          { rawText: "Buy groceries", description: "Buy groceries" },
          { rawText: "Walk the dog", description: "Walk the dog" },
          { rawText: "Write report", description: "Write report" },
        ]),
      });
      const parser = new TaskInputParser(client);

      const result = await parser.parse(
        "Buy groceries, walk the dog, write report",
      );

      expect(result.errors).toHaveLength(0);
      expect(result.tasks).toHaveLength(3);
      // Each task should have a unique ID
      const ids = result.tasks.map((t) => t.id);
      expect(new Set(ids).size).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Req 1.2 — Ambiguous items separated into ambiguousItems array
  // -----------------------------------------------------------------------

  describe("ambiguous task handling (Req 1.2)", () => {
    it("separates ambiguous tasks into ambiguousItems array", async () => {
      const { client } = createMockClient({
        content: llmJson([
          {
            rawText: "Buy groceries",
            description: "Buy groceries",
            isAmbiguous: false,
          },
          {
            rawText: "Do the thing",
            description: "Do the thing",
            isAmbiguous: true,
          },
        ]),
      });
      const parser = new TaskInputParser(client);

      const result = await parser.parse("Buy groceries and do the thing");

      expect(result.tasks).toHaveLength(2);
      expect(result.ambiguousItems).toHaveLength(1);
      expect(result.ambiguousItems[0].description).toBe("Do the thing");
      expect(result.ambiguousItems[0].isAmbiguous).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Req 1.2 — Compound tasks with splitFrom
  // -----------------------------------------------------------------------

  describe("compound task splitting (Req 1.2)", () => {
    it("handles compound tasks with splitFrom field", async () => {
      const { client } = createMockClient({
        content: llmJson([
          {
            rawText: "Buy groceries and cook dinner",
            description: "Buy groceries",
            isAmbiguous: false,
            splitFrom: "compound-1",
          },
          {
            rawText: "Buy groceries and cook dinner",
            description: "Cook dinner",
            isAmbiguous: false,
            splitFrom: "compound-1",
          },
        ]),
      });
      const parser = new TaskInputParser(client);

      const result = await parser.parse("Buy groceries and cook dinner");

      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].splitFrom).toBe("compound-1");
      expect(result.tasks[1].splitFrom).toBe("compound-1");
    });

    it("omits splitFrom when it is null", async () => {
      const { client } = createMockClient({
        content: llmJson([
          {
            rawText: "Buy groceries",
            description: "Buy groceries",
            splitFrom: null,
          },
        ]),
      });
      const parser = new TaskInputParser(client);

      const result = await parser.parse("Buy groceries");

      expect(result.tasks[0]).not.toHaveProperty("splitFrom");
    });
  });

  // -----------------------------------------------------------------------
  // Retry logic — malformed first response, valid second response
  // -----------------------------------------------------------------------

  describe("retry logic on malformed LLM response", () => {
    it("retries with strict prompt when first response is malformed JSON", async () => {
      const { client, create } = createMockClient(
        // First call: malformed JSON
        { content: "This is not valid JSON at all" },
        // Second call (retry): valid JSON
        {
          content: llmJson([
            { rawText: "Buy groceries", description: "Buy groceries" },
          ]),
        },
      );
      const parser = new TaskInputParser(client);

      const result = await parser.parse("Buy groceries");

      expect(create).toHaveBeenCalledTimes(2);
      expect(result.errors).toHaveLength(0);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].description).toBe("Buy groceries");
    });

    it("returns failure error when both LLM calls return malformed JSON", async () => {
      const { client, create } = createMockClient(
        { content: "not json" },
        { content: "still not json" },
      );
      const parser = new TaskInputParser(client);

      const result = await parser.parse("Buy groceries");

      expect(create).toHaveBeenCalledTimes(2);
      expect(result.tasks).toHaveLength(0);
      expect(result.errors).toContain(
        "Failed to parse tasks. Please try simplifying your input.",
      );
    });

    it("retries when first response has null content", async () => {
      const { client, create } = createMockClient(
        { content: null },
        {
          content: llmJson([
            { rawText: "Walk the dog", description: "Walk the dog" },
          ]),
        },
      );
      const parser = new TaskInputParser(client);

      const result = await parser.parse("Walk the dog");

      expect(create).toHaveBeenCalledTimes(2);
      expect(result.tasks).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // LLM returns empty tasks array
  // -----------------------------------------------------------------------

  describe("LLM returns empty tasks", () => {
    it('returns "No tasks detected" error when LLM returns empty tasks array', async () => {
      const { client } = createMockClient({
        content: JSON.stringify({ tasks: [] }),
      });
      const parser = new TaskInputParser(client);

      const result = await parser.parse("some input");

      expect(result.tasks).toHaveLength(0);
      expect(result.errors).toContain(
        "No tasks detected. Please enter at least one task.",
      );
    });
  });

  // -----------------------------------------------------------------------
  // LLM throws an error
  // -----------------------------------------------------------------------

  describe("LLM error handling", () => {
    it("handles LLM throwing an error gracefully on both attempts", async () => {
      const { client } = createMockClient(
        new Error("API rate limit exceeded"),
        new Error("API rate limit exceeded"),
      );
      const parser = new TaskInputParser(client);

      const result = await parser.parse("Buy groceries");

      expect(result.tasks).toHaveLength(0);
      expect(result.errors).toContain(
        "Failed to parse tasks. Please try simplifying your input.",
      );
    });

    it("recovers when first call throws but retry succeeds", async () => {
      const { client } = createMockClient(
        new Error("Temporary network error"),
        {
          content: llmJson([
            { rawText: "Buy groceries", description: "Buy groceries" },
          ]),
        },
      );
      const parser = new TaskInputParser(client);

      const result = await parser.parse("Buy groceries");

      expect(result.errors).toHaveLength(0);
      expect(result.tasks).toHaveLength(1);
    });
  });
});
