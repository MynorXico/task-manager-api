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

export { db };
