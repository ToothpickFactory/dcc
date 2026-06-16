import assert from "node:assert/strict";
import { PLAYER_RADIUS } from "../shared/constants.ts";
import { canOccupy } from "./collision.ts";
import { generateFloor } from "./index.ts";

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
}

console.log("procgen connectivity: 100 seeds passed");

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
