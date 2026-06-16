import type { Ability, Klass, PlayerClass, PlaystyleProfile } from "../../shared/types";
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
  gold: number; // currency earned by selling gear
  charXp: number; // character XP (skill system) — drives character level
  chosenClass: Klass | null; // WoW class picked at first level-up
  talents: Record<string, number>; // talent node id -> rank
  talentPoints: number; // unspent talent points
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
// All-time per-player score (survives run resets) — backs the leaderboard.
export interface LeaderboardEntry {
  playerId: string;
  name: string;
  lifetimeXp: number;
  bestFloor: number;
  kills: number;
  updatedAt: number;
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
  gold: number;
  char_xp: number;
  chosen_class: string | null;
  talents: string;
  talent_points: number;
  last_seen: number;
  [k: string]: SqlStorageValue;
}
interface LeaderboardRow {
  player_id: string;
  name: string;
  lifetime_xp: number;
  best_floor: number;
  kills: number;
  updated_at: number;
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
      `INSERT INTO player_record (player_id, name, alive, cls, profile, abilities, base, inv, gold, char_xp, chosen_class, talents, talent_points, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET name=excluded.name, alive=excluded.alive, cls=excluded.cls,
         profile=excluded.profile, abilities=excluded.abilities, base=excluded.base, inv=excluded.inv, gold=excluded.gold, char_xp=excluded.char_xp,
         chosen_class=excluded.chosen_class, talents=excluded.talents, talent_points=excluded.talent_points, last_seen=excluded.last_seen`,
      rec.playerId,
      rec.name,
      rec.alive ? 1 : 0,
      rec.cls,
      JSON.stringify(rec.profile),
      JSON.stringify(rec.abilities),
      JSON.stringify(rec.base),
      JSON.stringify(rec.inv),
      rec.gold | 0,
      rec.charXp | 0,
      rec.chosenClass ?? null,
      JSON.stringify(rec.talents ?? {}),
      rec.talentPoints | 0,
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
      .exec<PlayerRow>("SELECT player_id, name, alive, cls, profile, abilities, base, inv, gold, char_xp, chosen_class, talents, talent_points, last_seen FROM player_record WHERE player_id = ?", playerId)
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

  // Upsert an all-time leaderboard row with ABSOLUTE totals (the caller keeps the
  // running totals in memory and flushes them, so this is an idempotent set — not
  // an increment — and double-flushing can't inflate a score).
  leaderboardUpsertSync(e: LeaderboardEntry): void {
    this.sql.exec(
      `INSERT INTO leaderboard (player_id, name, lifetime_xp, best_floor, kills, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET name=excluded.name, lifetime_xp=excluded.lifetime_xp,
         best_floor=excluded.best_floor, kills=excluded.kills, updated_at=excluded.updated_at`,
      e.playerId,
      e.name,
      e.lifetimeXp | 0,
      e.bestFloor | 0,
      e.kills | 0,
      e.updatedAt,
    );
  }

  loadLeaderboardSync(playerId: string): LeaderboardEntry | null {
    const rows = this.sql
      .exec<LeaderboardRow>("SELECT player_id, name, lifetime_xp, best_floor, kills, updated_at FROM leaderboard WHERE player_id = ?", playerId)
      .toArray();
    if (rows.length !== 1) return null;
    return rowToLeaderboard(rows[0]);
  }

  // Top N by lifetime XP (the headline ranking), tie-broken by deepest floor. Only
  // actual scorers — zero rows can linger (e.g. a player who joined but never scored).
  topLeaderboardSync(limit: number): LeaderboardEntry[] {
    return this.sql
      .exec<LeaderboardRow>(
        `SELECT player_id, name, lifetime_xp, best_floor, kills, updated_at FROM leaderboard
         WHERE lifetime_xp > 0 OR best_floor > 0 OR kills > 0
         ORDER BY lifetime_xp DESC, best_floor DESC LIMIT ?`,
        Math.max(1, Math.min(100, limit | 0)),
      )
      .toArray()
      .map(rowToLeaderboard);
  }
}

function rowToLeaderboard(r: LeaderboardRow): LeaderboardEntry {
  return {
    playerId: r.player_id,
    name: r.name,
    lifetimeXp: r.lifetime_xp ?? 0,
    bestFloor: r.best_floor ?? 0,
    kills: r.kills ?? 0,
    updatedAt: r.updated_at ?? 0,
  };
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
    gold: r.gold ?? 0,
    charXp: r.char_xp ?? 0,
    chosenClass: r.chosen_class ? (r.chosen_class as Klass) : null,
    talents: safeJson(r.talents) as Record<string, number>,
    talentPoints: r.talent_points ?? 0,
    lastSeen: r.last_seen,
  };
}

function safeJson(s: string | null | undefined): Record<string, number> {
  if (!s) return {};
  try {
    const o = JSON.parse(s);
    return o && typeof o === "object" ? (o as Record<string, number>) : {};
  } catch {
    return {};
  }
}
