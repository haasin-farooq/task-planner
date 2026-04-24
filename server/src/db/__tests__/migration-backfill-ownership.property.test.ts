/**
 * Property 11: Migration Backfill Assigns Correct User Ownership
 *
 * For any set of existing categories with completion_history references from
 * multiple users, after running the migration backfill, each category's
 * `user_id` SHALL be set to the user who has the most completion_history rows
 * referencing that category.
 *
 * Feature: dynamic-ai-categories, Property 11: Migration Backfill Assigns Correct User Ownership
 *
 * **Validates: Requirements 15.2**
 */

import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";
import { runMigrations } from "../schema.js";
import { normalize } from "../../utils/category-normalizer.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Categories whose names self-normalize (i.e. normalize(name) === name).
 * "Communication" is excluded because normalize("Communication") === "Other".
 */
const SELF_NORMALIZING_CATEGORIES = [
  "Writing",
  "Development",
  "Design",
  "Research",
  "Admin",
  "Planning",
  "Testing",
  "Learning",
] as const;

const SEEDED_CATEGORIES = [
  ...SELF_NORMALIZING_CATEGORIES,
  "Communication",
  "Other",
] as const;

// ---------------------------------------------------------------------------
// Legacy schema (pre-migration)
// ---------------------------------------------------------------------------

const LEGACY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS preference_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  strategy TEXT NOT NULL DEFAULT 'highest-priority-first',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  raw_input TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES task_sessions(id),
  description TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  is_ambiguous BOOLEAN DEFAULT FALSE,
  priority INTEGER CHECK (priority BETWEEN 1 AND 5),
  effort_percentage REAL CHECK (effort_percentage BETWEEN 0 AND 100),
  difficulty_level INTEGER CHECK (difficulty_level BETWEEN 1 AND 5),
  estimated_time INTEGER,
  is_completed BOOLEAN DEFAULT FALSE,
  actual_time INTEGER,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS completion_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  task_description TEXT NOT NULL,
  category TEXT,
  estimated_time INTEGER NOT NULL,
  actual_time INTEGER NOT NULL,
  difficulty_level INTEGER NOT NULL,
  completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS behavioral_adjustments (
  user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  time_multiplier REAL NOT NULL DEFAULT 1.0,
  difficulty_adjustment REAL NOT NULL DEFAULT 0.0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, category)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

function seedLegacyCategories(db: Database.Database): void {
  const seedStmt = db.prepare(
    "INSERT OR IGNORE INTO categories (name) VALUES (?)",
  );
  for (const name of SEEDED_CATEGORIES) {
    seedStmt.run(name);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPreMigrationDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(LEGACY_SCHEMA_SQL);
  seedLegacyCategories(db);
  return db;
}

/**
 * Compute acceptable owners for each category after migration.
 *
 * The migration backfill first normalizes category text, then backfills
 * category_id from normalized_category. The ownership query uses category_id
 * first, then falls back to name matching. So the effective ownership is
 * determined by which category the normalized_category points to.
 *
 * For self-normalizing categories (normalize(name) === name), the category_id
 * correctly points to the same category. For non-self-normalizing categories
 * like "Communication" (which normalizes to "Other"), the category_id points
 * to "Other" instead, and the name-based fallback is used.
 *
 * To avoid this complexity, the main property test uses only self-normalizing
 * category names in completion_history rows.
 */
function computeAcceptableOwners(
  completions: { userId: string; categoryName: string }[],
): Map<string, Set<string>> {
  // Group by the NORMALIZED category name (what category_id will point to)
  const countsByNormalized = new Map<string, Map<string, number>>();
  for (const c of completions) {
    const normalizedName = normalize(c.categoryName);
    if (!countsByNormalized.has(normalizedName)) {
      countsByNormalized.set(normalizedName, new Map());
    }
    const userCounts = countsByNormalized.get(normalizedName)!;
    userCounts.set(c.userId, (userCounts.get(c.userId) || 0) + 1);
  }

  const result = new Map<string, Set<string>>();
  for (const [catName, userCounts] of countsByNormalized) {
    let bestCount = 0;
    for (const count of userCounts.values()) {
      if (count > bestCount) bestCount = count;
    }
    const tied = new Set<string>();
    for (const [userId, count] of userCounts) {
      if (count === bestCount) tied.add(userId);
    }
    result.set(catName, tied);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Use only self-normalizing categories for completion references.
 * This ensures category_id backfill correctly points to the intended category,
 * making ownership verification straightforward.
 */
const selfNormalizingCategoryArb = fc.constantFrom(
  ...SELF_NORMALIZING_CATEGORIES,
);

const userIdArb = fc.constantFrom(
  "user-a",
  "user-b",
  "user-c",
  "user-d",
  "user-e",
);

/**
 * Generates a scenario with categories and completion references.
 * Uses only self-normalizing category names to avoid normalization
 * redirecting completions to different categories.
 */
const ownershipScenarioArb = fc
  .record({
    categories: fc.uniqueArray(selfNormalizingCategoryArb, {
      minLength: 1,
      maxLength: 8,
    }),
    completions: fc.array(
      fc.record({
        userId: userIdArb,
        categoryName: selfNormalizingCategoryArb,
      }),
      { minLength: 1, maxLength: 50 },
    ),
  })
  .map((scenario) => {
    // Ensure every category in the scenario has at least one completion
    const referencedCategories = new Set(
      scenario.completions.map((c) => c.categoryName),
    );
    const extraCompletions: { userId: string; categoryName: string }[] = [];
    for (const cat of scenario.categories) {
      if (!referencedCategories.has(cat)) {
        extraCompletions.push({ userId: "user-a", categoryName: cat });
      }
    }
    return {
      categories: scenario.categories,
      completions: [...scenario.completions, ...extraCompletions],
    };
  });

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 11: Migration Backfill Assigns Correct User Ownership", () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it("each category user_id is set to a user with the most completions referencing it", () => {
    fc.assert(
      fc.property(ownershipScenarioArb, (scenario) => {
        db = createPreMigrationDb();

        // Insert all users referenced in completions
        const allUserIds = new Set(scenario.completions.map((c) => c.userId));
        const insertUser = db.prepare(
          "INSERT OR IGNORE INTO users (id) VALUES (?)",
        );
        for (const uid of allUserIds) {
          insertUser.run(uid);
        }

        // Insert completion_history rows with category text matching seeded names.
        // Using self-normalizing names ensures category_id backfill is correct.
        const insertCompletion = db.prepare(`
          INSERT INTO completion_history
            (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
          VALUES (?, ?, ?, ?, 30, 25, 2)
        `);

        for (let i = 0; i < scenario.completions.length; i++) {
          const c = scenario.completions[i];
          insertCompletion.run(
            `ch-${i}`,
            c.userId,
            `Task for ${c.categoryName}`,
            c.categoryName,
          );
        }

        // Compute acceptable owners (handles ties)
        const acceptableOwners = computeAcceptableOwners(scenario.completions);

        // Run migrations — triggers backfillCategoryUserId
        runMigrations(db);

        // Verify each category that had completions has a valid owner
        const catRows = db
          .prepare("SELECT id, name, user_id FROM categories")
          .all() as { id: number; name: string; user_id: string }[];

        for (const cat of catRows) {
          const owners = acceptableOwners.get(cat.name);
          if (owners) {
            // Category had completion references — owner must be one of the
            // users with the highest completion count
            expect(owners.has(cat.user_id)).toBe(true);
          } else {
            // Category had no completions — assigned to fallback user
            // (first user in users table or any existing user)
            const isKnownUser =
              allUserIds.has(cat.user_id) || cat.user_id === "__system__";
            expect(isKnownUser).toBe(true);
          }
        }

        db.close();
      }),
      { numRuns: 100 },
    );
  });

  it("categories with no completion references are assigned to the fallback user", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(selfNormalizingCategoryArb, {
          minLength: 2,
          maxLength: 5,
        }),
        fc.constantFrom("user-a", "user-b", "user-c"),
        (categories, singleUser) => {
          db = createPreMigrationDb();

          // Insert a single user
          db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(
            singleUser,
          );

          // Only add completions for the FIRST category; the rest have none
          const referencedCat = categories[0];
          db.prepare(
            `
            INSERT INTO completion_history
              (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
            VALUES ('ch-1', ?, 'Some task', ?, 30, 25, 2)
          `,
          ).run(singleUser, referencedCat);

          // Run migrations
          runMigrations(db);

          // The referenced category should be owned by singleUser
          const referencedRow = db
            .prepare("SELECT user_id FROM categories WHERE name = ?")
            .get(referencedCat) as { user_id: string };
          expect(referencedRow.user_id).toBe(singleUser);

          // Unreferenced categories should be assigned to the fallback user
          // (the first/only user in the users table)
          for (let i = 1; i < categories.length; i++) {
            const row = db
              .prepare("SELECT user_id FROM categories WHERE name = ?")
              .get(categories[i]) as { user_id: string };
            expect(row.user_id).toBe(singleUser);
          }

          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("when one user has strictly more completions than another, that user owns the category", () => {
    fc.assert(
      fc.property(
        selfNormalizingCategoryArb,
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        (categoryName, countA, countB) => {
          // Ensure user-a always has strictly more completions than user-b
          const adjustedCountA = countA + countB + 1;
          const adjustedCountB = countB;

          db = createPreMigrationDb();

          db.exec("INSERT INTO users (id) VALUES ('user-a')");
          db.exec("INSERT INTO users (id) VALUES ('user-b')");

          const insertCompletion = db.prepare(`
            INSERT INTO completion_history
              (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
            VALUES (?, ?, ?, ?, 30, 25, 2)
          `);

          let idx = 0;
          for (let i = 0; i < adjustedCountA; i++) {
            insertCompletion.run(
              `ch-${idx++}`,
              "user-a",
              `Task ${i}`,
              categoryName,
            );
          }

          for (let i = 0; i < adjustedCountB; i++) {
            insertCompletion.run(
              `ch-${idx++}`,
              "user-b",
              `Task ${i}`,
              categoryName,
            );
          }

          // Run migrations
          runMigrations(db);

          // Category should be owned by user-a (strictly more completions)
          const row = db
            .prepare("SELECT user_id FROM categories WHERE name = ?")
            .get(categoryName) as { user_id: string };
          expect(row.user_id).toBe("user-a");

          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});
