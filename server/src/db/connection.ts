/**
 * Database initialization and connection management.
 *
 * Provides a singleton-style accessor for the SQLite database. The database
 * file defaults to `data/planner.db` relative to the server root, but can be
 * overridden via the `DATABASE_PATH` environment variable. Passing `:memory:`
 * creates an in-memory database (useful for tests).
 */

import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.resolve(__dirname, "../../data/planner.db");

let dbInstance: Database.Database | null = null;

/**
 * Return the active database connection, creating one if it doesn't exist yet.
 * On first call the schema migrations are applied automatically.
 */
export function getDb(): Database.Database {
  if (!dbInstance) {
    const dbPath = process.env.DATABASE_PATH || DEFAULT_DB_PATH;
    dbInstance = createDb(dbPath);
  }
  return dbInstance;
}

/**
 * Create a new database connection at the given path and run migrations.
 * Useful for tests that need an isolated in-memory database.
 */
export function createDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  runMigrations(db);
  return db;
}

/**
 * Close the active database connection and clear the singleton reference.
 */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
