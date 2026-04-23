/**
 * Unit tests for CategoryRepository
 *
 * Tests CRUD operations on the categories table using an in-memory SQLite
 * database. Each test starts with a fresh database seeded by the migration.
 *
 * Requirements: 1.1, 1.3, 4.1, 4.2, 9.1, 9.2, 9.3
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
});
