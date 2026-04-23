import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, SCHEMA_SQL } from "../schema.js";
import { createDb } from "../connection.js";

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
    // Create a DB with the base schema but WITHOUT the normalized_category column
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA_SQL);

    // Insert pre-migration records (no normalized_category column yet)
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
    // Create a DB with the base schema but WITHOUT the normalized_category column
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA_SQL);

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
