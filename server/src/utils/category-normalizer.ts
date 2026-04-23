/**
 * Maps free-text category strings to canonical categories using keyword matching.
 *
 * The normalizer uses a static mapping table of keywords/synonyms to canonical
 * category labels. Input is lowercased and trimmed, then checked for substring
 * matches against each keyword. The first matching canonical category wins.
 * Unmatched inputs fall through to "Other".
 *
 * A `backfill` method is provided to populate `normalized_category` for all
 * existing `completion_history` records that lack one.
 */

import type Database from "better-sqlite3";
import type { CanonicalCategory } from "../types/index.js";

/** A single mapping rule: keywords that map to a canonical category */
interface CategoryMapping {
  canonical: CanonicalCategory;
  keywords: string[];
}

/** The static mapping table — ordered by specificity */
const CATEGORY_MAPPINGS: CategoryMapping[] = [
  {
    canonical: "Writing",
    keywords: [
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
    ],
  },
  {
    canonical: "Development",
    keywords: [
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
    ],
  },
  {
    canonical: "Design",
    keywords: [
      "design",
      "ui",
      "ux",
      "mockup",
      "wireframe",
      "prototype",
      "layout",
      "figma",
      "sketch",
    ],
  },
  {
    canonical: "Research",
    keywords: [
      "research",
      "investigate",
      "explore",
      "analyze",
      "analysis",
      "study",
      "review literature",
    ],
  },
  {
    canonical: "Admin",
    keywords: [
      "admin",
      "administrative",
      "organize",
      "file",
      "schedule",
      "booking",
      "invoice",
      "expense",
      "paperwork",
    ],
  },
  {
    canonical: "Communication",
    keywords: [
      "email",
      "meeting",
      "call",
      "chat",
      "discuss",
      "present",
      "presentation",
      "sync",
      "standup",
      "review",
    ],
  },
  {
    canonical: "Planning",
    keywords: [
      "plan",
      "planning",
      "roadmap",
      "strategy",
      "prioritize",
      "backlog",
      "sprint",
      "estimate",
    ],
  },
  {
    canonical: "Testing",
    keywords: [
      "test",
      "testing",
      "qa",
      "quality",
      "verify",
      "validation",
      "check",
    ],
  },
  {
    canonical: "Learning",
    keywords: [
      "learn",
      "learning",
      "study",
      "course",
      "tutorial",
      "training",
      "read",
      "reading",
    ],
  },
];

/**
 * Map a raw category string to a canonical category.
 *
 * 1. Lowercase and trim the input
 * 2. For each mapping rule, check if any keyword is a substring of the input
 * 3. Return the first matching canonical category
 * 4. If no match, return "Other"
 */
export function normalize(rawCategory: string): CanonicalCategory {
  const input = rawCategory.toLowerCase().trim();

  for (const mapping of CATEGORY_MAPPINGS) {
    for (const keyword of mapping.keywords) {
      if (input.includes(keyword)) {
        return mapping.canonical;
      }
    }
  }

  return "Other";
}

/**
 * Backfill all `completion_history` rows where `normalized_category IS NULL`.
 *
 * Queries rows missing a normalized category, normalizes each using the
 * keyword mapping, and updates them in a single transaction.
 */
export function backfill(db: Database.Database): void {
  const rows = db
    .prepare(
      "SELECT id, category FROM completion_history WHERE normalized_category IS NULL",
    )
    .all() as { id: string; category: string | null }[];

  if (rows.length === 0) {
    return;
  }

  const update = db.prepare(
    "UPDATE completion_history SET normalized_category = ? WHERE id = ?",
  );

  const runBatch = db.transaction(() => {
    for (const row of rows) {
      const normalized = row.category ? normalize(row.category) : "Other";
      update.run(normalized, row.id);
    }
  });

  runBatch();
}

/** Expose the mapping table for testing */
export { CATEGORY_MAPPINGS };
