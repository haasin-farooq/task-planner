/**
 * AdaptiveLearningEngine — tracks task completion behavior and produces
 * adjustment factors so the Task Analyzer can personalise metric predictions.
 *
 * Stores completion records in the `completion_history` table and maintains
 * rolling per-category adjustments in `behavioral_adjustments`.
 *
 * Key rules:
 * - `timeMultiplier` is the rolling average of (actualTime / estimatedTime)
 *   for a given category.
 * - Adjustments are only *applied* by consumers when `sampleSize >= 10`.
 * - `difficultyAdjustment` is derived from the timeMultiplier direction:
 *   negative when the user is faster (multiplier < 1), positive when slower.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type {
  CompletionRecord,
  BehavioralModel,
  CategoryAdjustment,
} from "../types/index.js";
import { normalize } from "../utils/category-normalizer.js";
import type { CategoryRepository } from "../db/category-repository.js";

// ---------------------------------------------------------------------------
// Row types for SQLite query results
// ---------------------------------------------------------------------------

interface AdjustmentRow {
  category: string;
  time_multiplier: number;
  difficulty_adjustment: number;
  sample_size: number;
}

interface CompletionCountRow {
  cnt: number;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class AdaptiveLearningEngine {
  private db: Database.Database;
  private categoryRepo?: CategoryRepository;

  constructor(db: Database.Database, categoryRepo?: CategoryRepository) {
    this.db = db;
    this.categoryRepo = categoryRepo;
  }

  // -----------------------------------------------------------------------
  // recordCompletion
  // -----------------------------------------------------------------------

  /**
   * Persist a completion record and update the rolling behavioural
   * adjustments for the task's category.
   *
   * The category is taken from `record.description` — in a full
   * implementation the LLM would assign a canonical category, but for now
   * we use the description directly as the category key.
   */
  recordCompletion(record: CompletionRecord): void {
    const category = record.description;

    const run = this.db.transaction(() => {
      // Ensure the user row exists
      this.db
        .prepare("INSERT OR IGNORE INTO users (id) VALUES (?)")
        .run(record.userId);

      // Resolve category_id via CategoryRepository when available (Req 6.1)
      const normalizedCategory = normalize(category);
      let categoryId: number | null = null;
      if (this.categoryRepo) {
        const categoryEntity =
          this.categoryRepo.upsertByName(normalizedCategory);
        categoryId = categoryEntity.id;
      }

      // 1. Insert into completion_history (include category_id when resolved)
      if (categoryId !== null) {
        this.db
          .prepare(
            `INSERT INTO completion_history
               (id, user_id, task_description, category, normalized_category, category_id, estimated_time, actual_time, difficulty_level, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            uuidv4(),
            record.userId,
            record.description,
            category,
            normalizedCategory,
            categoryId,
            record.estimatedTime,
            record.actualTime,
            record.difficultyLevel,
            record.completedAt.toISOString(),
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO completion_history
               (id, user_id, task_description, category, normalized_category, estimated_time, actual_time, difficulty_level, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            uuidv4(),
            record.userId,
            record.description,
            category,
            normalizedCategory,
            record.estimatedTime,
            record.actualTime,
            record.difficultyLevel,
            record.completedAt.toISOString(),
          );
      }

      // 2. Recompute the rolling average for this (user, category) pair.
      //    We query *all* history rows for the category so the multiplier
      //    is a true average rather than an incremental approximation.
      //    When category_id is available, group by category_id (Req 6.2);
      //    otherwise fall back to grouping by the raw category text.
      let rows: { actual_time: number; estimated_time: number }[];
      if (categoryId !== null) {
        rows = this.db
          .prepare(
            `SELECT actual_time, estimated_time
             FROM completion_history
             WHERE user_id = ? AND category_id = ?`,
          )
          .all(record.userId, categoryId) as {
          actual_time: number;
          estimated_time: number;
        }[];
      } else {
        rows = this.db
          .prepare(
            `SELECT actual_time, estimated_time
             FROM completion_history
             WHERE user_id = ? AND category = ?`,
          )
          .all(record.userId, category) as {
          actual_time: number;
          estimated_time: number;
        }[];
      }

      const sampleSize = rows.length;
      const timeMultiplier =
        rows.reduce((sum, r) => sum + r.actual_time / r.estimated_time, 0) /
        sampleSize;

      // difficultyAdjustment mirrors the multiplier direction:
      //   < 0 when user is faster (multiplier < 1)
      //   > 0 when user is slower (multiplier > 1)
      const difficultyAdjustment = timeMultiplier - 1.0;

      // 3. Upsert behavioral_adjustments
      //    When category_id is available, use the normalized category name as
      //    the category column so that ON CONFLICT(user_id, category) correctly
      //    groups all descriptions that resolve to the same category (Req 6.2, 6.3).
      //    Otherwise fall back to the raw category text.
      if (categoryId !== null) {
        this.db
          .prepare(
            `INSERT INTO behavioral_adjustments
               (user_id, category, category_id, time_multiplier, difficulty_adjustment, sample_size, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(user_id, category) DO UPDATE SET
               category_id        = excluded.category_id,
               time_multiplier    = excluded.time_multiplier,
               difficulty_adjustment = excluded.difficulty_adjustment,
               sample_size        = excluded.sample_size,
               updated_at         = excluded.updated_at`,
          )
          .run(
            record.userId,
            normalizedCategory,
            categoryId,
            timeMultiplier,
            difficultyAdjustment,
            sampleSize,
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO behavioral_adjustments
               (user_id, category, time_multiplier, difficulty_adjustment, sample_size, updated_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(user_id, category) DO UPDATE SET
               time_multiplier   = excluded.time_multiplier,
               difficulty_adjustment = excluded.difficulty_adjustment,
               sample_size        = excluded.sample_size,
               updated_at         = excluded.updated_at`,
          )
          .run(
            record.userId,
            category,
            timeMultiplier,
            difficultyAdjustment,
            sampleSize,
          );
      }
    });

    run();
  }

  // -----------------------------------------------------------------------
  // getBehavioralModel
  // -----------------------------------------------------------------------

  /**
   * Return the current behavioural model for a user.
   *
   * If no data exists the model is returned with an empty adjustments array
   * and `totalCompletedTasks: 0`.
   */
  getBehavioralModel(userId: string): BehavioralModel {
    const countRow = this.db
      .prepare(
        "SELECT COUNT(*) as cnt FROM completion_history WHERE user_id = ?",
      )
      .get(userId) as CompletionCountRow | undefined;

    const totalCompletedTasks = countRow?.cnt ?? 0;

    let adjustments: CategoryAdjustment[];

    if (this.categoryRepo) {
      // When CategoryRepository is available, group by category_id and JOIN
      // to the categories table for display names (Req 6.2)
      const rows = this.db
        .prepare(
          `SELECT c.name as category, ba.time_multiplier, ba.difficulty_adjustment, ba.sample_size
           FROM behavioral_adjustments ba
           JOIN categories c ON c.id = ba.category_id
           WHERE ba.user_id = ? AND ba.category_id IS NOT NULL`,
        )
        .all(userId) as AdjustmentRow[];

      adjustments = rows.map((r) => ({
        category: r.category,
        timeMultiplier: r.time_multiplier,
        difficultyAdjustment: r.difficulty_adjustment,
        sampleSize: r.sample_size,
      }));
    } else {
      // Fall back to grouping by raw category text
      const rows = this.db
        .prepare(
          `SELECT category, time_multiplier, difficulty_adjustment, sample_size
           FROM behavioral_adjustments
           WHERE user_id = ?`,
        )
        .all(userId) as AdjustmentRow[];

      adjustments = rows.map((r) => ({
        category: r.category,
        timeMultiplier: r.time_multiplier,
        difficultyAdjustment: r.difficulty_adjustment,
        sampleSize: r.sample_size,
      }));
    }

    return {
      userId,
      totalCompletedTasks,
      adjustments,
    };
  }

  // -----------------------------------------------------------------------
  // resetModel
  // -----------------------------------------------------------------------

  /**
   * Clear all learned adjustments and completion history for a user,
   * reverting them to the default (no adjustments) state.
   */
  resetModel(userId: string): void {
    const run = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM behavioral_adjustments WHERE user_id = ?")
        .run(userId);
      this.db
        .prepare("DELETE FROM completion_history WHERE user_id = ?")
        .run(userId);
    });

    run();
  }
}
