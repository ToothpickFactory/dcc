import type { Theme, MonsterKind } from "../shared/types";

export interface CollisionGrid {
  w: number; // grid width (cells)
  h: number; // grid height (cells)
  cell: number; // cell size (px)
  solid: Uint8Array; // 1 = blocked
}

export interface FloorDescriptor {
  index: number;
  seed: number;
  depth: number;
  theme: Theme;
  w: number; // world px
  h: number; // world px
  durationMs: number; // per-floor timer (decision #9 — NOT depth-scaled)
  collision: CollisionGrid; // server-authoritative
  entrance: { x: number; y: number };
  stairs: { x: number; y: number; r: number };
  spawns: { x: number; y: number; kind: MonsterKind }[];
  chests: { x: number; y: number }[];
}
