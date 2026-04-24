/**
 * Unit tests for CategoryRepository
 *
 * Tests CRUD operations on the categories table using an in-memory SQLite
 * database. Each test starts with a fresh database seeded by the migration.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 8.3, 8.4, 13.1, 14.1, 14.2, 14.3
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createDb } from "../connection.js";
import { CategoryRepository } from "../category-repository.js";

describe("CategoryRepository", () => {
  let db: Database.Database;
  let repo: CategoryRepository;

  beforeEach(() => {
    db = createDb(":memory:");
    // Clear seeded categories so tests control their own data
    db.exec("DELETE FROM categories");
    repo = new CategoryRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  // -----------------------------------------------------------------------
  // getAll()
  // -----------------------------------------------------------------------

  describe("getAll()", () => {
    it("returns categories sorted alphabetically by name", () => {
      repo.upsertByName("Zebra");
      repo.upsertByName("Apple");
      repo.upsertByName("Mango");

      const all = repo.getAll();

      expect(all.map((c) => c.name)).toEqual(["Apple", "Mango", "Zebra"]);
    });

    it("returns an empty array when no categories exist", () => {
      expect(repo.getAll()).toEqual([]);
    });

    it("returns entities with id, name, and createdAt", () => {
      repo.upsertByName("Testing");

      const [cat] = repo.getAll();
      expect(cat).toHaveProperty("id");
      expect(cat).toHaveProperty("name", "Testing");
      expect(cat).toHaveProperty("createdAt");
      expect(typeof cat.createdAt).toBe("string");
    });
  });

  // -----------------------------------------------------------------------
  // getAllNames()
  // -----------------------------------------------------------------------

  describe("getAllNames()", () => {
    it("returns just the name strings sorted alphabetically", () => {
      repo.upsertByName("Zebra");
      repo.upsertByName("Apple");
      repo.upsertByName("Mango");

      expect(repo.getAllNames()).toEqual(["Apple", "Mango", "Zebra"]);
    });

    it("returns an empty array when no categories exist", () => {
      expect(repo.getAllNames()).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // upsertByName()
  // -----------------------------------------------------------------------

  describe("upsertByName()", () => {
    it("creates a new category when name does not exist", () => {
      const cat = repo.upsertByName("Development");

      expect(cat.id).toBeGreaterThan(0);
      expect(cat.name).toBe("Development");
      expect(cat.createdAt).toBeTruthy();
    });

    it("returns the existing category when name already exists", () => {
      const first = repo.upsertByName("Development");
      const second = repo.upsertByName("Development");

      expect(second.id).toBe(first.id);
      expect(second.name).toBe(first.name);
    });

    it("returns the existing category on case-insensitive duplicate", () => {
      const first = repo.upsertByName("Development");
      const second = repo.upsertByName("DEVELOPMENT");
      const third = repo.upsertByName("development");

      expect(second.id).toBe(first.id);
      expect(third.id).toBe(first.id);
    });

    it("preserves the original casing of the first insert", () => {
      repo.upsertByName("MyCategory");
      const found = repo.upsertByName("mycategory");

      expect(found.name).toBe("MyCategory");
    });
  });

  // -----------------------------------------------------------------------
  // rename()
  // -----------------------------------------------------------------------

  describe("rename()", () => {
    it("successfully updates the category name", () => {
      const cat = repo.upsertByName("OldName");
      const renamed = repo.rename(cat.id, "NewName");

      expect(renamed.id).toBe(cat.id);
      expect(renamed.name).toBe("NewName");
    });

    it("throws when the new name conflicts with an existing category", () => {
      repo.upsertByName("Existing");
      const cat = repo.upsertByName("ToRename");

      expect(() => repo.rename(cat.id, "Existing")).toThrow(
        "A category with this name already exists",
      );
    });

    it("throws on case-insensitive duplicate name conflict", () => {
      repo.upsertByName("Existing");
      const cat = repo.upsertByName("ToRename");

      expect(() => repo.rename(cat.id, "EXISTING")).toThrow(
        "A category with this name already exists",
      );
    });

    it("throws when the category ID does not exist", () => {
      expect(() => repo.rename(99999, "Whatever")).toThrow(
        "Category not found",
      );
    });

    it("allows renaming a category to a different casing of its own name", () => {
      const cat = repo.upsertByName("myname");
      const renamed = repo.rename(cat.id, "MyName");

      expect(renamed.id).toBe(cat.id);
      expect(renamed.name).toBe("MyName");
    });

    it("updates the updated_at timestamp on rename", () => {
      const cat = repo.upsertByName("OldName");
      const originalUpdatedAt = cat.updatedAt;

      // Force a small delay by updating the timestamp manually first
      db.exec(
        `UPDATE categories SET updated_at = '2020-01-01 00:00:00' WHERE id = ${cat.id}`,
      );

      const renamed = repo.rename(cat.id, "NewName");
      expect(renamed.updatedAt).not.toBe("2020-01-01 00:00:00");
    });

    it("allows renaming to a name that exists for a different user", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user2')");

      repo.create("TakenByUser2", "user2", "user");
      const cat = repo.create("MyCategory", "user1", "user");

      // Should succeed because uniqueness is per-user
      const renamed = repo.rename(cat.id, "TakenByUser2");
      expect(renamed.name).toBe("TakenByUser2");
    });
  });

  // -----------------------------------------------------------------------
  // findByName()
  // -----------------------------------------------------------------------

  describe("findByName()", () => {
    it("performs case-insensitive lookup", () => {
      const created = repo.upsertByName("Development");

      expect(repo.findByName("development")?.id).toBe(created.id);
      expect(repo.findByName("DEVELOPMENT")?.id).toBe(created.id);
      expect(repo.findByName("Development")?.id).toBe(created.id);
    });

    it("returns null for a non-existent name", () => {
      expect(repo.findByName("NonExistent")).toBeNull();
    });

    it("returns the correct entity shape", () => {
      repo.upsertByName("Testing");
      const found = repo.findByName("testing");

      expect(found).not.toBeNull();
      expect(found!.name).toBe("Testing");
      expect(found!.id).toBeGreaterThan(0);
      expect(typeof found!.createdAt).toBe("string");
    });
  });

  // -----------------------------------------------------------------------
  // findById()
  // -----------------------------------------------------------------------

  describe("findById()", () => {
    it("returns the correct category by ID", () => {
      const created = repo.upsertByName("Research");
      const found = repo.findById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe("Research");
    });

    it("returns null for a non-existent ID", () => {
      expect(repo.findById(99999)).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // delete()
  // -----------------------------------------------------------------------

  describe("delete()", () => {
    it("removes the category from the table", () => {
      const cat = repo.upsertByName("ToDelete");
      expect(repo.findById(cat.id)).not.toBeNull();

      repo.delete(cat.id);
      expect(repo.findById(cat.id)).toBeNull();
    });

    it("does not affect other categories", () => {
      const keep = repo.upsertByName("Keep");
      const remove = repo.upsertByName("Remove");

      repo.delete(remove.id);

      expect(repo.findById(keep.id)).not.toBeNull();
      expect(repo.findById(remove.id)).toBeNull();
    });

    it("is a no-op for a non-existent ID", () => {
      repo.upsertByName("Existing");
      repo.delete(99999);

      expect(repo.getAll()).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Per-user methods
  // -----------------------------------------------------------------------

  describe("getActiveByUserId()", () => {
    it("returns only active categories for the specified user", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user2')");

      repo.create("Alpha", "user1", "user");
      repo.create("Beta", "user1", "user");
      repo.create("Gamma", "user2", "user");

      const user1Cats = repo.getActiveByUserId("user1");
      expect(user1Cats.map((c) => c.name)).toEqual(["Alpha", "Beta"]);

      const user2Cats = repo.getActiveByUserId("user2");
      expect(user2Cats.map((c) => c.name)).toEqual(["Gamma"]);
    });

    it("excludes archived and merged categories", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const active = repo.create("Active", "user1", "user");
      const toArchive = repo.create("Archived", "user1", "user");
      repo.archive(toArchive.id);

      const cats = repo.getActiveByUserId("user1");
      expect(cats.map((c) => c.name)).toEqual(["Active"]);
    });

    it("excludes merged categories", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const source = repo.create("Source", "user1", "user");
      const target = repo.create("Target", "user1", "user");
      repo.merge(source.id, target.id);

      const cats = repo.getActiveByUserId("user1");
      expect(cats.map((c) => c.name)).toEqual(["Target"]);
    });

    it("returns categories ordered by name", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      repo.create("Zebra", "user1", "user");
      repo.create("Apple", "user1", "user");
      repo.create("Mango", "user1", "user");

      const cats = repo.getActiveByUserId("user1");
      expect(cats.map((c) => c.name)).toEqual(["Apple", "Mango", "Zebra"]);
    });

    it("returns an empty array for a user with no categories", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");
      expect(repo.getActiveByUserId("user1")).toEqual([]);
    });

    it("returns an empty array for a non-existent user", () => {
      expect(repo.getActiveByUserId("nonexistent")).toEqual([]);
    });
  });

  describe("getActiveNamesByUserId()", () => {
    it("returns active category names as string array", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      repo.create("Alpha", "user1", "user");
      repo.create("Beta", "user1", "user");

      expect(repo.getActiveNamesByUserId("user1")).toEqual(["Alpha", "Beta"]);
    });

    it("excludes archived and merged categories", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      repo.create("Active", "user1", "user");
      const toArchive = repo.create("Archived", "user1", "user");
      repo.archive(toArchive.id);

      const source = repo.create("Source", "user1", "user");
      const target = repo.create("Target", "user1", "user");
      repo.merge(source.id, target.id);

      const names = repo.getActiveNamesByUserId("user1");
      expect(names).toEqual(["Active", "Target"]);
    });

    it("returns an empty array for a user with no categories", () => {
      expect(repo.getActiveNamesByUserId("nonexistent")).toEqual([]);
    });
  });

  describe("findByNameAndUserId()", () => {
    it("finds a category by name scoped to user (case-insensitive)", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user2')");

      repo.create("Development", "user1", "user");
      repo.create("Development", "user2", "user");

      const found = repo.findByNameAndUserId("development", "user1");
      expect(found).not.toBeNull();
      expect(found!.userId).toBe("user1");

      const notFound = repo.findByNameAndUserId("Development", "user3");
      expect(notFound).toBeNull();
    });

    it("returns null for a name that exists under a different user", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user2')");

      repo.create("OnlyForUser1", "user1", "user");

      expect(repo.findByNameAndUserId("OnlyForUser1", "user2")).toBeNull();
    });

    it("returns the full entity with all fields", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      repo.create("Testing", "user1", "llm");

      const found = repo.findByNameAndUserId("testing", "user1");
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Testing");
      expect(found!.userId).toBe("user1");
      expect(found!.createdBy).toBe("llm");
      expect(found!.status).toBe("active");
      expect(found!.id).toBeGreaterThan(0);
    });
  });

  describe("create()", () => {
    it("creates a new category with correct metadata", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const cat = repo.create("Development", "user1", "llm");

      expect(cat.name).toBe("Development");
      expect(cat.userId).toBe("user1");
      expect(cat.createdBy).toBe("llm");
      expect(cat.status).toBe("active");
      expect(cat.mergedIntoCategoryId).toBeNull();
    });

    it("returns existing category on duplicate name for same user", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const first = repo.create("Development", "user1", "llm");
      const second = repo.create("DEVELOPMENT", "user1", "user");

      expect(second.id).toBe(first.id);
    });

    it("preserves original createdBy on upsert", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const first = repo.create("Development", "user1", "llm");
      const second = repo.create("development", "user1", "user");

      expect(second.createdBy).toBe("llm");
    });

    it("creates separate categories for different users with same name", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user2')");

      const cat1 = repo.create("Development", "user1", "llm");
      const cat2 = repo.create("Development", "user2", "llm");

      expect(cat1.id).not.toBe(cat2.id);
    });

    it("supports all createdBy values", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const llm = repo.create("LlmCat", "user1", "llm");
      const user = repo.create("UserCat", "user1", "user");
      const system = repo.create("SystemCat", "user1", "system");
      const fallback = repo.create("FallbackCat", "user1", "fallback");

      expect(llm.createdBy).toBe("llm");
      expect(user.createdBy).toBe("user");
      expect(system.createdBy).toBe("system");
      expect(fallback.createdBy).toBe("fallback");
    });

    it("sets createdAt and updatedAt timestamps", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const cat = repo.create("Timestamped", "user1", "user");

      expect(cat.createdAt).toBeTruthy();
      expect(cat.updatedAt).toBeTruthy();
      expect(typeof cat.createdAt).toBe("string");
      expect(typeof cat.updatedAt).toBe("string");
    });
  });

  describe("countActiveByUserId()", () => {
    it("counts only active categories for a user", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      repo.create("A", "user1", "user");
      repo.create("B", "user1", "user");
      const toArchive = repo.create("C", "user1", "user");
      repo.archive(toArchive.id);

      expect(repo.countActiveByUserId("user1")).toBe(2);
    });

    it("returns zero for a user with no categories", () => {
      expect(repo.countActiveByUserId("nonexistent")).toBe(0);
    });

    it("excludes merged categories from count", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const source = repo.create("Source", "user1", "user");
      const target = repo.create("Target", "user1", "user");
      repo.create("Other", "user1", "user");
      repo.merge(source.id, target.id);

      expect(repo.countActiveByUserId("user1")).toBe(2);
    });
  });

  describe("archive()", () => {
    it("sets category status to archived", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const cat = repo.create("ToArchive", "user1", "user");
      repo.archive(cat.id);

      const found = repo.findById(cat.id);
      expect(found!.status).toBe("archived");
    });

    it("updates the updated_at timestamp", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const cat = repo.create("ToArchive", "user1", "user");
      db.exec(
        `UPDATE categories SET updated_at = '2020-01-01 00:00:00' WHERE id = ${cat.id}`,
      );

      repo.archive(cat.id);

      const found = repo.findById(cat.id);
      expect(found!.updatedAt).not.toBe("2020-01-01 00:00:00");
    });

    it("does not affect other categories", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const keep = repo.create("Keep", "user1", "user");
      const toArchive = repo.create("ToArchive", "user1", "user");
      repo.archive(toArchive.id);

      const kept = repo.findById(keep.id);
      expect(kept!.status).toBe("active");
    });
  });

  describe("merge()", () => {
    it("sets source status to merged and updates merged_into_category_id", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const source = repo.create("Source", "user1", "user");
      const target = repo.create("Target", "user1", "user");

      repo.merge(source.id, target.id);

      const merged = repo.findById(source.id);
      expect(merged!.status).toBe("merged");
      expect(merged!.mergedIntoCategoryId).toBe(target.id);
    });

    it("updates completion_history references from source to target", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const source = repo.create("Source", "user1", "user");
      const target = repo.create("Target", "user1", "user");

      // Insert completion_history rows referencing source
      db.exec(`
        INSERT INTO completion_history (id, user_id, task_description, category_id, estimated_time, actual_time, difficulty_level)
        VALUES ('ch1', 'user1', 'task1', ${source.id}, 30, 25, 3),
               ('ch2', 'user1', 'task2', ${source.id}, 60, 55, 4)
      `);

      repo.merge(source.id, target.id);

      const rows = db
        .prepare(
          "SELECT category_id FROM completion_history WHERE id IN ('ch1', 'ch2')",
        )
        .all() as { category_id: number }[];

      expect(rows.every((r) => r.category_id === target.id)).toBe(true);
    });

    it("merges behavioral_adjustments with weighted averages", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const source = repo.create("Source", "user1", "user");
      const target = repo.create("Target", "user1", "user");

      // Insert behavioral_adjustments for both source and target
      db.exec(`
        INSERT INTO behavioral_adjustments (user_id, category, category_id, time_multiplier, difficulty_adjustment, sample_size)
        VALUES ('user1', 'Source', ${source.id}, 1.5, 0.5, 10)
      `);
      db.exec(`
        INSERT INTO behavioral_adjustments (user_id, category, category_id, time_multiplier, difficulty_adjustment, sample_size)
        VALUES ('user1', 'Target', ${target.id}, 1.0, 0.0, 10)
      `);

      repo.merge(source.id, target.id);

      // Weighted average: (1.5*10 + 1.0*10) / 20 = 1.25
      const row = db
        .prepare(
          "SELECT time_multiplier, difficulty_adjustment, sample_size FROM behavioral_adjustments WHERE category_id = ? AND user_id = 'user1'",
        )
        .get(target.id) as {
        time_multiplier: number;
        difficulty_adjustment: number;
        sample_size: number;
      };

      expect(row.time_multiplier).toBeCloseTo(1.25);
      expect(row.difficulty_adjustment).toBeCloseTo(0.25);
      expect(row.sample_size).toBe(20);

      // Source row should be deleted
      const sourceRow = db
        .prepare("SELECT * FROM behavioral_adjustments WHERE category_id = ?")
        .get(source.id);
      expect(sourceRow).toBeUndefined();
    });

    it("preserves total completion_history row count", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const source = repo.create("Source", "user1", "user");
      const target = repo.create("Target", "user1", "user");

      db.exec(`
        INSERT INTO completion_history (id, user_id, task_description, category_id, estimated_time, actual_time, difficulty_level)
        VALUES ('ch1', 'user1', 'task1', ${source.id}, 30, 25, 3),
               ('ch2', 'user1', 'task2', ${target.id}, 60, 55, 4)
      `);

      const countBefore = (
        db.prepare("SELECT COUNT(*) as cnt FROM completion_history").get() as {
          cnt: number;
        }
      ).cnt;

      repo.merge(source.id, target.id);

      const countAfter = (
        db.prepare("SELECT COUNT(*) as cnt FROM completion_history").get() as {
          cnt: number;
        }
      ).cnt;

      expect(countAfter).toBe(countBefore);
    });

    it("reassigns behavioral_adjustments when no target row exists", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const source = repo.create("Source", "user1", "user");
      const target = repo.create("Target", "user1", "user");

      // Only insert a source behavioral_adjustment (no target row)
      db.exec(`
        INSERT INTO behavioral_adjustments (user_id, category, category_id, time_multiplier, difficulty_adjustment, sample_size)
        VALUES ('user1', 'Source', ${source.id}, 1.5, 0.5, 10)
      `);

      repo.merge(source.id, target.id);

      // Source row should be reassigned to target
      const row = db
        .prepare(
          "SELECT category_id, category, time_multiplier, difficulty_adjustment, sample_size FROM behavioral_adjustments WHERE user_id = 'user1'",
        )
        .get() as {
        category_id: number;
        category: string;
        time_multiplier: number;
        difficulty_adjustment: number;
        sample_size: number;
      };

      expect(row.category_id).toBe(target.id);
      expect(row.category).toBe("Target");
      expect(row.time_multiplier).toBeCloseTo(1.5);
      expect(row.difficulty_adjustment).toBeCloseTo(0.5);
      expect(row.sample_size).toBe(10);
    });

    it("handles merge with no completion_history or behavioral_adjustments", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const source = repo.create("Source", "user1", "user");
      const target = repo.create("Target", "user1", "user");

      // Merge with no references — should not throw
      repo.merge(source.id, target.id);

      const merged = repo.findById(source.id);
      expect(merged!.status).toBe("merged");
      expect(merged!.mergedIntoCategoryId).toBe(target.id);
    });
  });

  describe("resolveCategory()", () => {
    it("returns the category itself when it is active", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const cat = repo.create("Active", "user1", "user");
      const resolved = repo.resolveCategory(cat.id);

      expect(resolved.id).toBe(cat.id);
    });

    it("follows a single merge hop", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const source = repo.create("Source", "user1", "user");
      const target = repo.create("Target", "user1", "user");

      repo.merge(source.id, target.id);

      const resolved = repo.resolveCategory(source.id);
      expect(resolved.id).toBe(target.id);
      expect(resolved.name).toBe("Target");
      expect(resolved.status).toBe("active");
    });

    it("follows merge chain to final active category", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const a = repo.create("A", "user1", "user");
      const b = repo.create("B", "user1", "user");
      const c = repo.create("C", "user1", "user");

      // A → B → C
      repo.merge(a.id, b.id);
      repo.merge(b.id, c.id);

      const resolved = repo.resolveCategory(a.id);
      expect(resolved.id).toBe(c.id);
      expect(resolved.name).toBe("C");
    });

    it("throws for non-existent category ID", () => {
      expect(() => repo.resolveCategory(99999)).toThrow("Category not found");
    });

    it("returns archived category at end of chain without further following", () => {
      db.exec("INSERT OR IGNORE INTO users (id) VALUES ('user1')");

      const a = repo.create("A", "user1", "user");
      const b = repo.create("B", "user1", "user");

      repo.merge(a.id, b.id);
      repo.archive(b.id);

      // Chain: A (merged) → B (archived). B is not merged, so resolution stops at B.
      const resolved = repo.resolveCategory(a.id);
      expect(resolved.id).toBe(b.id);
      expect(resolved.status).toBe("archived");
    });
  });
});
