/**
 * Property 13: Rename updates label and preserves all references
 *
 * For any category ID that exists in the categories table and for any new
 * name that does not conflict with an existing name, after a rename
 * operation: (a) the category row's name SHALL equal the new name, and
 * (b) all completion_history and behavioral_adjustments rows that
 * referenced that category_id before the rename SHALL still reference
 * the same category_id.
 *
 * Feature: ai-category-assignment, Property 13: Rename updates label and preserves all references
 *
 * Validates: Requirements 9.1, 9.4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";
import { createDb } from "../../db/connection.js";
import { CategoryRepository } from "../../db/category-repository.js";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureUser(db: Database.Database, userId: string): void {
  db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId);
}

function insertCompletionDirect(
  db: Database.Database,
  opts: {
    userId: string;
    description: string;
    categoryId: number;
    estimatedTime: number;
    actualTime: number;
    difficultyLevel: number;
    completedAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO completion_history
       (id, user_id, task_description, category, normalized_category, category_id,
        estimated_time, actual_time, difficulty_level, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uuidv4(),
    opts.userId,
    opts.description,
    opts.description,
    opts.description,
    opts.categoryId,
    opts.estimatedTime,
    opts.actualTime,
    opts.difficultyLevel,
    opts.completedAt,
  );
}

function insertBehavioralAdjustment(
  db: Database.Database,
  opts: {
    userId: string;
    category: string;
    categoryId: number;
    timeMultiplier: number;
    difficultyAdjustment: number;
    sampleSize: number;
  },
): void {
  db.prepare(
    `INSERT INTO behavioral_adjustments
       (user_id, category, category_id, time_multiplier, difficulty_adjustment, sample_size)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.userId,
    opts.category,
    opts.categoryId,
    opts.timeMultiplier,
    opts.difficultyAdjustment,
    opts.sampleSize,
  );
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a valid category name: 1-30 alphanumeric characters with spaces. */
const categoryNameArb = fc
  .stringOf(
    fc.constantFrom(
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ".split(
        "",
      ),
    ),
    { minLength: 1, maxLength: 30 },
  )
  .filter((s) => s.trim().length > 0);

/** Generates random completion record data. */
const completionDataArb = fc.record({
  estimatedTime: fc.integer({ min: 1, max: 500 }),
  actualTime: fc.integer({ min: 1, max: 1000 }),
  difficultyLevel: fc.integer({ min: 1, max: 5 }),
  dayOffset: fc.integer({ min: 1, max: 28 }),
});

/** Generates random behavioral adjustment data. */
const adjustmentDataArb = fc.record({
  timeMultiplier: fc.double({ min: 0.1, max: 3.0, noNaN: true }),
  difficultyAdjustment: fc.double({ min: -2.0, max: 2.0, noNaN: true }),
  sampleSize: fc.integer({ min: 1, max: 100 }),
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 13: Rename updates label and preserves all references", () => {
  let db: Database.Database;
  let categoryRepo: CategoryRepository;

  beforeEach(() => {
    db = createDb(":memory:");
    categoryRepo = new CategoryRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * **Validates: Requirements 9.1, 9.4**
   *
   * For any category with random completion_history and behavioral_adjustments
   * rows, after renaming to a non-conflicting name:
   * (a) the category row's name equals the new name
   * (b) all completion_history rows still reference the same category_id
   * (c) all behavioral_adjustments rows still reference the same category_id
   */
  it("rename updates the category name and preserves all foreign key references", () => {
    fc.assert(
      fc.property(
        categoryNameArb,
        categoryNameArb,
        fc.array(completionDataArb, { minLength: 0, maxLength: 8 }),
        fc.array(adjustmentDataArb, { minLength: 0, maxLength: 5 }),
        (originalName, newName, completions, adjustments) => {
          // Ensure original and new names are distinct (case-insensitive)
          // to avoid duplicate name conflicts
          if (
            originalName.trim().toLowerCase() === newName.trim().toLowerCase()
          ) {
            return; // skip this case — same name is not a meaningful rename
          }

          // Ensure the new name doesn't conflict with any seeded category
          const existingNames = categoryRepo
            .getAllNames()
            .map((n) => n.toLowerCase());
          if (existingNames.includes(newName.trim().toLowerCase())) {
            return; // skip — would conflict with a seeded category
          }

          // Also ensure original name doesn't conflict with seeded categories
          if (existingNames.includes(originalName.trim().toLowerCase())) {
            return; // skip — would collide with a seeded category
          }

          // Create the category
          const category = categoryRepo.upsertByName(originalName);
          const categoryId = category.id;

          const userId = "user-rename-test";
          ensureUser(db, userId);

          // Insert completion_history rows referencing this category
          for (const comp of completions) {
            insertCompletionDirect(db, {
              userId,
              description: "rename test task",
              categoryId,
              estimatedTime: comp.estimatedTime,
              actualTime: comp.actualTime,
              difficultyLevel: comp.difficultyLevel,
              completedAt: `2025-01-${String(comp.dayOffset).padStart(2, "0")}T10:00:00Z`,
            });
          }

          // Insert behavioral_adjustments rows referencing this category
          // Each adjustment uses a different user to avoid PK conflicts
          for (let i = 0; i < adjustments.length; i++) {
            const adjUserId = `user-adj-rename-${i}`;
            ensureUser(db, adjUserId);
            insertBehavioralAdjustment(db, {
              userId: adjUserId,
              category: originalName,
              categoryId,
              timeMultiplier: adjustments[i].timeMultiplier,
              difficultyAdjustment: adjustments[i].difficultyAdjustment,
              sampleSize: adjustments[i].sampleSize,
            });
          }

          // Record counts before rename
          const completionCountBefore = (
            db
              .prepare(
                "SELECT COUNT(*) as cnt FROM completion_history WHERE category_id = ?",
              )
              .get(categoryId) as { cnt: number }
          ).cnt;

          const adjustmentCountBefore = (
            db
              .prepare(
                "SELECT COUNT(*) as cnt FROM behavioral_adjustments WHERE category_id = ?",
              )
              .get(categoryId) as { cnt: number }
          ).cnt;

          // Perform the rename
          const renamed = categoryRepo.rename(categoryId, newName);

          // (a) The category row's name SHALL equal the new name
          expect(renamed.name).toBe(newName);

          const fetched = categoryRepo.findById(categoryId);
          expect(fetched).not.toBeNull();
          expect(fetched!.name).toBe(newName);

          // (b) All completion_history rows still reference the same category_id
          const completionCountAfter = (
            db
              .prepare(
                "SELECT COUNT(*) as cnt FROM completion_history WHERE category_id = ?",
              )
              .get(categoryId) as { cnt: number }
          ).cnt;
          expect(completionCountAfter).toBe(completionCountBefore);

          // (c) All behavioral_adjustments rows still reference the same category_id
          const adjustmentCountAfter = (
            db
              .prepare(
                "SELECT COUNT(*) as cnt FROM behavioral_adjustments WHERE category_id = ?",
              )
              .get(categoryId) as { cnt: number }
          ).cnt;
          expect(adjustmentCountAfter).toBe(adjustmentCountBefore);

          // Clean up for next iteration
          db.prepare(
            "DELETE FROM completion_history WHERE category_id = ?",
          ).run(categoryId);
          db.prepare(
            "DELETE FROM behavioral_adjustments WHERE category_id = ?",
          ).run(categoryId);
          db.prepare("DELETE FROM categories WHERE id = ?").run(categoryId);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14: Rename rejects duplicate names case-insensitively
// ---------------------------------------------------------------------------

/**
 * Property 14: Rename rejects duplicate names case-insensitively
 *
 * For any two categories in the table, attempting to rename one to a
 * case-variant of the other's name SHALL result in an error, and neither
 * category SHALL be modified.
 *
 * Feature: ai-category-assignment, Property 14: Rename rejects duplicate names case-insensitively
 *
 * Validates: Requirements 9.2
 */

describe("Property 14: Rename rejects duplicate names case-insensitively", () => {
  let db: Database.Database;
  let categoryRepo: CategoryRepository;

  beforeEach(() => {
    db = createDb(":memory:");
    categoryRepo = new CategoryRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Generates a case-variant of a string by randomly toggling the case of
   * each alphabetic character.
   */
  const caseVariantArb = (base: string): fc.Arbitrary<string> =>
    fc
      .array(fc.boolean(), { minLength: base.length, maxLength: base.length })
      .map((toggles) =>
        base
          .split("")
          .map((ch, i) => {
            if (!/[a-zA-Z]/.test(ch)) return ch;
            return toggles[i] ? ch.toUpperCase() : ch.toLowerCase();
          })
          .join(""),
      );

  /**
   * **Validates: Requirements 9.2**
   *
   * For any two distinct categories, attempting to rename the first to a
   * case-variant of the second's name throws an error and leaves both
   * categories unmodified.
   */
  it("rename throws on case-variant of another category's name and leaves both unchanged", () => {
    fc.assert(
      fc.property(
        categoryNameArb,
        categoryNameArb,
        fc.context(),
        (nameA, nameB, ctx) => {
          // Ensure the two names are distinct (case-insensitive) so they
          // create two separate categories
          if (nameA.trim().toLowerCase() === nameB.trim().toLowerCase()) {
            return; // skip — same name won't create two categories
          }

          // Ensure neither name conflicts with seeded categories
          const seededNames = categoryRepo
            .getAllNames()
            .map((n) => n.toLowerCase());
          if (
            seededNames.includes(nameA.trim().toLowerCase()) ||
            seededNames.includes(nameB.trim().toLowerCase())
          ) {
            return; // skip — would collide with a seeded category
          }

          // Create two distinct categories
          const catA = categoryRepo.upsertByName(nameA);
          const catB = categoryRepo.upsertByName(nameB);

          ctx.log(`catA: id=${catA.id}, name="${catA.name}"`);
          ctx.log(`catB: id=${catB.id}, name="${catB.name}"`);

          // Generate a case-variant of catB's name and attempt to rename catA to it
          fc.assert(
            fc.property(caseVariantArb(catB.name), (variant) => {
              ctx.log(`Attempting rename catA to variant: "${variant}"`);

              // The rename should throw a duplicate error
              expect(() => categoryRepo.rename(catA.id, variant)).toThrow(
                "A category with this name already exists",
              );

              // Verify neither category was modified
              const fetchedA = categoryRepo.findById(catA.id);
              const fetchedB = categoryRepo.findById(catB.id);

              expect(fetchedA).not.toBeNull();
              expect(fetchedA!.name).toBe(catA.name);

              expect(fetchedB).not.toBeNull();
              expect(fetchedB!.name).toBe(catB.name);
            }),
            { numRuns: 10 },
          );

          // Clean up for next iteration
          db.prepare("DELETE FROM categories WHERE id = ?").run(catA.id);
          db.prepare("DELETE FROM categories WHERE id = ?").run(catB.id);
        },
      ),
      { numRuns: 50 },
    );
  });
});
