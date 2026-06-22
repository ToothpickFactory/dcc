import { WALKABLE_DELTA } from "../shared/constants";
import type { MonsterKind, Theme } from "../shared/types";
import type { CollisionGrid, FloorDescriptor, HazardSpec, PortalSpec } from "./types";
import { PREFABS, stampPrefab, type PrefabAnchor } from "./prefabs";

const THEMES: Theme[] = ["fantasy", "cyberpunk", "forest", "pirate", "clockwork", "nightmare", "icedungeon"];

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
export function generateFloor(seed: number, depth: number, opts: { pvp?: boolean } = {}): FloorDescriptor {
  const random = rng(seed + depth * 1013);
  const cell = CELL;
  const normalSize = nearestOdd(Math.min(MAX_GRID, BASE_GRID + depth * GROW_PER_DEPTH), MAX_GRID);
  const size = opts.pvp ? nearestOdd(Math.max(19, Math.floor(normalSize * 0.5)), MAX_GRID) : normalSize;
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
  const collision: CollisionGrid = {
    w: gw * SCALE,
    h: gh * SCALE,
    cell,
    solid: scaleGrid(solid, gw, gh, SCALE),
    ground: new Int16Array(gw * SCALE * gh * SCALE), // 0 = flat; buildHeightField fills it below
  };
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
  const hazards = generateHazards(solid, gw, gh, cell, random, depth, openness, start, farthest, bossCell).map(scHazard);
  const portals = generatePortals(solid, gw, gh, cell, random, depth, start, farthest, bossCell).map(scPortal);

  // Heightfield 2.5D: generate a deterministic per-cell ground height on the FINE grid. The seed is
  // drawn HERE, as the very last random() call, so every existing layout draw above stays byte-
  // identical (the procgen connectivity test proves it). Height is visual-only today; the slope
  // relaxation keeps adjacent open cells within WALKABLE_DELTA so the v2 step-up gate can trust it.
  const heightSeed = (random() * 0x100000000) >>> 0;
  buildHeightField(
    collision,
    prefabAnchors.map((a) => ({ x: a.x * SCALE, y: a.y * SCALE, landmark: a.landmark })),
    { x: start.x * SCALE, y: start.y * SCALE },
    { x: farthest.x * SCALE, y: farthest.y * SCALE },
    heightSeed,
    isCave,
    openness,
  );

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
    pvp: opts.pvp || undefined,
    collision,
    entrance,
    stairs,
    bossRoom,
    spawns,
    chests,
    decorations,
    hazards,
    portals,
  };
}

function generatePortals(
  solid: Uint8Array,
  gw: number,
  gh: number,
  cell: number,
  random: () => number,
  depth: number,
  start: { x: number; y: number },
  stairs: { x: number; y: number },
  bossCell: { x: number; y: number },
): PortalSpec[] {
  const candidates = openCells(solid, gw, gh).filter((p) =>
    manhattan(p.x, p.y, start.x, start.y) > 6 &&
    manhattan(p.x, p.y, stairs.x, stairs.y) > 6 &&
    manhattan(p.x, p.y, bossCell.x, bossCell.y) > 4
  );
  shuffle(candidates, random);
  const pairCount = Math.min(2, Math.max(1, Math.floor(depth / 4) + 1), Math.floor(candidates.length / 2));
  const portals: PortalSpec[] = [];
  const used: { x: number; y: number }[] = [];
  const farEnough = (p: { x: number; y: number }) => used.every((u) => manhattan(p.x, p.y, u.x, u.y) >= 8);
  for (let pair = 0; pair < pairCount; pair++) {
    const a = candidates.find((p) => farEnough(p));
    if (!a) break;
    used.push(a);
    const b = candidates.find((p) => p !== a && farEnough(p) && manhattan(p.x, p.y, a.x, a.y) >= Math.max(10, Math.floor((gw + gh) * 0.18)));
    if (!b) break;
    used.push(b);
    const ac = cellCenter(a.x, a.y, cell);
    const bc = cellCenter(b.x, b.y, cell);
    const hue = (pair * 0.37 + random() * 0.18) % 1;
    const aid = `portal_${pair}_a`;
    const bid = `portal_${pair}_b`;
    portals.push({ id: aid, pair: bid, ...ac, r: 34, hue });
    portals.push({ id: bid, pair: aid, ...bc, r: 34, hue });
  }
  return portals;
}

function generateHazards(
  solid: Uint8Array,
  gw: number,
  gh: number,
  cell: number,
  random: () => number,
  depth: number,
  openness: number,
  start: { x: number; y: number },
  stairs: { x: number; y: number },
  bossCell: { x: number; y: number },
): HazardSpec[] {
  const open = openCells(solid, gw, gh).filter((p) =>
    manhattan(p.x, p.y, start.x, start.y) > 5 &&
    manhattan(p.x, p.y, stairs.x, stairs.y) > 4 &&
    manhattan(p.x, p.y, bossCell.x, bossCell.y) > 3
  );
  shuffle(open, random);
  const count = Math.min(open.length, 6 + Math.floor(depth * 1.35) + Math.floor(openness * 5));
  const hazards: HazardSpec[] = [];
  const used = new Set<string>();
  const baseDmg = 5 + Math.floor(depth * 1.7);
  const pickOpen = () => {
    while (open.length > 0) {
      const p = open.pop()!;
      let crowded = false;
      for (let y = p.y - 2; y <= p.y + 2 && !crowded; y++) {
        for (let x = p.x - 2; x <= p.x + 2; x++) {
          if (used.has(`${x},${y}`)) {
            crowded = true;
            break;
          }
        }
      }
      if (crowded) continue;
      used.add(`${p.x},${p.y}`);
      return p;
    }
    return null;
  };

  const crusherCandidates = open.filter((p) => crusherDirAt(solid, gw, gh, p.x, p.y) !== null);
  shuffle(crusherCandidates, random);
  if (crusherCandidates.length > 0 && random() < 0.75) {
    const p = crusherCandidates[0]!;
    const center = cellCenter(p.x, p.y, cell);
    hazards.push({
      kind: "wall_crusher",
      ...center,
      r: 54,
      dmg: 9999,
      dir: crusherDirAt(solid, gw, gh, p.x, p.y) ?? 0,
      length: cell * 1.2,
      width: cell * 1.05,
      periodMs: 3400,
      activeMs: 520,
      phaseMs: Math.floor(random() * 2600),
    });
    used.add(`${p.x},${p.y}`);
  }

  for (let i = 0; i < count; i++) {
    const p = pickOpen();
    if (!p) break;
    const roll = random();
    const center = cellCenter(p.x, p.y, cell);
    const phaseMs = Math.floor(random() * 2600);
    if (roll < 0.26) {
      hazards.push({ kind: "floor_spikes", ...center, r: 46, dmg: baseDmg, periodMs: 2300, activeMs: 820, phaseMs });
    } else if (roll < 0.47) {
      hazards.push({ kind: "lava_pit", ...center, r: 58, dmg: baseDmg + 3 });
    } else if (roll < 0.66) {
      hazards.push({ kind: "acid_pit", ...center, r: 58, dmg: Math.max(3, baseDmg - 1) });
    } else {
      const crusherDir = crusherDirAt(solid, gw, gh, p.x, p.y);
      if (roll > 0.88 && crusherDir !== null) {
        hazards.push({
          kind: "wall_crusher",
          ...center,
          r: 54,
          dmg: 9999,
          dir: crusherDir,
          length: cell * 1.2,
          width: cell * 1.05,
          periodMs: 3400,
          activeMs: 520,
          phaseMs,
        });
        continue;
      }
      const wall = adjacentWallDir(solid, gw, gh, p.x, p.y, random);
      if (!wall) {
        hazards.push({ kind: "floor_spikes", ...center, r: 46, dmg: baseDmg, periodMs: 2300, activeMs: 820, phaseMs });
        continue;
      }
      const kind = roll < 0.83 ? "wall_spikes" : "flame_turret";
      hazards.push({
        kind,
        ...center,
        r: kind === "flame_turret" ? 54 : 42,
        dmg: kind === "flame_turret" ? baseDmg + 2 : baseDmg + 1,
        dir: wall,
        length: kind === "flame_turret" ? cell * 3.2 : cell * 2.1,
        width: kind === "flame_turret" ? 72 : 58,
        periodMs: kind === "flame_turret" ? 2800 : 2100,
        activeMs: kind === "flame_turret" ? 1050 : 640,
        phaseMs,
      });
    }
  }
  return hazards;
}

function adjacentWallDir(solid: Uint8Array, w: number, h: number, x: number, y: number, random: () => number): number | null {
  const dirs = [
    { dx: -1, dy: 0, dir: 0 },
    { dx: 0, dy: -1, dir: 1 },
    { dx: 1, dy: 0, dir: 2 },
    { dx: 0, dy: 1, dir: 3 },
  ].filter((d) => {
    const wx = x + d.dx;
    const wy = y + d.dy;
    return wx >= 0 && wy >= 0 && wx < w && wy < h && solid[wy * w + wx] === 1;
  });
  if (dirs.length === 0) return null;
  return dirs[Math.floor(random() * dirs.length)]!.dir;
}

function crusherDirAt(solid: Uint8Array, w: number, h: number, x: number, y: number): number | null {
  if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return null;
  const here = y * w + x;
  if (solid[here] !== 0) return null;
  const leftWall = solid[y * w + x - 1] === 1;
  const rightWall = solid[y * w + x + 1] === 1;
  const upWall = solid[(y - 1) * w + x] === 1;
  const downWall = solid[(y + 1) * w + x] === 1;
  const openUp = y > 1 && solid[(y - 1) * w + x] === 0;
  const openDown = y < h - 2 && solid[(y + 1) * w + x] === 0;
  const openLeft = x > 1 && solid[y * w + x - 1] === 0;
  const openRight = x < w - 2 && solid[y * w + x + 1] === 0;
  if (leftWall && rightWall && (openUp || openDown)) return 0;
  if (upWall && downWall && (openLeft || openRight)) return 1;
  return null;
}

function scHazard(h: HazardSpec): HazardSpec {
  const SCALE = 2;
  return {
    ...h,
    x: h.x * SCALE,
    y: h.y * SCALE,
    r: h.r * SCALE,
    length: h.length === undefined ? undefined : h.length * SCALE,
    width: h.width === undefined ? undefined : h.width * SCALE,
  };
}

function scPortal(p: PortalSpec): PortalSpec {
  const SCALE = 2;
  return { ...p, x: p.x * SCALE, y: p.y * SCALE, r: p.r * SCALE };
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

// ---- heightfield 2.5D (deterministic ground elevation) ---------------------

// Tuning (px / fine-cells). Amplitudes are kept modest so each feature's natural gradient is
// already near WALKABLE_DELTA — the relaxation pass then only has to clean up overlaps, so it
// converges fast and the cap is satisfiable everywhere (proven by the height-aware test).
const HEIGHT_OCTAVES = 2;
const CAVE_AMP = 46; // px FBM amplitude on cave floors (rolling slopes)
const MAZE_AMP = 24; // px FBM amplitude on maze floors (near-flat corridors)
const CAVE_PERIOD = 26; // fine cells per base noise octave (caves)
const MAZE_PERIOD = 34; // fine cells per base noise octave (mazes)
const DAIS_HEIGHT = 96; // raised platform under landmark prefabs
const DAIS_RADIUS = 9; // fine cells
const PIT_DEPTH = 64; // sunken depression
const PIT_RADIUS = 9; // fine cells
const LANDING_RADIUS = 5; // fine cells flattened around entrance + stairs (level spawn/exit)
const PLATEAU_HEIGHT = 120; // px raised platform — far above WALKABLE_DELTA so its faces are sheer cliffs
const PLATEAU_R = 3; // plateau disc radius (fine cells)
const PLATEAU_MAX = 3; // upper bound on plateaus per floor (many candidates fail to find room)

// Fill grid.ground (fine grid) with a natural, walkable height field: FBM base + landmark daises +
// a few sunken pits, with entrance/stairs flattened and a slope-relaxation pass capping every open
// 4-neighbour delta at WALKABLE_DELTA. Pure-deterministic from heightSeed; no main-stream draws.
function buildHeightField(
  grid: CollisionGrid,
  anchors: { x: number; y: number; landmark: boolean }[],
  start: { x: number; y: number },
  farthest: { x: number; y: number },
  heightSeed: number,
  isCave: boolean,
  openness: number,
): void {
  const { w, h, solid, ground } = grid;
  const hrng = rng(heightSeed);
  const amp = (isCave ? CAVE_AMP : MAZE_AMP) * (0.6 + openness * 0.6);
  const period = isCave ? CAVE_PERIOD : MAZE_PERIOD;

  // 1) FBM base over every cell (walls included — their bases sit on the same terrain).
  const hf = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      hf[y * w + x] = fbm(heightSeed, x, y, period, HEIGHT_OCTAVES) * amp;
    }
  }

  // 2) Daises under landmark anchors (shrines/vaults get plinths) + a few sunken pits in open rooms.
  for (const a of anchors) {
    if (a.landmark) addBump(hf, w, h, a.x, a.y, DAIS_RADIUS, DAIS_HEIGHT);
  }
  const pitCount = 1 + Math.floor(hrng() * 3);
  const farOpen = openCells(solid, w, h).filter((p) => manhattan(p.x, p.y, start.x, start.y) > LANDING_RADIUS + PIT_RADIUS);
  shuffle(farOpen, hrng);
  let pits = 0;
  for (const p of farOpen) {
    if (pits >= pitCount) break;
    if (!discAllOpen(solid, w, h, p.x, p.y, PIT_RADIUS)) continue; // ring-protect: never pit near a wall
    addBump(hf, w, h, p.x, p.y, PIT_RADIUS, -PIT_DEPTH);
    pits++;
  }

  // 3) Flatten the entrance + stairs into level landings (pinned so relaxation ramps INTO them).
  const pinned = new Uint8Array(w * h);
  flattenLanding(hf, pinned, w, h, solid, start.x, start.y, LANDING_RADIUS);
  flattenLanding(hf, pinned, w, h, solid, farthest.x, farthest.y, LANDING_RADIUS);

  // 4) Slope relaxation: cap every open 4-neighbour delta. Pinned (landing) cells stay fixed; their
  //    neighbours ramp toward them. Internal cap is tighter so the final Int16 rounding stays <= cap.
  relaxSlopes(hf, solid, pinned, w, h, WALKABLE_DELTA - 2);

  // 4b) Plateaus: raise a few far regions into tactical platforms with sheer (impassable) cliff
  //     faces + ONE walkable ramp. These intentionally break the slope cap (the v2 step-up gate
  //     blocks the cliff faces); each is kept only if a height-aware flood proves every open cell is
  //     still reachable, so a plateau can never sever the floor.
  addPlateaus(hf, solid, w, h, start, farthest, hrng);

  // 5) Quantize to Int16 px.
  for (let i = 0; i < w * h; i++) {
    ground[i] = Math.max(-32768, Math.min(32767, Math.round(hf[i]!)));
  }
}

// Value-noise FBM in [-1,1]. Lattice corners hashed from (seed, ix, iy), smoothstep-interpolated,
// octaves summed at halving amplitude/period. Fully integer-seeded → identical on any platform.
function fbm(seed: number, x: number, y: number, basePeriod: number, octaves: number): number {
  let sum = 0;
  let ampO = 1;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += ampO * (valueNoise(seed + o * 1013, x, y, period) * 2 - 1);
    norm += ampO;
    ampO *= 0.5;
    period *= 0.5;
  }
  return norm > 0 ? sum / norm : 0;
}

function valueNoise(seed: number, x: number, y: number, period: number): number {
  const gx = x / period;
  const gy = y / period;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const sx = smoothstep01(gx - x0);
  const sy = smoothstep01(gy - y0);
  const n00 = hash2(seed, x0, y0);
  const n10 = hash2(seed, x0 + 1, y0);
  const n01 = hash2(seed, x0, y0 + 1);
  const n11 = hash2(seed, x0 + 1, y0 + 1);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

function hash2(seed: number, ix: number, iy: number): number {
  let hh = (seed ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)) | 0;
  hh = Math.imul(hh ^ (hh >>> 13), 1274126177);
  return ((hh ^ (hh >>> 16)) >>> 0) / 4294967296;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep01(t: number): number {
  return t * t * (3 - 2 * t);
}

// Add a smooth radial bump (height>0 raises, <0 sinks) with a smoothstep falloff to the rim.
function addBump(hf: Float64Array, w: number, h: number, cx: number, cy: number, radius: number, height: number): void {
  const minX = Math.max(0, cx - radius);
  const maxX = Math.min(w - 1, cx + radius);
  const minY = Math.max(0, cy - radius);
  const maxY = Math.min(h - 1, cy + radius);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius) continue;
      hf[y * w + x] += height * smoothstep01(1 - d / radius);
    }
  }
}

// Whole disc must be open floor — keeps pits inside rooms so they never pinch a corridor.
function discAllOpen(solid: Uint8Array, w: number, h: number, cx: number, cy: number, radius: number): boolean {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return false;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      if (solid[y * w + x] === 1) return false;
    }
  }
  return true;
}

// Flatten open cells within `radius` of (cx,cy) to the centre height, and pin them so the slope
// relaxation treats them as fixed (its neighbours ramp toward the flat landing).
function flattenLanding(hf: Float64Array, pinned: Uint8Array, w: number, h: number, solid: Uint8Array, cx: number, cy: number, radius: number): void {
  const centerVal = hf[cy * w + cx]!;
  const r2 = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = y * w + x;
      if (solid[i] !== 0) continue;
      hf[i] = centerVal;
      pinned[i] = 1;
    }
  }
}

// Slope relaxation (Gauss-Seidel clamp): repeatedly clamp each free open cell into the band where
// it sits within `cap` of every open neighbour, until no open 4-neighbour pair differs by more than
// `cap`. Clamping is BOUNDED (a cell only ever moves to its neighbour-derived limits — it can never
// overshoot) so this is unconditionally stable, unlike additive diffusion. Pinned (landing) cells
// don't move but still constrain their neighbours. Direction alternates for faster convergence.
function relaxSlopes(hf: Float64Array, solid: Uint8Array, pinned: Uint8Array, w: number, h: number, cap: number): void {
  for (let pass = 0; pass < 400; pass++) {
    let changed = false;
    const forward = pass % 2 === 0;
    const y0 = forward ? 1 : h - 2;
    const yEnd = forward ? h - 1 : 0;
    const yStep = forward ? 1 : -1;
    const x0 = forward ? 1 : w - 2;
    const xEnd = forward ? w - 1 : 0;
    const xStep = forward ? 1 : -1;
    for (let y = y0; y !== yEnd; y += yStep) {
      for (let x = x0; x !== xEnd; x += xStep) {
        const i = y * w + x;
        if (solid[i] !== 0 || pinned[i]) continue;
        let lo = -Infinity;
        let hi = Infinity;
        for (const nb of [i - 1, i + 1, i - w, i + w]) {
          if (solid[nb] !== 0) continue;
          const nh = hf[nb]!;
          if (nh - cap > lo) lo = nh - cap; // hf[i] must be >= each neighbour - cap
          if (nh + cap < hi) hi = nh + cap; // hf[i] must be <= each neighbour + cap
        }
        if (lo === -Infinity) continue; // no open neighbour
        const cur = hf[i]!;
        // Feasible band [lo,hi]: clamp into it. If infeasible (neighbours differ by >2*cap), sit at
        // the midpoint — that pulls the (also-moving) neighbours together over subsequent passes.
        const target = lo <= hi ? (cur < lo ? lo : cur > hi ? hi : cur) : (lo + hi) / 2;
        if (Math.abs(target - cur) > 1e-4) {
          hf[i] = target;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

// Place up to a few plateaus (raised platforms with cliff faces + one ramp). Each is applied, then
// VERIFIED: a height-aware flood from `start` must still reach every open cell, or the plateau is
// rolled back. This makes tactical cliffs impossible to mis-generate into a soft-lock.
function addPlateaus(
  hf: Float64Array,
  solid: Uint8Array,
  w: number,
  h: number,
  start: { x: number; y: number },
  farthest: { x: number; y: number },
  hrng: () => number,
): void {
  const base0 = Float64Array.from(hf); // relaxed base snapshot — the height a ramp descends to
  const rampStep = WALKABLE_DELTA - 2; // descend a touch under the cap so post-round ramp edges stay walkable
  const totalOpen = countOpen(solid, w, h);
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const want = 1 + Math.floor(hrng() * PLATEAU_MAX);
  const margin = PLATEAU_R + 8 + LANDING_RADIUS;
  const spacing = 2 * (PLATEAU_R + 8);
  const cands = openCells(solid, w, h).filter(
    (p) => manhattan(p.x, p.y, start.x, start.y) > margin && manhattan(p.x, p.y, farthest.x, farthest.y) > margin,
  );
  shuffle(cands, hrng);
  const placed: { x: number; y: number }[] = [];
  let made = 0;
  for (const c of cands) {
    if (made >= want) break;
    if (placed.some((q) => Math.abs(q.x - c.x) < spacing && Math.abs(q.y - c.y) < spacing)) continue;
    const order = dirs.slice();
    shuffle(order, hrng);
    for (const dir of order) {
      const snapshot = Float64Array.from(hf);
      if (!tryPlateau(hf, base0, solid, w, h, c.x, c.y, dir, rampStep)) continue;
      // Keep only if every open cell is still reachable across walkable (<=rampStep) slopes.
      if (heightReachCount(hf, solid, w, h, start.x, start.y, rampStep) === totalOpen) {
        placed.push(c);
        made++;
        break;
      }
      hf.set(snapshot); // reverted — this plateau severed the floor
    }
  }
}

// Raise a disc to a flat top and carve one descending ramp out to the base. Plans the ramp first
// (bailing if a wall interrupts before it merges with the base), then applies — so a failed attempt
// leaves `hf` untouched. Returns true on success.
function tryPlateau(
  hf: Float64Array,
  base0: Float64Array,
  solid: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  dir: { x: number; y: number },
  rampStep: number,
): boolean {
  const R = PLATEAU_R;
  if (!discAllOpen(solid, w, h, cx, cy, R)) return false;
  const top = base0[cy * w + cx]! + PLATEAU_HEIGHT;
  const perp = { x: -dir.y, y: dir.x };
  const plan: { idx: number; h: number }[] = [];
  let hPrev = top;
  let merged = false;
  for (let i = 1; i < 48; i++) {
    const ox = cx + dir.x * (R + i);
    const oy = cy + dir.y * (R + i);
    if (ox < 1 || oy < 1 || ox >= w - 1 || oy >= h - 1 || solid[oy * w + ox] === 1) return false;
    if (base0[oy * w + ox]! >= hPrev - rampStep) {
      merged = true; // within one step of the base — the ramp has reached the floor
      break;
    }
    const hh = hPrev - rampStep;
    for (const pp of [0, 1, -1]) {
      // width-3 ramp: the centre cell (required) + both perpendicular neighbours (optional)
      const px = ox + perp.x * pp;
      const py = oy + perp.y * pp;
      if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1 || solid[py * w + px] === 1) {
        if (pp === 0) return false;
        continue;
      }
      plan.push({ idx: py * w + px, h: hh });
    }
    hPrev = hh;
  }
  if (!merged) return false;
  for (let yy = cy - R; yy <= cy + R; yy++) {
    for (let xx = cx - R; xx <= cx + R; xx++) {
      if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) continue;
      const dx = xx - cx;
      const dy = yy - cy;
      if (dx * dx + dy * dy <= R * R && solid[yy * w + xx] === 0) hf[yy * w + xx] = top;
    }
  }
  for (const c of plan) hf[c.idx] = c.h;
  return true;
}

// Count open cells reachable from (sx,sy) crossing only open 4-neighbour edges whose height delta
// is within `cap` — i.e. the walkable graph the step-up gate enforces.
function heightReachCount(hf: Float64Array, solid: Uint8Array, w: number, h: number, sx: number, sy: number, cap: number): number {
  const seen = new Uint8Array(w * h);
  const s = sy * w + sx;
  if (solid[s] !== 0) return 0;
  seen[s] = 1;
  const q = [s];
  let head = 0;
  let count = 1;
  while (head < q.length) {
    const i = q[head++]!;
    const x = i % w;
    const y = (i / w) | 0;
    const nb = [x + 1 < w ? i + 1 : -1, x - 1 >= 0 ? i - 1 : -1, y + 1 < h ? i + w : -1, y - 1 >= 0 ? i - w : -1];
    for (const j of nb) {
      if (j < 0 || solid[j] !== 0 || seen[j]) continue;
      if (Math.abs(hf[i]! - hf[j]!) > cap) continue;
      seen[j] = 1;
      count++;
      q.push(j);
    }
  }
  return count;
}

function countOpen(solid: Uint8Array, w: number, h: number): number {
  let n = 0;
  for (let i = 0; i < w * h; i++) if (solid[i] === 0) n++;
  return n;
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

const MELEE_KINDS: MonsterKind[] = ["grunt", "brute", "swarm", "pirate", "sharkman"];
const ALL_KINDS: MonsterKind[] = ["grunt", "brute", "swarm", "ranged", "pirate", "sharkman"];

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
  const campCount = Math.min(rooms.length, (2 + Math.floor(depth * 0.5)) * 2);
  for (let i = 0; i < campCount; i++) {
    placeCamp(spawns, solid, w, h, cell, random, rooms[i]!, depth);
  }

  // SINGLES: lone wanderers scattered across the floor (the classic feel).
  const loose = openCells(solid, w, h).filter(farFromStart);
  shuffle(loose, random);
  const singleCount = Math.min(loose.length, (3 + depth) * 2);
  const singleKinds = shuffledKinds(ALL_KINDS, random);
  for (let i = 0; i < singleCount; i++) {
    const p = loose[i]!;
    spawns.push({ ...cellCenter(p.x, p.y, cell), kind: singleKinds[i % singleKinds.length]! });
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

function shuffledKinds(kinds: MonsterKind[], random: () => number): MonsterKind[] {
  const out = [...kinds];
  shuffle(out, random);
  return out;
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
