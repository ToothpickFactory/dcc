// SQLite schema for the world DO (Stream A / M0). Each statement is executed
// individually (sql.exec runs one statement and returns a cursor for it).
// SQLite has no boolean type -> `alive` is INTEGER 0/1. Seeds stay small ints
// (well within JS 2^53), so INTEGER is safe here.
export const SCHEMA_VERSION = 1;

export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS run_state (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     run_id TEXT NOT NULL,
     current_floor INTEGER NOT NULL,
     seed INTEGER NOT NULL,
     phase TEXT NOT NULL,
     saved_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS player_record (
     player_id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     alive INTEGER NOT NULL,
     cls TEXT NOT NULL,
     profile TEXT NOT NULL,
     abilities TEXT NOT NULL,
     last_seen INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS floor_record (
     run_id TEXT NOT NULL,
     floor INTEGER NOT NULL,
     completed_at INTEGER NOT NULL,
     survivors INTEGER NOT NULL
   )`,
];
