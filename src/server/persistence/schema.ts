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
     base TEXT NOT NULL DEFAULT '{}',
     inv TEXT NOT NULL DEFAULT '{}',
     gold INTEGER NOT NULL DEFAULT 0,
     char_xp INTEGER NOT NULL DEFAULT 0,
     chosen_class TEXT,
     talents TEXT NOT NULL DEFAULT '{}',
     talent_points INTEGER NOT NULL DEFAULT 0,
     attr_points INTEGER NOT NULL DEFAULT 0,
     last_seen INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS floor_record (
     run_id TEXT NOT NULL,
     floor INTEGER NOT NULL,
     completed_at INTEGER NOT NULL,
     survivors INTEGER NOT NULL
   )`,
  // All-time per-player score for the leaderboard. UNLIKE player_record (run-scoped,
  // wiped on /admin/new-run), this survives run resets — it's the durable ranking.
  `CREATE TABLE IF NOT EXISTS leaderboard (
     player_id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     lifetime_xp INTEGER NOT NULL DEFAULT 0,
     best_floor INTEGER NOT NULL DEFAULT 0,
     kills INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL
   )`,
];

// Additive migrations for DBs created before a column existed. Each ALTER throws
// "duplicate column" if already applied, so the DO runs them in try/catch — a
// re-run is a harmless no-op. (Fresh DBs already have the columns from SCHEMA.)
export const MIGRATIONS: string[] = [
  "ALTER TABLE player_record ADD COLUMN base TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE player_record ADD COLUMN inv TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE player_record ADD COLUMN gold INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE player_record ADD COLUMN char_xp INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE player_record ADD COLUMN chosen_class TEXT",
  "ALTER TABLE player_record ADD COLUMN talents TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE player_record ADD COLUMN talent_points INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE player_record ADD COLUMN attr_points INTEGER NOT NULL DEFAULT 0",
];
