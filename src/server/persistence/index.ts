import type { Ability, PlayerClass, PlaystyleProfile } from "../../shared/types";

export interface PlayerRecord {
  playerId: string;
  name: string;
  alive: boolean; // SOLE source of truth for permadeath
  cls: PlayerClass;
  profile: PlaystyleProfile;
  abilities: Ability[];
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
  savePlayer(rec: PlayerRecord): Promise<void>; // idempotent; alive=false can't be undone in-run
  recordFloorComplete(rec: FloorRecord): Promise<void>;
}

// PHASE-0 STUB: in-memory. Stream A / M0 replaces this with DO SQLite so the
// global run survives eviction. The interface is the frozen contract.
export class InMemoryRunStore implements RunStore {
  private run: RunCheckpoint | null = null;
  private players = new Map<string, PlayerRecord>();
  private floors: FloorRecord[] = [];
  async loadRun() {
    return this.run;
  }
  async saveCheckpoint(c: RunCheckpoint) {
    this.run = c;
  }
  async loadPlayer(id: string) {
    return this.players.get(id) ?? null;
  }
  async savePlayer(rec: PlayerRecord) {
    this.players.set(rec.playerId, rec);
  }
  async recordFloorComplete(rec: FloorRecord) {
    this.floors.push(rec);
  }
}
