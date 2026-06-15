// SQLite schema for Stream A / M0. Unused by the Phase-0 in-memory stub; kept
// here so the table shapes are agreed up front and the migration is reviewable.
export const SCHEMA_VERSION = 1;

export const DDL = `
CREATE TABLE IF NOT EXISTS run_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  run_id TEXT, current_floor INTEGER, seed INTEGER, phase TEXT, saved_at INTEGER
);
CREATE TABLE IF NOT EXISTS player_record (
  player_id TEXT PRIMARY KEY, name TEXT, alive INTEGER,
  cls TEXT, profile TEXT, abilities TEXT, last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS floor_record (
  run_id TEXT, floor INTEGER, completed_at INTEGER, survivors INTEGER
);
`;
