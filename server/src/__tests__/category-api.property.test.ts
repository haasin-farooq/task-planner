/**
 * Property 15: API Error Responses
 *
 * For any request to a category management endpoint with missing or invalid
 * required parameters, the system SHALL return HTTP 400 with a descriptive
 * error message. For any request referencing a non-existent category ID,
 * the system SHALL return HTTP 404.
 *
 * Feature: dynamic-ai-categories, Property 15: API Error Responses
 *
 * **Validates: Requirements 14.6, 14.7**
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import request from "supertest";
import Database from "better-sqlite3";
import { createDb } from "../db/connection.js";
import { createApp, type AppDependencies } from "../app.js";
import { TaskInputParser } from "../services/task-input-parser.js";
import { TaskAnalyzer } from "../services/task-analyzer.js";
import { AdaptiveLearningEngine } from "../services/adaptive-learning-engine.js";
import { AnalyticsAggregator } from "../services/analytics-aggregator.js";
import { PreferenceProfileStore } from "../services/preference-profile-store.js";
import { CategoryRepository } from "../db/category-repository.js";
import type { Express } from "express";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Arbitrary for safe alphanumeric strings (avoids special chars that could
 * cause transport-level issues with supertest).
 */
const safeStringArb = fc.stringOf(
  fc.oneof(
    fc.integer({ min: 0x30, max: 0x39 }).map((c) => String.fromCharCode(c)),
    fc.integer({ min: 0x41, max: 0x5a }).map((c) => String.fromCharCode(c)),
    fc.integer({ min: 0x61, max: 0x7a }).map((c) => String.fromCharCode(c)),
  ),
  { minLength: 1, maxLength: 20 },
);

/**
 * Arbitrary that produces invalid payloads for POST /api/categories.
 * Each payload is missing or has invalid required fields (name, userId).
 */
const invalidCreatePayloadArb: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  // Empty object — missing both name and userId
  fc.constant({}),
  // Missing name entirely
  fc.record({ userId: safeStringArb }),
  // Missing userId entirely
  fc.record({ name: safeStringArb }),
  // Name is empty string
  fc.record({ name: fc.constant(""), userId: safeStringArb }),
  // Name is whitespace only
  fc.record({
    name: fc.stringOf(fc.constant(" "), { minLength: 1, maxLength: 5 }),
    userId: safeStringArb,
  }),
  // userId is empty string
  fc.record({ name: safeStringArb, userId: fc.constant("") }),
  // userId is whitespace only
  fc.record({
    name: safeStringArb,
    userId: fc.stringOf(fc.constant(" "), { minLength: 1, maxLength: 5 }),
  }),
);

/**
 * Arbitrary that produces non-existent category IDs.
 * Uses large integers that won't exist in a fresh DB.
 */
const nonExistentIdArb = fc.integer({ min: 90000, max: 999999 });

/**
 * Arbitrary that produces invalid payloads for PATCH /api/categories/:id (rename).
 * These payloads are missing the required `name` field or have wrong types.
 */
const invalidRenamePayloadArb: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  // Missing name entirely
  fc.constant({}),
  // Name is empty string
  fc.record({ name: fc.constant("") }),
  // Name is whitespace only
  fc.record({
    name: fc.stringOf(fc.constant(" "), { minLength: 1, maxLength: 5 }),
  }),
  // Name is non-string type (number)
  fc.record({ name: fc.integer() }),
  // Name is non-string type (boolean)
  fc.record({ name: fc.boolean() }),
  // Name is null
  fc.record({ name: fc.constant(null) }),
);

/**
 * Arbitrary that produces invalid payloads for POST /api/categories/merge.
 */
const invalidMergePayloadArb: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  // Empty object
  fc.constant({}),
  // Only sourceCategoryId
  fc.record({ sourceCategoryId: fc.integer() }),
  // Only targetCategoryId
  fc.record({ targetCategoryId: fc.integer() }),
  // Unrelated fields
  fc.record({ unrelated: safeStringArb }),
);

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
// Property 15: API Error Responses
// ===========================================================================

describe("Property 15: API Error Responses", () => {
  /**
   * **Validates: Requirements 14.6**
   *
   * For any invalid payload sent to POST /api/categories (missing or invalid
   * required fields), the API SHALL return HTTP 400 with a descriptive error.
   */
  it("POST /api/categories returns 400 for any invalid payload", () => {
    return fc.assert(
      fc.asyncProperty(invalidCreatePayloadArb, async (payload) => {
        const res = await request(app).post("/api/categories").send(payload);

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty("error");
        expect(typeof res.body.error).toBe("string");
        expect(res.body.error.length).toBeGreaterThan(0);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 14.7**
   *
   * For any non-existent category ID, PATCH /api/categories/:id/archive
   * SHALL return HTTP 404.
   */
  it("PATCH /api/categories/:id/archive returns 404 for non-existent IDs", () => {
    return fc.assert(
      fc.asyncProperty(nonExistentIdArb, async (id) => {
        const res = await request(app)
          .patch(`/api/categories/${id}/archive`)
          .send();

        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty("error");
        expect(typeof res.body.error).toBe("string");
        expect(res.body.error.length).toBeGreaterThan(0);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 14.7**
   *
   * For any non-existent category ID, PATCH /api/categories/:id (rename)
   * SHALL return HTTP 404 when given a valid name payload.
   */
  it("PATCH /api/categories/:id returns 404 for non-existent IDs with valid name", () => {
    return fc.assert(
      fc.asyncProperty(nonExistentIdArb, async (id) => {
        const res = await request(app)
          .patch(`/api/categories/${id}`)
          .send({ name: "ValidName" });

        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty("error");
        expect(typeof res.body.error).toBe("string");
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 14.6**
   *
   * For any invalid rename payload sent to PATCH /api/categories/:id,
   * the API SHALL return HTTP 400 with a descriptive error, even when
   * the category ID exists.
   */
  it("PATCH /api/categories/:id returns 400 for invalid rename payloads on existing category", () => {
    // Create a real category once before the property runs
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("prop-user");
    const cat = categoryRepo.create("TestCategory", "prop-user", "user");

    return fc.assert(
      fc.asyncProperty(invalidRenamePayloadArb, async (payload) => {
        const res = await request(app)
          .patch(`/api/categories/${cat.id}`)
          .send(payload);

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty("error");
        expect(typeof res.body.error).toBe("string");
        expect(res.body.error.length).toBeGreaterThan(0);
      }),
      { numRuns: 30 },
    );
  });

  /**
   * **Validates: Requirements 14.6, 14.7**
   *
   * For any non-existent source category ID in a merge request,
   * the API SHALL return 404.
   */
  it("POST /api/categories/merge returns 404 for non-existent source IDs", () => {
    // Create a real target category once
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("merge-user");
    const target = categoryRepo.create("MergeTarget", "merge-user", "user");

    return fc.assert(
      fc.asyncProperty(nonExistentIdArb, async (sourceId) => {
        const res = await request(app).post("/api/categories/merge").send({
          sourceCategoryId: sourceId,
          targetCategoryId: target.id,
        });

        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty("error");
        expect(typeof res.body.error).toBe("string");
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 14.6, 14.7**
   *
   * For any non-existent target category ID in a merge request,
   * the API SHALL return 404.
   */
  it("POST /api/categories/merge returns 404 for non-existent target IDs", () => {
    // Create a real source category once
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(
      "merge-user2",
    );
    const source = categoryRepo.create("MergeSource", "merge-user2", "user");

    return fc.assert(
      fc.asyncProperty(nonExistentIdArb, async (targetId) => {
        const res = await request(app).post("/api/categories/merge").send({
          sourceCategoryId: source.id,
          targetCategoryId: targetId,
        });

        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty("error");
        expect(typeof res.body.error).toBe("string");
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 14.6**
   *
   * For any merge request with missing required fields, the API SHALL
   * return HTTP 400.
   */
  it("POST /api/categories/merge returns 400 for missing required fields", () => {
    return fc.assert(
      fc.asyncProperty(invalidMergePayloadArb, async (payload) => {
        const res = await request(app)
          .post("/api/categories/merge")
          .send(payload);

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty("error");
        expect(typeof res.body.error).toBe("string");
      }),
      { numRuns: 30 },
    );
  });
});
