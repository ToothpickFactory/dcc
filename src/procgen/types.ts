import type { Theme, MonsterKind } from "../shared/types";

export interface CollisionGrid {
  w: number; // grid width (cells)
  h: number; // grid height (cells)
  cell: number; // cell size (px)
  solid: Uint8Array; // 1 = blocked
  ground: Int16Array; // per-cell ground HEIGHT in px (same fine-grid layout as solid; cy*w+cx). 0 = flat.
  // NOTE: `h` above is row-count, not elevation. Adjacent open cells differ by <= WALKABLE_DELTA
  // (guaranteed by procgen relaxation) so the v2 step-up gate can trust it. Heightfield 2.5D.
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
  bossRoom: { x: number; y: number }; // where the boss spawns when triggered (a far room)
  spawns: { x: number; y: number; kind: MonsterKind }[];
  chests: { x: number; y: number }[];
  decorations: { x: number; y: number; variant: number; scale: number }[];
}
