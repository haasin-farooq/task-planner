import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, SCHEMA_SQL } from "../schema.js";
import { createDb } from "../connection.js";

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
