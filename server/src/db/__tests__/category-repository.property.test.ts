/**
 * Property 1: Per-User Category Isolation
 *
 * For any two distinct users A and B, each with their own set of categories,
 * calling `getActiveByUserId(A)` SHALL return only categories where
 * `user_id = A`, and none of user B's categories SHALL appear in the result.
 *
 * Feature: dynamic-ai-categories, Property 1: Per-User Category Isolation
 *
 * Validates: Requirements 2.2, 16.1
 *
 * ---
 *
 * Property 2: Category Creation Metadata Correctness
 *
 * For any category created via `CategoryRepository.create(name, userId, createdBy)`,
 * the resulting `CategoryEntity` SHALL have `userId` equal to the provided user ID,
 * `createdBy` equal to the provided source, `status` equal to `'active'`, and `name`
 * equal to the provided name (modulo case normalization).
 *
 * Feature: dynamic-ai-categories, Property 2: Category Creation Metadata Correctness
 *
 * Validates: Requirements 2.3, 16.3
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
 * Arbitrary that produces a non-empty user ID string using alphanumeric chars.
 * User IDs must be non-empty after trimming.
 */
const userIdArb = fc
  .stringOf(
    fc.oneof(
      fc.integer({ min: 0x30, max: 0x39 }).map((c) => String.fromCharCode(c)), // 0-9
      fc.integer({ min: 0x61, max: 0x7a }).map((c) => String.fromCharCode(c)), // a-z
    ),
    { minLength: 1, maxLength: 20 },
  )
  .filter((s) => s.trim().length > 0);

/**
 * Arbitrary that produces a non-empty category name string.
 * Category names must be non-empty after trimming and contain at least one
 * letter so they are meaningful.
 */
const categoryNameArb = fc
  .stringOf(fc.char(), { minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0)
  .filter((s) => /[a-zA-Z]/.test(s));

/**
 * Arbitrary that produces a pair of distinct user IDs.
 */
const distinctUserPairArb = fc
  .tuple(userIdArb, userIdArb)
  .filter(([a, b]) => a.toLowerCase() !== b.toLowerCase());

/**
 * Arbitrary that produces a non-empty array of unique category names (1-5 names).
 */
const categoryNamesArb = fc.uniqueArray(categoryNameArb, {
  minLength: 1,
  maxLength: 5,
  comparator: (a, b) => a.toLowerCase() === b.toLowerCase(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureUser(db: Database.Database, userId: string): void {
  db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId);
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 1: Per-User Category Isolation", () => {
  let db: Database.Database;
  let repo: CategoryRepository;

  beforeEach(() => {
    db = createDb(":memory:");
    db.exec("DELETE FROM categories");
    repo = new CategoryRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it("getActiveByUserId(A) returns only user A's categories and none of user B's", () => {
    fc.assert(
      fc.property(
        distinctUserPairArb,
        categoryNamesArb,
        categoryNamesArb,
        ([userA, userB], namesA, namesB) => {
          // Clean state for each iteration
          db.exec("DELETE FROM categories");

          // Ensure both users exist
          ensureUser(db, userA);
          ensureUser(db, userB);

          // Create categories for user A
          for (const name of namesA) {
            repo.create(name, userA, "llm");
          }

          // Create categories for user B
          for (const name of namesB) {
            repo.create(name, userB, "llm");
          }

          // Fetch user A's active categories
          const resultA = repo.getActiveByUserId(userA);

          // All returned categories must belong to user A
          for (const cat of resultA) {
            expect(cat.userId).toBe(userA);
            expect(cat.status).toBe("active");
          }

          // All of user A's created names must appear in the result
          const resultANames = resultA.map((c) => c.name.toLowerCase());
          for (const name of namesA) {
            expect(resultANames).toContain(name.toLowerCase());
          }

          // None of user B's unique names should appear in user A's results
          // (unless user A also has the same name — which is valid per-user isolation)
          const namesALower = new Set(namesA.map((n) => n.toLowerCase()));
          for (const cat of resultA) {
            // Every category in A's result must either be one of A's names
            // or must have userId === userA
            expect(cat.userId).toBe(userA);
          }

          // Fetch user B's active categories
          const resultB = repo.getActiveByUserId(userB);

          // All returned categories must belong to user B
          for (const cat of resultB) {
            expect(cat.userId).toBe(userB);
            expect(cat.status).toBe("active");
          }

          // User A's result IDs and user B's result IDs must be disjoint
          const idsA = new Set(resultA.map((c) => c.id));
          const idsB = new Set(resultB.map((c) => c.id));
          for (const id of idsA) {
            expect(idsB.has(id)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("categories created for user A never leak into user B's query even with same names", () => {
    fc.assert(
      fc.property(
        distinctUserPairArb,
        categoryNamesArb,
        ([userA, userB], sharedNames) => {
          db.exec("DELETE FROM categories");

          ensureUser(db, userA);
          ensureUser(db, userB);

          // Create the same category names for both users
          for (const name of sharedNames) {
            repo.create(name, userA, "llm");
            repo.create(name, userB, "user");
          }

          const resultA = repo.getActiveByUserId(userA);
          const resultB = repo.getActiveByUserId(userB);

          // Both users should have the same number of categories
          expect(resultA.length).toBe(sharedNames.length);
          expect(resultB.length).toBe(sharedNames.length);

          // All of A's results belong to A, all of B's results belong to B
          for (const cat of resultA) {
            expect(cat.userId).toBe(userA);
          }
          for (const cat of resultB) {
            expect(cat.userId).toBe(userB);
          }

          // The category IDs must be completely disjoint
          const idsA = new Set(resultA.map((c) => c.id));
          const idsB = new Set(resultB.map((c) => c.id));
          for (const id of idsA) {
            expect(idsB.has(id)).toBe(false);
          }

          // Total categories in DB should be 2x the shared names
          const total = db
            .prepare("SELECT COUNT(*) as cnt FROM categories")
            .get() as { cnt: number };
          expect(total.cnt).toBe(sharedNames.length * 2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("getActiveByUserId returns empty array for a user with no categories", () => {
    fc.assert(
      fc.property(
        distinctUserPairArb,
        categoryNamesArb,
        ([userA, userB], namesA) => {
          db.exec("DELETE FROM categories");

          ensureUser(db, userA);
          ensureUser(db, userB);

          // Create categories only for user A
          for (const name of namesA) {
            repo.create(name, userA, "llm");
          }

          // User B should have zero categories
          const resultB = repo.getActiveByUserId(userB);
          expect(resultB).toHaveLength(0);

          // User A should have all their categories
          const resultA = repo.getActiveByUserId(userA);
          expect(resultA.length).toBe(namesA.length);
          for (const cat of resultA) {
            expect(cat.userId).toBe(userA);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Category Creation Metadata Correctness
// ---------------------------------------------------------------------------

/**
 * Arbitrary that produces a valid `createdBy` value.
 */
const createdByArb = fc.constantFrom(
  "llm" as const,
  "user" as const,
  "system" as const,
  "fallback" as const,
);

describe("Property 2: Category Creation Metadata Correctness", () => {
  let db: Database.Database;
  let repo: CategoryRepository;

  beforeEach(() => {
    db = createDb(":memory:");
    db.exec("DELETE FROM categories");
    repo = new CategoryRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * **Validates: Requirements 2.3, 16.3**
   *
   * For any random name, userId, and createdBy value, the entity returned by
   * `create()` must have the correct userId, createdBy, status='active', and
   * name matching the input (modulo case normalization via COLLATE NOCASE).
   */
  it("created entity has correct userId, createdBy, status, and name", () => {
    fc.assert(
      fc.property(
        categoryNameArb,
        userIdArb,
        createdByArb,
        (name, userId, createdBy) => {
          // Clean state for each iteration
          db.exec("DELETE FROM categories");

          // Ensure user exists
          ensureUser(db, userId);

          // Create the category
          const entity = repo.create(name, userId, createdBy);

          // userId must match exactly
          expect(entity.userId).toBe(userId);

          // createdBy must match exactly
          expect(entity.createdBy).toBe(createdBy);

          // status must be 'active' for newly created categories
          expect(entity.status).toBe("active");

          // name must match case-insensitively (COLLATE NOCASE)
          expect(entity.name.toLowerCase()).toBe(name.toLowerCase());

          // id must be a positive integer
          expect(entity.id).toBeGreaterThan(0);

          // mergedIntoCategoryId must be null for new categories
          expect(entity.mergedIntoCategoryId).toBeNull();

          // createdAt and updatedAt must be non-empty strings
          expect(entity.createdAt).toBeTruthy();
          expect(entity.updatedAt).toBeTruthy();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.3, 16.3**
   *
   * When the same name is created twice for the same user, the second call
   * returns the existing entity (upsert semantics). The metadata from the
   * first creation is preserved.
   */
  it("duplicate create returns existing entity preserving original metadata", () => {
    fc.assert(
      fc.property(
        categoryNameArb,
        userIdArb,
        createdByArb,
        createdByArb,
        (name, userId, createdBy1, createdBy2) => {
          db.exec("DELETE FROM categories");
          ensureUser(db, userId);

          // First creation
          const first = repo.create(name, userId, createdBy1);

          // Second creation with potentially different createdBy
          const second = repo.create(name, userId, createdBy2);

          // Should return the same entity (same id)
          expect(second.id).toBe(first.id);

          // Original metadata is preserved (INSERT OR IGNORE keeps first row)
          expect(second.userId).toBe(userId);
          expect(second.createdBy).toBe(createdBy1);
          expect(second.status).toBe("active");
          expect(second.name.toLowerCase()).toBe(name.toLowerCase());
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.3, 16.3**
   *
   * Creating categories with different createdBy sources all produce entities
   * with the correct source metadata.
   */
  it("all createdBy sources produce correct metadata", () => {
    fc.assert(
      fc.property(
        userIdArb,
        fc.uniqueArray(categoryNameArb, {
          minLength: 4,
          maxLength: 4,
          comparator: (a, b) => a.toLowerCase() === b.toLowerCase(),
        }),
        (userId, names) => {
          db.exec("DELETE FROM categories");
          ensureUser(db, userId);

          const sources: Array<"llm" | "user" | "system" | "fallback"> = [
            "llm",
            "user",
            "system",
            "fallback",
          ];

          for (let i = 0; i < sources.length; i++) {
            const entity = repo.create(names[i], userId, sources[i]);

            expect(entity.userId).toBe(userId);
            expect(entity.createdBy).toBe(sources[i]);
            expect(entity.status).toBe("active");
            expect(entity.name.toLowerCase()).toBe(names[i].toLowerCase());
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Per-User Case-Insensitive Name Uniqueness
// ---------------------------------------------------------------------------

/**
 * Property 3: Per-User Case-Insensitive Name Uniqueness
 *
 * For any user and any two category names that differ only in letter casing,
 * creating both for the same user SHALL result in a single category row (the
 * second create returns the existing one). However, for any two distinct users,
 * creating the same category name for each SHALL result in two separate
 * category rows.
 *
 * Feature: dynamic-ai-categories, Property 3: Per-User Case-Insensitive Name Uniqueness
 *
 * **Validates: Requirements 2.4**
 */

/**
 * Arbitrary that produces a case variation of a given string by randomly
 * toggling the case of each letter character.
 */
const caseVariationArb = (base: string): fc.Arbitrary<string> =>
  fc
    .array(fc.boolean(), { minLength: base.length, maxLength: base.length })
    .map((flags) =>
      base
        .split("")
        .map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase()))
        .join(""),
    );

describe("Property 3: Per-User Case-Insensitive Name Uniqueness", () => {
  let db: Database.Database;
  let repo: CategoryRepository;

  beforeEach(() => {
    db = createDb(":memory:");
    db.exec("DELETE FROM categories");
    repo = new CategoryRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * Creating the same name with different casing for the same user returns
   * the existing entity (same ID). The COLLATE NOCASE constraint ensures
   * case-insensitive uniqueness per user.
   */
  it("same-user duplicate names differing only in case return the existing entity", () => {
    fc.assert(
      fc.property(
        categoryNameArb,
        userIdArb,
        createdByArb,
        (baseName, userId, createdBy) => {
          db.exec("DELETE FROM categories");
          ensureUser(db, userId);

          // Create the category with the original name
          const first = repo.create(baseName, userId, createdBy);

          // Generate a case variation of the name
          const variation = baseName
            .split("")
            .map((ch) =>
              ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase(),
            )
            .join("");

          // Create with the case variation for the same user
          const second = repo.create(variation, userId, createdBy);

          // Both should return the same entity (same ID)
          expect(second.id).toBe(first.id);

          // Names should match case-insensitively
          expect(second.name.toLowerCase()).toBe(first.name.toLowerCase());

          // Only one row should exist for this user
          const count = repo.countActiveByUserId(userId);
          expect(count).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * Creating the same name for two distinct users creates separate rows
   * with different IDs. Per-user uniqueness means the same name can exist
   * independently for different users.
   */
  it("cross-user same names create separate rows with different IDs", () => {
    fc.assert(
      fc.property(
        categoryNameArb,
        distinctUserPairArb,
        createdByArb,
        (name, [userA, userB], createdBy) => {
          db.exec("DELETE FROM categories");
          ensureUser(db, userA);
          ensureUser(db, userB);

          // Create the same category name for both users
          const catA = repo.create(name, userA, createdBy);
          const catB = repo.create(name, userB, createdBy);

          // They must have different IDs (separate rows)
          expect(catA.id).not.toBe(catB.id);

          // Each belongs to its respective user
          expect(catA.userId).toBe(userA);
          expect(catB.userId).toBe(userB);

          // Names match case-insensitively
          expect(catA.name.toLowerCase()).toBe(catB.name.toLowerCase());

          // Each user has exactly one active category
          expect(repo.countActiveByUserId(userA)).toBe(1);
          expect(repo.countActiveByUserId(userB)).toBe(1);

          // Total rows in DB should be 2
          const total = db
            .prepare("SELECT COUNT(*) as cnt FROM categories")
            .get() as { cnt: number };
          expect(total.cnt).toBe(2);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * Combining both properties: for a random set of names with case variations,
   * same-user duplicates collapse while cross-user duplicates remain separate.
   */
  it("mixed scenario: same-user case variants collapse, cross-user variants stay separate", () => {
    fc.assert(
      fc.property(
        distinctUserPairArb,
        categoryNamesArb,
        ([userA, userB], names) => {
          db.exec("DELETE FROM categories");
          ensureUser(db, userA);
          ensureUser(db, userB);

          // Create each name for user A with original casing
          for (const name of names) {
            repo.create(name, userA, "llm");
          }

          // Create each name for user A again with swapped casing (should collapse)
          for (const name of names) {
            const swapped = name
              .split("")
              .map((ch) =>
                ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase(),
              )
              .join("");
            const result = repo.create(swapped, userA, "user");
            // Should return the original entity
            const original = repo.findByNameAndUserId(name, userA);
            expect(result.id).toBe(original!.id);
          }

          // User A should still have exactly names.length categories
          expect(repo.countActiveByUserId(userA)).toBe(names.length);

          // Create the same names for user B (should create new separate rows)
          for (const name of names) {
            repo.create(name, userB, "llm");
          }

          // User B should also have exactly names.length categories
          expect(repo.countActiveByUserId(userB)).toBe(names.length);

          // IDs must be disjoint between users
          const idsA = new Set(repo.getActiveByUserId(userA).map((c) => c.id));
          const idsB = new Set(repo.getActiveByUserId(userB).map((c) => c.id));
          for (const id of idsA) {
            expect(idsB.has(id)).toBe(false);
          }

          // Total rows should be 2 * names.length
          const total = db
            .prepare("SELECT COUNT(*) as cnt FROM categories")
            .get() as { cnt: number };
          expect(total.cnt).toBe(names.length * 2);
        },
      ),
      { numRuns: 100 },
    );
  });
});
