/**
 * Unit tests for category management API endpoints.
 *
 * Uses supertest to exercise each category route handler with an in-memory
 * SQLite database. Tests cover GET /api/categories, POST /api/categories/merge,
 * and PATCH /api/categories/:categoryId.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createDb } from "../db/connection.js";
import { createApp, type AppDependencies } from "../app.js";
import { TaskInputParser } from "../services/task-input-parser.js";
import { TaskAnalyzer } from "../services/task-analyzer.js";
import { AdaptiveLearningEngine } from "../services/adaptive-learning-engine.js";
import { AnalyticsAggregator } from "../services/analytics-aggregator.js";
import { PreferenceProfileStore } from "../services/preference-profile-store.js";
import { CategoryRepository } from "../db/category-repository.js";
import type Database from "better-sqlite3";
import type { Express } from "express";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let db: Database.Database;
let app: Express;
let categoryRepo: CategoryRepository;

function buildApp(): Express {
  const learningEngine = new AdaptiveLearningEngine(db);
  const analytics = new AnalyticsAggregator(db);
  const preferenceStore = new PreferenceProfileStore(db);
  categoryRepo = new CategoryRepository(db);

  // Stub parser and analyzer — not needed for category endpoint tests
  const parser = {
    parse: async () => ({ tasks: [], ambiguousItems: [], errors: [] }),
  } as unknown as TaskInputParser;

  const analyzer = {
    analyze: async () => ({ tasks: [], circularDependencies: [] }),
  } as unknown as TaskAnalyzer;

  const deps: AppDependencies = {
    db,
    parser,
    analyzer,
    learningEngine,
    analytics,
    preferenceStore,
    categoryRepo,
  };

  return createApp(deps);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  db = createDb(":memory:");
  app = buildApp();
});

afterEach(() => {
  db.close();
});

// ===========================================================================
// GET /api/categories
// ===========================================================================

describe("GET /api/categories", () => {
  it("returns all seeded categories sorted by name (Req 10.1)", async () => {
    const res = await request(app).get("/api/categories");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // The migration seeds 10 canonical categories
    expect(res.body.length).toBeGreaterThanOrEqual(10);

    // Verify sorted by name
    const names: string[] = res.body.map((c: { name: string }) => c.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("returns categories with id, name, and createdAt fields", async () => {
    const res = await request(app).get("/api/categories");

    expect(res.status).toBe(200);
    for (const cat of res.body) {
      expect(cat).toHaveProperty("id");
      expect(cat).toHaveProperty("name");
      expect(cat).toHaveProperty("createdAt");
      expect(typeof cat.id).toBe("number");
      expect(typeof cat.name).toBe("string");
    }
  });

  it("includes newly created categories in the list", async () => {
    categoryRepo.upsertByName("CustomCategory");

    const res = await request(app).get("/api/categories");

    expect(res.status).toBe(200);
    const names: string[] = res.body.map((c: { name: string }) => c.name);
    expect(names).toContain("CustomCategory");
  });
});

// ===========================================================================
// POST /api/categories/merge
// ===========================================================================

describe("POST /api/categories/merge", () => {
  it("merges source category into target successfully (Req 8.1, 10.2)", async () => {
    const source = categoryRepo.upsertByName("SourceCat");
    const target = categoryRepo.upsertByName("TargetCat");

    const res = await request(app)
      .post("/api/categories/merge")
      .send({ sourceCategoryId: source.id, targetCategoryId: target.id });

    expect(res.status).toBe(200);
    expect(res.body.targetCategoryId).toBe(target.id);

    // Source category should be deleted
    const allCategories = categoryRepo.getAll();
    const sourceStillExists = allCategories.find((c) => c.id === source.id);
    expect(sourceStillExists).toBeUndefined();
  });

  it("returns 400 when source and target are the same (Req 8.4)", async () => {
    const cat = categoryRepo.upsertByName("SameCat");

    const res = await request(app)
      .post("/api/categories/merge")
      .send({ sourceCategoryId: cat.id, targetCategoryId: cat.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Cannot merge a category with itself");
  });

  it("returns 404 when source category does not exist (Req 8.5, 10.5)", async () => {
    const target = categoryRepo.upsertByName("TargetCat");

    const res = await request(app)
      .post("/api/categories/merge")
      .send({ sourceCategoryId: 99999, targetCategoryId: target.id });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Source category not found");
  });

  it("returns 404 when target category does not exist (Req 10.5)", async () => {
    const source = categoryRepo.upsertByName("SourceCat");

    const res = await request(app)
      .post("/api/categories/merge")
      .send({ sourceCategoryId: source.id, targetCategoryId: 99999 });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Target category not found");
  });

  it("returns 400 when sourceCategoryId is missing (Req 10.4)", async () => {
    const target = categoryRepo.upsertByName("TargetCat");

    const res = await request(app)
      .post("/api/categories/merge")
      .send({ targetCategoryId: target.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Missing required fields: sourceCategoryId, targetCategoryId",
    );
  });

  it("returns 400 when targetCategoryId is missing (Req 10.4)", async () => {
    const source = categoryRepo.upsertByName("SourceCat");

    const res = await request(app)
      .post("/api/categories/merge")
      .send({ sourceCategoryId: source.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Missing required fields: sourceCategoryId, targetCategoryId",
    );
  });

  it("returns 400 when body is empty (Req 10.4)", async () => {
    const res = await request(app).post("/api/categories/merge").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Missing required fields: sourceCategoryId, targetCategoryId",
    );
  });

  it("transfers completion_history references during merge (Req 8.1)", async () => {
    const source = categoryRepo.upsertByName("MergeSource");
    const target = categoryRepo.upsertByName("MergeTarget");

    // Seed a user and completion_history row referencing the source category
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-m");
    db.prepare(
      `INSERT INTO completion_history
       (id, user_id, task_description, category, normalized_category, estimated_time, actual_time, difficulty_level, completed_at, category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "ch-1",
      "user-m",
      "Test task",
      "MergeSource",
      "MergeSource",
      30,
      25,
      3,
      new Date().toISOString(),
      source.id,
    );

    await request(app)
      .post("/api/categories/merge")
      .send({ sourceCategoryId: source.id, targetCategoryId: target.id });

    // Verify the completion_history row now references the target
    const row = db
      .prepare("SELECT category_id FROM completion_history WHERE id = ?")
      .get("ch-1") as { category_id: number };
    expect(row.category_id).toBe(target.id);
  });
});

// ===========================================================================
// PATCH /api/categories/:categoryId
// ===========================================================================

describe("PATCH /api/categories/:categoryId", () => {
  it("renames a category successfully (Req 9.1, 10.3)", async () => {
    const cat = categoryRepo.upsertByName("OldName");

    const res = await request(app)
      .patch(`/api/categories/${cat.id}`)
      .send({ name: "NewName" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("NewName");
    expect(res.body.id).toBe(cat.id);
  });

  it("returns 409 when renaming to a duplicate name (Req 9.2, 10.4)", async () => {
    categoryRepo.upsertByName("ExistingName");
    const cat = categoryRepo.upsertByName("ToRename");

    const res = await request(app)
      .patch(`/api/categories/${cat.id}`)
      .send({ name: "ExistingName" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("A category with this name already exists");
  });

  it("returns 409 for case-insensitive duplicate name (Req 9.2)", async () => {
    categoryRepo.upsertByName("Development");
    const cat = categoryRepo.upsertByName("MyCategory");

    const res = await request(app)
      .patch(`/api/categories/${cat.id}`)
      .send({ name: "development" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("A category with this name already exists");
  });

  it("returns 404 for non-existent category ID (Req 9.3, 10.5)", async () => {
    const res = await request(app)
      .patch("/api/categories/99999")
      .send({ name: "SomeName" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Category not found");
  });

  it("returns 400 when name is missing (Req 10.4)", async () => {
    const cat = categoryRepo.upsertByName("SomeCat");

    const res = await request(app).patch(`/api/categories/${cat.id}`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: name");
  });

  it("returns 400 when name is empty string (Req 10.4)", async () => {
    const cat = categoryRepo.upsertByName("SomeCat");

    const res = await request(app)
      .patch(`/api/categories/${cat.id}`)
      .send({ name: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: name");
  });

  it("returns 400 when name is whitespace only (Req 10.4)", async () => {
    const cat = categoryRepo.upsertByName("SomeCat");

    const res = await request(app)
      .patch(`/api/categories/${cat.id}`)
      .send({ name: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: name");
  });

  it("trims whitespace from the new name", async () => {
    const cat = categoryRepo.upsertByName("TrimTest");

    const res = await request(app)
      .patch(`/api/categories/${cat.id}`)
      .send({ name: "  Trimmed Name  " });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Trimmed Name");
  });
});
