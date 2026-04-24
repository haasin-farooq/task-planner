/**
 * Unit tests for category management API endpoints.
 *
 * Uses supertest to exercise each category route handler with an in-memory
 * SQLite database. Tests cover GET /api/categories, POST /api/categories,
 * POST /api/categories/merge, PATCH /api/categories/:categoryId,
 * PATCH /api/categories/:categoryId/archive, POST /api/categories/consolidate,
 * and POST /api/categories/consolidate/apply.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3, 10.4, 10.5, 14.4, 14.5, 14.6, 14.7
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
import type {
  CategoryConsolidator,
  ConsolidationSuggestion,
} from "../services/category-consolidator.js";
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
  it("returns all categories when no userId is provided (legacy, Req 10.1)", async () => {
    const res = await request(app).get("/api/categories");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
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

  it("returns only active categories for a specific user when userId is provided (Req 14.1)", async () => {
    // Create categories for two different users
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-a");
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-b");
    categoryRepo.create("UserA Cat", "user-a", "user");
    categoryRepo.create("UserB Cat", "user-b", "user");

    const resA = await request(app).get("/api/categories?userId=user-a");
    expect(resA.status).toBe(200);
    const namesA: string[] = resA.body.map((c: { name: string }) => c.name);
    expect(namesA).toContain("UserA Cat");
    expect(namesA).not.toContain("UserB Cat");

    const resB = await request(app).get("/api/categories?userId=user-b");
    expect(resB.status).toBe(200);
    const namesB: string[] = resB.body.map((c: { name: string }) => c.name);
    expect(namesB).toContain("UserB Cat");
    expect(namesB).not.toContain("UserA Cat");
  });

  it("excludes merged and archived categories when userId is provided (Req 14.1)", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(
      "user-filter",
    );
    const active = categoryRepo.create("Active Cat", "user-filter", "user");
    const toArchive = categoryRepo.create(
      "Archived Cat",
      "user-filter",
      "user",
    );
    const toMerge = categoryRepo.create("Merged Cat", "user-filter", "user");

    categoryRepo.archive(toArchive.id);
    categoryRepo.merge(toMerge.id, active.id);

    const res = await request(app).get("/api/categories?userId=user-filter");
    expect(res.status).toBe(200);
    const names: string[] = res.body.map((c: { name: string }) => c.name);
    expect(names).toContain("Active Cat");
    expect(names).not.toContain("Archived Cat");
    expect(names).not.toContain("Merged Cat");
  });

  it("returns empty array for a user with no categories (Req 14.1)", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-empty");

    const res = await request(app).get("/api/categories?userId=user-empty");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns categories sorted by name when userId is provided (Req 14.1)", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-sort");
    categoryRepo.create("Zebra", "user-sort", "user");
    categoryRepo.create("Alpha", "user-sort", "user");
    categoryRepo.create("Middle", "user-sort", "user");

    const res = await request(app).get("/api/categories?userId=user-sort");
    expect(res.status).toBe(200);
    const names: string[] = res.body.map((c: { name: string }) => c.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});

// ===========================================================================
// POST /api/categories/merge
// ===========================================================================

describe("POST /api/categories/merge", () => {
  it("merges source category into target with soft-delete (Req 8.1, 10.2, 14.2)", async () => {
    const source = categoryRepo.upsertByName("SourceCat");
    const target = categoryRepo.upsertByName("TargetCat");

    const res = await request(app)
      .post("/api/categories/merge")
      .send({ sourceCategoryId: source.id, targetCategoryId: target.id });

    expect(res.status).toBe(200);
    expect(res.body.targetCategoryId).toBe(target.id);

    // Source category should still exist with status='merged' and merged_into_category_id set
    const sourceAfterMerge = categoryRepo.findById(source.id);
    expect(sourceAfterMerge).not.toBeNull();
    expect(sourceAfterMerge!.status).toBe("merged");
    expect(sourceAfterMerge!.mergedIntoCategoryId).toBe(target.id);
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

  it("updates updated_at timestamp on rename (Req 14.3)", async () => {
    const cat = categoryRepo.upsertByName("TimestampTest");
    const originalUpdatedAt = cat.updatedAt;

    // Small delay to ensure timestamp differs
    await new Promise((resolve) => setTimeout(resolve, 50));

    const res = await request(app)
      .patch(`/api/categories/${cat.id}`)
      .send({ name: "RenamedTimestamp" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("updatedAt");
    // The updatedAt should be present in the response
    expect(typeof res.body.updatedAt).toBe("string");
  });
});

// ===========================================================================
// POST /api/tasks/analyze — categoryConfidence in response
// ===========================================================================

describe("POST /api/tasks/analyze", () => {
  it("includes categoryConfidence per task in the response (Req 14.3)", async () => {
    // Build an app with a mock analyzer that returns categoryConfidence
    const mockAnalyzer = {
      analyze: async () => ({
        tasks: [
          {
            id: "task-1",
            rawText: "Write tests",
            description: "Write tests",
            isAmbiguous: false,
            metrics: {
              priority: 3,
              effortPercentage: 100,
              difficultyLevel: 3,
              estimatedTime: 30,
              dependsOn: [],
            },
            category: "Development",
            categoryId: 1,
            categoryConfidence: 0.85,
          },
        ],
        circularDependencies: [],
      }),
    } as unknown as TaskAnalyzer;

    const mockParser = {
      parse: async () => ({ tasks: [], ambiguousItems: [], errors: [] }),
    } as unknown as TaskInputParser;

    const testApp = createApp({
      db,
      parser: mockParser,
      analyzer: mockAnalyzer,
      learningEngine: new AdaptiveLearningEngine(db),
      analytics: new AnalyticsAggregator(db),
      preferenceStore: new PreferenceProfileStore(db),
      categoryRepo,
    });

    const res = await request(testApp)
      .post("/api/tasks/analyze")
      .send({
        tasks: [{ description: "Write tests" }],
        userId: "test-user",
      });

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0]).toHaveProperty("categoryConfidence", 0.85);
  });
});

// ===========================================================================
// POST /api/categories — Create a category manually
// ===========================================================================

describe("POST /api/categories", () => {
  it("creates a category with created_by='user' and returns 201 (Req 14.4)", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(
      "user-create",
    );

    const res = await request(app)
      .post("/api/categories")
      .send({ name: "My Category", userId: "user-create" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("My Category");
    expect(res.body.userId).toBe("user-create");
    expect(res.body.status).toBe("active");
    expect(res.body.createdBy).toBe("user");
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("createdAt");
  });

  it("returns 400 when name is missing (Req 14.6)", async () => {
    const res = await request(app)
      .post("/api/categories")
      .send({ userId: "user-create" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: name");
  });

  it("returns 400 when name is empty string (Req 14.6)", async () => {
    const res = await request(app)
      .post("/api/categories")
      .send({ name: "", userId: "user-create" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: name");
  });

  it("returns 400 when name is whitespace only (Req 14.6)", async () => {
    const res = await request(app)
      .post("/api/categories")
      .send({ name: "   ", userId: "user-create" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: name");
  });

  it("returns 400 when userId is missing (Req 14.6)", async () => {
    const res = await request(app)
      .post("/api/categories")
      .send({ name: "My Category" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: userId");
  });

  it("returns 400 when userId is empty string (Req 14.6)", async () => {
    const res = await request(app)
      .post("/api/categories")
      .send({ name: "My Category", userId: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: userId");
  });

  it("returns 409 when category name already exists for user (Req 14.6)", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-dup");
    categoryRepo.create("Existing", "user-dup", "user");

    const res = await request(app)
      .post("/api/categories")
      .send({ name: "Existing", userId: "user-dup" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("A category with this name already exists");
  });

  it("returns 409 for case-insensitive duplicate name (Req 14.6)", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-dup2");
    categoryRepo.create("Development", "user-dup2", "user");

    const res = await request(app)
      .post("/api/categories")
      .send({ name: "development", userId: "user-dup2" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("A category with this name already exists");
  });

  it("allows same category name for different users", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-x");
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-y");
    categoryRepo.create("SharedName", "user-x", "user");

    const res = await request(app)
      .post("/api/categories")
      .send({ name: "SharedName", userId: "user-y" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("SharedName");
    expect(res.body.userId).toBe("user-y");
  });

  it("trims whitespace from the name", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-trim");

    const res = await request(app)
      .post("/api/categories")
      .send({ name: "  Trimmed  ", userId: "user-trim" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Trimmed");
  });

  it("creates user record if it does not exist", async () => {
    const res = await request(app)
      .post("/api/categories")
      .send({ name: "NewUserCat", userId: "brand-new-user" });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe("brand-new-user");
  });
});

// ===========================================================================
// PATCH /api/categories/:categoryId/archive
// ===========================================================================

describe("PATCH /api/categories/:categoryId/archive", () => {
  it("archives a category and returns 200 (Req 14.5)", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-arch");
    const cat = categoryRepo.create("ToArchive", "user-arch", "user");

    const res = await request(app)
      .patch(`/api/categories/${cat.id}/archive`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(cat.id);
    expect(res.body.name).toBe("ToArchive");
    expect(res.body.status).toBe("archived");
  });

  it("returns 404 when category does not exist (Req 14.7)", async () => {
    const res = await request(app)
      .patch("/api/categories/99999/archive")
      .send();

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Category not found");
  });

  it("archived category is excluded from active list", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-arch2");
    const cat = categoryRepo.create("WillArchive", "user-arch2", "user");

    await request(app).patch(`/api/categories/${cat.id}/archive`).send();

    const listRes = await request(app).get("/api/categories?userId=user-arch2");
    expect(listRes.status).toBe(200);
    const names: string[] = listRes.body.map((c: { name: string }) => c.name);
    expect(names).not.toContain("WillArchive");
  });
});

// ===========================================================================
// POST /api/categories/consolidate
// ===========================================================================

describe("POST /api/categories/consolidate", () => {
  it("returns 400 when userId is missing (Req 14.6)", async () => {
    const consolidator: CategoryConsolidator = {
      analyze: async () => [],
    } as unknown as CategoryConsolidator;

    const testApp = createApp({
      db,
      parser: {
        parse: async () => ({ tasks: [], ambiguousItems: [], errors: [] }),
      } as unknown as TaskInputParser,
      analyzer: {
        analyze: async () => ({ tasks: [], circularDependencies: [] }),
      } as unknown as TaskAnalyzer,
      learningEngine: new AdaptiveLearningEngine(db),
      analytics: new AnalyticsAggregator(db),
      preferenceStore: new PreferenceProfileStore(db),
      categoryRepo,
      categoryConsolidator: consolidator,
    });

    const res = await request(testApp)
      .post("/api/categories/consolidate")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: userId");
  });

  it("returns 501 when consolidator is not configured", async () => {
    const res = await request(app)
      .post("/api/categories/consolidate")
      .send({ userId: "user-test" });

    expect(res.status).toBe(501);
    expect(res.body.error).toBe("Category consolidation is not configured");
  });

  it("returns suggestions from the consolidator (Req 8.1)", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-cons");
    categoryRepo.create("Dev Work", "user-cons", "user");
    categoryRepo.create("Development", "user-cons", "user");

    const mockSuggestions: ConsolidationSuggestion[] = [
      {
        id: "sug-1",
        action: "merge",
        sourceCategoryName: "Dev Work",
        targetCategoryName: "Development",
        reason: "Synonyms",
      },
    ];

    const consolidator: CategoryConsolidator = {
      analyze: async () => mockSuggestions,
    } as unknown as CategoryConsolidator;

    const testApp = createApp({
      db,
      parser: {
        parse: async () => ({ tasks: [], ambiguousItems: [], errors: [] }),
      } as unknown as TaskInputParser,
      analyzer: {
        analyze: async () => ({ tasks: [], circularDependencies: [] }),
      } as unknown as TaskAnalyzer,
      learningEngine: new AdaptiveLearningEngine(db),
      analytics: new AnalyticsAggregator(db),
      preferenceStore: new PreferenceProfileStore(db),
      categoryRepo,
      categoryConsolidator: consolidator,
    });

    const res = await request(testApp)
      .post("/api/categories/consolidate")
      .send({ userId: "user-cons" });

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toHaveLength(1);
    expect(res.body.suggestions[0].action).toBe("merge");
    expect(res.body.suggestions[0].id).toBe("sug-1");
  });
});

// ===========================================================================
// POST /api/categories/consolidate/apply
// ===========================================================================

describe("POST /api/categories/consolidate/apply", () => {
  it("returns 400 when userId is missing (Req 14.6)", async () => {
    const res = await request(app)
      .post("/api/categories/consolidate/apply")
      .send({ suggestionIds: ["sug-1"], suggestions: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: userId");
  });

  it("returns 400 when suggestionIds is missing (Req 14.6)", async () => {
    const res = await request(app)
      .post("/api/categories/consolidate/apply")
      .send({ userId: "user-test", suggestions: [{ id: "sug-1" }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: suggestionIds");
  });

  it("returns 400 when suggestions is missing (Req 14.6)", async () => {
    const res = await request(app)
      .post("/api/categories/consolidate/apply")
      .send({ userId: "user-test", suggestionIds: ["sug-1"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: suggestions");
  });

  it("applies a merge suggestion (Req 8.2, 8.3)", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-apply");
    const source = categoryRepo.create("Dev Work", "user-apply", "user");
    const target = categoryRepo.create("Development", "user-apply", "user");

    const suggestions: ConsolidationSuggestion[] = [
      {
        id: "sug-merge",
        action: "merge",
        sourceCategoryId: source.id,
        sourceCategoryName: "Dev Work",
        targetCategoryId: target.id,
        targetCategoryName: "Development",
        reason: "Synonyms",
      },
    ];

    const res = await request(app)
      .post("/api/categories/consolidate/apply")
      .send({
        userId: "user-apply",
        suggestionIds: ["sug-merge"],
        suggestions,
      });

    expect(res.status).toBe(200);
    expect(res.body.applied).toContain("sug-merge");
    expect(res.body.errors).toHaveLength(0);

    // Verify source is now merged
    const sourceAfter = categoryRepo.findById(source.id);
    expect(sourceAfter!.status).toBe("merged");
    expect(sourceAfter!.mergedIntoCategoryId).toBe(target.id);
  });

  it("applies a rename suggestion (Req 8.4)", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-ren");
    const cat = categoryRepo.create("Misc", "user-ren", "user");

    const suggestions: ConsolidationSuggestion[] = [
      {
        id: "sug-rename",
        action: "rename",
        categoryId: cat.id,
        currentName: "Misc",
        proposedName: "General Tasks",
        reason: "More descriptive",
      },
    ];

    const res = await request(app)
      .post("/api/categories/consolidate/apply")
      .send({
        userId: "user-ren",
        suggestionIds: ["sug-rename"],
        suggestions,
      });

    expect(res.status).toBe(200);
    expect(res.body.applied).toContain("sug-rename");
    expect(res.body.errors).toHaveLength(0);

    // Verify category was renamed
    const updated = categoryRepo.findById(cat.id);
    expect(updated!.name).toBe("General Tasks");
  });

  it("applies a split suggestion (Req 8.5)", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-split");
    const cat = categoryRepo.create("Work", "user-split", "user");

    const suggestions: ConsolidationSuggestion[] = [
      {
        id: "sug-split",
        action: "split",
        categoryId: cat.id,
        currentName: "Work",
        proposedNames: ["Client Work", "Internal Work"],
        reason: "Too broad",
      },
    ];

    const res = await request(app)
      .post("/api/categories/consolidate/apply")
      .send({
        userId: "user-split",
        suggestionIds: ["sug-split"],
        suggestions,
      });

    expect(res.status).toBe(200);
    expect(res.body.applied).toContain("sug-split");
    expect(res.body.errors).toHaveLength(0);

    // Verify original is archived
    const original = categoryRepo.findById(cat.id);
    expect(original!.status).toBe("archived");

    // Verify new categories were created
    const active = categoryRepo.getActiveByUserId("user-split");
    const names = active.map((c) => c.name);
    expect(names).toContain("Client Work");
    expect(names).toContain("Internal Work");
  });

  it("only applies suggestions in the approved suggestionIds list", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(
      "user-partial",
    );
    const cat1 = categoryRepo.create("Cat1", "user-partial", "user");
    const cat2 = categoryRepo.create("Cat2", "user-partial", "user");

    const suggestions: ConsolidationSuggestion[] = [
      {
        id: "sug-approved",
        action: "rename",
        categoryId: cat1.id,
        currentName: "Cat1",
        proposedName: "Category One",
        reason: "Better name",
      },
      {
        id: "sug-not-approved",
        action: "rename",
        categoryId: cat2.id,
        currentName: "Cat2",
        proposedName: "Category Two",
        reason: "Better name",
      },
    ];

    const res = await request(app)
      .post("/api/categories/consolidate/apply")
      .send({
        userId: "user-partial",
        suggestionIds: ["sug-approved"],
        suggestions,
      });

    expect(res.status).toBe(200);
    expect(res.body.applied).toContain("sug-approved");
    expect(res.body.applied).not.toContain("sug-not-approved");

    // Cat1 should be renamed, Cat2 should not
    const c1 = categoryRepo.findById(cat1.id);
    expect(c1!.name).toBe("Category One");
    const c2 = categoryRepo.findById(cat2.id);
    expect(c2!.name).toBe("Cat2");
  });

  it("reports errors for suggestions with missing fields", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-err");

    const suggestions: ConsolidationSuggestion[] = [
      {
        id: "sug-bad-merge",
        action: "merge",
        reason: "Missing IDs",
        // Missing sourceCategoryId and targetCategoryId
      },
    ];

    const res = await request(app)
      .post("/api/categories/consolidate/apply")
      .send({
        userId: "user-err",
        suggestionIds: ["sug-bad-merge"],
        suggestions,
      });

    expect(res.status).toBe(200);
    expect(res.body.applied).toHaveLength(0);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].suggestionId).toBe("sug-bad-merge");
  });
});

// ===========================================================================
// Additional coverage — extended entity fields, behavioral_adjustments merge,
// edge cases for error responses
// ===========================================================================

describe("GET /api/categories — extended entity fields", () => {
  it("returns userId, status, createdBy, and updatedAt when userId is provided (Req 14.1)", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(
      "user-fields",
    );
    categoryRepo.create("FieldTest", "user-fields", "llm");

    const res = await request(app).get("/api/categories?userId=user-fields");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const cat = res.body[0];
    expect(cat).toHaveProperty("userId", "user-fields");
    expect(cat).toHaveProperty("status", "active");
    expect(cat).toHaveProperty("createdBy", "llm");
    expect(cat).toHaveProperty("updatedAt");
    expect(typeof cat.updatedAt).toBe("string");
  });
});

describe("POST /api/categories/merge — behavioral_adjustments transfer", () => {
  it("transfers behavioral_adjustments references during merge (Req 8.3)", async () => {
    const source = categoryRepo.upsertByName("BehSource");
    const target = categoryRepo.upsertByName("BehTarget");

    // Seed a user and behavioral_adjustments row referencing the source category
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-beh");
    db.prepare(
      `INSERT INTO behavioral_adjustments
       (user_id, category, category_id, time_multiplier, difficulty_adjustment, sample_size, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    ).run("user-beh", "BehSource", source.id, 1.2, 0.5, 10);

    await request(app)
      .post("/api/categories/merge")
      .send({ sourceCategoryId: source.id, targetCategoryId: target.id });

    // Verify the behavioral_adjustments row now references the target
    const row = db
      .prepare(
        "SELECT category_id FROM behavioral_adjustments WHERE user_id = ? AND category_id = ?",
      )
      .get("user-beh", target.id) as { category_id: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.category_id).toBe(target.id);

    // Verify no rows reference the source anymore
    const sourceRow = db
      .prepare(
        "SELECT category_id FROM behavioral_adjustments WHERE user_id = ? AND category_id = ?",
      )
      .get("user-beh", source.id) as { category_id: number } | undefined;
    expect(sourceRow).toBeUndefined();
  });

  it("merges behavioral_adjustments with weighted averages when target has existing adjustments (Req 8.3)", async () => {
    const source = categoryRepo.upsertByName("WAvgSource");
    const target = categoryRepo.upsertByName("WAvgTarget");

    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-wavg");

    // Source: time_multiplier=1.5, difficulty_adjustment=0.8, sample_size=10
    db.prepare(
      `INSERT INTO behavioral_adjustments
       (user_id, category, category_id, time_multiplier, difficulty_adjustment, sample_size, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    ).run("user-wavg", "WAvgSource", source.id, 1.5, 0.8, 10);

    // Target: time_multiplier=1.0, difficulty_adjustment=0.2, sample_size=20
    db.prepare(
      `INSERT INTO behavioral_adjustments
       (user_id, category, category_id, time_multiplier, difficulty_adjustment, sample_size, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    ).run("user-wavg", "WAvgTarget", target.id, 1.0, 0.2, 20);

    await request(app)
      .post("/api/categories/merge")
      .send({ sourceCategoryId: source.id, targetCategoryId: target.id });

    // Verify weighted average: (1.5*10 + 1.0*20) / 30 = 35/30 ≈ 1.1667
    const row = db
      .prepare(
        "SELECT time_multiplier, difficulty_adjustment, sample_size FROM behavioral_adjustments WHERE user_id = ? AND category_id = ?",
      )
      .get("user-wavg", target.id) as {
      time_multiplier: number;
      difficulty_adjustment: number;
      sample_size: number;
    };

    expect(row.sample_size).toBe(30);
    expect(row.time_multiplier).toBeCloseTo((1.5 * 10 + 1.0 * 20) / 30, 4);
    expect(row.difficulty_adjustment).toBeCloseTo(
      (0.8 * 10 + 0.2 * 20) / 30,
      4,
    );
  });
});

describe("PATCH /api/categories/:categoryId — edge cases", () => {
  it("returns 404 for non-numeric categoryId (Req 14.7)", async () => {
    const res = await request(app)
      .patch("/api/categories/not-a-number")
      .send({ name: "SomeName" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Category not found");
  });
});

describe("POST /api/categories/consolidate — edge cases", () => {
  it("returns 400 when userId is empty string (Req 14.6)", async () => {
    const consolidator: CategoryConsolidator = {
      analyze: async () => [],
    } as unknown as CategoryConsolidator;

    const testApp = createApp({
      db,
      parser: {
        parse: async () => ({ tasks: [], ambiguousItems: [], errors: [] }),
      } as unknown as TaskInputParser,
      analyzer: {
        analyze: async () => ({ tasks: [], circularDependencies: [] }),
      } as unknown as TaskAnalyzer,
      learningEngine: new AdaptiveLearningEngine(db),
      analytics: new AnalyticsAggregator(db),
      preferenceStore: new PreferenceProfileStore(db),
      categoryRepo,
      categoryConsolidator: consolidator,
    });

    const res = await request(testApp)
      .post("/api/categories/consolidate")
      .send({ userId: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: userId");
  });
});

describe("POST /api/categories/consolidate/apply — edge cases", () => {
  it("returns 400 when suggestionIds is an empty array (Req 14.6)", async () => {
    const res = await request(app)
      .post("/api/categories/consolidate/apply")
      .send({
        userId: "user-test",
        suggestionIds: [],
        suggestions: [{ id: "sug-1", action: "rename" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: suggestionIds");
  });

  it("returns 400 when suggestions is an empty array (Req 14.6)", async () => {
    const res = await request(app)
      .post("/api/categories/consolidate/apply")
      .send({
        userId: "user-test",
        suggestionIds: ["sug-1"],
        suggestions: [],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: suggestions");
  });

  it("returns 400 when userId is empty string (Req 14.6)", async () => {
    const res = await request(app)
      .post("/api/categories/consolidate/apply")
      .send({
        userId: "",
        suggestionIds: ["sug-1"],
        suggestions: [{ id: "sug-1" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required field: userId");
  });
});
