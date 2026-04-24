/**
 * CategoryRepository — SQLite-backed data access for the `categories` table.
 *
 * Provides CRUD operations for category entities with per-user ownership,
 * lifecycle status tracking, and merge support. The `name` column uses
 * COLLATE NOCASE so all lookups and uniqueness checks are case-insensitive.
 * Uniqueness is scoped per user via UNIQUE(user_id, name).
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 8.3, 8.4, 13.1, 14.1, 14.2, 14.3
 */

import type Database from "better-sqlite3";

export interface CategoryEntity {
  id: number;
  name: string;
  userId: string;
  status: "active" | "merged" | "archived";
  createdBy: "llm" | "user" | "system" | "fallback";
  mergedIntoCategoryId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface CategoryRow {
  id: number;
  name: string;
  user_id: string;
  status: "active" | "merged" | "archived";
  created_by: "llm" | "user" | "system" | "fallback";
  merged_into_category_id: number | null;
  created_at: string;
  updated_at: string;
}

function rowToEntity(row: CategoryRow): CategoryEntity {
  return {
    id: row.id,
    name: row.name,
    userId: row.user_id,
    status: row.status,
    createdBy: row.created_by,
    mergedIntoCategoryId: row.merged_into_category_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ALL_COLUMNS =
  "id, name, user_id, status, created_by, merged_into_category_id, created_at, updated_at";

export class CategoryRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ---------------------------------------------------------------------------
  // Per-user queries
  // ---------------------------------------------------------------------------

  /** Get all active categories for a user, ordered by name. */
  getActiveByUserId(userId: string): CategoryEntity[] {
    const rows = this.db
      .prepare(
        `SELECT ${ALL_COLUMNS} FROM categories
         WHERE user_id = ? AND status = 'active'
         ORDER BY name`,
      )
      .all(userId) as CategoryRow[];
    return rows.map(rowToEntity);
  }

  /** Get all active category names for a user as a string array. */
  getActiveNamesByUserId(userId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT name FROM categories
         WHERE user_id = ? AND status = 'active'
         ORDER BY name`,
      )
      .all(userId) as Pick<CategoryRow, "name">[];
    return rows.map((r) => r.name);
  }

  /** Find a category by name for a specific user (case-insensitive). */
  findByNameAndUserId(name: string, userId: string): CategoryEntity | null {
    const row = this.db
      .prepare(
        `SELECT ${ALL_COLUMNS} FROM categories
         WHERE name = ? AND user_id = ?`,
      )
      .get(name, userId) as CategoryRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  /** Count active categories for a user. */
  countActiveByUserId(userId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM categories
         WHERE user_id = ? AND status = 'active'`,
      )
      .get(userId) as { cnt: number };
    return row.cnt;
  }

  // ---------------------------------------------------------------------------
  // Lookup by ID / name (global)
  // ---------------------------------------------------------------------------

  /** Find a category by ID. */
  findById(id: number): CategoryEntity | null {
    const row = this.db
      .prepare(`SELECT ${ALL_COLUMNS} FROM categories WHERE id = ?`)
      .get(id) as CategoryRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  /**
   * Find a category by name (case-insensitive due to COLLATE NOCASE).
   * Legacy method — prefers findByNameAndUserId for per-user scoping.
   */
  findByName(name: string): CategoryEntity | null {
    const row = this.db
      .prepare(`SELECT ${ALL_COLUMNS} FROM categories WHERE name = ?`)
      .get(name) as CategoryRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  // ---------------------------------------------------------------------------
  // Create / upsert
  // ---------------------------------------------------------------------------

  /**
   * Create a new category for a user. Returns existing if name already
   * exists for that user (case-insensitive upsert).
   */
  create(
    name: string,
    userId: string,
    createdBy: CategoryEntity["createdBy"],
  ): CategoryEntity {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO categories (name, user_id, created_by)
         VALUES (?, ?, ?)`,
      )
      .run(name, userId, createdBy);

    const row = this.db
      .prepare(
        `SELECT ${ALL_COLUMNS} FROM categories
         WHERE name = ? AND user_id = ?`,
      )
      .get(name, userId) as CategoryRow;

    return rowToEntity(row);
  }

  /**
   * Insert a new category or return the existing one if the name already exists.
   * Legacy method — uses a default user_id and created_by for backward compat.
   */
  upsertByName(name: string): CategoryEntity {
    // Ensure the __pending__ user exists for legacy inserts
    this.db
      .prepare("INSERT OR IGNORE INTO users (id) VALUES ('__pending__')")
      .run();

    this.db
      .prepare(
        `INSERT OR IGNORE INTO categories (name, user_id, created_by)
         VALUES (?, '__pending__', 'system')`,
      )
      .run(name);

    const row = this.db
      .prepare(`SELECT ${ALL_COLUMNS} FROM categories WHERE name = ?`)
      .get(name) as CategoryRow;

    return rowToEntity(row);
  }

  // ---------------------------------------------------------------------------
  // Update operations
  // ---------------------------------------------------------------------------

  /**
   * Rename a category. Updates updated_at timestamp. Throws if the ID does
   * not exist or if the new name conflicts with an existing category for the
   * same user (case-insensitive).
   */
  rename(id: number, newName: string): CategoryEntity {
    const existing = this.findById(id);
    if (!existing) {
      throw new Error("Category not found");
    }

    try {
      this.db
        .prepare(
          `UPDATE categories
           SET name = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
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

  /** Set a category's status to 'archived'. */
  archive(id: number): void {
    this.db
      .prepare(
        `UPDATE categories
         SET status = 'archived', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(id);
  }

  // ---------------------------------------------------------------------------
  // Merge
  // ---------------------------------------------------------------------------

  /**
   * Merge source category into target category.
   *
   * 1. Set source status to 'merged' and merged_into_category_id to target.id
   * 2. Update all completion_history rows referencing source category_id → target
   * 3. Merge behavioral_adjustments using weighted averages
   * 4. Preserve total row counts
   */
  merge(sourceId: number, targetId: number): void {
    const doMerge = this.db.transaction(() => {
      // 1. Mark source as merged
      this.db
        .prepare(
          `UPDATE categories
           SET status = 'merged',
               merged_into_category_id = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .run(targetId, sourceId);

      // 2. Update all completion_history references from source → target
      this.db
        .prepare(
          `UPDATE completion_history
           SET category_id = ?
           WHERE category_id = ?`,
        )
        .run(targetId, sourceId);

      // 3. Merge behavioral_adjustments using weighted averages
      this._mergeBehavioralAdjustments(sourceId, targetId);
    });

    doMerge();
  }

  /**
   * Merge behavioral_adjustments from source into target using weighted averages.
   *
   * For each source adjustment row:
   * - If a matching target row exists (same user_id), compute weighted averages
   *   for time_multiplier and difficulty_adjustment, sum sample_size
   * - If no matching target row exists, reassign the source row to the target category_id
   */
  private _mergeBehavioralAdjustments(
    sourceId: number,
    targetId: number,
  ): void {
    // Get the target category to find its name
    const targetCat = this.findById(targetId);
    if (!targetCat) return;

    // Get all source adjustment rows
    const sourceRows = this.db
      .prepare(
        `SELECT user_id, category, category_id, time_multiplier, difficulty_adjustment, sample_size
         FROM behavioral_adjustments
         WHERE category_id = ?`,
      )
      .all(sourceId) as {
      user_id: string;
      category: string;
      category_id: number;
      time_multiplier: number;
      difficulty_adjustment: number;
      sample_size: number;
    }[];

    for (const srcRow of sourceRows) {
      // Check if a target adjustment row exists for the same user
      const targetRow = this.db
        .prepare(
          `SELECT user_id, category, category_id, time_multiplier, difficulty_adjustment, sample_size
           FROM behavioral_adjustments
           WHERE category_id = ? AND user_id = ?`,
        )
        .get(targetId, srcRow.user_id) as
        | {
            user_id: string;
            category: string;
            category_id: number;
            time_multiplier: number;
            difficulty_adjustment: number;
            sample_size: number;
          }
        | undefined;

      if (targetRow) {
        // Compute weighted averages and merge
        const totalSamples = srcRow.sample_size + targetRow.sample_size;
        const weightedTimeMultiplier =
          totalSamples > 0
            ? (srcRow.time_multiplier * srcRow.sample_size +
                targetRow.time_multiplier * targetRow.sample_size) /
              totalSamples
            : targetRow.time_multiplier;
        const weightedDifficultyAdj =
          totalSamples > 0
            ? (srcRow.difficulty_adjustment * srcRow.sample_size +
                targetRow.difficulty_adjustment * targetRow.sample_size) /
              totalSamples
            : targetRow.difficulty_adjustment;

        // Update target row with merged values
        this.db
          .prepare(
            `UPDATE behavioral_adjustments
             SET time_multiplier = ?,
                 difficulty_adjustment = ?,
                 sample_size = ?,
                 category = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE category_id = ? AND user_id = ?`,
          )
          .run(
            weightedTimeMultiplier,
            weightedDifficultyAdj,
            totalSamples,
            targetCat.name,
            targetId,
            srcRow.user_id,
          );

        // Delete the source row (it's been merged into the target)
        this.db
          .prepare(
            `DELETE FROM behavioral_adjustments
             WHERE category_id = ? AND user_id = ?`,
          )
          .run(sourceId, srcRow.user_id);
      } else {
        // No matching target row — reassign source row to target
        this.db
          .prepare(
            `UPDATE behavioral_adjustments
             SET category_id = ?,
                 category = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE category_id = ? AND user_id = ?`,
          )
          .run(targetId, targetCat.name, sourceId, srcRow.user_id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Category resolution (follow merge chain)
  // ---------------------------------------------------------------------------

  /**
   * Follow the merged_into_category_id chain to resolve the final active category.
   * Protects against infinite loops with a max depth of 50.
   */
  resolveCategory(categoryId: number): CategoryEntity {
    let current = this.findById(categoryId);
    if (!current) {
      throw new Error("Category not found");
    }

    const maxDepth = 50;
    let depth = 0;

    while (
      current.status === "merged" &&
      current.mergedIntoCategoryId !== null &&
      depth < maxDepth
    ) {
      const next = this.findById(current.mergedIntoCategoryId);
      if (!next) {
        // Broken chain — return the last valid category
        break;
      }
      current = next;
      depth++;
    }

    return current;
  }

  // ---------------------------------------------------------------------------
  // Legacy methods (backward compatibility)
  // ---------------------------------------------------------------------------

  /** Get all categories ordered by name. Legacy — returns all statuses. */
  getAll(): CategoryEntity[] {
    const rows = this.db
      .prepare(`SELECT ${ALL_COLUMNS} FROM categories ORDER BY name`)
      .all() as CategoryRow[];
    return rows.map(rowToEntity);
  }

  /** Get all category names as a string array. Legacy — returns all statuses. */
  getAllNames(): string[] {
    const rows = this.db
      .prepare("SELECT name FROM categories ORDER BY name")
      .all() as Pick<CategoryRow, "name">[];
    return rows.map((r) => r.name);
  }

  /** Delete a category by ID. Legacy method. */
  delete(id: number): void {
    this.db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  }
}
