import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, SCHEMA_SQL } from "../schema.js";
import { createDb } from "../connection.js";

/**
 * The old categories table schema (before the dynamic-ai-categories migration).
 * Used to simulate pre-migration database state in tests.
 */
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

/** Seed the 10 canonical categories (old behavior) into a legacy DB */
function seedLegacyCategories(db: Database.Database): void {
  const seedStmt = db.prepare(
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
    seedStmt.run(name);
  }
}

describe("Schema migration — normalized_category", () => {
  let db: Database.Database;

  afterEach(() => {
    db.close();
  });

  it("should add normalized_category column to completion_history after migration", () => {
    db = createDb(":memory:");

    const cols = db.pragma("table_info(completion_history)") as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain("normalized_category");
  });

  it("should backfill normalized_category for existing records during migration", () => {
    // Create a DB with the legacy schema (old categories table)
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    // Insert pre-migration records
    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(`
      INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
      VALUES
        ('c1', 'u1', 'Write blog post', 'writing', 30, 25, 2),
        ('c2', 'u1', 'Fix login bug', 'coding', 60, 90, 4),
        ('c3', 'u1', 'Random task', 'xyz', 15, 20, 1)
    `);

    // Now run migrations — this should add the column and backfill
    runMigrations(db);

    const rows = db
      .prepare(
        "SELECT id, normalized_category FROM completion_history ORDER BY id",
      )
      .all() as { id: string; normalized_category: string }[];

    expect(rows).toEqual([
      { id: "c1", normalized_category: "Writing" },
      { id: "c2", normalized_category: "Development" },
      { id: "c3", normalized_category: "Other" },
    ]);
  });

  it("should preserve original category column values after backfill", () => {
    // Create a DB with the legacy schema
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    // Insert pre-migration records with various raw category values
    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(`
      INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
      VALUES
        ('c1', 'u1', 'Write blog post', 'My Custom Writing Category', 30, 25, 2),
        ('c2', 'u1', 'Fix login bug', 'Backend Coding Work', 60, 90, 4),
        ('c3', 'u1', 'Team sync', 'Weekly Meeting', 15, 20, 1)
    `);

    // Run migrations — backfill should NOT modify the original category column
    runMigrations(db);

    const rows = db
      .prepare(
        "SELECT id, category, normalized_category FROM completion_history ORDER BY id",
      )
      .all() as {
      id: string;
      category: string;
      normalized_category: string;
    }[];

    expect(rows).toEqual([
      {
        id: "c1",
        category: "My Custom Writing Category",
        normalized_category: "Writing",
      },
      {
        id: "c2",
        category: "Backend Coding Work",
        normalized_category: "Development",
      },
      {
        id: "c3",
        category: "Weekly Meeting",
        normalized_category: "Communication",
      },
    ]);
  });
});

describe("Schema migration — categories table", () => {
  let db: Database.Database;

  afterEach(() => {
    db.close();
  });

  it("should create categories table with correct columns including new per-user fields", () => {
    db = createDb(":memory:");

    const cols = db.pragma("table_info(categories)") as {
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }[];
    const colMap = Object.fromEntries(cols.map((c) => [c.name, c]));

    expect(colMap).toHaveProperty("id");
    expect(colMap).toHaveProperty("name");
    expect(colMap).toHaveProperty("user_id");
    expect(colMap).toHaveProperty("status");
    expect(colMap).toHaveProperty("created_by");
    expect(colMap).toHaveProperty("merged_into_category_id");
    expect(colMap).toHaveProperty("created_at");
    expect(colMap).toHaveProperty("updated_at");

    expect(colMap.id.pk).toBe(1);
    expect(colMap.name.notnull).toBe(1);
    expect(colMap.user_id.notnull).toBe(1);
    expect(colMap.status.notnull).toBe(1);
    expect(colMap.created_by.notnull).toBe(1);
  });

  it("should NOT seed canonical categories for new databases", () => {
    db = createDb(":memory:");

    const rows = db
      .prepare("SELECT name FROM categories ORDER BY name")
      .all() as { name: string }[];

    expect(rows).toEqual([]);
  });

  it("should add category_id column to completion_history", () => {
    db = createDb(":memory:");

    const cols = db.pragma("table_info(completion_history)") as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain("category_id");
  });

  it("should add category_id column to behavioral_adjustments", () => {
    db = createDb(":memory:");

    const cols = db.pragma("table_info(behavioral_adjustments)") as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain("category_id");
  });

  it("should backfill category_id for existing completion_history rows (legacy migration)", () => {
    // Create a DB with the LEGACY schema to simulate pre-migration state
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    // Insert a user and pre-migration completion records
    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(`
      INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
      VALUES
        ('c1', 'u1', 'Write blog post', 'writing', 30, 25, 2),
        ('c2', 'u1', 'Fix login bug', 'coding', 60, 90, 4),
        ('c3', 'u1', 'Random task', 'xyz', 15, 20, 1)
    `);

    // Run migrations — this should add columns, backfill normalized_category, then backfill category_id
    runMigrations(db);

    const rows = db
      .prepare("SELECT id, category_id FROM completion_history ORDER BY id")
      .all() as { id: string; category_id: number | null }[];

    // c1 → "writing" normalizes to "Writing" → should match categories.id for Writing
    // c2 → "coding" normalizes to "Development" → should match categories.id for Development
    // c3 → "xyz" normalizes to "Other" → should match categories.id for Other
    const writingId = (
      db.prepare("SELECT id FROM categories WHERE name = 'Writing'").get() as {
        id: number;
      }
    ).id;
    const devId = (
      db
        .prepare("SELECT id FROM categories WHERE name = 'Development'")
        .get() as { id: number }
    ).id;
    const otherId = (
      db.prepare("SELECT id FROM categories WHERE name = 'Other'").get() as {
        id: number;
      }
    ).id;

    expect(rows).toEqual([
      { id: "c1", category_id: writingId },
      { id: "c2", category_id: devId },
      { id: "c3", category_id: otherId },
    ]);
  });

  it("should backfill category_id for existing behavioral_adjustments rows (legacy migration)", () => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(`
      INSERT INTO behavioral_adjustments (user_id, category, time_multiplier, sample_size)
      VALUES
        ('u1', 'Writing', 1.2, 5),
        ('u1', 'Development', 0.9, 10)
    `);

    runMigrations(db);

    const rows = db
      .prepare(
        "SELECT category, category_id FROM behavioral_adjustments ORDER BY category",
      )
      .all() as { category: string; category_id: number | null }[];

    const devId = (
      db
        .prepare("SELECT id FROM categories WHERE name = 'Development'")
        .get() as { id: number }
    ).id;
    const writingId = (
      db.prepare("SELECT id FROM categories WHERE name = 'Writing'").get() as {
        id: number;
      }
    ).id;

    expect(rows).toEqual([
      { category: "Development", category_id: devId },
      { category: "Writing", category_id: writingId },
    ]);
  });

  it("should be idempotent — running migrations twice does not error or duplicate categories", () => {
    // Use legacy schema to simulate existing DB with seeded categories
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(`
      INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
      VALUES ('c1', 'u1', 'Write blog post', 'writing', 30, 25, 2)
    `);

    // Run migrations twice
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();

    // Categories should still be exactly 10 (preserved from legacy seeding)
    const count = (
      db.prepare("SELECT COUNT(*) as cnt FROM categories").get() as {
        cnt: number;
      }
    ).cnt;
    expect(count).toBe(10);

    // Backfilled category_id should remain correct (not nulled or duplicated)
    const row = db
      .prepare("SELECT category_id FROM completion_history WHERE id = 'c1'")
      .get() as { category_id: number | null };
    expect(row.category_id).not.toBeNull();
  });

  it("should backfill user_id on existing categories from completion_history", () => {
    // Use legacy schema to simulate existing DB
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec("INSERT INTO users (id) VALUES ('u2')");

    // Add category_id column and normalized_category to simulate partial migration
    db.exec(
      "ALTER TABLE completion_history ADD COLUMN normalized_category TEXT DEFAULT NULL",
    );
    db.exec(
      "ALTER TABLE completion_history ADD COLUMN category_id INTEGER DEFAULT NULL",
    );

    // Get the Writing category ID
    const writingId = (
      db.prepare("SELECT id FROM categories WHERE name = 'Writing'").get() as {
        id: number;
      }
    ).id;

    // u1 has 3 completions referencing Writing, u2 has 1
    db.exec(`
      INSERT INTO completion_history (id, user_id, task_description, category, normalized_category, category_id, estimated_time, actual_time, difficulty_level)
      VALUES
        ('c1', 'u1', 'Write blog', 'writing', 'Writing', ${writingId}, 30, 25, 2),
        ('c2', 'u1', 'Write docs', 'writing', 'Writing', ${writingId}, 20, 15, 1),
        ('c3', 'u1', 'Write report', 'writing', 'Writing', ${writingId}, 45, 50, 3),
        ('c4', 'u2', 'Write email', 'writing', 'Writing', ${writingId}, 10, 8, 1)
    `);

    runMigrations(db);

    // Writing category should be assigned to u1 (most completions)
    const writingRow = db
      .prepare("SELECT user_id FROM categories WHERE name = 'Writing'")
      .get() as { user_id: string };
    expect(writingRow.user_id).toBe("u1");
  });

  it("should set status=active and created_by=system for existing categories after migration", () => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    db.exec("INSERT INTO users (id) VALUES ('u1')");

    runMigrations(db);

    const rows = db
      .prepare("SELECT name, status, created_by FROM categories ORDER BY name")
      .all() as { name: string; status: string; created_by: string }[];

    for (const row of rows) {
      expect(row.status).toBe("active");
      expect(row.created_by).toBe("system");
    }
  });

  it("should have UNIQUE(user_id, name) constraint after migration", () => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec("INSERT INTO users (id) VALUES ('u2')");

    runMigrations(db);

    // Same name for different users should work
    db.exec(
      "INSERT INTO categories (name, user_id, status, created_by) VALUES ('Custom', 'u1', 'active', 'user')",
    );
    db.exec(
      "INSERT INTO categories (name, user_id, status, created_by) VALUES ('Custom', 'u2', 'active', 'user')",
    );

    // Same name for same user should fail (case-insensitive)
    expect(() =>
      db.exec(
        "INSERT INTO categories (name, user_id, status, created_by) VALUES ('custom', 'u1', 'active', 'user')",
      ),
    ).toThrow();
  });

  it("should enforce status CHECK constraint", () => {
    db = createDb(":memory:");
    db.exec("INSERT INTO users (id) VALUES ('u1')");

    // Valid status
    expect(() =>
      db.exec(
        "INSERT INTO categories (name, user_id, status, created_by) VALUES ('Test', 'u1', 'active', 'system')",
      ),
    ).not.toThrow();

    // Invalid status
    expect(() =>
      db.exec(
        "INSERT INTO categories (name, user_id, status, created_by) VALUES ('Test2', 'u1', 'invalid', 'system')",
      ),
    ).toThrow();
  });

  it("should enforce created_by CHECK constraint", () => {
    db = createDb(":memory:");
    db.exec("INSERT INTO users (id) VALUES ('u1')");

    // Valid created_by values
    for (const source of ["llm", "user", "system", "fallback"]) {
      expect(() =>
        db.exec(
          `INSERT INTO categories (name, user_id, status, created_by) VALUES ('Test_${source}', 'u1', 'active', '${source}')`,
        ),
      ).not.toThrow();
    }

    // Invalid created_by
    expect(() =>
      db.exec(
        "INSERT INTO categories (name, user_id, status, created_by) VALUES ('TestBad', 'u1', 'active', 'invalid')",
      ),
    ).toThrow();
  });
});

describe("Schema migration — completion_history category metadata columns", () => {
  let db: Database.Database;

  afterEach(() => {
    db.close();
  });

  it("should add raw_llm_category column to completion_history", () => {
    db = createDb(":memory:");

    const cols = db.pragma("table_info(completion_history)") as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain("raw_llm_category");
  });

  it("should add category_confidence column to completion_history", () => {
    db = createDb(":memory:");

    const cols = db.pragma("table_info(completion_history)") as {
      name: string;
      type: string;
    }[];
    const col = cols.find((c) => c.name === "category_confidence");

    expect(col).toBeDefined();
    expect(col!.type).toBe("REAL");
  });

  it("should add category_source column to completion_history", () => {
    db = createDb(":memory:");

    const cols = db.pragma("table_info(completion_history)") as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain("category_source");
  });

  it("should default new columns to NULL for fresh databases", () => {
    db = createDb(":memory:");
    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(`
      INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
      VALUES ('c1', 'u1', 'Test task', 'Testing', 30, 25, 2)
    `);

    const row = db
      .prepare(
        "SELECT raw_llm_category, category_confidence, category_source FROM completion_history WHERE id = 'c1'",
      )
      .get() as {
      raw_llm_category: string | null;
      category_confidence: number | null;
      category_source: string | null;
    };

    expect(row.raw_llm_category).toBeNull();
    expect(row.category_confidence).toBeNull();
    expect(row.category_source).toBeNull();
  });

  it("should enforce category_source CHECK constraint — valid values", () => {
    db = createDb(":memory:");
    db.exec("INSERT INTO users (id) VALUES ('u1')");

    for (const source of ["llm", "fallback", "user"]) {
      expect(() =>
        db.exec(`
          INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level, category_source)
          VALUES ('cs_${source}', 'u1', 'Task ${source}', 'Cat', 30, 25, 2, '${source}')
        `),
      ).not.toThrow();
    }
  });

  it("should enforce category_source CHECK constraint — invalid value", () => {
    db = createDb(":memory:");
    db.exec("INSERT INTO users (id) VALUES ('u1')");

    expect(() =>
      db.exec(`
        INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level, category_source)
        VALUES ('cs_bad', 'u1', 'Bad task', 'Cat', 30, 25, 2, 'invalid')
      `),
    ).toThrow();
  });

  it("should allow storing category metadata alongside completion records", () => {
    db = createDb(":memory:");
    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(`
      INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level, raw_llm_category, category_confidence, category_source)
      VALUES ('c1', 'u1', 'Write blog post', 'Writing', 30, 25, 2, 'Creative Writing', 0.85, 'llm')
    `);

    const row = db
      .prepare(
        "SELECT raw_llm_category, category_confidence, category_source FROM completion_history WHERE id = 'c1'",
      )
      .get() as {
      raw_llm_category: string;
      category_confidence: number;
      category_source: string;
    };

    expect(row.raw_llm_category).toBe("Creative Writing");
    expect(row.category_confidence).toBe(0.85);
    expect(row.category_source).toBe("llm");
  });

  it("should add columns idempotently on legacy databases", () => {
    // Start with legacy schema (no new columns)
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(`
      INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
      VALUES ('c1', 'u1', 'Write blog post', 'writing', 30, 25, 2)
    `);

    // Run migrations twice — should not error
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();

    // Columns should exist and existing row should have NULL defaults
    const row = db
      .prepare(
        "SELECT raw_llm_category, category_confidence, category_source FROM completion_history WHERE id = 'c1'",
      )
      .get() as {
      raw_llm_category: string | null;
      category_confidence: number | null;
      category_source: string | null;
    };

    expect(row.raw_llm_category).toBeNull();
    expect(row.category_confidence).toBeNull();
    expect(row.category_source).toBeNull();
  });
});

describe("Schema migration — backfill correctness", () => {
  let db: Database.Database;

  afterEach(() => {
    db.close();
  });

  it("should assign each category to the user with the most completions referencing it", () => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    db.exec("INSERT INTO users (id) VALUES ('alice')");
    db.exec("INSERT INTO users (id) VALUES ('bob')");

    // Alice has 5 completions for "Development", Bob has 2
    const insert = db.prepare(`
      INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
      VALUES (?, ?, ?, ?, 30, 25, 2)
    `);
    for (let i = 0; i < 5; i++)
      insert.run(`a-dev-${i}`, "alice", "dev task", "Development");
    for (let i = 0; i < 2; i++)
      insert.run(`b-dev-${i}`, "bob", "dev task", "Development");

    // Bob has 4 completions for "Design", Alice has 1
    for (let i = 0; i < 4; i++)
      insert.run(`b-des-${i}`, "bob", "design task", "Design");
    insert.run("a-des-0", "alice", "design task", "Design");

    runMigrations(db);

    const devRow = db
      .prepare("SELECT user_id FROM categories WHERE name = 'Development'")
      .get() as { user_id: string };
    expect(devRow.user_id).toBe("alice");

    const desRow = db
      .prepare("SELECT user_id FROM categories WHERE name = 'Design'")
      .get() as { user_id: string };
    expect(desRow.user_id).toBe("bob");
  });

  it("should assign categories with no completions to the fallback user", () => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    db.exec("INSERT INTO users (id) VALUES ('only-user')");

    // Only add completions for "Writing" — all other seeded categories have none
    db.exec(`
      INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
      VALUES ('c1', 'only-user', 'Write docs', 'Writing', 30, 25, 2)
    `);

    runMigrations(db);

    // Writing should be owned by 'only-user' (has completions)
    const writingRow = db
      .prepare("SELECT user_id FROM categories WHERE name = 'Writing'")
      .get() as { user_id: string };
    expect(writingRow.user_id).toBe("only-user");

    // Categories with no completions should be assigned to the fallback user (first user = 'only-user')
    const otherRow = db
      .prepare("SELECT user_id FROM categories WHERE name = 'Other'")
      .get() as { user_id: string };
    expect(otherRow.user_id).toBe("only-user");

    const adminRow = db
      .prepare("SELECT user_id FROM categories WHERE name = 'Admin'")
      .get() as { user_id: string };
    expect(adminRow.user_id).toBe("only-user");
  });

  it("should create __system__ user when no users exist and assign categories to it", () => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    // No users, no completions — all categories should go to __system__
    runMigrations(db);

    const rows = db
      .prepare("SELECT DISTINCT user_id FROM categories")
      .all() as { user_id: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].user_id).toBe("__system__");

    // __system__ user should exist in users table
    const systemUser = db
      .prepare("SELECT id FROM users WHERE id = '__system__'")
      .get() as { id: string } | undefined;
    expect(systemUser).toBeDefined();
  });

  it("should correctly backfill category_id on completion_history using normalized_category", () => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(`
      INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
      VALUES
        ('c1', 'u1', 'Write blog', 'writing stuff', 30, 25, 2),
        ('c2', 'u1', 'Code review', 'programming', 60, 90, 4),
        ('c3', 'u1', 'Plan sprint', 'planning', 20, 15, 1)
    `);

    runMigrations(db);

    // Verify each completion has a non-null category_id
    const rows = db
      .prepare("SELECT id, category_id FROM completion_history ORDER BY id")
      .all() as { id: string; category_id: number | null }[];
    for (const row of rows) {
      expect(row.category_id).not.toBeNull();
    }

    // Verify the category_ids point to valid categories
    for (const row of rows) {
      const cat = db
        .prepare("SELECT id FROM categories WHERE id = ?")
        .get(row.category_id) as { id: number } | undefined;
      expect(cat).toBeDefined();
    }
  });
});

describe("Schema migration — preservation of existing data", () => {
  let db: Database.Database;

  afterEach(() => {
    db.close();
  });

  it("should preserve all existing category names after migration", () => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    const canonicalCategories = [
      "Admin",
      "Communication",
      "Design",
      "Development",
      "Learning",
      "Other",
      "Planning",
      "Research",
      "Testing",
      "Writing",
    ];

    db.exec("INSERT INTO users (id) VALUES ('u1')");
    runMigrations(db);

    const rows = db
      .prepare("SELECT name FROM categories ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);

    expect(names).toEqual(canonicalCategories);
  });

  it("should preserve existing completion_history rows and their original field values", () => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(`
      INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
      VALUES
        ('c1', 'u1', 'Write blog post', 'Writing', 30, 25, 2),
        ('c2', 'u1', 'Fix login bug', 'Development', 60, 90, 4),
        ('c3', 'u1', 'Team standup', 'Communication', 15, 20, 1)
    `);

    runMigrations(db);

    const rows = db
      .prepare(
        "SELECT id, user_id, task_description, category, estimated_time, actual_time, difficulty_level FROM completion_history ORDER BY id",
      )
      .all() as {
      id: string;
      user_id: string;
      task_description: string;
      category: string;
      estimated_time: number;
      actual_time: number;
      difficulty_level: number;
    }[];

    expect(rows).toEqual([
      {
        id: "c1",
        user_id: "u1",
        task_description: "Write blog post",
        category: "Writing",
        estimated_time: 30,
        actual_time: 25,
        difficulty_level: 2,
      },
      {
        id: "c2",
        user_id: "u1",
        task_description: "Fix login bug",
        category: "Development",
        estimated_time: 60,
        actual_time: 90,
        difficulty_level: 4,
      },
      {
        id: "c3",
        user_id: "u1",
        task_description: "Team standup",
        category: "Communication",
        estimated_time: 15,
        actual_time: 20,
        difficulty_level: 1,
      },
    ]);
  });

  it("should preserve existing behavioral_adjustments rows after migration", () => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(`
      INSERT INTO behavioral_adjustments (user_id, category, time_multiplier, difficulty_adjustment, sample_size)
      VALUES
        ('u1', 'Writing', 1.2, 0.5, 10),
        ('u1', 'Development', 0.8, -0.3, 20)
    `);

    runMigrations(db);

    const rows = db
      .prepare(
        "SELECT user_id, category, time_multiplier, difficulty_adjustment, sample_size FROM behavioral_adjustments ORDER BY category",
      )
      .all() as {
      user_id: string;
      category: string;
      time_multiplier: number;
      difficulty_adjustment: number;
      sample_size: number;
    }[];

    expect(rows).toEqual([
      {
        user_id: "u1",
        category: "Development",
        time_multiplier: 0.8,
        difficulty_adjustment: -0.3,
        sample_size: 20,
      },
      {
        user_id: "u1",
        category: "Writing",
        time_multiplier: 1.2,
        difficulty_adjustment: 0.5,
        sample_size: 10,
      },
    ]);
  });

  it("should preserve category IDs across migration (no ID reassignment)", () => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    // Record pre-migration IDs
    const preMigrationIds = db
      .prepare("SELECT id, name FROM categories ORDER BY id")
      .all() as { id: number; name: string }[];

    db.exec("INSERT INTO users (id) VALUES ('u1')");
    runMigrations(db);

    // Post-migration IDs should match
    const postMigrationIds = db
      .prepare("SELECT id, name FROM categories ORDER BY id")
      .all() as { id: number; name: string }[];

    expect(postMigrationIds.map((r) => ({ id: r.id, name: r.name }))).toEqual(
      preMigrationIds.map((r) => ({ id: r.id, name: r.name })),
    );
  });

  it("should preserve completion_history row count after migration", () => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    db.exec("INSERT INTO users (id) VALUES ('u1')");
    const insert = db.prepare(`
      INSERT INTO completion_history (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level)
      VALUES (?, 'u1', ?, ?, 30, 25, 2)
    `);
    for (let i = 0; i < 15; i++) {
      insert.run(`c${i}`, `Task ${i}`, "Writing");
    }

    const preMigrationCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM completion_history").get() as {
        cnt: number;
      }
    ).cnt;

    runMigrations(db);

    const postMigrationCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM completion_history").get() as {
        cnt: number;
      }
    ).cnt;
    expect(postMigrationCount).toBe(preMigrationCount);
    expect(postMigrationCount).toBe(15);
  });
});

describe("Schema migration — no seeding for new databases", () => {
  let db: Database.Database;

  afterEach(() => {
    db.close();
  });

  it("should have zero categories for a fresh database", () => {
    db = createDb(":memory:");

    const count = (
      db.prepare("SELECT COUNT(*) as cnt FROM categories").get() as {
        cnt: number;
      }
    ).cnt;
    expect(count).toBe(0);
  });

  it("should not contain any of the 10 canonical categories in a fresh database", () => {
    db = createDb(":memory:");

    const canonicalNames = [
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

    const rows = db.prepare("SELECT name FROM categories").all() as {
      name: string;
    }[];
    const names = rows.map((r) => r.name);

    for (const canonical of canonicalNames) {
      expect(names).not.toContain(canonical);
    }
  });

  it("should allow creating categories manually on a fresh database", () => {
    db = createDb(":memory:");
    db.exec("INSERT INTO users (id) VALUES ('u1')");

    // Should be able to insert categories without conflict
    db.exec(
      "INSERT INTO categories (name, user_id, status, created_by) VALUES ('My Category', 'u1', 'active', 'user')",
    );

    const row = db
      .prepare(
        "SELECT name, user_id, status, created_by FROM categories WHERE name = 'My Category'",
      )
      .get() as {
      name: string;
      user_id: string;
      status: string;
      created_by: string;
    };

    expect(row).toEqual({
      name: "My Category",
      user_id: "u1",
      status: "active",
      created_by: "user",
    });
  });
});

describe("Schema migration — new columns on completion_history", () => {
  let db: Database.Database;

  afterEach(() => {
    db.close();
  });

  it("should have all new category metadata columns on completion_history after migration", () => {
    db = createDb(":memory:");

    const cols = db.pragma("table_info(completion_history)") as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain("raw_llm_category");
    expect(colNames).toContain("category_confidence");
    expect(colNames).toContain("category_source");
    expect(colNames).toContain("category_id");
    expect(colNames).toContain("normalized_category");
  });

  it("should add new columns to legacy databases via migration", () => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    // Verify columns don't exist yet
    const preCols = db.pragma("table_info(completion_history)") as {
      name: string;
    }[];
    const preColNames = preCols.map((c) => c.name);
    expect(preColNames).not.toContain("raw_llm_category");
    expect(preColNames).not.toContain("category_confidence");
    expect(preColNames).not.toContain("category_source");

    db.exec("INSERT INTO users (id) VALUES ('u1')");
    runMigrations(db);

    // Verify columns exist after migration
    const postCols = db.pragma("table_info(completion_history)") as {
      name: string;
    }[];
    const postColNames = postCols.map((c) => c.name);
    expect(postColNames).toContain("raw_llm_category");
    expect(postColNames).toContain("category_confidence");
    expect(postColNames).toContain("category_source");
  });

  it("should have all new columns on categories table after migration of legacy DB", () => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(LEGACY_SCHEMA_SQL);
    seedLegacyCategories(db);

    // Verify new columns don't exist yet
    const preCols = db.pragma("table_info(categories)") as { name: string }[];
    const preColNames = preCols.map((c) => c.name);
    expect(preColNames).not.toContain("user_id");
    expect(preColNames).not.toContain("status");
    expect(preColNames).not.toContain("created_by");
    expect(preColNames).not.toContain("merged_into_category_id");
    expect(preColNames).not.toContain("updated_at");

    db.exec("INSERT INTO users (id) VALUES ('u1')");
    runMigrations(db);

    // Verify columns exist after migration
    const postCols = db.pragma("table_info(categories)") as { name: string }[];
    const postColNames = postCols.map((c) => c.name);
    expect(postColNames).toContain("user_id");
    expect(postColNames).toContain("status");
    expect(postColNames).toContain("created_by");
    expect(postColNames).toContain("merged_into_category_id");
    expect(postColNames).toContain("updated_at");
  });
});

describe("Database schema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("should create all expected tables", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name).sort();
    expect(tableNames).toEqual([
      "behavioral_adjustments",
      "categories",
      "completion_history",
      "preference_profiles",
      "task_dependencies",
      "task_sessions",
      "tasks",
      "users",
    ]);
  });

  it("should be idempotent — running migrations twice does not error", () => {
    expect(() => runMigrations(db)).not.toThrow();
  });

  it("should enforce foreign keys", () => {
    const fkEnabled = db.pragma("foreign_keys", { simple: true });
    expect(fkEnabled).toBe(1);
  });

  it("should enforce priority CHECK constraint (1-5)", () => {
    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(
      "INSERT INTO task_sessions (id, user_id, raw_input) VALUES ('s1', 'u1', 'test')",
    );

    // Valid priority
    expect(() =>
      db.exec(
        "INSERT INTO tasks (id, session_id, description, raw_text, priority) VALUES ('t1', 's1', 'd', 'r', 3)",
      ),
    ).not.toThrow();

    // Priority too low
    expect(() =>
      db.exec(
        "INSERT INTO tasks (id, session_id, description, raw_text, priority) VALUES ('t2', 's1', 'd', 'r', 0)",
      ),
    ).toThrow();

    // Priority too high
    expect(() =>
      db.exec(
        "INSERT INTO tasks (id, session_id, description, raw_text, priority) VALUES ('t3', 's1', 'd', 'r', 6)",
      ),
    ).toThrow();
  });

  it("should enforce difficulty_level CHECK constraint (1-5)", () => {
    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(
      "INSERT INTO task_sessions (id, user_id, raw_input) VALUES ('s1', 'u1', 'test')",
    );

    // Valid difficulty
    expect(() =>
      db.exec(
        "INSERT INTO tasks (id, session_id, description, raw_text, difficulty_level) VALUES ('t1', 's1', 'd', 'r', 5)",
      ),
    ).not.toThrow();

    // Difficulty too low
    expect(() =>
      db.exec(
        "INSERT INTO tasks (id, session_id, description, raw_text, difficulty_level) VALUES ('t2', 's1', 'd', 'r', 0)",
      ),
    ).toThrow();

    // Difficulty too high
    expect(() =>
      db.exec(
        "INSERT INTO tasks (id, session_id, description, raw_text, difficulty_level) VALUES ('t3', 's1', 'd', 'r', 6)",
      ),
    ).toThrow();
  });

  it("should enforce effort_percentage CHECK constraint (0-100)", () => {
    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(
      "INSERT INTO task_sessions (id, user_id, raw_input) VALUES ('s1', 'u1', 'test')",
    );

    // Valid effort
    expect(() =>
      db.exec(
        "INSERT INTO tasks (id, session_id, description, raw_text, effort_percentage) VALUES ('t1', 's1', 'd', 'r', 50.5)",
      ),
    ).not.toThrow();

    // Effort too low
    expect(() =>
      db.exec(
        "INSERT INTO tasks (id, session_id, description, raw_text, effort_percentage) VALUES ('t2', 's1', 'd', 'r', -1)",
      ),
    ).toThrow();

    // Effort too high
    expect(() =>
      db.exec(
        "INSERT INTO tasks (id, session_id, description, raw_text, effort_percentage) VALUES ('t3', 's1', 'd', 'r', 101)",
      ),
    ).toThrow();
  });

  it("should enforce foreign key on task_sessions.user_id", () => {
    expect(() =>
      db.exec(
        "INSERT INTO task_sessions (id, user_id, raw_input) VALUES ('s1', 'nonexistent', 'test')",
      ),
    ).toThrow();
  });

  it("should enforce foreign key on tasks.session_id", () => {
    expect(() =>
      db.exec(
        "INSERT INTO tasks (id, session_id, description, raw_text) VALUES ('t1', 'nonexistent', 'd', 'r')",
      ),
    ).toThrow();
  });

  it("should enforce composite primary key on task_dependencies", () => {
    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec(
      "INSERT INTO task_sessions (id, user_id, raw_input) VALUES ('s1', 'u1', 'test')",
    );
    db.exec(
      "INSERT INTO tasks (id, session_id, description, raw_text) VALUES ('t1', 's1', 'd1', 'r1')",
    );
    db.exec(
      "INSERT INTO tasks (id, session_id, description, raw_text) VALUES ('t2', 's1', 'd2', 'r2')",
    );

    // First insert should succeed
    expect(() =>
      db.exec(
        "INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ('t1', 't2')",
      ),
    ).not.toThrow();

    // Duplicate should fail
    expect(() =>
      db.exec(
        "INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ('t1', 't2')",
      ),
    ).toThrow();
  });

  it("should enforce composite primary key on behavioral_adjustments", () => {
    db.exec("INSERT INTO users (id) VALUES ('u1')");

    expect(() =>
      db.exec(
        "INSERT INTO behavioral_adjustments (user_id, category) VALUES ('u1', 'coding')",
      ),
    ).not.toThrow();

    expect(() =>
      db.exec(
        "INSERT INTO behavioral_adjustments (user_id, category) VALUES ('u1', 'coding')",
      ),
    ).toThrow();
  });

  it("should set default values correctly", () => {
    db.exec("INSERT INTO users (id) VALUES ('u1')");
    db.exec("INSERT INTO preference_profiles (user_id) VALUES ('u1')");

    const profile = db
      .prepare("SELECT strategy FROM preference_profiles WHERE user_id = 'u1'")
      .get() as { strategy: string };
    expect(profile.strategy).toBe("highest-priority-first");
  });
});
