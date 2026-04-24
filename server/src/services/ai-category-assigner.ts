/**
 * AICategoryAssigner — assigns a category to a task description using an LLM,
 * preferring existing categories and falling back to "Uncategorized" sentinel.
 *
 * Responsibilities:
 * - Send task description + existing category list to the LLM
 * - Instruct LLM to prefer existing categories over proposing new ones
 * - Frame categories as activity-type categories (what the task is about)
 * - Reject generic/process labels and retry with stronger prompt
 * - Filter weak/rejected categories from the candidate list sent to the LLM
 * - Normalize synonyms and near-duplicates via alias map
 * - Enforce naming constraints on new categories (≤3 words, title-cased, general-purpose)
 * - When >20 categories exist, emphasize reuse even more strongly
 * - Parse JSON response: { "category": "...", "isExisting": true/false, "confidence": 0.0-1.0 }
 * - Retry once with stricter prompt on parse failure
 * - Fall back to "Uncategorized" on total failure
 * - Return confidence scores, source tracking, and low-confidence flags
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4,
 *              6.1, 6.2, 6.3, 6.4, 10.1, 10.2, 10.3, 10.4, 10.5
 */

import OpenAI from "openai";

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
// Rejected categories
// ---------------------------------------------------------------------------

export const REJECTED_CATEGORIES = new Set([
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
  "uncategorized",
  "needs review",
]);

export function isRejectedCategory(name: string): boolean {
  return REJECTED_CATEGORIES.has(name.toLowerCase().trim());
}

// ---------------------------------------------------------------------------
// Weak category filtering
// ---------------------------------------------------------------------------

export function filterWeakCategories(categories: string[]): string[] {
  return categories.filter(
    (c) => !isRejectedCategory(c) && c.toLowerCase() !== "uncategorized",
  );
}

// ---------------------------------------------------------------------------
// Synonym / alias normalization
// ---------------------------------------------------------------------------

export const CATEGORY_ALIASES: Record<string, string> = {
  errand: "Errands",
  socializing: "Social",
  socialising: "Social",
  meeting: "Social",
  meetings: "Social",
  workout: "Exercise",
  workouts: "Exercise",
  gym: "Exercise",
  fitness: "Exercise",
  grooming: "Personal Care",
  hygiene: "Personal Care",
  "self care": "Personal Care",
  "self-care": "Personal Care",
  studying: "Learning",
  study: "Learning",
  education: "Learning",
  coding: "Development",
  programming: "Development",
  shopping: "Errands",
  chore: "Errands",
  chores: "Errands",
  housework: "Cleaning",
  commute: "Travel",
  commuting: "Travel",
  appointment: "Errands",
  appointments: "Errands",
};

export function normalizeAlias(
  category: string,
  existingCategories: string[],
): string {
  const lower = category.toLowerCase().trim();

  // Check alias map first
  const alias = Object.prototype.hasOwnProperty.call(CATEGORY_ALIASES, lower)
    ? CATEGORY_ALIASES[lower]
    : undefined;
  if (alias) {
    // If the alias target exists in existing categories, use it
    const existingMatch = existingCategories.find(
      (c) => c.toLowerCase() === alias.toLowerCase(),
    );
    if (existingMatch) return existingMatch;
    return alias;
  }

  // Check for singular/plural match against existing categories
  // "Errand" matches "Errands", "Meeting" matches "Meetings"
  const existingLower = existingCategories.map((c) => ({
    original: c,
    lower: c.toLowerCase(),
  }));
  for (const existing of existingLower) {
    if (existing.lower === lower + "s" || existing.lower + "s" === lower) {
      return existing.original;
    }
    if (existing.lower === lower + "ing" || existing.lower + "ing" === lower) {
      return existing.original;
    }
  }

  return category;
}

// ---------------------------------------------------------------------------
// Title-case normalization
// ---------------------------------------------------------------------------

export function toTitleCase(str: string): string {
  return str
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  description: string,
  existingCategories: string[],
  activeCategoryCount?: number,
  rawText?: string,
): string {
  const categoryList =
    existingCategories.length > 0
      ? existingCategories.map((c) => `- ${c}`).join("\n")
      : "(no existing categories)";

  let prompt = `You are a task categorization assistant. Assign each task to a meaningful activity-type category that describes what kind of activity the task involves.

Task: "${description}"
${rawText ? `Original text: "${rawText}"` : ""}

Existing categories:
${categoryList}

CATEGORY GUIDELINES:
- Categories should describe the TYPE OF ACTIVITY, not the task itself
- Good categories: Social, Errands, Reading, Learning, Personal Care, Health, Exercise, Job Search, Interview Prep, Admin, Planning, Communication, Development, Writing, Cooking, Finance, Shopping, Cleaning, Travel
- BAD categories (NEVER use these): Task Completion, General, Misc, Other, Daily Task, Personal Task, Task, Activity, To Do, Miscellaneous, Various
- Tasks can be personal-life activities (grooming, socializing, shopping) — not just work tasks
- "meet Ali" → Social, "pick up parcel" → Errands, "read a book" → Reading, "trim beard" → Personal Care

RULES:
1. PREFER an existing category if it's a good semantic fit
2. If no existing category fits well, propose a new meaningful activity-type category
3. New categories: at most 3 words, title-cased, general-purpose enough for multiple future tasks
4. Do NOT propose synonyms or near-duplicates of existing categories
5. Return ONLY valid JSON: { "category": "...", "isExisting": true/false, "confidence": 0.0-1.0 }
6. The confidence score should reflect how well the category fits the task:
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
- "category" (string): a meaningful activity-type category name
- "isExisting" (boolean): true if the category was selected from the provided list, false if it is a new proposal
- "confidence" (number): a confidence score from 0.0 to 1.0

BAD categories (NEVER use these): Task Completion, General, Misc, Other, Daily Task, Personal Task, Task, Activity, To Do, Miscellaneous, Various
Categories should describe the TYPE OF ACTIVITY (e.g., Social, Errands, Reading, Learning, Personal Care, Health, Exercise).

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
   * 1. Call the LLM with the description and filtered existing categories.
   * 2. On parse failure, retry once with a stricter prompt.
   * 3. Reject generic/process categories and retry with stronger prompt.
   * 4. Apply alias normalization to resolve synonyms/near-duplicates.
   * 5. Apply title-case normalization to new categories.
   * 6. On total failure, fall back to "Uncategorized" sentinel.
   */
  async assign(
    description: string,
    existingCategories: string[],
    activeCategoryCount?: number,
    rawText?: string,
  ): Promise<CategoryAssignmentResult> {
    // Filter weak categories from the list sent to the LLM
    const filteredCategories = filterWeakCategories(existingCategories);

    // First attempt
    let result = await this.callLLM(
      description,
      filteredCategories,
      false,
      activeCategoryCount,
      rawText,
    );

    // Retry once with stricter prompt on failure (Req 4.7)
    if (result === null) {
      result = await this.callLLM(
        description,
        filteredCategories,
        true,
        activeCategoryCount,
        rawText,
      );
    }

    // Both attempts failed — fall back to "Uncategorized" (Req 10.1, 10.2)
    if (result === null) {
      console.warn(
        `[AICategoryAssigner] LLM failed after retry for description: "${description.slice(0, 80)}". Falling back to keyword normalizer.`,
      );
      return {
        rawLLMCategory: null,
        finalCategory: "Uncategorized",
        isNew: false,
        confidence: 0.0,
        source: "fallback",
        closestExisting: null,
        lowConfidence: true,
      };
    }

    // Check for rejected generic categories and retry if needed
    if (isRejectedCategory(result.category)) {
      const rejectedName = result.category;
      const retryResult = await this.callLLMWithRejection(
        description,
        filteredCategories,
        rejectedName,
        activeCategoryCount,
        rawText,
      );

      if (retryResult !== null && !isRejectedCategory(retryResult.category)) {
        result = retryResult;
      } else {
        // Both attempts returned rejected categories — fall back to "Uncategorized"
        console.warn(
          `[AICategoryAssigner] LLM returned rejected category "${rejectedName}" and retry also failed. Falling back to keyword normalizer.`,
        );
        return {
          rawLLMCategory: rejectedName,
          finalCategory: "Uncategorized",
          isNew: false,
          confidence: 0.0,
          source: "fallback",
          closestExisting: null,
          lowConfidence: true,
        };
      }
    }

    // Check for very low confidence and retry
    if (result.confidence < 0.3) {
      const lowConfRetry = await this.callLLMWithLowConfidence(
        description,
        filteredCategories,
        activeCategoryCount,
        rawText,
      );
      if (lowConfRetry !== null && lowConfRetry.confidence >= 0.3) {
        result = lowConfRetry;
      }
    }

    // Apply alias normalization (after rejected check, before ≤3 word check)
    result.category = normalizeAlias(result.category, existingCategories);

    // Enforce ≤3 word naming rule on new categories (Req 5.4)
    // Use original existingCategories for isNew determination
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

        // Otherwise fall back to "Uncategorized"
        console.warn(
          `[AICategoryAssigner] LLM proposed >3 word category "${result.category}", truncated "${truncated}" does not match existing. Falling back.`,
        );
        return {
          rawLLMCategory: result.category,
          finalCategory: "Uncategorized",
          isNew: false,
          confidence: 0.0,
          source: "fallback",
          closestExisting: null,
          lowConfidence: true,
        };
      }
    }

    // Apply title-case normalization to new categories only
    if (isNew) {
      result.category = toTitleCase(result.category);
    }

    // Determine closestExisting for low-confidence new categories (Req 6.4)
    let closestExisting: string | null = null;
    if (isNew && result.confidence < 0.5 && existingCategories.length > 0) {
      closestExisting = null;
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
    rawText?: string,
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
                  rawText,
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
   * Retry LLM call with a prompt that explicitly rejects the previous generic category.
   */
  private async callLLMWithRejection(
    description: string,
    existingCategories: string[],
    rejectedCategory: string,
    activeCategoryCount?: number,
    rawText?: string,
  ): Promise<LLMCategoryResponse | null> {
    try {
      const categoryList =
        existingCategories.length > 0
          ? existingCategories.join(", ")
          : "(none)";

      const prompt = `Your previous answer "${rejectedCategory}" is too generic. Choose a more specific activity-type category.

Task: "${description}"
${rawText ? `Original text: "${rawText}"` : ""}
Existing categories: ${categoryList}

BAD categories (NEVER use these): Task Completion, General, Misc, Other, Daily Task, Personal Task, Task, Activity, To Do, Miscellaneous, Various
Good categories describe the TYPE OF ACTIVITY: Social, Errands, Reading, Learning, Personal Care, Health, Exercise, Admin, Planning, Communication, Development, Writing, Cooking, Finance, Shopping, Cleaning, Travel

Return ONLY valid JSON: { "category": "...", "isExisting": true/false, "confidence": 0.0-1.0 }`;

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
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
        "[AICategoryAssigner] LLM rejection retry failed:",
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  /**
   * Retry LLM call when confidence was very low.
   */
  private async callLLMWithLowConfidence(
    description: string,
    existingCategories: string[],
    activeCategoryCount?: number,
    rawText?: string,
  ): Promise<LLMCategoryResponse | null> {
    try {
      const categoryList =
        existingCategories.length > 0
          ? existingCategories.join(", ")
          : "(none)";

      const prompt = `Your confidence was very low. Think about what TYPE OF ACTIVITY this task represents for long-term time analytics.

Task: "${description}"
${rawText ? `Original text: "${rawText}"` : ""}
Existing categories: ${categoryList}

Ask yourself: "If I were tracking how I spend my time across weeks, what activity bucket would this task fall into?"

Categories should be useful for answering: "How much time do I spend on Social vs Errands vs Learning vs Personal Care?"

Return ONLY valid JSON: { "category": "...", "isExisting": true/false, "confidence": 0.0-1.0 }`;

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
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
        "[AICategoryAssigner] LLM low-confidence retry failed:",
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
