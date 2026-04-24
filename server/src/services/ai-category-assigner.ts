/**
 * AICategoryAssigner — assigns a category to a task description using an LLM,
 * preferring existing categories and falling back to the keyword normalizer.
 *
 * Responsibilities:
 * - Send task description + existing category list to the LLM
 * - Instruct LLM to prefer existing categories over proposing new ones
 * - Enforce naming constraints on new categories (≤3 words, title-cased, general-purpose)
 * - When >20 categories exist, emphasize reuse even more strongly
 * - Parse JSON response: { "category": "...", "isExisting": true/false, "confidence": 0.0-1.0 }
 * - Retry once with stricter prompt on parse failure
 * - Fall back to keyword normalizer on total failure
 * - Return confidence scores, source tracking, and low-confidence flags
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4,
 *              6.1, 6.2, 6.3, 6.4, 10.1, 10.2, 10.3, 10.4, 10.5
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
  /** LLM confidence score 0.0-1.0, or 0.0 for fallback */
  confidence: number;
  /** How the category was assigned */
  source: "llm" | "fallback";
  /** When confidence < 0.5 and isNew, the closest existing category */
  closestExisting: string | null;
  /** Whether the assignment is flagged as low confidence */
  lowConfidence: boolean;
}

// ---------------------------------------------------------------------------
// LLM response shape
// ---------------------------------------------------------------------------

interface LLMCategoryResponse {
  category: string;
  isExisting: boolean;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  description: string,
  existingCategories: string[],
  activeCategoryCount?: number,
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
3. Do NOT propose a new category that is a synonym or near-duplicate of an existing category. Check the existing list carefully before proposing a new name.
4. Return ONLY valid JSON matching this schema — no markdown fences, no commentary:
   { "category": "<category name>", "isExisting": <true if selected from list, false if new>, "confidence": <0.0 to 1.0> }
5. The confidence score should reflect how well the category fits the task:
   - 0.9-1.0: Perfect match to an existing category
   - 0.7-0.9: Good match
   - 0.5-0.7: Reasonable match
   - Below 0.5: Weak match — consider if an existing category might work instead`;

  const effectiveCount =
    activeCategoryCount !== undefined
      ? activeCategoryCount
      : existingCategories.length;

  if (effectiveCount > 20) {
    prompt += `\n\nIMPORTANT: There are already ${effectiveCount} categories. You should almost always select an existing category. Only create a new category in truly exceptional cases where the task clearly does not fit ANY existing category.`;
  }

  return prompt;
}

const STRICT_RETRY_PROMPT = `You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.
The JSON must have exactly three keys:
- "category" (string): the category name
- "isExisting" (boolean): true if the category was selected from the provided list, false if it is a new proposal
- "confidence" (number): a confidence score from 0.0 to 1.0

Example: {"category": "Development", "isExisting": true, "confidence": 0.95}

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
    activeCategoryCount?: number,
  ): Promise<CategoryAssignmentResult> {
    // First attempt
    let result = await this.callLLM(
      description,
      existingCategories,
      false,
      activeCategoryCount,
    );

    // Retry once with stricter prompt on failure (Req 4.7)
    if (result === null) {
      result = await this.callLLM(
        description,
        existingCategories,
        true,
        activeCategoryCount,
      );
    }

    // Both attempts failed — fall back to keyword normalizer (Req 10.1, 10.2)
    if (result === null) {
      console.warn(
        `[AICategoryAssigner] LLM failed after retry for description: "${description.slice(0, 80)}". Falling back to keyword normalizer.`,
      );
      const fallbackCategory = normalize(description);
      return {
        rawLLMCategory: null,
        finalCategory: fallbackCategory,
        isNew: false,
        confidence: 0.0,
        source: "fallback",
        closestExisting: null,
        lowConfidence: fallbackCategory === "Other",
      };
    }

    // Enforce ≤3 word naming rule on new categories (Req 5.4)
    const existingSet = new Set(existingCategories.map((c) => c.toLowerCase()));
    const isNew = !existingSet.has(result.category.toLowerCase());

    if (isNew) {
      const words = result.category.trim().split(/\s+/);
      if (words.length > 3) {
        // Truncate to first 3 words
        const truncated = words.slice(0, 3).join(" ");

        // If truncated name matches an existing category, use it
        if (existingSet.has(truncated.toLowerCase())) {
          return {
            rawLLMCategory: result.category,
            finalCategory: truncated,
            isNew: false,
            confidence: result.confidence,
            source: "llm",
            closestExisting: null,
            lowConfidence: false,
          };
        }

        // Otherwise fall back to normalizer
        console.warn(
          `[AICategoryAssigner] LLM proposed >3 word category "${result.category}", truncated "${truncated}" does not match existing. Falling back.`,
        );
        const fallbackCategory = normalize(description);
        return {
          rawLLMCategory: result.category,
          finalCategory: fallbackCategory,
          isNew: false,
          confidence: 0.0,
          source: "fallback",
          closestExisting: null,
          lowConfidence: fallbackCategory === "Other",
        };
      }
    }

    // Determine closestExisting for low-confidence new categories (Req 6.4)
    let closestExisting: string | null = null;
    if (isNew && result.confidence < 0.5 && existingCategories.length > 0) {
      // Use the first existing category as the closest (simple heuristic)
      closestExisting = existingCategories[0];
    }

    return {
      rawLLMCategory: result.category,
      finalCategory: result.category,
      isNew,
      confidence: result.confidence,
      source: "llm",
      closestExisting,
      lowConfidence: false,
    };
  }

  // -----------------------------------------------------------------------
  // LLM interaction
  // -----------------------------------------------------------------------

  private async callLLM(
    description: string,
    existingCategories: string[],
    strict: boolean,
    activeCategoryCount?: number,
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
                content: buildSystemPrompt(
                  description,
                  existingCategories,
                  activeCategoryCount,
                ),
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
   * { "category": "...", "isExisting": true/false, "confidence": 0.0-1.0 }
   */
  private validateLLMResponse(data: unknown): LLMCategoryResponse | null {
    if (typeof data !== "object" || data === null) {
      return null;
    }

    const obj = data as Record<string, unknown>;

    if (typeof obj.category !== "string" || obj.category.trim() === "") {
      return null;
    }

    // Parse confidence, defaulting to 0.5 if not provided or invalid
    let confidence = 0.5;
    if (typeof obj.confidence === "number" && isFinite(obj.confidence)) {
      confidence = Math.max(0.0, Math.min(1.0, obj.confidence));
    }

    return {
      category: obj.category.trim(),
      isExisting: typeof obj.isExisting === "boolean" ? obj.isExisting : false,
      confidence,
    };
  }
}
