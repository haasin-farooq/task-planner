/**
 * Property 7: Migration backfill populates category_id from text columns
 *
 * For any existing completion_history row whose normalized_category matches a
 * seeded category name, and for any existing behavioral_adjustments row whose
 * category text matches a seeded category name, the migration backfill SHALL
 * set category_id to the corresponding categories.id.
 *
 * Feature: ai-category-assignment, Property 7: Migration backfill populates category_id from text columns
 *
 * Validates: Requirements 4.6, 6.4
 */

import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";
import { runMigrations, SCHEMA_SQL } from "../schema.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEEDED_CATEGORIES = [
  "Writing",
  "Development",
  "Design",
  "Research",
  "Admin",
  "Communication",
  "Planning",
  "Testing",
  "Learning",
  "Other",
] as const;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary that picks a random seeded category name. */
const seededCategoryArb = fc.constantFrom(...SEEDED_CATEGORIES);

/**
 * Arbitrary that generates a non-empty array of unique seeded category names.
 * Each element represents a row to insert before migration.
 */
const categorySubsetArb = fc
  .uniqueArray(seededCategoryArb, { minLength: 1, maxLength: 10 })
  .filter((arr) => arr.length > 0);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a fresh in-memory database with the base schema (no migrations).
 * This simulates a pre-migration state.
 */
function createPreMigrationDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 7: Migration backfill populates category_id from text columns", () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it("backfills completion_history.category_id from normalized_category for any combination of seeded categories", () => {
    fc.assert(
      fc.property(categorySubsetArb, (categories) => {
        db = createPreMigrationDb();

        // Insert a user
        db.exec("INSERT INTO users (id) VALUES ('u1')");

        // Insert pre-migration completion_history rows with various
        // normalized_category values matching seeded categories.
        // At this point the base SCHEMA_SQL already creates the categories
        // table, but category_id columns and backfill haven't run yet.
        const insertCompletion = db.prepare(`
          INSERT INTO completion_history
            (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
          VALUES (?, 'u1', ?, ?, 30, 25, 2)
        `);

        for (let i = 0; i < categories.length; i++) {
          insertCompletion.run(
            `ch-${i}`,
            `Task for ${categories[i]}`,
            categories[i].toLowerCase(),
          );
        }

        // Run migrations — this adds normalized_category, category_id columns,
        // seeds categories, backfills normalized_category, then backfills category_id
        runMigrations(db);

        // Build a lookup of category name → categories.id
        const catRows = db.prepare("SELECT id, name FROM categories").all() as {
          id: number;
          name: string;
        }[];
        const catIdByName = new Map(catRows.map((r) => [r.name, r.id]));

        // Verify each completion_history row has the correct category_id
        for (let i = 0; i < categories.length; i++) {
          const row = db
            .prepare(
              "SELECT category_id, normalized_category FROM completion_history WHERE id = ?",
            )
            .get(`ch-${i}`) as {
            category_id: number | null;
            normalized_category: string | null;
          };

          // The normalized_category should have been backfilled to a seeded name
          expect(row.normalized_category).not.toBeNull();

          // The category_id should match the corresponding categories.id
          const expectedId = catIdByName.get(row.normalized_category!);
          expect(expectedId).toBeDefined();
          expect(row.category_id).toBe(expectedId);
        }

        db.close();
      }),
      { numRuns: 100 },
    );
  });

  it("backfills behavioral_adjustments.category_id from category text for any combination of seeded categories", () => {
    fc.assert(
      fc.property(categorySubsetArb, (categories) => {
        db = createPreMigrationDb();

        // Insert a user
        db.exec("INSERT INTO users (id) VALUES ('u1')");

        // Insert pre-migration behavioral_adjustments rows with category text
        // matching seeded category names exactly.
        const insertAdjustment = db.prepare(`
          INSERT INTO behavioral_adjustments
            (user_id, category, time_multiplier, sample_size)
          VALUES ('u1', ?, 1.1, 5)
        `);

        for (const cat of categories) {
          insertAdjustment.run(cat);
        }

        // Run migrations — this adds category_id column and backfills it
        runMigrations(db);

        // Build a lookup of category name → categories.id
        const catRows = db.prepare("SELECT id, name FROM categories").all() as {
          id: number;
          name: string;
        }[];
        const catIdByName = new Map(catRows.map((r) => [r.name, r.id]));

        // Verify each behavioral_adjustments row has the correct category_id
        for (const cat of categories) {
          const row = db
            .prepare(
              "SELECT category_id FROM behavioral_adjustments WHERE user_id = 'u1' AND category = ?",
            )
            .get(cat) as { category_id: number | null };

          const expectedId = catIdByName.get(cat);
          expect(expectedId).toBeDefined();
          expect(row.category_id).toBe(expectedId);
        }

        db.close();
      }),
      { numRuns: 100 },
    );
  });

  it("backfills both tables correctly for any random pairing of seeded categories", () => {
    fc.assert(
      fc.property(
        categorySubsetArb,
        categorySubsetArb,
        (completionCategories, adjustmentCategories) => {
          db = createPreMigrationDb();

          db.exec("INSERT INTO users (id) VALUES ('u1')");

          // Insert completion_history rows
          const insertCompletion = db.prepare(`
            INSERT INTO completion_history
              (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
            VALUES (?, 'u1', ?, ?, 30, 25, 2)
          `);

          for (let i = 0; i < completionCategories.length; i++) {
            insertCompletion.run(
              `ch-${i}`,
              `Task for ${completionCategories[i]}`,
              completionCategories[i].toLowerCase(),
            );
          }

          // Insert behavioral_adjustments rows
          const insertAdjustment = db.prepare(`
            INSERT INTO behavioral_adjustments
              (user_id, category, time_multiplier, sample_size)
            VALUES ('u1', ?, 1.0, 3)
          `);

          for (const cat of adjustmentCategories) {
            insertAdjustment.run(cat);
          }

          // Run migrations
          runMigrations(db);

          // Build category lookup
          const catRows = db
            .prepare("SELECT id, name FROM categories")
            .all() as { id: number; name: string }[];
          const catIdByName = new Map(catRows.map((r) => [r.name, r.id]));

          // Verify completion_history backfill
          for (let i = 0; i < completionCategories.length; i++) {
            const row = db
              .prepare(
                "SELECT category_id, normalized_category FROM completion_history WHERE id = ?",
              )
              .get(`ch-${i}`) as {
              category_id: number | null;
              normalized_category: string | null;
            };

            expect(row.normalized_category).not.toBeNull();
            const expectedId = catIdByName.get(row.normalized_category!);
            expect(expectedId).toBeDefined();
            expect(row.category_id).toBe(expectedId);
          }

          // Verify behavioral_adjustments backfill
          for (const cat of adjustmentCategories) {
            const row = db
              .prepare(
                "SELECT category_id FROM behavioral_adjustments WHERE user_id = 'u1' AND category = ?",
              )
              .get(cat) as { category_id: number | null };

            const expectedId = catIdByName.get(cat);
            expect(expectedId).toBeDefined();
            expect(row.category_id).toBe(expectedId);
          }

          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});
