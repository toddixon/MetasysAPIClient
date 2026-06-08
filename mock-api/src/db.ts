import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';
import { createSchema, seedDatabaseIfEmpty } from './seed';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) {
    return db;
  }

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  createSchema(db);
  seedDatabaseIfEmpty(db);
  db.pragma('journal_mode = WAL');
  return db;
}
