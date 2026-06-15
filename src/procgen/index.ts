import { WORLD } from "../shared/constants";
import type { Theme } from "../shared/types";
import type { CollisionGrid, FloorDescriptor } from "./types";

const THEMES: Theme[] = ["fantasy", "cyberpunk", "forest", "pirate", "clockwork", "nightmare"];

// Deterministic PRNG (mulberry32) so the server AND the client reconstruct an
// identical floor from the same seed.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// PHASE-0 STUB: one open bordered room with a center entrance and far-corner
// stairs. Stream D (M4) replaces this body with seeded BSP+cave generation,
// real themes, and a BFS reachability + timer-feasibility guarantee. The
// SIGNATURE here is the frozen contract — keep it.
export function generateFloor(seed: number, depth: number): FloorDescriptor {
  const r = rng(seed + depth * 1013);
  const cell = 80;
  const gw = Math.floor(WORLD.w / cell);
  const gh = Math.floor(WORLD.h / cell);
  const solid = new Uint8Array(gw * gh);
  for (let x = 0; x < gw; x++) {
    solid[x] = 1;
    solid[(gh - 1) * gw + x] = 1;
  }
  for (let y = 0; y < gh; y++) {
    solid[y * gw] = 1;
    solid[y * gw + gw - 1] = 1;
  }
  const collision: CollisionGrid = { w: gw, h: gh, cell, solid };

  const theme = THEMES[Math.floor(r() * THEMES.length)];
  const entrance = { x: WORLD.w / 2, y: WORLD.h / 2 };
  const stairs = { x: WORLD.w - 240, y: WORLD.h - 240, r: 60 };

  const spawns: FloorDescriptor["spawns"] = [];
  const n = 6 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    spawns.push({ x: 200 + r() * (WORLD.w - 400), y: 200 + r() * (WORLD.h - 400), kind: "grunt" });
  }
  const chests = [{ x: 400 + r() * 200, y: 400 + r() * 200 }];

  return {
    index: depth,
    seed,
    depth,
    theme,
    w: WORLD.w,
    h: WORLD.h,
    durationMs: 240000,
    collision,
    entrance,
    stairs,
    spawns,
    chests,
  };
}
