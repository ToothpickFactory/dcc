import type { MonsterKind, Theme } from "../shared/types";
import type { CollisionGrid, FloorDescriptor } from "./types";

const THEMES: Theme[] = ["fantasy", "cyberpunk", "forest", "pirate", "clockwork", "nightmare"];

const CELL = 80; // px per grid cell
const BASE_GRID = 38; // floor-1 grid size (cells)
const GROW_PER_DEPTH = 6; // levels grow with depth (huge later floors)
const MAX_GRID = 96; // cap so generation/render stays cheap (~7700px across)
const PLAYER_TRAVEL = 230; // px/s — mirrors PLAYER_SPEED; used to size the floor timer

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

// Seed-deterministic floor. Grows with depth, and each floor's "openness" varies
// the tightness — some are roomy/open, some are tighter mazes. Connectivity is
// guaranteed: a maze backbone, then operations that only ADD cells adjacent to
// the connected open set (dilation, rooms centered on open cells), so every open
// tile stays reachable (asserted by the procgen test across 100 seeds).
export function generateFloor(seed: number, depth: number): FloorDescriptor {
  const random = rng(seed + depth * 1013);
  const cell = CELL;
  const size = nearestOdd(Math.min(MAX_GRID, BASE_GRID + depth * GROW_PER_DEPTH), MAX_GRID);
  const gw = size;
  const gh = size;
  const solid = new Uint8Array(gw * gh).fill(1);
  const start = { x: nearestOdd(Math.floor(gw / 2), gw), y: nearestOdd(Math.floor(gh / 2), gh) };

  // Per-floor character: 0.2 = tight maze, 0.95 = wide open with big rooms.
  const openness = 0.2 + random() * 0.75;

  carveConnectedMaze(solid, gw, gh, start.x, start.y, random);
  widen(solid, gw, gh, random, openness); // fatten corridors — preserves connectivity
  addLoops(solid, gw, gh, random, Math.floor(gw * gh * 0.03 * openness));
  const roomCenters = carveRooms(solid, gw, gh, random, openness, depth);

  carveRect(solid, gw, gh, start.x, start.y, 2, 2); // entrance room
  const farthest = farthestOpenCell(solid, gw, gh, start.x, start.y);
  carveRect(solid, gw, gh, farthest.x, farthest.y, 2, 2); // stairs room

  const collision: CollisionGrid = { w: gw, h: gh, cell, solid };
  const entrance = cellCenter(start.x, start.y, cell);
  const stairs = { ...cellCenter(farthest.x, farthest.y, cell), r: 60 };

  // Boss room: the room farthest from the entrance (a place to find the boss).
  let bossCell: { x: number; y: number } = farthest;
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

  // Chests + decorations on open cells away from the entrance.
  const open = openCells(solid, gw, gh).filter((p) => manhattan(p.x, p.y, start.x, start.y) > 4);
  shuffle(open, random);
  const chests = open.slice(0, 2 + Math.floor(random() * 2)).map((p) => cellCenter(p.x, p.y, cell));
  const decorations = open.slice(4, 4 + 18 + Math.floor(openness * 22)).map((p) => ({
    ...cellCenter(p.x, p.y, cell),
    variant: 1 + Math.floor(random() * 15), // variant 0 reserved for the stairs sprite
    scale: 0.75 + random() * 0.45,
  }));

  const theme = THEMES[Math.floor(random() * THEMES.length)]!;
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
    durationMs:
      depth <= 1
        ? 300000
        : Math.max(Math.round(((gw * cell) / PLAYER_TRAVEL) * 1000 * 5), Math.ceil((pathCells * cell * 1.7 * 1000) / PLAYER_TRAVEL)),
    collision,
    entrance,
    stairs,
    bossRoom,
    spawns,
    chests,
    decorations,
  };
}

// ---- geometry ----

function carveConnectedMaze(solid: Uint8Array, w: number, h: number, startX: number, startY: number, random: () => number): void {
  const stack = [{ x: startX, y: startY }];
  solid[startY * w + startX] = 0;
  const directions = [
    { x: 2, y: 0 },
    { x: -2, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: -2 },
  ];
  while (stack.length > 0) {
    const current = stack[stack.length - 1]!;
    const choices = directions.filter(({ x, y }) => {
      const nx = current.x + x;
      const ny = current.y + y;
      return nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && solid[ny * w + nx] === 1;
    });
    if (choices.length === 0) {
      stack.pop();
      continue;
    }
    const direction = choices[Math.floor(random() * choices.length)]!;
    const nx = current.x + direction.x;
    const ny = current.y + direction.y;
    solid[(current.y + direction.y / 2) * w + current.x + direction.x / 2] = 0;
    solid[ny * w + nx] = 0;
    stack.push({ x: nx, y: ny });
  }
}

// Dilation: open solid cells that touch the open set, with probability scaled by
// openness. Only opens cells ADJACENT to existing open cells, so the connected
// region just grows — corridors widen and open patches form, never disconnect.
function widen(solid: Uint8Array, w: number, h: number, random: () => number, openness: number): void {
  // Tight floors keep their bare 1-wide maze corridors (no dilation); only roomier
  // floors fatten out, so the per-floor character actually varies (some claustro-
  // phobic, some open arenas) instead of every floor reading the same.
  if (openness < 0.4) return;
  const passes = openness > 0.7 ? 2 : 1;
  const p = (openness - 0.3) * 0.7;
  for (let pass = 0; pass < passes; pass++) {
    const toOpen: number[] = [];
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

// Carve rooms centered on existing open cells (so they're always connected).
function carveRooms(solid: Uint8Array, w: number, h: number, random: () => number, openness: number, depth: number): { x: number; y: number }[] {
  const centers: { x: number; y: number }[] = [];
  const open = openCells(solid, w, h);
  if (open.length === 0) return centers;
  const roomCount = Math.floor(3 + openness * 9 + depth * 0.4);
  for (let r = 0; r < roomCount; r++) {
    const c = open[Math.floor(random() * open.length)]!;
    const rw = 2 + Math.floor(random() * (2 + openness * 4));
    const rh = 2 + Math.floor(random() * (2 + openness * 4));
    carveRect(solid, w, h, c.x, c.y, rw, rh);
    centers.push({ x: c.x, y: c.y });
  }
  return centers;
}

function carveRect(solid: Uint8Array, w: number, h: number, cx: number, cy: number, rw: number, rh: number): void {
  for (let y = Math.max(1, cy - rh); y <= Math.min(h - 2, cy + rh); y++) {
    for (let x = Math.max(1, cx - rw); x <= Math.min(w - 2, cx + rw); x++) {
      solid[y * w + x] = 0;
    }
  }
}

function addLoops(solid: Uint8Array, w: number, h: number, random: () => number, count: number): void {
  for (let i = 0; i < count; i++) {
    const x = 1 + Math.floor(random() * (w - 2));
    const y = 1 + Math.floor(random() * (h - 2));
    if (solid[y * w + x] === 0) continue;
    const horizontal = solid[y * w + x - 1] === 0 && solid[y * w + x + 1] === 0;
    const vertical = solid[(y - 1) * w + x] === 0 && solid[(y + 1) * w + x] === 0;
    if (horizontal || vertical) solid[y * w + x] = 0;
  }
}

// ---- spawns: camps (clusters) + scattered singles ----

const MELEE_KINDS: MonsterKind[] = ["grunt", "brute", "swarm"];
const ALL_KINDS: MonsterKind[] = ["grunt", "brute", "swarm", "ranged"];

function generateSpawns(
  solid: Uint8Array,
  w: number,
  h: number,
  cell: number,
  random: () => number,
  roomCenters: { x: number; y: number }[],
  start: { x: number; y: number },
  farthest: { x: number; y: number },
  depth: number,
  openness: number,
): FloorDescriptor["spawns"] {
  const spawns: FloorDescriptor["spawns"] = [];
  const farFromStart = (p: { x: number; y: number }) => manhattan(p.x, p.y, start.x, start.y) > 7;

  // CAMPS: clusters of mixed kinds (melee + ranged + a healer) around far rooms.
  const rooms = roomCenters.filter(farFromStart).filter((r) => manhattan(r.x, r.y, farthest.x, farthest.y) > 3);
  shuffle(rooms, random);
  const campCount = Math.min(rooms.length, 2 + Math.floor(depth * 0.5));
  for (let i = 0; i < campCount; i++) {
    placeCamp(spawns, solid, w, h, cell, random, rooms[i]!, depth);
  }

  // SINGLES: lone wanderers scattered across the floor (the classic feel).
  const loose = openCells(solid, w, h).filter(farFromStart);
  shuffle(loose, random);
  const singleCount = Math.min(loose.length, 3 + depth);
  for (let i = 0; i < singleCount; i++) {
    const p = loose[i]!;
    spawns.push({ ...cellCenter(p.x, p.y, cell), kind: ALL_KINDS[Math.floor(random() * ALL_KINDS.length)]! });
  }
  return spawns;
}

// A camp: a couple of melee, a ranged or two, and (often) a healer — clustered.
function placeCamp(
  spawns: FloorDescriptor["spawns"],
  solid: Uint8Array,
  w: number,
  h: number,
  cell: number,
  random: () => number,
  center: { x: number; y: number },
  depth: number,
): void {
  const n = 3 + Math.floor(random() * 3); // 3..5
  const roster: MonsterKind[] = [];
  if (random() < 0.7) roster.push("healer"); // most camps have a medic
  roster.push("ranged");
  while (roster.length < n) roster.push(MELEE_KINDS[Math.floor(random() * MELEE_KINDS.length)]!);
  for (const kind of roster) {
    const c = openCellNear(solid, w, h, center, 3, random);
    if (c) spawns.push({ ...cellCenter(c.x, c.y, cell), kind });
  }
}

function openCellNear(solid: Uint8Array, w: number, h: number, center: { x: number; y: number }, radius: number, random: () => number): { x: number; y: number } | null {
  for (let tries = 0; tries < 24; tries++) {
    const x = center.x + Math.floor((random() * 2 - 1) * radius);
    const y = center.y + Math.floor((random() * 2 - 1) * radius);
    if (x > 0 && y > 0 && x < w - 1 && y < h - 1 && solid[y * w + x] === 0) return { x, y };
  }
  return solid[center.y * w + center.x] === 0 ? center : null;
}

// ---- helpers ----

function farthestOpenCell(solid: Uint8Array, w: number, h: number, startX: number, startY: number): { x: number; y: number; distance: number } {
  const distances = new Int32Array(w * h).fill(-1);
  const queue = [{ x: startX, y: startY }];
  distances[startY * w + startX] = 0;
  let head = 0;
  let farthest = { x: startX, y: startY, distance: 0 };
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  while (head < queue.length) {
    const current = queue[head++]!;
    const distance = distances[current.y * w + current.x]!;
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

function openCells(solid: Uint8Array, w: number, h: number): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (solid[y * w + x] === 0) result.push({ x, y });
    }
  }
  return result;
}

function nearestOdd(value: number, limit: number): number {
  const odd = value % 2 === 1 ? value : value - 1;
  return Math.max(1, Math.min(limit - 2, odd));
}

function cellCenter(x: number, y: number, cell: number): { x: number; y: number } {
  return { x: (x + 0.5) * cell, y: (y + 0.5) * cell };
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function shuffle<T>(items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
}
