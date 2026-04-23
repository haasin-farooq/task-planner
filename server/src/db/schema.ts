/**
 * SQLite database schema and migration for the AI Daily Task Planner.
 *
 * All CREATE TABLE statements match the design document. CHECK constraints
 * enforce valid ranges for priority (1-5), difficulty (1-5), and effort (0-100).
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
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
 * Run the schema migration against the given database instance.
 * Uses `exec` so all statements run in a single call.
 */
export function runMigrations(db: import("better-sqlite3").Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  // Seed canonical categories
  const seedCategories = db.prepare(
    "INSERT OR IGNORE INTO categories (name) VALUES (?)",
  );
  const canonicalCategories = [
    "Writing",
    "Development",
    "Design",
    "Research",
    "Admin",
    "Communication",
    "Planning",
    "Testing",
    "Learning",
    "Other",
  ];
  for (const name of canonicalCategories) {
    seedCategories.run(name);
  }

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
}
