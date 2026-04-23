/**
 * AICategoryAssigner — assigns a category to a task description using an LLM,
 * preferring existing categories and falling back to the keyword normalizer.
 *
 * Responsibilities:
 * - Send task description + existing category list to the LLM
 * - Instruct LLM to prefer existing categories over proposing new ones
 * - Enforce naming constraints on new categories (≤3 words, title-cased, general-purpose)
 * - When >30 categories exist, emphasize reuse even more strongly
 * - Parse JSON response: { "category": "...", "isExisting": true/false }
 * - Retry once with stricter prompt on parse failure
 * - Fall back to keyword normalizer on total failure
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4,
 *              11.1, 11.2, 11.3, 11.4
 */

import OpenAI from "openai";
import { normalize } from "../utils/category-normalizer.js";

// ---------------------------------------------------------------------------
// Result interface
// ---------------------------------------------------------------------------

export interface CategoryAssignmentResult {
  /** The raw string returned by the LLM, or null if fallback was used */
  rawLLMCategory: string | null;
  /** The resolved category name (existing or newly created) */
  finalCategory: string;
  /** Whether the LLM proposed a new category (not in the existing list) */
  isNew: boolean;
}

// ---------------------------------------------------------------------------
// LLM response shape
// ---------------------------------------------------------------------------

interface LLMCategoryResponse {
  category: string;
  isExisting: boolean;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  description: string,
  existingCategories: string[],
): string {
  const categoryList =
    existingCategories.length > 0
      ? existingCategories.map((c) => `- ${c}`).join("\n")
      : "(no existing categories)";

  let prompt = `You are a task-categorization assistant. Given a task description, assign it to the most appropriate category.

Task description: "${description}"

Existing categories:
${categoryList}

Rules:
1. PREFER selecting an existing category from the list above. Only propose a new category when none of the existing categories fit the task description.
2. If you propose a new category, the name must be:
   - At most 3 words
   - Title-cased (e.g., "Data Entry", "Code Review")
   - General-purpose enough to apply to multiple future tasks — not a task-specific description
3. Return ONLY valid JSON matching this schema — no markdown fences, no commentary:
   { "category": "<category name>", "isExisting": <true if selected from list, false if new> }`;

  if (existingCategories.length > 30) {
    prompt += `\n\nIMPORTANT: There are already ${existingCategories.length} categories. You should almost always select an existing category. Only create a new category in truly exceptional cases where the task clearly does not fit ANY existing category.`;
  }

  return prompt;
}

const STRICT_RETRY_PROMPT = `You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.
The JSON must have exactly two keys:
- "category" (string): the category name
- "isExisting" (boolean): true if the category was selected from the provided list, false if it is a new proposal

Example: {"category": "Development", "isExisting": true}

Now categorize the following task and return ONLY the JSON:`;

// ---------------------------------------------------------------------------
// AICategoryAssigner
// ---------------------------------------------------------------------------

export class AICategoryAssigner {
  private client: OpenAI;
  private model: string;

  constructor(client?: OpenAI, model?: string) {
    this.client = client ?? new OpenAI();
    this.model = model ?? "gpt-4o-mini";
  }

  /**
   * Assign a category to a task description.
   *
   * 1. Call the LLM with the description and existing categories.
   * 2. On parse failure, retry once with a stricter prompt.
   * 3. On total failure, fall back to the keyword normalizer.
   */
  async assign(
    description: string,
    existingCategories: string[],
  ): Promise<CategoryAssignmentResult> {
    // First attempt
    let result = await this.callLLM(description, existingCategories, false);

    // Retry once with stricter prompt on failure (Req 2.7)
    if (result === null) {
      result = await this.callLLM(description, existingCategories, true);
    }

    // Both attempts failed — fall back to keyword normalizer (Req 3.1, 3.2, 3.3)
    if (result === null) {
      console.warn(
        `[AICategoryAssigner] LLM failed after retry for description: "${description.slice(0, 80)}". Falling back to keyword normalizer.`,
      );
      const fallbackCategory = normalize(description);
      return {
        rawLLMCategory: null,
        finalCategory: fallbackCategory,
        isNew: false,
      };
    }

    // Determine if the LLM selected an existing category or proposed a new one
    const existingSet = new Set(existingCategories.map((c) => c.toLowerCase()));
    const isNew = !existingSet.has(result.category.toLowerCase());

    return {
      rawLLMCategory: result.category,
      finalCategory: result.category,
      isNew,
    };
  }

  // -----------------------------------------------------------------------
  // LLM interaction
  // -----------------------------------------------------------------------

  private async callLLM(
    description: string,
    existingCategories: string[],
    strict: boolean,
  ): Promise<LLMCategoryResponse | null> {
    try {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        strict
          ? [
              {
                role: "user",
                content: `${STRICT_RETRY_PROMPT}\n\nTask: "${description}"\nExisting categories: ${existingCategories.join(", ")}`,
              },
            ]
          : [
              {
                role: "system",
                content: buildSystemPrompt(description, existingCategories),
              },
              { role: "user", content: description },
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
    } catch (error) {
      console.error(
        "[AICategoryAssigner] LLM call failed:",
        error instanceof Error ? error.message : error,
      );
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
   * Validate that the parsed JSON conforms to the expected shape:
   * { "category": "...", "isExisting": true/false }
   */
  private validateLLMResponse(data: unknown): LLMCategoryResponse | null {
    if (typeof data !== "object" || data === null) {
      return null;
    }

    const obj = data as Record<string, unknown>;

    if (typeof obj.category !== "string" || obj.category.trim() === "") {
      return null;
    }

    return {
      category: obj.category.trim(),
      isExisting: typeof obj.isExisting === "boolean" ? obj.isExisting : false,
    };
  }
}
