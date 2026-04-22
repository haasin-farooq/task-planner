/**
 * PreferenceProfileStore — SQLite-backed persistence for user prioritization preferences.
 *
 * Provides get/save operations for PreferenceProfile records. When no profile
 * exists for a user, `get` returns `null` so callers can apply the default
 * strategy ("highest-priority-first") themselves.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */

import type Database from "better-sqlite3";
import type {
  PreferenceProfile,
  PrioritizationStrategy,
} from "../types/index.js";

interface ProfileRow {
  user_id: string;
  strategy: string;
  updated_at: string;
}

export class PreferenceProfileStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Retrieve the preference profile for the given user.
   * Returns `null` when no profile has been saved yet.
   */
  get(userId: string): PreferenceProfile | null {
    const row = this.db
      .prepare(
        "SELECT user_id, strategy, updated_at FROM preference_profiles WHERE user_id = ?",
      )
      .get(userId) as ProfileRow | undefined;

    if (!row) {
      return null;
    }

    return {
      userId: row.user_id,
      strategy: row.strategy as PrioritizationStrategy,
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Save (upsert) the user's preferred prioritization strategy.
   *
   * If the user doesn't exist in the `users` table yet, they are created
   * automatically so the foreign-key constraint is satisfied.
   */
  save(userId: string, strategy: PrioritizationStrategy): void {
    const upsert = this.db.transaction(() => {
      // Ensure the user row exists
      this.db
        .prepare("INSERT OR IGNORE INTO users (id) VALUES (?)")
        .run(userId);

      this.db
        .prepare(
          `INSERT INTO preference_profiles (user_id, strategy, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(user_id) DO UPDATE SET
             strategy = excluded.strategy,
             updated_at = excluded.updated_at`,
        )
        .run(userId, strategy);
    });

    upsert();
  }
}
