// src/procgen/index.test.ts
import assert from "node:assert/strict";

// src/shared/constants.ts
var INPUT_HZ = 10;
var INPUT_MS = 1e3 / INPUT_HZ;
var WORLD = { w: 2400, h: 2400 };
var PLAYER_RADIUS = 17;

// src/procgen/collision.ts
function canOccupy(grid, x, y, radius) {
  const minX = Math.floor((x - radius) / grid.cell);
  const maxX = Math.floor((x + radius) / grid.cell);
  const minY = Math.floor((y - radius) / grid.cell);
  const maxY = Math.floor((y + radius) / grid.cell);
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      if (cx < 0 || cy < 0 || cx >= grid.w || cy >= grid.h) return false;
      if (grid.solid[cy * grid.w + cx] !== 1) continue;
      const left = cx * grid.cell;
      const top = cy * grid.cell;
      const nearestX = clamp(x, left, left + grid.cell);
      const nearestY = clamp(y, top, top + grid.cell);
      const dx = x - nearestX;
      const dy = y - nearestY;
      if (dx * dx + dy * dy < radius * radius) return false;
    }
  }
  return true;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// src/procgen/index.ts
var THEMES = ["fantasy", "cyberpunk", "forest", "pirate", "clockwork", "nightmare"];
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function generateFloor(seed, depth) {
  const random = rng(seed + depth * 1013);
  const cell = 80;
  const gw = Math.floor(WORLD.w / cell);
  const gh = Math.floor(WORLD.h / cell);
  const solid = new Uint8Array(gw * gh).fill(1);
  const start = {
    x: nearestOdd(Math.floor(gw / 2), gw),
    y: nearestOdd(Math.floor(gh / 2), gh)
  };
  carveConnectedMaze(solid, gw, gh, start.x, start.y, random);
  addLoops(solid, gw, gh, random, Math.floor(gw * gh * 0.08));
  carveRoom(solid, gw, gh, start.x, start.y, 2);
  const farthest = farthestOpenCell(solid, gw, gh, start.x, start.y);
  carveRoom(solid, gw, gh, farthest.x, farthest.y, 1);
  const collision = { w: gw, h: gh, cell, solid };
  const entrance = cellCenter(start.x, start.y, cell);
  const stairs = { ...cellCenter(farthest.x, farthest.y, cell), r: 48 };
  const candidates = openCells(solid, gw, gh).filter(
    (p) => manhattan(p.x, p.y, start.x, start.y) > 5 && manhattan(p.x, p.y, farthest.x, farthest.y) > 3
  );
  shuffle(candidates, random);
  const kinds = ["grunt", "brute", "swarm", "ranged"];
  const spawns = [];
  const spawnCount = Math.min(candidates.length, 8 + Math.min(8, depth));
  for (let i = 0; i < spawnCount; i++) {
    const p = candidates[i];
    spawns.push({ ...cellCenter(p.x, p.y, cell), kind: kinds[Math.floor(random() * kinds.length)] });
  }
  const chests = candidates.slice(spawnCount, spawnCount + 2).map((p) => cellCenter(p.x, p.y, cell));
  const pathCells = farthest.distance + 1;
  const theme = THEMES[Math.floor(random() * THEMES.length)];
  const decorationCells = candidates.slice(spawnCount + 2, spawnCount + 26);
  const decorations = decorationCells.map((p) => ({
    ...cellCenter(p.x, p.y, cell),
    // Variant 0 is reserved for the themed stairs sprite in the prop sheet.
    variant: 1 + Math.floor(random() * 15),
    scale: 0.75 + random() * 0.45
  }));
  return {
    index: depth,
    seed,
    depth,
    theme,
    w: WORLD.w,
    h: WORLD.h,
    // Per-floor lethal timer — reach the stairs before it expires (decision #2).
    // Stream D (M4 gen) will set real, per-floor, theme-driven durations; until
    // then floor 1 gets a generous 5 min to learn the ropes. Later floors have
    // at least 60s and scale up when the generated stairs path requires it.
    durationMs: depth <= 1 ? 3e5 : Math.max(6e4, Math.ceil(pathCells * cell * 1.8 * 1e3 / 230)),
    collision,
    entrance,
    stairs,
    spawns,
    chests,
    decorations
  };
}
function carveConnectedMaze(solid, w, h, startX, startY, random) {
  const stack = [{ x: startX, y: startY }];
  solid[startY * w + startX] = 0;
  const directions = [
    { x: 2, y: 0 },
    { x: -2, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: -2 }
  ];
  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const choices = directions.filter(({ x, y }) => {
      const nx2 = current.x + x;
      const ny2 = current.y + y;
      return nx2 > 0 && ny2 > 0 && nx2 < w - 1 && ny2 < h - 1 && solid[ny2 * w + nx2] === 1;
    });
    if (choices.length === 0) {
      stack.pop();
      continue;
    }
    const direction = choices[Math.floor(random() * choices.length)];
    const nx = current.x + direction.x;
    const ny = current.y + direction.y;
    solid[(current.y + direction.y / 2) * w + current.x + direction.x / 2] = 0;
    solid[ny * w + nx] = 0;
    stack.push({ x: nx, y: ny });
  }
}
function addLoops(solid, w, h, random, count) {
  for (let i = 0; i < count; i++) {
    const x = 1 + Math.floor(random() * (w - 2));
    const y = 1 + Math.floor(random() * (h - 2));
    if (solid[y * w + x] === 0) continue;
    const horizontal = solid[y * w + x - 1] === 0 && solid[y * w + x + 1] === 0;
    const vertical = solid[(y - 1) * w + x] === 0 && solid[(y + 1) * w + x] === 0;
    if (horizontal || vertical) solid[y * w + x] = 0;
  }
}
function carveRoom(solid, w, h, cx, cy, radius) {
  for (let y = Math.max(1, cy - radius); y <= Math.min(h - 2, cy + radius); y++) {
    for (let x = Math.max(1, cx - radius); x <= Math.min(w - 2, cx + radius); x++) {
      solid[y * w + x] = 0;
    }
  }
}
function farthestOpenCell(solid, w, h, startX, startY) {
  const distances = new Int32Array(w * h).fill(-1);
  const queue = [{ x: startX, y: startY }];
  distances[startY * w + startX] = 0;
  let head = 0;
  let farthest = { x: startX, y: startY, distance: 0 };
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];
  while (head < queue.length) {
    const current = queue[head++];
    const distance = distances[current.y * w + current.x];
    if (distance > farthest.distance) farthest = { ...current, distance };
    for (const direction of directions) {
      const x = current.x + direction.x;
      const y = current.y + direction.y;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const index = y * w + x;
      if (solid[index] === 1 || distances[index] !== -1) continue;
      distances[index] = distance + 1;
      queue.push({ x, y });
    }
  }
  return farthest;
}
function openCells(solid, w, h) {
  const result = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (solid[y * w + x] === 0) result.push({ x, y });
    }
  }
  return result;
}
function nearestOdd(value, limit) {
  const odd = value % 2 === 1 ? value : value - 1;
  return Math.max(1, Math.min(limit - 2, odd));
}
function cellCenter(x, y, cell) {
  return { x: (x + 0.5) * cell, y: (y + 0.5) * cell };
}
function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}
function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

// src/procgen/index.test.ts
for (let seed = 1; seed <= 100; seed++) {
  const floor = generateFloor(seed, 1 + seed % 20);
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
function flood(solid, w, h, startX, startY) {
  const seen = /* @__PURE__ */ new Set();
  const queue = [{ x: startX, y: startY }];
  seen.add(startY * w + startX);
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
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
