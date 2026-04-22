import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createDb } from "../../db/connection.js";
import { PreferenceProfileStore } from "../preference-profile-store.js";
import type { PrioritizationStrategy } from "../../types/index.js";

describe("PreferenceProfileStore", () => {
  let db: Database.Database;
  let store: PreferenceProfileStore;

  beforeEach(() => {
    db = createDb(":memory:");
    store = new PreferenceProfileStore(db);
  });

  afterEach(() => {
    db.close();
  });

  // --- Requirement 5.4: default when no profile exists ---

  it("should return null for a non-existent user", () => {
    const profile = store.get("unknown-user");
    expect(profile).toBeNull();
  });

  it("should default to 'highest-priority-first' when no profile exists", () => {
    const DEFAULT_STRATEGY: PrioritizationStrategy = "highest-priority-first";
    const profile = store.get("no-profile-user");

    // Store returns null — callers apply the default strategy
    expect(profile).toBeNull();

    // Verify the default strategy matches the documented default (Req 5.2, 5.4)
    const effectiveStrategy = profile?.strategy ?? DEFAULT_STRATEGY;
    expect(effectiveStrategy).toBe("highest-priority-first");
  });

  // --- Requirement 5.1, 5.3: save and retrieve strategy ---

  it("should save and retrieve a preference profile", () => {
    store.save("user-1", "least-effort-first");

    const profile = store.get("user-1");
    expect(profile).not.toBeNull();
    expect(profile!.userId).toBe("user-1");
    expect(profile!.strategy).toBe("least-effort-first");
    expect(profile!.updatedAt).toBeInstanceOf(Date);
  });

  it("should upsert when saving a strategy for an existing user", () => {
    store.save("user-1", "hardest-first");
    store.save("user-1", "dependency-aware");

    const profile = store.get("user-1");
    expect(profile).not.toBeNull();
    expect(profile!.strategy).toBe("dependency-aware");
  });

  // --- Requirement 5.2: saved preference persists across calls ---

  it("should persist the strategy across separate get calls", () => {
    store.save("user-1", "highest-priority-first");

    const first = store.get("user-1");
    const second = store.get("user-1");

    expect(first!.strategy).toBe("highest-priority-first");
    expect(second!.strategy).toBe("highest-priority-first");
  });

  // --- Multiple users ---

  it("should store independent profiles for different users", () => {
    store.save("user-a", "least-effort-first");
    store.save("user-b", "hardest-first");

    expect(store.get("user-a")!.strategy).toBe("least-effort-first");
    expect(store.get("user-b")!.strategy).toBe("hardest-first");
  });

  // --- All valid strategies ---

  it.each<PrioritizationStrategy>([
    "least-effort-first",
    "hardest-first",
    "highest-priority-first",
    "dependency-aware",
  ])("should round-trip the '%s' strategy", (strategy) => {
    store.save("user-rt", strategy);
    const profile = store.get("user-rt");
    expect(profile!.strategy).toBe(strategy);
  });

  // --- Auto-creates user row ---

  it("should auto-create the user row if it does not exist", () => {
    store.save("new-user", "hardest-first");

    const userRow = db
      .prepare("SELECT id FROM users WHERE id = ?")
      .get("new-user") as { id: string } | undefined;

    expect(userRow).toBeDefined();
    expect(userRow!.id).toBe("new-user");
  });

  // --- Requirement 5.2, 5.4: schema default is 'highest-priority-first' ---

  it("should have 'highest-priority-first' as the schema default strategy", () => {
    // Insert a user and a bare preference row using the DB default
    db.prepare("INSERT INTO users (id) VALUES (?)").run("schema-default-user");
    db.prepare("INSERT INTO preference_profiles (user_id) VALUES (?)").run(
      "schema-default-user",
    );

    const profile = store.get("schema-default-user");
    expect(profile).not.toBeNull();
    expect(profile!.strategy).toBe("highest-priority-first");
  });

  it("should not duplicate the user row on repeated saves", () => {
    store.save("user-1", "hardest-first");
    store.save("user-1", "least-effort-first");

    const count = db
      .prepare("SELECT COUNT(*) as cnt FROM users WHERE id = ?")
      .get("user-1") as { cnt: number };

    expect(count.cnt).toBe(1);
  });
});
