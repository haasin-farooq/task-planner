/**
 * CategoryRepository — SQLite-backed data access for the `categories` table.
 *
 * Provides CRUD operations for category entities. The `name` column uses
 * COLLATE NOCASE so all lookups and uniqueness checks are case-insensitive.
 *
 * Requirements: 1.1, 1.3, 4.1, 4.2, 9.1, 9.2, 9.3
 */

import type Database from "better-sqlite3";

export interface CategoryEntity {
  id: number;
  name: string;
  createdAt: string;
}

interface CategoryRow {
  id: number;
  name: string;
  created_at: string;
}

function rowToEntity(row: CategoryRow): CategoryEntity {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}

export class CategoryRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Get all categories ordered by name. */
  getAll(): CategoryEntity[] {
    const rows = this.db
      .prepare("SELECT id, name, created_at FROM categories ORDER BY name")
      .all() as CategoryRow[];
    return rows.map(rowToEntity);
  }

  /** Get all category names as a string array. */
  getAllNames(): string[] {
    const rows = this.db
      .prepare("SELECT name FROM categories ORDER BY name")
      .all() as Pick<CategoryRow, "name">[];
    return rows.map((r) => r.name);
  }

  /** Find a category by name (case-insensitive due to COLLATE NOCASE). */
  findByName(name: string): CategoryEntity | null {
    const row = this.db
      .prepare("SELECT id, name, created_at FROM categories WHERE name = ?")
      .get(name) as CategoryRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  /** Find a category by ID. */
  findById(id: number): CategoryEntity | null {
    const row = this.db
      .prepare("SELECT id, name, created_at FROM categories WHERE id = ?")
      .get(id) as CategoryRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  /**
   * Insert a new category or return the existing one if the name already exists.
   * Uses INSERT OR IGNORE followed by a SELECT to handle the COLLATE NOCASE
   * uniqueness constraint gracefully.
   */
  upsertByName(name: string): CategoryEntity {
    this.db
      .prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)")
      .run(name);

    const row = this.db
      .prepare("SELECT id, name, created_at FROM categories WHERE name = ?")
      .get(name) as CategoryRow;

    return rowToEntity(row);
  }

  /**
   * Rename a category. Throws if the ID does not exist or if the new name
   * conflicts with an existing category (case-insensitive).
   */
  rename(id: number, newName: string): CategoryEntity {
    const existing = this.findById(id);
    if (!existing) {
      throw new Error("Category not found");
    }

    try {
      this.db
        .prepare("UPDATE categories SET name = ? WHERE id = ?")
        .run(newName, id);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint failed")
      ) {
        throw new Error("A category with this name already exists");
      }
      throw err;
    }

    return this.findById(id)!;
  }

  /** Delete a category by ID. */
  delete(id: number): void {
    this.db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  }
}
