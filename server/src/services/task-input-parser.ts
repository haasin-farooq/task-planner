import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import type { ParsedTask, ParseResult } from "../types/index.js";

/**
 * Schema description sent to the LLM so it returns well-structured JSON.
 */
const PARSE_SYSTEM_PROMPT = `You are a task-parsing assistant. The user will give you a raw, unstructured block of text describing tasks they want to accomplish today.

Your job:
1. Split the text into individual, discrete tasks.
2. If a single sentence describes multiple distinct activities (a compound task), split it into separate tasks. Set "splitFrom" on each child to the same generated compound ID.
3. If a task description is vague or ambiguous, set "isAmbiguous" to true.
4. Return ONLY valid JSON matching the schema below — no markdown fences, no commentary.

JSON schema:
{
  "tasks": [
    {
      "rawText": "<original text fragment>",
      "description": "<cleaned-up, concise description>",
      "isAmbiguous": <boolean>,
      "splitFrom": "<compound-id or null>"
    }
  ]
}`;

const STRICT_RETRY_PROMPT = `You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.
The JSON must have a single key "tasks" containing an array of objects. Each object must have:
- "rawText" (string): the original text fragment
- "description" (string): a cleaned-up concise description
- "isAmbiguous" (boolean): true if the task is vague
- "splitFrom" (string or null): a compound ID if this was split from a compound task

Example:
{"tasks":[{"rawText":"buy groceries","description":"Buy groceries","isAmbiguous":false,"splitFrom":null}]}

Now parse the following text into tasks using ONLY the JSON format above:`;

interface LLMParsedTask {
  rawText: string;
  description: string;
  isAmbiguous: boolean;
  splitFrom?: string | null;
}

interface LLMParseResponse {
  tasks: LLMParsedTask[];
}

export class TaskInputParser {
  private client: OpenAI;
  private model: string;

  constructor(client?: OpenAI, model?: string) {
    this.client = client ?? new OpenAI();
    this.model = model ?? "gpt-4o-mini";
  }

  /**
   * Parse raw, unstructured text into discrete tasks via the LLM.
   *
   * - Empty / whitespace-only input returns an error immediately.
   * - On a malformed LLM response the parser retries once with a stricter prompt.
   */
  async parse(rawText: string): Promise<ParseResult> {
    // Handle empty / whitespace input (Req 1.3)
    if (!rawText || rawText.trim().length === 0) {
      return {
        tasks: [],
        ambiguousItems: [],
        errors: ["No tasks detected. Please enter at least one task."],
      };
    }

    const trimmedText = rawText.trim();

    // First attempt
    let llmTasks = await this.callLLM(trimmedText, false);

    // Retry once with stricter prompt if the first attempt failed
    if (llmTasks === null) {
      llmTasks = await this.callLLM(trimmedText, true);
    }

    // Both attempts failed
    if (llmTasks === null) {
      return {
        tasks: [],
        ambiguousItems: [],
        errors: ["Failed to parse tasks. Please try simplifying your input."],
      };
    }

    // No tasks extracted by the LLM
    if (llmTasks.length === 0) {
      return {
        tasks: [],
        ambiguousItems: [],
        errors: ["No tasks detected. Please enter at least one task."],
      };
    }

    // Convert LLM output to ParsedTask objects
    const tasks: ParsedTask[] = llmTasks.map((t) => ({
      id: uuidv4(),
      rawText: t.rawText,
      description: t.description,
      isAmbiguous: Boolean(t.isAmbiguous),
      ...(t.splitFrom ? { splitFrom: t.splitFrom } : {}),
    }));

    // Separate ambiguous items (Req 1.2)
    const ambiguousItems = tasks.filter((t) => t.isAmbiguous);

    return {
      tasks,
      ambiguousItems,
      errors: [],
    };
  }

  /**
   * Send the raw text to the LLM and attempt to parse the JSON response.
   * Returns null when the response cannot be parsed as valid JSON.
   */
  private async callLLM(
    text: string,
    strict: boolean,
  ): Promise<LLMParsedTask[] | null> {
    try {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        strict
          ? [
              {
                role: "user",
                content: `${STRICT_RETRY_PROMPT}\n\n${text}`,
              },
            ]
          : [
              { role: "system", content: PARSE_SYSTEM_PROMPT },
              { role: "user", content: text },
            ];

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.2,
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        return null;
      }

      const parsed = this.extractJSON(content);
      if (!parsed) {
        return null;
      }

      return this.validateLLMResponse(parsed);
    } catch {
      return null;
    }
  }

  /**
   * Try to extract a JSON object from the LLM response string.
   * Handles cases where the LLM wraps JSON in markdown code fences.
   */
  private extractJSON(raw: string): unknown | null {
    const trimmed = raw.trim();

    // Try direct parse first
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }

    // Strip markdown code fences and retry
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        // fall through
      }
    }

    return null;
  }

  /**
   * Validate that the parsed JSON conforms to the expected shape.
   */
  private validateLLMResponse(data: unknown): LLMParsedTask[] | null {
    if (typeof data !== "object" || data === null) {
      return null;
    }

    const obj = data as Record<string, unknown>;
    if (!Array.isArray(obj.tasks)) {
      return null;
    }

    const tasks: LLMParsedTask[] = [];

    for (const item of obj.tasks) {
      if (typeof item !== "object" || item === null) {
        continue;
      }

      const t = item as Record<string, unknown>;

      if (typeof t.description !== "string" || t.description.trim() === "") {
        continue;
      }

      tasks.push({
        rawText: typeof t.rawText === "string" ? t.rawText : t.description,
        description: t.description.trim(),
        isAmbiguous: Boolean(t.isAmbiguous),
        splitFrom: typeof t.splitFrom === "string" ? t.splitFrom : null,
      });
    }

    return tasks;
  }
}
