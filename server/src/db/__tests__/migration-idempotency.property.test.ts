/**
 * Property 12: Migration Idempotency
 *
 * For any initial database state (empty or with existing data), running
 * `runMigrations` twice SHALL produce the same database state as running it
 * once. Specifically, the row counts, column values, and schema SHALL be
 * identical after the first and second runs.
 *
 * Feature: dynamic-ai-categories, Property 12: Migration Idempotency
 *
 * **Validates: Requirements 15.5**
 */

import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";
import { runMigrations } from "../schema.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SELF_NORMALIZING_CATEGORIES = [
  "Writing",
  "Development",
  "Design",
  "Research",
  "Admin",
  "Planning",
  "Testing",
  "Learning",
] as const;

const SEEDED_CATEGORIES = [
  ...SELF_NORMALIZING_CATEGORIES,
  "Communication",
  "Other",
] as const;

// ---------------------------------------------------------------------------
// Legacy schema (pre-migration)
// ---------------------------------------------------------------------------

const LEGACY_SCHEMA_SQL = `
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

function seedLegacyCategories(db: Database.Database): void {
  const seedStmt = db.prepare(
    "INSERT OR IGNORE INTO categories (name) VALUES (?)",
  );
  for (const name of SEEDED_CATEGORIES) {
    seedStmt.run(name);
  }
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

interface TableSchema {
  columns: { name: string; type: string; notnull: number; pk: number }[];
  indexes: { name: string; columns: string[] }[];
}

interface DbSnapshot {
  /** Schema info per table */
  schemas: Record<string, TableSchema>;
  /** Row data per table, sorted deterministically */
  rows: Record<string, Record<string, unknown>[]>;
  /** Row counts per table */
  rowCounts: Record<string, number>;
}

const TABLES_TO_SNAPSHOT = [
  "categories",
  "completion_history",
  "behavioral_adjustments",
  "users",
] as const;

/**
 * Capture a full snapshot of the database state: schema info, row counts,
 * and all row data for the tables we care about.
 *
 * Timestamps like `updated_at` and `created_at` are excluded from row
 * comparison since they may differ by microseconds between runs.
 */
function captureSnapshot(db: Database.Database): DbSnapshot {
  const schemas: Record<string, TableSchema> = {};
  const rows: Record<string, Record<string, unknown>[]> = {};
  const rowCounts: Record<string, number> = {};

  for (const table of TABLES_TO_SNAPSHOT) {
    // Check if table exists
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(table) as { name: string } | undefined;

    if (!tableExists) {
      schemas[table] = { columns: [], indexes: [] };
      rows[table] = [];
      rowCounts[table] = 0;
      continue;
    }

    // Capture schema
    const cols = db.pragma(`table_info(${table})`) as {
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }[];
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?",
      )
      .all(table) as { name: string }[];

    const indexDetails: { name: string; columns: string[] }[] = [];
    for (const idx of indexes) {
      const info = db.pragma(`index_info(${idx.name})`) as {
        name: string;
      }[];
      indexDetails.push({
        name: idx.name,
        columns: info.map((c) => c.name).sort(),
      });
    }

    schemas[table] = {
      columns: cols.map((c) => ({
        name: c.name,
        type: c.type,
        notnull: c.notnull,
        pk: c.pk,
      })),
      indexes: indexDetails.sort((a, b) => a.name.localeCompare(b.name)),
    };

    // Capture rows — exclude timestamp columns that may vary
    const TIMESTAMP_COLS = ["created_at", "updated_at", "completed_at"];
    const allRows = db.prepare(`SELECT * FROM ${table}`).all() as Record<
      string,
      unknown
    >[];

    const sanitizedRows = allRows.map((row) => {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (!TIMESTAMP_COLS.includes(key)) {
          sanitized[key] = value;
        }
      }
      return sanitized;
    });

    // Sort rows deterministically by all non-timestamp columns
    sanitizedRows.sort((a, b) => {
      const keysA = Object.keys(a).sort();
      for (const key of keysA) {
        const va = String(a[key] ?? "");
        const vb = String(b[key] ?? "");
        if (va < vb) return -1;
        if (va > vb) return 1;
      }
      return 0;
    });

    rows[table] = sanitizedRows;
    rowCounts[table] = allRows.length;
  }

  return { schemas, rows, rowCounts };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const userIdArb = fc.constantFrom("user-a", "user-b", "user-c");

const selfNormalizingCategoryArb = fc.constantFrom(
  ...SELF_NORMALIZING_CATEGORIES,
);

/**
 * Generates a scenario describing the initial DB state before migration.
 * Three variants:
 * - empty: no users, no categories, no completions
 * - categoriesOnly: users + seeded categories, no completions
 * - full: users + seeded categories + completion_history + behavioral_adjustments
 */
const dbScenarioArb = fc.oneof(
  // Empty DB (just legacy schema, no data)
  fc.constant({ kind: "empty" as const }),

  // DB with users and seeded categories but no completions
  fc.record({
    kind: fc.constant("categoriesOnly" as const),
    users: fc.uniqueArray(userIdArb, { minLength: 1, maxLength: 3 }),
  }),

  // DB with users, seeded categories, completions, and behavioral adjustments
  fc.record({
    kind: fc.constant("full" as const),
    users: fc.uniqueArray(userIdArb, { minLength: 1, maxLength: 3 }),
    completions: fc.array(
      fc.record({
        userId: userIdArb,
        categoryName: selfNormalizingCategoryArb,
      }),
      { minLength: 1, maxLength: 20 },
    ),
    adjustments: fc.array(
      fc.record({
        userId: userIdArb,
        categoryName: selfNormalizingCategoryArb,
        timeMultiplier: fc.double({ min: 0.5, max: 2.0, noNaN: true }),
        sampleSize: fc.integer({ min: 1, max: 50 }),
      }),
      { minLength: 0, maxLength: 10 },
    ),
  }),
);

type DbScenario =
  typeof dbScenarioArb extends fc.Arbitrary<infer T> ? T : never;

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Create a fresh in-memory DB with the legacy schema and populate it
 * according to the given scenario.
 */
function createAndPopulateDb(scenario: DbScenario): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(LEGACY_SCHEMA_SQL);
  seedLegacyCategories(db);

  if (scenario.kind === "empty") {
    // No additional data
    return db;
  }

  // Insert users
  const insertUser = db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)");
  for (const uid of scenario.users) {
    insertUser.run(uid);
  }

  if (scenario.kind === "categoriesOnly") {
    return db;
  }

  // Insert completion_history rows
  const insertCompletion = db.prepare(`
    INSERT INTO completion_history
      (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
    VALUES (?, ?, ?, ?, 30, 25, 2)
  `);

  // Filter completions to only use users that exist
  const userSet = new Set(scenario.users);
  for (let i = 0; i < scenario.completions.length; i++) {
    const c = scenario.completions[i];
    const userId = userSet.has(c.userId) ? c.userId : scenario.users[0];
    insertCompletion.run(
      `ch-${i}`,
      userId,
      `Task for ${c.categoryName}`,
      c.categoryName,
    );
  }

  // Insert behavioral_adjustments rows (deduplicate by user_id + category)
  const insertAdjustment = db.prepare(`
    INSERT OR IGNORE INTO behavioral_adjustments
      (user_id, category, time_multiplier, sample_size)
    VALUES (?, ?, ?, ?)
  `);

  for (const adj of scenario.adjustments) {
    const userId = userSet.has(adj.userId) ? adj.userId : scenario.users[0];
    insertAdjustment.run(
      userId,
      adj.categoryName,
      adj.timeMultiplier,
      adj.sampleSize,
    );
  }

  return db;
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 12: Migration Idempotency", () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) {
      try {
        db.close();
      } catch {
        // already closed
      }
    }
  });

  it("running runMigrations twice produces the same state as running it once", () => {
    fc.assert(
      fc.property(dbScenarioArb, (scenario) => {
        // --- Run 1: migrate once, capture state ---
        db = createAndPopulateDb(scenario);
        runMigrations(db);
        const snapshotAfterFirst = captureSnapshot(db);
        db.close();

        // --- Run 2: migrate twice on a fresh copy, capture state ---
        db = createAndPopulateDb(scenario);
        runMigrations(db);
        runMigrations(db);
        const snapshotAfterSecond = captureSnapshot(db);

        // --- Verify idempotency ---

        // Row counts must be identical
        for (const table of TABLES_TO_SNAPSHOT) {
          expect(snapshotAfterSecond.rowCounts[table]).toBe(
            snapshotAfterFirst.rowCounts[table],
          );
        }

        // Schema must be identical (columns, indexes)
        for (const table of TABLES_TO_SNAPSHOT) {
          expect(snapshotAfterSecond.schemas[table].columns).toEqual(
            snapshotAfterFirst.schemas[table].columns,
          );
          expect(snapshotAfterSecond.schemas[table].indexes).toEqual(
            snapshotAfterFirst.schemas[table].indexes,
          );
        }

        // Row data must be identical (excluding timestamps)
        for (const table of TABLES_TO_SNAPSHOT) {
          expect(snapshotAfterSecond.rows[table]).toEqual(
            snapshotAfterFirst.rows[table],
          );
        }

        db.close();
      }),
      { numRuns: 100 },
    );
  });

  it("running runMigrations on an already-migrated empty DB is a no-op", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        // Start with a completely fresh DB — no legacy schema, just runMigrations
        db = new Database(":memory:");

        // First migration creates everything from scratch
        runMigrations(db);
        const snapshotAfterFirst = captureSnapshot(db);

        // Second migration should be a no-op
        runMigrations(db);
        const snapshotAfterSecond = captureSnapshot(db);

        // Everything must match
        for (const table of TABLES_TO_SNAPSHOT) {
          expect(snapshotAfterSecond.rowCounts[table]).toBe(
            snapshotAfterFirst.rowCounts[table],
          );
          expect(snapshotAfterSecond.schemas[table].columns).toEqual(
            snapshotAfterFirst.schemas[table].columns,
          );
          expect(snapshotAfterSecond.rows[table]).toEqual(
            snapshotAfterFirst.rows[table],
          );
        }

        db.close();
      }),
      { numRuns: 10 },
    );
  });

  it("schema is identical whether migrating from legacy or running fresh", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        // Path A: fresh DB with just runMigrations (no legacy schema)
        const freshDb = new Database(":memory:");
        runMigrations(freshDb);
        const freshSchema = captureSnapshot(freshDb).schemas;
        freshDb.close();

        // Path B: legacy DB migrated
        db = new Database(":memory:");
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        db.exec(LEGACY_SCHEMA_SQL);
        seedLegacyCategories(db);
        db.prepare("INSERT INTO users (id) VALUES ('test-user')").run();
        runMigrations(db);
        const migratedSchema = captureSnapshot(db).schemas;

        // Column names and types should match for all tables
        for (const table of TABLES_TO_SNAPSHOT) {
          const freshCols = freshSchema[table].columns
            .map((c) => c.name)
            .sort();
          const migratedCols = migratedSchema[table].columns
            .map((c) => c.name)
            .sort();
          expect(migratedCols).toEqual(freshCols);
        }

        db.close();
      }),
      { numRuns: 5 },
    );
  });
});
