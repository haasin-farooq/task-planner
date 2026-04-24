/**
 * SQLite database schema and migration for the AI Daily Task Planner.
 *
 * All CREATE TABLE statements match the design document. CHECK constraints
 * enforce valid ranges for priority (1-5), difficulty (1-5), and effort (0-100).
 *
 * The categories table uses per-user ownership with a composite UNIQUE(user_id, name)
 * constraint. Categories are no longer seeded with canonical values for new databases;
 * they emerge dynamically from AI analysis.
 */

import { backfill } from "../utils/category-normalizer.js";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS preference_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  strategy TEXT NOT NULL DEFAULT 'highest-priority-first',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  raw_input TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES task_sessions(id),
  description TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  is_ambiguous BOOLEAN DEFAULT FALSE,
  priority INTEGER CHECK (priority BETWEEN 1 AND 5),
  effort_percentage REAL CHECK (effort_percentage BETWEEN 0 AND 100),
  difficulty_level INTEGER CHECK (difficulty_level BETWEEN 1 AND 5),
  estimated_time INTEGER,
  is_completed BOOLEAN DEFAULT FALSE,
  actual_time INTEGER,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS completion_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  task_description TEXT NOT NULL,
  category TEXT,
  estimated_time INTEGER NOT NULL,
  actual_time INTEGER NOT NULL,
  difficulty_level INTEGER NOT NULL,
  completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS behavioral_adjustments (
  user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  time_multiplier REAL NOT NULL DEFAULT 1.0,
  difficulty_adjustment REAL NOT NULL DEFAULT 0.0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, category)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  user_id TEXT NOT NULL DEFAULT '__pending__' REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'archived')),
  created_by TEXT NOT NULL DEFAULT 'system' CHECK (created_by IN ('llm', 'user', 'system', 'fallback')),
  merged_into_category_id INTEGER REFERENCES categories(id) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name)
);
`;

/**
 * Check whether a column exists on a table.
 */
function columnExists(
  db: import("better-sqlite3").Database,
  table: string,
  column: string,
): boolean {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[];
  return cols.some((c) => c.name === column);
}

/**
 * Check whether the categories table has the old global UNIQUE(name) constraint
 * (i.e. it lacks the user_id column). This indicates the table needs recreation.
 */
function categoriesNeedsMigration(
  db: import("better-sqlite3").Database,
): boolean {
  return !columnExists(db, "categories", "user_id");
}

/**
 * Check whether the categories table has the new composite UNIQUE(user_id, name)
 * constraint by inspecting the index list.
 */
function hasCompositeUniqueConstraint(
  db: import("better-sqlite3").Database,
): boolean {
  const indexes = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='categories'",
    )
    .all() as { name: string }[];

  for (const idx of indexes) {
    const info = db.pragma(`index_info(${idx.name})`) as {
      name: string;
      seqno: number;
    }[];
    const colNames = info.map((c) => c.name);
    if (colNames.includes("user_id") && colNames.includes("name")) {
      return true;
    }
  }
  return false;
}

/**
 * Ensure all columns from the dynamic-ai-categories migration exist on the
 * categories table. This handles the case where the table was already migrated
 * by the ai-category-assignment spec (which added user_id) but is missing
 * columns added by the dynamic-ai-categories spec (updated_at, status, etc.).
 */
function ensureDynamicCategoryColumns(
  db: import("better-sqlite3").Database,
): void {
  if (!columnExists(db, "categories", "status")) {
    db.exec(
      "ALTER TABLE categories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    );
  }
  if (!columnExists(db, "categories", "created_by")) {
    db.exec(
      "ALTER TABLE categories ADD COLUMN created_by TEXT NOT NULL DEFAULT 'system'",
    );
  }
  if (!columnExists(db, "categories", "merged_into_category_id")) {
    db.exec(
      "ALTER TABLE categories ADD COLUMN merged_into_category_id INTEGER DEFAULT NULL",
    );
  }
  if (!columnExists(db, "categories", "updated_at")) {
    db.exec(
      "ALTER TABLE categories ADD COLUMN updated_at TIMESTAMP DEFAULT NULL",
    );
    db.exec(
      "UPDATE categories SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL",
    );
  }
}

/**
 * Migrate the categories table from the old schema (global UNIQUE(name))
 * to the new schema (per-user UNIQUE(user_id, name) with lifecycle columns).
 *
 * Steps:
 * 1. Add new columns via ALTER TABLE ADD COLUMN (if table already exists without them)
 * 2. Backfill user_id from completion_history (user with most completions per category)
 * 3. Set status='active' and created_by='system' for existing rows
 * 4. Recreate table to change UNIQUE constraint from (name) to (user_id, name)
 *
 * All operations are idempotent.
 */
function migrateCategoriesTable(db: import("better-sqlite3").Database): void {
  if (!categoriesNeedsMigration(db)) {
    // user_id already exists, but we may still need to add columns from the
    // dynamic-ai-categories migration (updated_at, merged_into_category_id, etc.)
    ensureDynamicCategoryColumns(db);
    // Ensure defaults are set for any rows missing them
    backfillCategoryDefaults(db);
    return;
  }

  // Step 1: Add new columns to the old categories table
  // We need these columns before we can backfill and recreate
  if (!columnExists(db, "categories", "user_id")) {
    db.exec(
      "ALTER TABLE categories ADD COLUMN user_id TEXT DEFAULT '__pending__'",
    );
  }
  if (!columnExists(db, "categories", "status")) {
    db.exec(
      "ALTER TABLE categories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    );
  }
  if (!columnExists(db, "categories", "created_by")) {
    db.exec(
      "ALTER TABLE categories ADD COLUMN created_by TEXT NOT NULL DEFAULT 'system'",
    );
  }
  if (!columnExists(db, "categories", "merged_into_category_id")) {
    db.exec(
      "ALTER TABLE categories ADD COLUMN merged_into_category_id INTEGER DEFAULT NULL",
    );
  }
  if (!columnExists(db, "categories", "updated_at")) {
    // SQLite ALTER TABLE ADD COLUMN doesn't support CURRENT_TIMESTAMP as default
    // (it's not a constant expression). Use NULL default, then backfill.
    db.exec(
      "ALTER TABLE categories ADD COLUMN updated_at TIMESTAMP DEFAULT NULL",
    );
    db.exec(
      "UPDATE categories SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL",
    );
  }

  // Step 2: Backfill user_id from completion_history
  backfillCategoryUserId(db);

  // Step 3: Set status='active' and created_by='system' for all existing rows
  backfillCategoryDefaults(db);

  // Step 4: Recreate table with new UNIQUE(user_id, name) constraint
  recreateCategoriesTable(db);
}

/**
 * Backfill user_id on existing categories by finding the user with the most
 * completion_history rows referencing each category (via category_id).
 *
 * If no completions reference a category, assign to the first user in the
 * users table. If no users exist, create a '__system__' user.
 */
function backfillCategoryUserId(db: import("better-sqlite3").Database): void {
  // Get categories that still need a user_id assignment
  const pendingCategories = db
    .prepare(
      "SELECT id, name FROM categories WHERE user_id = '__pending__' OR user_id IS NULL",
    )
    .all() as { id: number; name: string }[];

  if (pendingCategories.length === 0) return;

  // Determine fallback user: first user in users table, or create '__system__'
  const fallbackUser = getFallbackUserId(db);

  const updateStmt = db.prepare(
    "UPDATE categories SET user_id = ? WHERE id = ?",
  );

  const runBackfill = db.transaction(() => {
    for (const cat of pendingCategories) {
      // Find user with most completion_history rows referencing this category
      // Try by category_id first, then by normalized_category name match
      let bestUser: string | null = null;

      // Try matching by category_id
      const byId = db
        .prepare(
          `SELECT user_id, COUNT(*) as cnt
           FROM completion_history
           WHERE category_id = ?
           GROUP BY user_id
           ORDER BY cnt DESC
           LIMIT 1`,
        )
        .get(cat.id) as { user_id: string; cnt: number } | undefined;

      if (byId) {
        bestUser = byId.user_id;
      }

      // If no match by category_id, try by normalized_category name
      if (!bestUser) {
        const byName = db
          .prepare(
            `SELECT user_id, COUNT(*) as cnt
             FROM completion_history
             WHERE normalized_category = ? OR category = ?
             GROUP BY user_id
             ORDER BY cnt DESC
             LIMIT 1`,
          )
          .get(cat.name, cat.name) as
          | { user_id: string; cnt: number }
          | undefined;

        if (byName) {
          bestUser = byName.user_id;
        }
      }

      // Fall back to default user
      if (!bestUser) {
        bestUser = fallbackUser;
      }

      updateStmt.run(bestUser, cat.id);
    }
  });

  runBackfill();
}

/**
 * Get a fallback user ID for categories with no completion_history references.
 * Returns the first user in the users table, or creates a '__system__' user.
 */
function getFallbackUserId(db: import("better-sqlite3").Database): string {
  const firstUser = db
    .prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1")
    .get() as { id: string } | undefined;

  if (firstUser) {
    return firstUser.id;
  }

  // No users exist — create a system user
  db.prepare("INSERT OR IGNORE INTO users (id) VALUES ('__system__')").run();
  return "__system__";
}

/**
 * Set status='active' and created_by='system' for any existing rows that
 * don't already have these values set (idempotent).
 */
function backfillCategoryDefaults(db: import("better-sqlite3").Database): void {
  // Only update rows that still have default/null values
  db.exec(`
    UPDATE categories
    SET status = 'active'
    WHERE status IS NULL
  `);

  db.exec(`
    UPDATE categories
    SET created_by = 'system'
    WHERE created_by IS NULL
  `);

  db.exec(`
    UPDATE categories
    SET updated_at = CURRENT_TIMESTAMP
    WHERE updated_at IS NULL
  `);
}

/**
 * Recreate the categories table to change the UNIQUE constraint from
 * (name) to (user_id, name). SQLite does not support ALTER TABLE to
 * modify constraints, so we must recreate the table.
 *
 * This is idempotent: if the table already has the composite constraint,
 * this function is a no-op.
 */
function recreateCategoriesTable(db: import("better-sqlite3").Database): void {
  // Check if we already have the composite constraint
  if (hasCompositeUniqueConstraint(db)) {
    return;
  }

  // Must disable foreign keys temporarily for table recreation
  db.pragma("foreign_keys = OFF");

  const recreate = db.transaction(() => {
    // Create new table with the correct schema
    // Note: merged_into_category_id references categories_new(id) during creation,
    // but after rename it will correctly reference categories(id).
    db.exec(`
      CREATE TABLE IF NOT EXISTS categories_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL COLLATE NOCASE,
        user_id TEXT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'archived')),
        created_by TEXT NOT NULL DEFAULT 'system' CHECK (created_by IN ('llm', 'user', 'system', 'fallback')),
        merged_into_category_id INTEGER DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, name)
      )
    `);

    // Copy data from old table to new table
    db.exec(`
      INSERT OR IGNORE INTO categories_new (id, name, user_id, status, created_by, merged_into_category_id, created_at, updated_at)
      SELECT id, name, user_id, status, created_by, merged_into_category_id, created_at, updated_at
      FROM categories
    `);

    // Drop old table and rename new one
    db.exec("DROP TABLE categories");
    db.exec("ALTER TABLE categories_new RENAME TO categories");
  });

  recreate();

  // Re-enable foreign keys
  db.pragma("foreign_keys = ON");

  // Verify foreign key integrity
  const fkCheck = db.pragma("foreign_key_check") as unknown[];
  if (fkCheck.length > 0) {
    console.warn(
      "Foreign key check found issues after categories table recreation:",
      fkCheck,
    );
  }
}

/**
 * Run the schema migration against the given database instance.
 * Uses `exec` so all statements run in a single call.
 */
export function runMigrations(db: import("better-sqlite3").Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  // NOTE: Canonical category seeding has been removed for new databases.
  // Categories now emerge dynamically from AI analysis per user.
  // Existing categories are preserved by the migration below.

  // Migration: add normalized_category column to completion_history
  if (!columnExists(db, "completion_history", "normalized_category")) {
    db.exec(
      "ALTER TABLE completion_history ADD COLUMN normalized_category TEXT DEFAULT NULL",
    );
  }

  // Migration: add category_id column to completion_history
  if (!columnExists(db, "completion_history", "category_id")) {
    db.exec(
      "ALTER TABLE completion_history ADD COLUMN category_id INTEGER REFERENCES categories(id) DEFAULT NULL",
    );
  }

  // Migration: add category_id column to behavioral_adjustments
  if (!columnExists(db, "behavioral_adjustments", "category_id")) {
    db.exec(
      "ALTER TABLE behavioral_adjustments ADD COLUMN category_id INTEGER REFERENCES categories(id) DEFAULT NULL",
    );
  }

  // Backfill normalized_category for any existing records that lack one
  backfill(db);

  // Backfill category_id on completion_history by matching normalized_category against categories.name
  db.exec(`
    UPDATE completion_history
    SET category_id = (
      SELECT c.id FROM categories c WHERE c.name = completion_history.normalized_category
    )
    WHERE category_id IS NULL
      AND normalized_category IS NOT NULL
  `);

  // Backfill category_id on behavioral_adjustments by matching category against categories.name
  db.exec(`
    UPDATE behavioral_adjustments
    SET category_id = (
      SELECT c.id FROM categories c WHERE c.name = behavioral_adjustments.category
    )
    WHERE category_id IS NULL
      AND category IS NOT NULL
  `);

  // Migration: add raw_llm_category column to completion_history
  if (!columnExists(db, "completion_history", "raw_llm_category")) {
    db.exec(
      "ALTER TABLE completion_history ADD COLUMN raw_llm_category TEXT DEFAULT NULL",
    );
  }

  // Migration: add category_confidence column to completion_history
  if (!columnExists(db, "completion_history", "category_confidence")) {
    db.exec(
      "ALTER TABLE completion_history ADD COLUMN category_confidence REAL DEFAULT NULL",
    );
  }

  // Migration: add category_source column to completion_history
  if (!columnExists(db, "completion_history", "category_source")) {
    db.exec(
      "ALTER TABLE completion_history ADD COLUMN category_source TEXT DEFAULT NULL CHECK (category_source IN ('llm', 'fallback', 'user'))",
    );
  }

  // Migrate categories table: add per-user columns, backfill, recreate with new constraint
  migrateCategoriesTable(db);
}
