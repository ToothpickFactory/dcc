import { WORLD } from "../shared/constants";
import type { MonsterKind, Theme } from "../shared/types";
import type { CollisionGrid, FloorDescriptor } from "./types";

const THEMES: Theme[] = ["fantasy", "cyberpunk", "forest", "pirate", "clockwork", "nightmare"];

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

export function generateFloor(seed: number, depth: number): FloorDescriptor {
  const random = rng(seed + depth * 1013);
  const cell = 80;
  const gw = Math.floor(WORLD.w / cell);
  const gh = Math.floor(WORLD.h / cell);
  const solid = new Uint8Array(gw * gh).fill(1);
  const start = {
    x: nearestOdd(Math.floor(gw / 2), gw),
    y: nearestOdd(Math.floor(gh / 2), gh),
  };

  carveConnectedMaze(solid, gw, gh, start.x, start.y, random);
  addLoops(solid, gw, gh, random, Math.floor(gw * gh * 0.08));
  carveRoom(solid, gw, gh, start.x, start.y, 2);

  const farthest = farthestOpenCell(solid, gw, gh, start.x, start.y);
  carveRoom(solid, gw, gh, farthest.x, farthest.y, 1);
  const collision: CollisionGrid = { w: gw, h: gh, cell, solid };
  const entrance = cellCenter(start.x, start.y, cell);
  const stairs = { ...cellCenter(farthest.x, farthest.y, cell), r: 48 };

  const candidates = openCells(solid, gw, gh).filter(
    (p) => manhattan(p.x, p.y, start.x, start.y) > 5 && manhattan(p.x, p.y, farthest.x, farthest.y) > 3,
  );
  shuffle(candidates, random);

  const kinds: MonsterKind[] = ["grunt", "brute", "swarm", "ranged"];
  const spawns: FloorDescriptor["spawns"] = [];
  const spawnCount = Math.min(candidates.length, 8 + Math.min(8, depth));
  for (let i = 0; i < spawnCount; i++) {
    const p = candidates[i]!;
    spawns.push({ ...cellCenter(p.x, p.y, cell), kind: kinds[Math.floor(random() * kinds.length)]! });
  }

  const chests = candidates.slice(spawnCount, spawnCount + 2).map((p) => cellCenter(p.x, p.y, cell));
  const pathCells = farthest.distance + 1;

  return {
    index: depth,
    seed,
    depth,
    theme: THEMES[Math.floor(random() * THEMES.length)]!,
    w: WORLD.w,
    h: WORLD.h,
    durationMs: Math.max(45000, Math.ceil((pathCells * cell * 1.8 * 1000) / 230)),
    collision,
    entrance,
    stairs,
    spawns,
    chests,
  };
}

function carveConnectedMaze(
  solid: Uint8Array,
  w: number,
  h: number,
  startX: number,
  startY: number,
  random: () => number,
): void {
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

function carveRoom(solid: Uint8Array, w: number, h: number, cx: number, cy: number, radius: number): void {
  for (let y = Math.max(1, cy - radius); y <= Math.min(h - 2, cy + radius); y++) {
    for (let x = Math.max(1, cx - radius); x <= Math.min(w - 2, cx + radius); x++) {
      solid[y * w + x] = 0;
    }
  }
}

function farthestOpenCell(
  solid: Uint8Array,
  w: number,
  h: number,
  startX: number,
  startY: number,
): { x: number; y: number; distance: number } {
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
