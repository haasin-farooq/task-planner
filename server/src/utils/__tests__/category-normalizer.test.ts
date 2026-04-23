import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  normalize,
  backfill,
  CATEGORY_MAPPINGS,
} from "../category-normalizer.js";
import type { CanonicalCategory } from "../../types/index.js";

describe("CategoryNormalizer", () => {
  describe("normalize", () => {
    it("maps writing-related keywords to Writing", () => {
      expect(normalize("write")).toBe("Writing");
      expect(normalize("blog post")).toBe("Writing");
      expect(normalize("article")).toBe("Writing");
      expect(normalize("draft")).toBe("Writing");
      expect(normalize("documentation")).toBe("Writing");
      expect(normalize("docs")).toBe("Writing");
      expect(normalize("report")).toBe("Writing");
    });

    it("maps development-related keywords to Development", () => {
      expect(normalize("code")).toBe("Development");
      expect(normalize("coding")).toBe("Development");
      expect(normalize("programming")).toBe("Development");
      expect(normalize("implement feature")).toBe("Development");
      expect(normalize("debug issue")).toBe("Development");
      expect(normalize("refactor module")).toBe("Development");
      expect(normalize("deploy to prod")).toBe("Development");
    });

    it("maps design-related keywords to Design", () => {
      expect(normalize("design")).toBe("Design");
      expect(normalize("ui work")).toBe("Design");
      expect(normalize("ux research")).toBe("Design");
      expect(normalize("mockup")).toBe("Design");
      expect(normalize("wireframe")).toBe("Design");
      expect(normalize("figma")).toBe("Design");
    });

    it("maps research-related keywords to Research", () => {
      expect(normalize("research")).toBe("Research");
      expect(normalize("investigate bug")).toBe("Research");
      expect(normalize("analyze data")).toBe("Research");
      expect(normalize("analysis")).toBe("Research");
    });

    it("maps admin-related keywords to Admin", () => {
      expect(normalize("admin")).toBe("Admin");
      expect(normalize("administrative")).toBe("Admin");
      expect(normalize("organize files")).toBe("Admin");
      expect(normalize("invoice")).toBe("Admin");
      expect(normalize("expense tracking")).toBe("Admin");
      expect(normalize("paperwork")).toBe("Admin");
    });

    it("maps communication-related keywords to Communication", () => {
      expect(normalize("email")).toBe("Communication");
      expect(normalize("meeting")).toBe("Communication");
      expect(normalize("call")).toBe("Communication");
      expect(normalize("presentation")).toBe("Communication");
      expect(normalize("standup")).toBe("Communication");
    });

    it("maps planning-related keywords to Planning", () => {
      expect(normalize("plan")).toBe("Planning");
      expect(normalize("planning")).toBe("Planning");
      expect(normalize("roadmap")).toBe("Planning");
      expect(normalize("sprint planning")).toBe("Planning");
      expect(normalize("backlog grooming")).toBe("Planning");
    });

    it("maps testing-related keywords to Testing", () => {
      expect(normalize("test")).toBe("Testing");
      expect(normalize("testing")).toBe("Testing");
      expect(normalize("qa")).toBe("Testing");
      expect(normalize("validation")).toBe("Testing");
    });

    it("maps learning-related keywords to Learning", () => {
      expect(normalize("learn")).toBe("Learning");
      expect(normalize("learning")).toBe("Learning");
      expect(normalize("course")).toBe("Learning");
      expect(normalize("tutorial")).toBe("Learning");
      expect(normalize("training")).toBe("Learning");
    });

    it("returns Other for unmatched input", () => {
      expect(normalize("random stuff")).toBe("Other");
      expect(normalize("xyz")).toBe("Other");
      expect(normalize("")).toBe("Other");
    });

    it("normalizes case-insensitively", () => {
      expect(normalize("WRITING")).toBe("Writing");
      expect(normalize("Code Review")).toBe("Development");
      expect(normalize("DESIGN")).toBe("Design");
      expect(normalize("Testing")).toBe("Testing");
    });

    it("trims whitespace", () => {
      expect(normalize("  writing  ")).toBe("Writing");
      expect(normalize("\tcode\n")).toBe("Development");
    });

    it("matches keywords as substrings", () => {
      expect(normalize("write a blog post about coding")).toBe("Writing");
      expect(normalize("frontend development task")).toBe("Development");
    });
  });

  describe("backfill", () => {
    let db: Database.Database;

    beforeEach(() => {
      db = new Database(":memory:");
      db.exec(`
        CREATE TABLE completion_history (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          task_description TEXT NOT NULL,
          category TEXT,
          normalized_category TEXT,
          estimated_time INTEGER NOT NULL,
          actual_time INTEGER NOT NULL,
          difficulty_level INTEGER NOT NULL,
          completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    });

    afterEach(() => {
      db.close();
    });

    it("updates rows with NULL normalized_category", () => {
      db.exec(`
        INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
        VALUES ('1', 'u1', 'Write docs', 'writing', 30, 25, 2),
               ('2', 'u1', 'Fix bug', 'coding', 60, 90, 4)
      `);

      backfill(db);

      const rows = db
        .prepare(
          "SELECT id, normalized_category FROM completion_history ORDER BY id",
        )
        .all() as { id: string; normalized_category: string }[];

      expect(rows).toEqual([
        { id: "1", normalized_category: "Writing" },
        { id: "2", normalized_category: "Development" },
      ]);
    });

    it("does not modify rows that already have a normalized_category", () => {
      db.exec(`
        INSERT INTO completion_history (id, user_id, task_description, category, normalized_category, estimated_time, actual_time, difficulty_level)
        VALUES ('1', 'u1', 'Write docs', 'writing', 'Writing', 30, 25, 2)
      `);

      backfill(db);

      const row = db
        .prepare(
          "SELECT normalized_category FROM completion_history WHERE id = '1'",
        )
        .get() as { normalized_category: string };

      expect(row.normalized_category).toBe("Writing");
    });

    it("assigns Other when category is NULL", () => {
      db.exec(`
        INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
        VALUES ('1', 'u1', 'Some task', NULL, 30, 25, 2)
      `);

      backfill(db);

      const row = db
        .prepare(
          "SELECT normalized_category FROM completion_history WHERE id = '1'",
        )
        .get() as { normalized_category: string };

      expect(row.normalized_category).toBe("Other");
    });

    it("preserves original category values", () => {
      db.exec(`
        INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
        VALUES ('1', 'u1', 'Write docs', 'My Custom Writing Category', 30, 25, 2)
      `);

      backfill(db);

      const row = db
        .prepare(
          "SELECT category, normalized_category FROM completion_history WHERE id = '1'",
        )
        .get() as { category: string; normalized_category: string };

      expect(row.category).toBe("My Custom Writing Category");
      expect(row.normalized_category).toBe("Writing");
    });

    it("handles empty table gracefully", () => {
      expect(() => backfill(db)).not.toThrow();
    });
  });

  describe("CATEGORY_MAPPINGS", () => {
    it("covers all canonical categories except Other", () => {
      const mappedCategories = CATEGORY_MAPPINGS.map((m) => m.canonical);
      const expected: CanonicalCategory[] = [
        "Writing",
        "Development",
        "Design",
        "Research",
        "Admin",
        "Communication",
        "Planning",
        "Testing",
        "Learning",
      ];
      expect(mappedCategories).toEqual(expected);
    });

    it("has at least one keyword per category", () => {
      for (const mapping of CATEGORY_MAPPINGS) {
        expect(mapping.keywords.length).toBeGreaterThan(0);
      }
    });
  });
});
