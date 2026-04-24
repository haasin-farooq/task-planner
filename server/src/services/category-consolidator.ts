/**
 * CategoryConsolidator — uses an LLM to review a user's category list and
 * suggest taxonomy cleanups: merges, renames, and splits.
 *
 * Responsibilities:
 * - Send the user's full active category list to the LLM
 * - Instruct the LLM to identify duplicates, synonyms, overly narrow, and overly broad labels
 * - Parse the LLM response into ConsolidationSuggestion[] (merge, rename, split)
 * - Retry once with a stricter prompt on parse failure
 * - Return empty array on total failure
 * - Does NOT apply changes — returns suggestions only
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import type { CategoryEntity } from "../db/category-repository.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SuggestionAction = "merge" | "rename" | "split";

export interface ConsolidationSuggestion {
  id: string; // UUID for tracking
  action: SuggestionAction;
  // For merge:
  sourceCategoryId?: number;
  sourceCategoryName?: string;
  targetCategoryId?: number;
  targetCategoryName?: string;
  // For rename and split:
  categoryId?: number;
  currentName?: string;
  proposedName?: string;
  // For split:
  proposedNames?: string[];
  // Common:
  reason: string;
}

// ---------------------------------------------------------------------------
// Raw LLM response shape (before validation)
// ---------------------------------------------------------------------------

interface RawLLMSuggestion {
  action: string;
  sourceCategoryName?: string;
  targetCategoryName?: string;
  currentName?: string;
  proposedName?: string;
  proposedNames?: string[];
  reason?: string;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildAnalysisPrompt(categories: CategoryEntity[]): string {
  const categoryList = categories
    .map((c) => `- "${c.name}" (id: ${c.id})`)
    .join("\n");

  return `You are a taxonomy maintenance assistant. Review the following category list and suggest improvements to keep the taxonomy clean, consistent, and useful.

Categories:
${categoryList}

Analyze the list for:
1. **Duplicates / Synonyms**: Categories that mean the same thing and should be merged (e.g., "Dev Work" and "Development")
2. **Overly narrow labels**: Categories that are too specific and should be renamed to something more general
3. **Overly broad labels**: Categories that cover too many different types of tasks and should be split
4. **Inconsistent naming**: Categories that don't follow title-case or are poorly worded

For each suggestion, return one of these action types:
- "merge": Combine two near-duplicate categories. Specify "sourceCategoryName" (the one to remove) and "targetCategoryName" (the one to keep).
- "rename": Improve a category name. Specify "currentName" and "proposedName".
- "split": Break a broad category into more specific ones. Specify "currentName" and "proposedNames" (array of 2+ new names).

Return ONLY a valid JSON array of suggestion objects. No markdown fences, no commentary.
Each object must have: "action", the relevant name fields, and a "reason" string explaining why.

Example:
[
  {"action": "merge", "sourceCategoryName": "Dev Work", "targetCategoryName": "Development", "reason": "These are synonyms referring to the same type of work"},
  {"action": "rename", "currentName": "Misc", "proposedName": "General Tasks", "reason": "More descriptive and consistent with other category names"},
  {"action": "split", "currentName": "Work", "proposedNames": ["Client Work", "Internal Work"], "reason": "Too broad — covers distinct task types"}
]

If the taxonomy looks clean and no changes are needed, return an empty array: []`;
}

const STRICT_RETRY_PROMPT = `You MUST respond with ONLY a valid JSON array. No markdown, no explanation, no code fences.
Each element must be an object with:
- "action": one of "merge", "rename", or "split"
- For "merge": "sourceCategoryName" (string) and "targetCategoryName" (string)
- For "rename": "currentName" (string) and "proposedName" (string)
- For "split": "currentName" (string) and "proposedNames" (array of 2+ strings)
- "reason": a short explanation string

If no suggestions, return: []

Now analyze these categories and return ONLY the JSON array:`;

// ---------------------------------------------------------------------------
// CategoryConsolidator
// ---------------------------------------------------------------------------

export class CategoryConsolidator {
  private client: OpenAI;
  private model: string;

  constructor(client?: OpenAI, model?: string) {
    this.client = client ?? new OpenAI();
    this.model = model ?? "gpt-4o-mini";
  }

  /**
   * Analyze a user's category list and produce consolidation suggestions.
   * Does NOT apply changes — returns suggestions for review.
   *
   * 1. Call the LLM with the full category list.
   * 2. On parse failure, retry once with a stricter prompt.
   * 3. On total failure, return an empty array.
   */
  async analyze(
    categories: CategoryEntity[],
  ): Promise<ConsolidationSuggestion[]> {
    // Nothing to consolidate with 0 or 1 categories
    if (categories.length <= 1) {
      return [];
    }

    // Build a lookup map for resolving category IDs from names
    const categoryMap = new Map<string, CategoryEntity>();
    for (const cat of categories) {
      categoryMap.set(cat.name.toLowerCase(), cat);
    }

    // First attempt
    let rawSuggestions = await this.callLLM(categories, false);

    // Retry once with stricter prompt on failure
    if (rawSuggestions === null) {
      rawSuggestions = await this.callLLM(categories, true);
    }

    // Both attempts failed — return empty array
    if (rawSuggestions === null) {
      console.warn(
        "[CategoryConsolidator] LLM failed after retry. Returning empty suggestions.",
      );
      return [];
    }

    // Convert raw suggestions to ConsolidationSuggestion[] with IDs and resolved category IDs
    return this.buildSuggestions(rawSuggestions, categoryMap);
  }

  // -----------------------------------------------------------------------
  // LLM interaction
  // -----------------------------------------------------------------------

  private async callLLM(
    categories: CategoryEntity[],
    strict: boolean,
  ): Promise<RawLLMSuggestion[] | null> {
    try {
      const categoryNames = categories
        .map((c) => `"${c.name}" (id: ${c.id})`)
        .join(", ");

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        strict
          ? [
              {
                role: "user",
                content: `${STRICT_RETRY_PROMPT}\n\nCategories: ${categoryNames}`,
              },
            ]
          : [
              {
                role: "system",
                content: buildAnalysisPrompt(categories),
              },
              {
                role: "user",
                content: "Analyze the categories above and return suggestions.",
              },
            ];

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.3,
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        return null;
      }

      const parsed = this.extractJSON(content);
      if (!parsed) {
        return null;
      }

      return this.validateRawSuggestions(parsed);
    } catch (error) {
      console.error(
        "[CategoryConsolidator] LLM call failed:",
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  /**
   * Try to extract a JSON array from the LLM response string.
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
   * Validate that the parsed JSON is an array of suggestion objects
   * with the expected shape.
   */
  private validateRawSuggestions(data: unknown): RawLLMSuggestion[] | null {
    if (!Array.isArray(data)) {
      return null;
    }

    const validSuggestions: RawLLMSuggestion[] = [];

    for (const item of data) {
      if (typeof item !== "object" || item === null) {
        continue;
      }

      const obj = item as Record<string, unknown>;
      const action = obj.action;

      if (action !== "merge" && action !== "rename" && action !== "split") {
        continue;
      }

      const reason =
        typeof obj.reason === "string" ? obj.reason : "No reason provided";

      if (action === "merge") {
        if (
          typeof obj.sourceCategoryName !== "string" ||
          typeof obj.targetCategoryName !== "string"
        ) {
          continue;
        }
        validSuggestions.push({
          action,
          sourceCategoryName: obj.sourceCategoryName,
          targetCategoryName: obj.targetCategoryName,
          reason,
        });
      } else if (action === "rename") {
        if (
          typeof obj.currentName !== "string" ||
          typeof obj.proposedName !== "string"
        ) {
          continue;
        }
        validSuggestions.push({
          action,
          currentName: obj.currentName,
          proposedName: obj.proposedName,
          reason,
        });
      } else if (action === "split") {
        if (
          typeof obj.currentName !== "string" ||
          !Array.isArray(obj.proposedNames) ||
          obj.proposedNames.length < 2 ||
          !obj.proposedNames.every((n: unknown) => typeof n === "string")
        ) {
          continue;
        }
        validSuggestions.push({
          action,
          currentName: obj.currentName,
          proposedNames: obj.proposedNames as string[],
          reason,
        });
      }
    }

    return validSuggestions;
  }

  /**
   * Convert validated raw suggestions into ConsolidationSuggestion[] with
   * UUIDs and resolved category IDs from the category map.
   */
  private buildSuggestions(
    rawSuggestions: RawLLMSuggestion[],
    categoryMap: Map<string, CategoryEntity>,
  ): ConsolidationSuggestion[] {
    const suggestions: ConsolidationSuggestion[] = [];

    for (const raw of rawSuggestions) {
      if (raw.action === "merge") {
        const source = categoryMap.get(raw.sourceCategoryName!.toLowerCase());
        const target = categoryMap.get(raw.targetCategoryName!.toLowerCase());

        suggestions.push({
          id: uuidv4(),
          action: "merge",
          sourceCategoryId: source?.id,
          sourceCategoryName: raw.sourceCategoryName,
          targetCategoryId: target?.id,
          targetCategoryName: raw.targetCategoryName,
          reason: raw.reason!,
        });
      } else if (raw.action === "rename") {
        const category = categoryMap.get(raw.currentName!.toLowerCase());

        suggestions.push({
          id: uuidv4(),
          action: "rename",
          categoryId: category?.id,
          currentName: raw.currentName,
          proposedName: raw.proposedName,
          reason: raw.reason!,
        });
      } else if (raw.action === "split") {
        const category = categoryMap.get(raw.currentName!.toLowerCase());

        suggestions.push({
          id: uuidv4(),
          action: "split",
          categoryId: category?.id,
          currentName: raw.currentName,
          proposedNames: raw.proposedNames,
          reason: raw.reason!,
        });
      }
    }

    return suggestions;
  }
}
