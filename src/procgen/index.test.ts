import assert from "node:assert/strict";
import { PLAYER_RADIUS, WALKABLE_DELTA } from "../shared/constants.ts";
import { canOccupy, canStep } from "./collision.ts";
import type { CollisionGrid } from "./types.ts";
import { generateFloor } from "./index.ts";

// Step-up gate golden vector — the SAME 4x3 ground fixture + point pairs asserted in
// godot/test/geo_test.gd, so TS canStep and GDScript Geo.can_step are proven bit-identical
// (the parity guard against cliff-edge rubber-band). WALKABLE_DELTA = 24.
{
  const CELL = 80;
  const cc = (c: number) => (c + 0.5) * CELL;
  const gold: CollisionGrid = {
    w: 4,
    h: 3,
    cell: CELL,
    solid: new Uint8Array(12),
    ground: Int16Array.from([0, 16, -16, 100, 50, 0, -100, 24, -7, 200, -32768, 32767]),
  };
  assert.equal(canStep(gold, cc(0), cc(0), cc(1), cc(0)), true, "|0-16|=16 <= 24");
  assert.equal(canStep(gold, cc(1), cc(0), cc(2), cc(0)), false, "|16-(-16)|=32 > 24");
  assert.equal(canStep(gold, cc(1), cc(1), cc(3), cc(1)), true, "|0-24|=24 == 24 inclusive");
  assert.equal(canStep(gold, cc(3), cc(1), cc(3), cc(0)), false, "|24-100|=76 > 24");
  assert.equal(canStep(gold, cc(2), cc(2), cc(3), cc(2)), false, "Int16 extremes -> huge");
}

{
  const normal = generateFloor(4242, 4);
  const pvp = generateFloor(4242, 4, { pvp: true });
  assert.equal(pvp.pvp, true);
  const areaRatio = (pvp.collision.w * pvp.collision.h) / (normal.collision.w * normal.collision.h);
  assert.ok(areaRatio > 0.22 && areaRatio < 0.28, `PvP area ratio ${areaRatio} should be about 25%`);
}

for (let seed = 1; seed <= 100; seed++) {
  const floor = generateFloor(seed, 1 + (seed % 20));
  const grid = floor.collision;
  const startX = Math.floor(floor.entrance.x / grid.cell);
  const startY = Math.floor(floor.entrance.y / grid.cell);
  const stairsX = Math.floor(floor.stairs.x / grid.cell);
  const stairsY = Math.floor(floor.stairs.y / grid.cell);
  const reachable = flood(grid.solid, grid.w, grid.h, startX, startY);

  for (let i = 0; i < grid.solid.length; i++) {
    if (grid.solid[i] === 0) assert.equal(reachable.has(i), true, `seed ${seed} has a disconnected tile`);
  }
  assert.equal(reachable.has(stairsY * grid.w + stairsX), true, `seed ${seed} stairs are unreachable`);
  assert.equal(canOccupy(grid, floor.entrance.x, floor.entrance.y, PLAYER_RADIUS), true);
  assert.equal(canOccupy(grid, floor.stairs.x, floor.stairs.y, PLAYER_RADIUS), true);
  for (const spawn of floor.spawns) assert.equal(canOccupy(grid, spawn.x, spawn.y, 28), true);
  for (const decoration of floor.decorations) assert.equal(canOccupy(grid, decoration.x, decoration.y, 12), true);
  for (const hazard of floor.hazards) assert.equal(canOccupy(grid, hazard.x, hazard.y, 12), true);
  assert.ok(floor.portals.length <= 4, `seed ${seed} has too many portals`);
  const portals = new Map(floor.portals.map((p) => [p.id, p]));
  for (const portal of floor.portals) {
    assert.equal(canOccupy(grid, portal.x, portal.y, 12), true);
    const pair = portals.get(portal.pair);
    assert.ok(pair, `seed ${seed} portal ${portal.id} has no pair`);
    assert.equal(pair?.pair, portal.id, `seed ${seed} portal ${portal.id} pair is not reciprocal`);
  }

  // ---- heightfield 2.5D invariants ----
  const g = grid.ground;
  assert.equal(g.length, grid.solid.length, `seed ${seed} ground array wrong size`);

  // (a) Height-aware reachability is THE connectivity guarantee: flooding only across walkable
  //     (<=WALKABLE_DELTA) open edges must still reach EVERY open cell + the stairs. Gentle base
  //     slopes are crossable; plateau cliff faces are not, but their ramp keeps the top reachable —
  //     the procgen verify-and-rollback guarantees no plateau ever severs the floor. This is exactly
  //     the walkable graph the v2 step-up gate enforces, so if this holds the gate can never trap.
  const hReach = heightFlood(grid.solid, g, grid.w, grid.h, startX, startY, WALKABLE_DELTA);
  for (let i = 0; i < grid.solid.length; i++) {
    if (grid.solid[i] === 0) assert.equal(hReach.has(i), true, `seed ${seed} tile unreachable across walkable slopes`);
  }
  assert.equal(hReach.has(stairsY * grid.w + stairsX), true, `seed ${seed} stairs unreachable across walkable slopes`);

  // (c) Flat landings: the OPEN cells of the 3x3 around entrance + stairs are level (safe spawn /
  //     exit). Wall cells in the 3x3 keep their own terrain height — they aren't walkable.
  assertFlat3x3(g, grid.solid, grid.w, grid.h, startX, startY, `seed ${seed} entrance`);
  assertFlat3x3(g, grid.solid, grid.w, grid.h, stairsX, stairsY, `seed ${seed} stairs`);
}

console.log("procgen connectivity + heightfield: 100 seeds passed");

function assertFlat3x3(ground: Int16Array, solid: Uint8Array, w: number, h: number, cx: number, cy: number, label: string): void {
  const center = ground[cy * w + cx]!;
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (solid[y * w + x] !== 0) continue; // walls keep their terrain height
      assert.equal(ground[y * w + x], center, `${label} landing is not flat at (${x},${y})`);
    }
  }
}

function heightFlood(solid: Uint8Array, ground: Int16Array, w: number, h: number, startX: number, startY: number, cap: number): Set<number> {
  const seen = new Set<number>();
  const queue = [{ x: startX, y: startY }];
  seen.add(startY * w + startX);
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++]!;
    const ci = current.y * w + current.x;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const x = current.x + dx;
      const y = current.y + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const index = y * w + x;
      if (solid[index] === 1 || seen.has(index)) continue;
      if (Math.abs(ground[ci]! - ground[index]!) > cap) continue; // too steep to walk
      seen.add(index);
      queue.push({ x, y });
    }
  }
  return seen;
}

function flood(solid: Uint8Array, w: number, h: number, startX: number, startY: number): Set<number> {
  const seen = new Set<number>();
  const queue = [{ x: startX, y: startY }];
  seen.add(startY * w + startX);
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++]!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const x = current.x + dx;
      const y = current.y + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const index = y * w + x;
      if (solid[index] === 1 || seen.has(index)) continue;
      seen.add(index);
      queue.push({ x, y });
    }
  }
  return seen;
}
