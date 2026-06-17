import type { MonsterKind, Theme } from "../shared/types";
import type { CollisionGrid, FloorDescriptor } from "./types";
import { PREFABS, stampPrefab, type PrefabAnchor } from "./prefabs";

const THEMES: Theme[] = ["fantasy", "cyberpunk", "forest", "pirate", "clockwork", "nightmare"];

const CELL = 80; // px per grid cell
const BASE_GRID = 38; // floor-1 grid size (cells)
const GROW_PER_DEPTH = 6; // levels grow with depth (huge later floors)
const MAX_GRID = 96; // cap so generation/render stays cheap (~7700px across)

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

  // Per-floor character: 0.2 = tight maze, 0.95 = wide open with big rooms.
  const openness = 0.2 + random() * 0.75;

  // ~40% of floors are organic CAVES (cellular-automata caverns) instead of a rectilinear maze —
  // curvy, natural rock so descending doesn't read as the same grid every time.
  const isCave = random() < 0.4;
  let start: { x: number; y: number };
  let roomCenters: { x: number; y: number }[];
  if (isCave) {
    start = carveCave(solid, gw, gh, random);
    roomCenters = sampleOpenCenters(solid, gw, gh, random, depth, start);
  } else {
    start = { x: nearestOdd(Math.floor(gw / 2), gw), y: nearestOdd(Math.floor(gh / 2), gh) };
    carveConnectedMaze(solid, gw, gh, start.x, start.y, random);
    widen(solid, gw, gh, random, openness); // fatten corridors on roomier floors — preserves connectivity
    addLoops(solid, gw, gh, random, Math.floor(gw * gh * 0.03 * openness));
    roomCenters = carveRooms(solid, gw, gh, random, openness, depth);
  }

  // Stamp hand-authored set-piece rooms (the "designed, not generated" feel) — they read as ruins
  // inside a cavern too — then repair connectivity so any sealed-off region gets a doorway.
  const prefabAnchors = placePrefabs(solid, gw, gh, random, depth, start);

  carveRect(solid, gw, gh, start.x, start.y, 2, 2); // entrance room
  reconnect(solid, gw, gh, start); // guarantee every open cell (incl. prefabs) reaches the entrance
  const farthest = farthestOpenCell(solid, gw, gh, start.x, start.y);
  carveRect(solid, gw, gh, farthest.x, farthest.y, 2, 2); // stairs room

  // Render the maze at 2× cell resolution: every wall is preserved but corridors are
  // now 2 cells (≈160px) wide — wide CoN-style halls instead of 1-tile passages. The
  // grid scales; all px positions scale by SCALE too (a fine block's centre is exactly
  // 2× the logical cell centre), so speed/vision/attack ranges (all in px) are untouched.
  const SCALE = 2;
  const collision: CollisionGrid = { w: gw * SCALE, h: gh * SCALE, cell, solid: scaleGrid(solid, gw, gh, SCALE) };
  const sc = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: p.x * SCALE, y: p.y * SCALE });

  const entrance = sc(cellCenter(start.x, start.y, cell));
  const stairs = { ...sc(cellCenter(farthest.x, farthest.y, cell)), r: 60 * SCALE };

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
  const bossRoom = sc(cellCenter(bossCell.x, bossCell.y, cell));

  const spawns = generateSpawns(solid, gw, gh, cell, random, roomCenters, start, farthest, depth, openness).map(sc);

  // Chests + decorations on open cells away from the entrance.
  const open = openCells(solid, gw, gh).filter((p) => manhattan(p.x, p.y, start.x, start.y) > 4);
  shuffle(open, random);
  const chests = open.slice(0, 2 + Math.floor(random() * 2)).map((p) => sc(cellCenter(p.x, p.y, cell)));
  const scatterDecor = open.slice(4, 4 + 18 + Math.floor(openness * 22)).map((p) => sc({
    ...cellCenter(p.x, p.y, cell),
    variant: 1 + Math.floor(random() * 15), // variant 0 reserved for the stairs sprite
    scale: 0.75 + random() * 0.45,
  }));
  // Prefab anchors become set-dressing: landmarks (altars/statues) are big focal props; the rest
  // are normal scatter. Gives each set-piece room a "thing" at its heart.
  const prefabDecor = prefabAnchors.map((a) => sc({
    ...cellCenter(a.x, a.y, cell),
    variant: 1 + Math.floor(random() * 15),
    scale: a.landmark ? 1.8 + random() * 0.6 : 0.8 + random() * 0.4,
  }));
  const decorations = [...prefabDecor, ...scatterDecor];

  const theme = THEMES[Math.floor(random() * THEMES.length)]!;

  return {
    index: depth,
    seed,
    depth,
    theme,
    w: gw * cell * SCALE,
    h: gh * cell * SCALE,
    // TEMP: flat 10-minute timer on every floor (was: 5 min on floor 1, then scaled by
    // floor size / path length). Revert to the scaled formula when tuning difficulty.
    durationMs: 600000,
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

// Scale a logical solid grid up by an integer factor: each logical cell becomes an
// f×f block of fine cells with the same value. This keeps the maze TOPOLOGY (every
// wall preserved) but widens corridors to f cells across — the Champions-of-Norrath
// "wide halls between thick walls" feel, with zero change to px-based tuning (speed,
// vision, attack ranges all stay in px). World coordinates simply scale by f too.
function scaleGrid(solid: Uint8Array, w: number, h: number, f: number): Uint8Array {
  const fw = w * f;
  const out = new Uint8Array(fw * h * f);
  for (let y = 0; y < h * f; y++) {
    const sy = (y / f) | 0;
    for (let x = 0; x < fw; x++) {
      out[y * fw + x] = solid[sy * w + ((x / f) | 0)];
    }
  }
  return out;
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

// ---- organic caves (cellular automata) -------------------------------------

// Carve a natural cavern via cellular automata: random fill -> smooth -> keep the largest
// connected region. Returns a start cell near the centre of that region. Curvy/organic, the
// antidote to "every floor is a grid maze".
function carveCave(solid: Uint8Array, w: number, h: number, random: () => number): { x: number; y: number } {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      solid[y * w + x] = border || random() < 0.46 ? 1 : 0;
    }
  }
  const tmp = new Uint8Array(w * h);
  for (let it = 0; it < 5; it++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
          tmp[y * w + x] = 1;
          continue;
        }
        let walls = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (solid[(y + dy) * w + (x + dx)] === 1) walls++;
          }
        }
        tmp[y * w + x] = walls >= 5 ? 1 : 0; // the classic 4-5 cave rule
      }
    }
    solid.set(tmp);
  }
  return keepLargestRegion(solid, w, h);
}

// Keep only the largest connected open region (fill the rest solid) so the cavern is one piece,
// and return the open cell of that region nearest the grid centre (a good entrance).
function keepLargestRegion(solid: Uint8Array, w: number, h: number): { x: number; y: number } {
  const region = new Int32Array(w * h).fill(-1);
  let bestId = -1;
  let bestSize = 0;
  let id = 0;
  for (let i = 0; i < w * h; i++) {
    if (solid[i] !== 0 || region[i] !== -1) continue;
    const cells = [i];
    region[i] = id;
    let head = 0;
    while (head < cells.length) {
      const c = cells[head++]!;
      const x = c % w;
      const y = (c / w) | 0;
      const nb = [x + 1 < w ? c + 1 : -1, x - 1 >= 0 ? c - 1 : -1, y + 1 < h ? c + w : -1, y - 1 >= 0 ? c - w : -1];
      for (const j of nb) {
        if (j >= 0 && solid[j] === 0 && region[j] === -1) {
          region[j] = id;
          cells.push(j);
        }
      }
    }
    if (cells.length > bestSize) {
      bestSize = cells.length;
      bestId = id;
    }
    id++;
  }
  let sx = 1;
  let sy = 1;
  let bd = Infinity;
  const cx = w / 2;
  const cy = h / 2;
  for (let i = 0; i < w * h; i++) {
    if (solid[i] === 0 && region[i] !== bestId) solid[i] = 1; // fill non-largest pockets
    if (region[i] === bestId) {
      const x = i % w;
      const y = (i / w) | 0;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bd) {
        bd = d;
        sx = x;
        sy = y;
      }
    }
  }
  return { x: sx, y: sy };
}

// Pseudo "room centres" for a cave (drives camp/boss spawn placement): open cells far from start.
function sampleOpenCenters(solid: Uint8Array, w: number, h: number, random: () => number, depth: number, start: { x: number; y: number }): { x: number; y: number }[] {
  const open = openCells(solid, w, h).filter((p) => manhattan(p.x, p.y, start.x, start.y) > 6);
  shuffle(open, random);
  return open.slice(0, 4 + depth).map((p) => ({ x: p.x, y: p.y }));
}

// ---- prefab set-pieces + connectivity repair -------------------------------

// Stamp a handful of hand-authored rooms into the maze, avoiding the entrance + each other.
function placePrefabs(
  solid: Uint8Array,
  w: number,
  h: number,
  random: () => number,
  depth: number,
  start: { x: number; y: number },
): PrefabAnchor[] {
  const anchors: PrefabAnchor[] = [];
  const want = Math.min(6, 2 + Math.floor(depth / 2) + Math.floor(random() * 2));
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  let tries = 0;
  let n = 0;
  while (n < want && tries < 80) {
    tries++;
    const p = PREFABS[Math.floor(random() * PREFABS.length)]!;
    if (p.w + 2 >= w || p.h + 2 >= h) continue;
    const ox = 1 + Math.floor(random() * (w - p.w - 2));
    const oy = 1 + Math.floor(random() * (h - p.h - 2));
    // Keep the spawn area clear, and don't overlap another prefab (1-cell margin).
    if (Math.abs(ox + p.w / 2 - start.x) < 6 && Math.abs(oy + p.h / 2 - start.y) < 6) continue;
    if (placed.some((r) => ox < r.x + r.w + 1 && ox + p.w + 1 > r.x && oy < r.y + r.h + 1 && oy + p.h + 1 > r.y)) continue;
    const res = stampPrefab(solid, w, h, p, ox, oy);
    anchors.push(...res.anchors);
    placed.push({ x: ox, y: oy, w: p.w, h: p.h });
    n++;
  }
  return anchors;
}

// Guarantee every open cell reaches `start`: flood-fill from start; for any disconnected open
// region, carve the shortest tunnel back to the reached set. Only ADDS open cells. This is what
// lets prefabs stamp real walls (sealed vaults, severed corridors) without ever orphaning the map.
function reconnect(solid: Uint8Array, w: number, h: number, start: { x: number; y: number }): void {
  for (let guard = 0; guard < 64; guard++) {
    const reached = floodOpen(solid, w, h, start);
    let u = -1;
    for (let i = 0; i < w * h; i++) {
      if (solid[i] === 0 && !reached[i]) {
        u = i;
        break;
      }
    }
    if (u < 0) return; // fully connected
    carveTunnel(solid, w, h, u, reached);
  }
}

function floodOpen(solid: Uint8Array, w: number, h: number, start: { x: number; y: number }): Uint8Array {
  const reached = new Uint8Array(w * h);
  const s = start.y * w + start.x;
  if (solid[s] !== 0) return reached;
  reached[s] = 1;
  const q = [s];
  let head = 0;
  while (head < q.length) {
    const i = q[head++]!;
    const x = i % w;
    const y = (i / w) | 0;
    const nb = [x + 1 < w ? i + 1 : -1, x - 1 >= 0 ? i - 1 : -1, y + 1 < h ? i + w : -1, y - 1 >= 0 ? i - w : -1];
    for (const j of nb) {
      if (j >= 0 && solid[j] === 0 && !reached[j]) {
        reached[j] = 1;
        q.push(j);
      }
    }
  }
  return reached;
}

// BFS from `from` over ALL cells (walls passable) to the nearest reached open cell, then open the
// path — a 1-wide doorway/tunnel connecting `from`'s region to the connected set.
function carveTunnel(solid: Uint8Array, w: number, h: number, from: number, reached: Uint8Array): void {
  const prev = new Int32Array(w * h).fill(-1);
  const seen = new Uint8Array(w * h);
  seen[from] = 1;
  const q = [from];
  let head = 0;
  while (head < q.length) {
    const i = q[head++]!;
    if (reached[i]) {
      let c = i;
      while (c !== from) {
        solid[c] = 0;
        c = prev[c]!;
      }
      solid[from] = 0;
      return;
    }
    const x = i % w;
    const y = (i / w) | 0;
    const nb = [x + 1 < w - 1 ? i + 1 : -1, x - 1 >= 1 ? i - 1 : -1, y + 1 < h - 1 ? i + w : -1, y - 1 >= 1 ? i - w : -1];
    for (const j of nb) {
      if (j >= 0 && !seen[j]) {
        seen[j] = 1;
        prev[j] = i;
        q.push(j);
      }
    }
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
