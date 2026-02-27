import Database from 'better-sqlite3';
import { initializeSchema } from './schema.js';

const dbPath = process.env.DB_PATH ?? './tasks.db';

let db: Database.Database;

try {
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  initializeSchema(db);
} catch (err) {
  console.error('Failed to initialize database:', err);
  process.exit(1);
}

/**
 * SQLite database connection configured for the task management system.
 *
 * This is a singleton instance initialized on module load with Write-Ahead Logging (WAL)
 * for better concurrency and foreign key constraints enabled for referential integrity.
 * The database schema (users and tasks tables) is automatically created if not present
 * via initializeSchema(). The database path is controlled by the DB_PATH environment
 * variable, defaulting to ./tasks.db in the current working directory.
 *
 * Side effects: Initializes schema on first import, exits the process if database
 * initialization fails.
 *
 * @type {Database.Database}
 */
export { db };
