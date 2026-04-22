/**
 * Property 7: Preference profile round-trip
 *
 * For any valid prioritization strategy, saving it to a user's preference
 * profile and then loading that profile must return the same strategy.
 *
 * Feature: ai-daily-task-planner, Property 7: Preference profile round-trip
 *
 * Validates: Requirements 5.1, 5.3
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";
import { createDb } from "../../db/connection.js";
import { PreferenceProfileStore } from "../preference-profile-store.js";
import type { PrioritizationStrategy } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary that produces one of the four valid prioritization strategies. */
const strategyArb: fc.Arbitrary<PrioritizationStrategy> = fc.constantFrom(
  "least-effort-first",
  "hardest-first",
  "highest-priority-first",
  "dependency-aware",
);

/** Arbitrary that produces a non-empty user ID string. */
const userIdArb = fc
  .stringOf(fc.char(), { minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 7: Preference profile round-trip", () => {
  let db: Database.Database;
  let store: PreferenceProfileStore;

  beforeEach(() => {
    db = createDb(":memory:");
    store = new PreferenceProfileStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("saving then loading a strategy returns the same strategy", () => {
    fc.assert(
      fc.property(userIdArb, strategyArb, (userId, strategy) => {
        store.save(userId, strategy);
        const profile = store.get(userId);

        expect(profile).not.toBeNull();
        expect(profile!.strategy).toBe(strategy);
        expect(profile!.userId).toBe(userId);
        expect(profile!.updatedAt).toBeInstanceOf(Date);
      }),
      { numRuns: 100 },
    );
  });

  it("overwriting a strategy and loading returns the latest strategy", () => {
    fc.assert(
      fc.property(
        userIdArb,
        strategyArb,
        strategyArb,
        (userId, firstStrategy, secondStrategy) => {
          store.save(userId, firstStrategy);
          store.save(userId, secondStrategy);

          const profile = store.get(userId);

          expect(profile).not.toBeNull();
          expect(profile!.strategy).toBe(secondStrategy);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("different users maintain independent strategies", () => {
    fc.assert(
      fc.property(
        userIdArb,
        userIdArb,
        strategyArb,
        strategyArb,
        (userA, userB, strategyA, strategyB) => {
          // Skip when user IDs collide — we want independent users
          fc.pre(userA !== userB);

          store.save(userA, strategyA);
          store.save(userB, strategyB);

          const profileA = store.get(userA);
          const profileB = store.get(userB);

          expect(profileA).not.toBeNull();
          expect(profileB).not.toBeNull();
          expect(profileA!.strategy).toBe(strategyA);
          expect(profileB!.strategy).toBe(strategyB);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a user with no saved profile returns null", () => {
    fc.assert(
      fc.property(userIdArb, (userId) => {
        const profile = store.get(userId);
        expect(profile).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
