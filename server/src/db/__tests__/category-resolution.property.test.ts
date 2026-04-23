/**
 * Property 5: Category resolution is idempotent
 *
 * For any category name, resolving it against the categories table SHALL return
 * a valid CategoryEntity with a positive integer id. Resolving the same name a
 * second time SHALL return the same id. If the name did not previously exist, a
 * new row SHALL be created; if it did exist, the existing row SHALL be returned.
 *
 * Feature: ai-category-assignment, Property 5: Category resolution is idempotent
 *
 * Validates: Requirements 4.1, 4.2
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
 * Arbitrary that produces a non-empty category name string suitable for
 * insertion into the categories table. Names must be non-empty after trimming.
 */
const categoryNameArb = fc
  .stringOf(fc.char(), { minLength: 1, maxLength: 60 })
  .filter((s) => s.trim().length > 0);

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 5: Category resolution is idempotent", () => {
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

  it("upsertByName returns a valid CategoryEntity with a positive integer id", () => {
    fc.assert(
      fc.property(categoryNameArb, (name) => {
        db.exec("DELETE FROM categories");

        const entity = repo.upsertByName(name);

        // Must return a valid entity with a positive integer id
        expect(entity).toBeDefined();
        expect(Number.isInteger(entity.id)).toBe(true);
        expect(entity.id).toBeGreaterThan(0);
        // Name should match case-insensitively
        expect(entity.name.toLowerCase()).toBe(name.toLowerCase());
        // createdAt should be a non-empty string
        expect(typeof entity.createdAt).toBe("string");
        expect(entity.createdAt.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("resolving the same name twice returns the same id", () => {
    fc.assert(
      fc.property(categoryNameArb, (name) => {
        db.exec("DELETE FROM categories");

        const first = repo.upsertByName(name);
        const second = repo.upsertByName(name);

        // Both calls must return the same id
        expect(second.id).toBe(first.id);
        // Both must return valid positive integer ids
        expect(Number.isInteger(first.id)).toBe(true);
        expect(first.id).toBeGreaterThan(0);
        expect(Number.isInteger(second.id)).toBe(true);
        expect(second.id).toBeGreaterThan(0);
        // Names should match case-insensitively
        expect(first.name.toLowerCase()).toBe(name.toLowerCase());
        expect(second.name.toLowerCase()).toBe(name.toLowerCase());
      }),
      { numRuns: 100 },
    );
  });

  it("resolving a new name creates a row; resolving an existing name returns it without creating another", () => {
    fc.assert(
      fc.property(categoryNameArb, (name) => {
        db.exec("DELETE FROM categories");

        // Before upsert, no rows should exist
        const countBefore = db
          .prepare("SELECT COUNT(*) as cnt FROM categories")
          .get() as { cnt: number };
        expect(countBefore.cnt).toBe(0);

        // First resolution creates a new row
        const first = repo.upsertByName(name);
        const countAfterFirst = db
          .prepare("SELECT COUNT(*) as cnt FROM categories")
          .get() as { cnt: number };
        expect(countAfterFirst.cnt).toBe(1);

        // Second resolution does not create another row
        const second = repo.upsertByName(name);
        const countAfterSecond = db
          .prepare("SELECT COUNT(*) as cnt FROM categories")
          .get() as { cnt: number };
        expect(countAfterSecond.cnt).toBe(1);

        // Both return the same entity
        expect(second.id).toBe(first.id);
      }),
      { numRuns: 100 },
    );
  });

  it("resolving a case-variant of an existing name returns the same id", () => {
    fc.assert(
      fc.property(
        categoryNameArb.filter((s) => /[a-zA-Z]/.test(s)),
        (name) => {
          db.exec("DELETE FROM categories");

          const first = repo.upsertByName(name);
          const second = repo.upsertByName(name.toUpperCase());
          const third = repo.upsertByName(name.toLowerCase());

          // All resolutions should return the same id
          expect(second.id).toBe(first.id);
          expect(third.id).toBe(first.id);

          // Only one row should exist
          const count = db
            .prepare("SELECT COUNT(*) as cnt FROM categories")
            .get() as { cnt: number };
          expect(count.cnt).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
