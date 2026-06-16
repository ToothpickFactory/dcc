// src/procgen/index.test.ts
import assert from "node:assert/strict";

// src/shared/constants.ts
var INPUT_HZ = 10;
var INPUT_MS = 1e3 / INPUT_HZ;
var PLAYER_RADIUS = 17;
var MONSTER_KINDS = {
  grunt: { hp: 60, speed: 95, dmg: 6, attackCd: 1200, meleeRange: 56, radius: 20 },
  brute: { hp: 150, speed: 58, dmg: 16, attackCd: 1500, meleeRange: 74, radius: 28 },
  // slow tank, big hits
  swarm: { hp: 24, speed: 158, dmg: 4, attackCd: 700, meleeRange: 42, radius: 13 },
  // fast, fragile, weak
  ranged: { hp: 42, speed: 86, dmg: 0, attackCd: 1500, meleeRange: 0, radius: 18, ranged: { shootRange: 470, kite: 280, projSpeed: 360, projDmg: 9 } },
  healer: { hp: 50, speed: 92, dmg: 0, attackCd: 1500, meleeRange: 0, radius: 18, heal: { amount: 14, cd: 1400, range: 320, kite: 240 } }
  // mends its camp
};
var BOSS_POWER_MULT = 1.5;
var BOSS_MAX_HP = Math.round(MONSTER_KINDS.grunt.hp * BOSS_POWER_MULT);
var BOSS_SPEED = MONSTER_KINDS.grunt.speed;
var BOSS_MELEE_DMG = Math.round(MONSTER_KINDS.grunt.dmg * BOSS_POWER_MULT);
var BOSS_PROJ_DMG = Math.round((MONSTER_KINDS.ranged.ranged?.projDmg ?? MONSTER_KINDS.grunt.dmg) * BOSS_POWER_MULT);

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
var CELL = 80;
var BASE_GRID = 38;
var GROW_PER_DEPTH = 6;
var MAX_GRID = 96;
var PLAYER_TRAVEL = 230;
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
  const cell = CELL;
  const size = nearestOdd(Math.min(MAX_GRID, BASE_GRID + depth * GROW_PER_DEPTH), MAX_GRID);
  const gw = size;
  const gh = size;
  const solid = new Uint8Array(gw * gh).fill(1);
  const start = { x: nearestOdd(Math.floor(gw / 2), gw), y: nearestOdd(Math.floor(gh / 2), gh) };
  const openness = 0.2 + random() * 0.75;
  carveConnectedMaze(solid, gw, gh, start.x, start.y, random);
  widen(solid, gw, gh, random, openness);
  addLoops(solid, gw, gh, random, Math.floor(gw * gh * 0.03 * openness));
  const roomCenters = carveRooms(solid, gw, gh, random, openness, depth);
  carveRect(solid, gw, gh, start.x, start.y, 2, 2);
  const farthest = farthestOpenCell(solid, gw, gh, start.x, start.y);
  carveRect(solid, gw, gh, farthest.x, farthest.y, 2, 2);
  const collision = { w: gw, h: gh, cell, solid };
  const entrance = cellCenter(start.x, start.y, cell);
  const stairs = { ...cellCenter(farthest.x, farthest.y, cell), r: 60 };
  let bossCell = farthest;
  let bossDist = -1;
  for (const c of roomCenters) {
    const d = manhattan(c.x, c.y, start.x, start.y);
    if (d > bossDist && manhattan(c.x, c.y, farthest.x, farthest.y) > 4) {
      bossDist = d;
      bossCell = c;
    }
  }
  const bossRoom = cellCenter(bossCell.x, bossCell.y, cell);
  const spawns = generateSpawns(solid, gw, gh, cell, random, roomCenters, start, farthest, depth, openness);
  const open = openCells(solid, gw, gh).filter((p) => manhattan(p.x, p.y, start.x, start.y) > 4);
  shuffle(open, random);
  const chests = open.slice(0, 2 + Math.floor(random() * 2)).map((p) => cellCenter(p.x, p.y, cell));
  const decorations = open.slice(4, 4 + 18 + Math.floor(openness * 22)).map((p) => ({
    ...cellCenter(p.x, p.y, cell),
    variant: 1 + Math.floor(random() * 15),
    // variant 0 reserved for the stairs sprite
    scale: 0.75 + random() * 0.45
  }));
  const theme = THEMES[Math.floor(random() * THEMES.length)];
  const pathCells = farthest.distance + 1;
  return {
    index: depth,
    seed,
    depth,
    theme,
    w: gw * cell,
    h: gh * cell,
    // Floor 1 gets a generous 5 min to learn. Later floors scale the timer with
    // BOTH the journey to the stairs and the sheer size of the floor (a huge open
    // arena still needs time to cross + clear camps), so the floor minimum grows
    // with the grid rather than sitting at a flat 90s.
    durationMs: depth <= 1 ? 3e5 : Math.max(Math.round(gw * cell / PLAYER_TRAVEL * 1e3 * 5), Math.ceil(pathCells * cell * 1.7 * 1e3 / PLAYER_TRAVEL)),
    collision,
    entrance,
    stairs,
    bossRoom,
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
function widen(solid, w, h, random, openness) {
  if (openness < 0.4) return;
  const passes = openness > 0.7 ? 2 : 1;
  const p = (openness - 0.3) * 0.7;
  for (let pass = 0; pass < passes; pass++) {
    const toOpen = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (solid[i] === 0) continue;
        const adj = (solid[i - 1] === 0 ? 1 : 0) + (solid[i + 1] === 0 ? 1 : 0) + (solid[i - w] === 0 ? 1 : 0) + (solid[i + w] === 0 ? 1 : 0);
        if (adj > 0 && random() < p) toOpen.push(i);
      }
    }
    for (const i of toOpen) solid[i] = 0;
  }
}
function carveRooms(solid, w, h, random, openness, depth) {
  const centers = [];
  const open = openCells(solid, w, h);
  if (open.length === 0) return centers;
  const roomCount = Math.floor(3 + openness * 9 + depth * 0.4);
  for (let r = 0; r < roomCount; r++) {
    const c = open[Math.floor(random() * open.length)];
    const rw = 2 + Math.floor(random() * (2 + openness * 4));
    const rh = 2 + Math.floor(random() * (2 + openness * 4));
    carveRect(solid, w, h, c.x, c.y, rw, rh);
    centers.push({ x: c.x, y: c.y });
  }
  return centers;
}
function carveRect(solid, w, h, cx, cy, rw, rh) {
  for (let y = Math.max(1, cy - rh); y <= Math.min(h - 2, cy + rh); y++) {
    for (let x = Math.max(1, cx - rw); x <= Math.min(w - 2, cx + rw); x++) {
      solid[y * w + x] = 0;
    }
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
var MELEE_KINDS = ["grunt", "brute", "swarm"];
var ALL_KINDS = ["grunt", "brute", "swarm", "ranged"];
function generateSpawns(solid, w, h, cell, random, roomCenters, start, farthest, depth, openness) {
  const spawns = [];
  const farFromStart = (p) => manhattan(p.x, p.y, start.x, start.y) > 7;
  const rooms = roomCenters.filter(farFromStart).filter((r) => manhattan(r.x, r.y, farthest.x, farthest.y) > 3);
  shuffle(rooms, random);
  const campCount = Math.min(rooms.length, 2 + Math.floor(depth * 0.5));
  for (let i = 0; i < campCount; i++) {
    placeCamp(spawns, solid, w, h, cell, random, rooms[i], depth);
  }
  const loose = openCells(solid, w, h).filter(farFromStart);
  shuffle(loose, random);
  const singleCount = Math.min(loose.length, 3 + depth);
  for (let i = 0; i < singleCount; i++) {
    const p = loose[i];
    spawns.push({ ...cellCenter(p.x, p.y, cell), kind: ALL_KINDS[Math.floor(random() * ALL_KINDS.length)] });
  }
  return spawns;
}
function placeCamp(spawns, solid, w, h, cell, random, center, depth) {
  const n = 3 + Math.floor(random() * 3);
  const roster = [];
  if (random() < 0.7) roster.push("healer");
  roster.push("ranged");
  while (roster.length < n) roster.push(MELEE_KINDS[Math.floor(random() * MELEE_KINDS.length)]);
  for (const kind of roster) {
    const c = openCellNear(solid, w, h, center, 3, random);
    if (c) spawns.push({ ...cellCenter(c.x, c.y, cell), kind });
  }
}
function openCellNear(solid, w, h, center, radius, random) {
  for (let tries = 0; tries < 24; tries++) {
    const x = center.x + Math.floor((random() * 2 - 1) * radius);
    const y = center.y + Math.floor((random() * 2 - 1) * radius);
    if (x > 0 && y > 0 && x < w - 1 && y < h - 1 && solid[y * w + x] === 0) return { x, y };
  }
  return solid[center.y * w + center.x] === 0 ? center : null;
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
