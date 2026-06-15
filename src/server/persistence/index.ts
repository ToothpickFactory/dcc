import type { Ability, PlayerClass, PlaystyleProfile } from "../../shared/types";
import { coerceAttrs, coerceInventory, type Attributes, type Inventory } from "../../shared/items";

export interface PlayerRecord {
  playerId: string;
  name: string;
  alive: boolean; // SOLE source of truth for permadeath
  cls: PlayerClass;
  profile: PlaystyleProfile;
  abilities: Ability[];
  base: Attributes; // innate attributes (gear-derived stats rebuild from base+inv)
  inv: Inventory; // equipped gear + bags + carried items
  lastSeen: number;
}
export interface RunCheckpoint {
  runId: string;
  currentFloor: number;
  seed: number;
  phase: string;
  savedAt: number;
}
export interface FloorRecord {
  runId: string;
  floor: number;
  completedAt: number;
  survivors: number;
}

export interface RunStore {
  loadRun(): Promise<RunCheckpoint | null>;
  saveCheckpoint(c: RunCheckpoint): Promise<void>;
  loadPlayer(playerId: string): Promise<PlayerRecord | null>;
  savePlayer(rec: PlayerRecord): Promise<void>; // idempotent upsert
  recordFloorComplete(rec: FloorRecord): Promise<void>;
}

// exec<T> requires T extends Record<string, SqlStorageValue>, hence the index sig.
interface RunRow {
  run_id: string;
  current_floor: number;
  seed: number;
  phase: string;
  saved_at: number;
  [k: string]: SqlStorageValue;
}
interface PlayerRow {
  player_id: string;
  name: string;
  alive: number;
  cls: string;
  profile: string;
  abilities: string;
  base: string;
  inv: string;
  last_seen: number;
  [k: string]: SqlStorageValue;
}

// M0: durable run state in the DO's SQLite storage, so the global run survives
// eviction/restart. The sync `*Sync` methods exist so the DO can batch writes
// inside ctx.storage.transactionSync (whose callback must be synchronous); the
// async RunStore methods wrap them.
export class SqlRunStore implements RunStore {
  constructor(private sql: SqlStorage) {}

  checkpointSync(c: RunCheckpoint): void {
    this.sql.exec(
      `INSERT INTO run_state (id, run_id, current_floor, seed, phase, saved_at) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id, current_floor=excluded.current_floor,
         seed=excluded.seed, phase=excluded.phase, saved_at=excluded.saved_at`,
      c.runId,
      c.currentFloor,
      c.seed,
      c.phase,
      c.savedAt,
    );
  }

  playerSync(rec: PlayerRecord): void {
    this.sql.exec(
      `INSERT INTO player_record (player_id, name, alive, cls, profile, abilities, base, inv, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET name=excluded.name, alive=excluded.alive, cls=excluded.cls,
         profile=excluded.profile, abilities=excluded.abilities, base=excluded.base, inv=excluded.inv, last_seen=excluded.last_seen`,
      rec.playerId,
      rec.name,
      rec.alive ? 1 : 0,
      rec.cls,
      JSON.stringify(rec.profile),
      JSON.stringify(rec.abilities),
      JSON.stringify(rec.base),
      JSON.stringify(rec.inv),
      rec.lastSeen,
    );
  }

  // Wipe a run while preserving the schema (NOT deleteAll, which also drops the
  // alarm). Used by the admin /admin/new-run reset.
  resetSync(runId: string, seed: number, now: number): void {
    this.sql.exec("DELETE FROM player_record");
    this.sql.exec("DELETE FROM floor_record");
    this.checkpointSync({ runId, currentFloor: 1, seed, phase: "running", savedAt: now });
  }

  async loadRun(): Promise<RunCheckpoint | null> {
    const rows = this.sql
      .exec<RunRow>("SELECT run_id, current_floor, seed, phase, saved_at FROM run_state WHERE id = 1")
      .toArray();
    if (rows.length !== 1 || !rows[0].run_id) return null;
    const r = rows[0];
    return { runId: r.run_id, currentFloor: r.current_floor, seed: r.seed, phase: r.phase, savedAt: r.saved_at };
  }

  async saveCheckpoint(c: RunCheckpoint): Promise<void> {
    this.checkpointSync(c);
  }

  async loadPlayer(playerId: string): Promise<PlayerRecord | null> {
    const rows = this.sql
      .exec<PlayerRow>("SELECT player_id, name, alive, cls, profile, abilities, base, inv, last_seen FROM player_record WHERE player_id = ?", playerId)
      .toArray();
    if (rows.length !== 1) return null;
    try {
      return rowToPlayer(rows[0]);
    } catch {
      // A corrupt profile/abilities blob shouldn't reject the load path — treat
      // it as "no usable record" (fail-soft, like loadRun's guard).
      return null;
    }
  }

  async savePlayer(rec: PlayerRecord): Promise<void> {
    this.playerSync(rec);
  }

  recordFloorCompleteSync(rec: FloorRecord): void {
    this.sql.exec(
      "INSERT INTO floor_record (run_id, floor, completed_at, survivors) VALUES (?, ?, ?, ?)",
      rec.runId,
      rec.floor,
      rec.completedAt,
      rec.survivors,
    );
  }

  async recordFloorComplete(rec: FloorRecord): Promise<void> {
    this.recordFloorCompleteSync(rec);
  }
}

function rowToPlayer(r: PlayerRow): PlayerRecord {
  return {
    playerId: r.player_id,
    name: r.name,
    alive: r.alive === 1,
    cls: r.cls as PlayerClass,
    profile: JSON.parse(r.profile) as PlaystyleProfile,
    abilities: JSON.parse(r.abilities) as Ability[],
    base: coerceAttrs(JSON.parse(r.base ?? "{}")),
    inv: coerceInventory(JSON.parse(r.inv ?? "{}")),
    lastSeen: r.last_seen,
  };
}
