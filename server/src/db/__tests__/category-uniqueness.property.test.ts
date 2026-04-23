/**
 * Property 1: Case-insensitive category uniqueness
 *
 * For any two category name strings that differ only in letter casing,
 * inserting both into the categories table SHALL result in only one row,
 * with the second insert being a no-op or raising a uniqueness violation.
 *
 * Feature: ai-category-assignment, Property 1: Case-insensitive category uniqueness
 *
 * Validates: Requirements 1.3
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";
import { createDb } from "../connection.js";
import { CategoryRepository } from "../category-repository.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Arbitrary that produces a non-empty category name string.
 * Category names must be non-empty after trimming and contain at least one
 * letter so that case variants are meaningful.
 */
const categoryNameArb = fc
  .stringOf(fc.char(), { minLength: 1, maxLength: 60 })
  .filter((s) => s.trim().length > 0)
  .filter((s) => /[a-zA-Z]/.test(s));

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 1: Case-insensitive category uniqueness", () => {
  let db: Database.Database;
  let repo: CategoryRepository;

  beforeEach(() => {
    db = createDb(":memory:");
    // Clear seeded categories so generated names don't collide with them
    db.exec("DELETE FROM categories");
    repo = new CategoryRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it("inserting a name and its uppercase variant results in only one row", () => {
    fc.assert(
      fc.property(categoryNameArb, (name) => {
        // Clear table for each iteration
        db.exec("DELETE FROM categories");

        const first = repo.upsertByName(name);
        const second = repo.upsertByName(name.toUpperCase());

        // Both calls should return the same category ID
        expect(second.id).toBe(first.id);

        // Only one row should exist for this name
        const count = db
          .prepare(
            "SELECT COUNT(*) as cnt FROM categories WHERE name = ? COLLATE NOCASE",
          )
          .get(name) as { cnt: number };
        expect(count.cnt).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it("inserting a name and its lowercase variant results in only one row", () => {
    fc.assert(
      fc.property(categoryNameArb, (name) => {
        db.exec("DELETE FROM categories");

        const first = repo.upsertByName(name);
        const second = repo.upsertByName(name.toLowerCase());

        expect(second.id).toBe(first.id);

        const count = db
          .prepare(
            "SELECT COUNT(*) as cnt FROM categories WHERE name = ? COLLATE NOCASE",
          )
          .get(name) as { cnt: number };
        expect(count.cnt).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it("inserting a name and a random case-variant results in only one row", () => {
    fc.assert(
      fc.property(
        categoryNameArb,
        fc.infiniteStream(fc.boolean()),
        (name, boolStream) => {
          db.exec("DELETE FROM categories");

          // Build a case-variant by randomly toggling each character's case
          const variant = name
            .split("")
            .map((ch) => {
              const flip = boolStream.next().value;
              return flip ? ch.toUpperCase() : ch.toLowerCase();
            })
            .join("");

          const first = repo.upsertByName(name);
          const second = repo.upsertByName(variant);

          expect(second.id).toBe(first.id);

          const count = db
            .prepare(
              "SELECT COUNT(*) as cnt FROM categories WHERE name = ? COLLATE NOCASE",
            )
            .get(name) as { cnt: number };
          expect(count.cnt).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("direct SQL INSERT OR IGNORE of a case-variant is a no-op", () => {
    fc.assert(
      fc.property(categoryNameArb, (name) => {
        db.exec("DELETE FROM categories");

        // Insert the original name
        db.prepare("INSERT INTO categories (name) VALUES (?)").run(name);

        // Attempt to insert the uppercase variant — should be ignored
        const result = db
          .prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)")
          .run(name.toUpperCase());

        // changes === 0 means the insert was a no-op
        expect(result.changes).toBe(0);

        // Still only one row
        const count = db
          .prepare("SELECT COUNT(*) as cnt FROM categories")
          .get() as { cnt: number };
        expect(count.cnt).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});
