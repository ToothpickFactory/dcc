import { WALKABLE_DELTA, WALKABLE_SLOPE_DELTA } from "../shared/constants";
import type { CollisionGrid } from "./types";

export function blocked(grid: CollisionGrid, x: number, y: number): boolean {
  const cx = Math.floor(x / grid.cell);
  const cy = Math.floor(y / grid.cell);
  if (cx < 0 || cy < 0 || cx >= grid.w || cy >= grid.h) return true;
  return grid.solid[cy * grid.w + cx] === 1;
}

export function canOccupy(grid: CollisionGrid, x: number, y: number, radius: number): boolean {
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

// Nearest-cell ground height (px) at a world position. INTEGER-indexed (Math.floor) so it is
// trivially reproducible in GDScript with zero float drift — this is the canonical sampler the
// future v2 step-up gate reads. Any bilinear RENDER variant must stay separate from this.
export function heightAt(grid: CollisionGrid, x: number, y: number): number {
  if (!grid.ground) return 0;
  let cx = Math.floor(x / grid.cell);
  let cy = Math.floor(y / grid.cell);
  if (cx < 0) cx = 0;
  else if (cx >= grid.w) cx = grid.w - 1;
  if (cy < 0) cy = 0;
  else if (cy >= grid.h) cy = grid.h - 1;
  return grid.ground[cy * grid.w + cx]!;
}

// Bilinear terrain height at a world position, matching Godot's Geo.ground_height().
// This is for movement feel only; heightAt() stays the deterministic cell sampler
// used by the strict parity gate and procgen reachability checks.
export function smoothHeightAt(grid: CollisionGrid, x: number, y: number): number {
  if (!grid.ground) return 0;
  const gx = x / grid.cell - 0.5;
  const gy = y / grid.cell - 0.5;
  let x0 = Math.floor(gx);
  let y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const x1 = clamp(x0 + 1, 0, grid.w - 1);
  const y1 = clamp(y0 + 1, 0, grid.h - 1);
  x0 = clamp(x0, 0, grid.w - 1);
  y0 = clamp(y0, 0, grid.h - 1);
  const h00 = grid.ground[y0 * grid.w + x0]!;
  const h10 = grid.ground[y0 * grid.w + x1]!;
  const h01 = grid.ground[y1 * grid.w + x0]!;
  const h11 = grid.ground[y1 * grid.w + x1]!;
  return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fy);
}

// Heightfield 2.5D step-up gate: a move between two points is allowed only if the NEAREST-CELL
// ground heights differ by <= WALKABLE_DELTA. Pure integer math (heightAt) so GDScript's
// Geo.can_step reproduces it bit-for-bit — no float drift, no rubber-band. A cliff face (delta >
// cap, e.g. a plateau edge) acts like a wall; the procgen ramp keeps every region reachable.
export function canStep(grid: CollisionGrid, fromX: number, fromY: number, toX: number, toY: number): boolean {
  return Math.abs(heightAt(grid, toX, toY) - heightAt(grid, fromX, fromY)) <= WALKABLE_DELTA;
}

export function canTraverseSlope(grid: CollisionGrid, fromX: number, fromY: number, toX: number, toY: number): boolean {
  if (!grid.ground) return true;
  if (canStep(grid, fromX, fromY, toX, toY)) return true;
  if (Math.abs(heightAt(grid, toX, toY) - heightAt(grid, fromX, fromY)) > WALKABLE_SLOPE_DELTA) return false;
  return Math.abs(smoothHeightAt(grid, toX, toY) - smoothHeightAt(grid, fromX, fromY)) <= WALKABLE_DELTA;
}

export function moveWithCollisions(
  grid: CollisionGrid,
  position: { x: number; y: number },
  dx: number,
  dy: number,
  radius: number,
): void {
  const nx = position.x + dx;
  if (canOccupy(grid, nx, position.y, radius) && canStep(grid, position.x, position.y, nx, position.y)) position.x = nx;

  const ny = position.y + dy;
  // Y step measured from the POST-X position so a diagonal can't climb a cliff one axis at a time.
  if (canOccupy(grid, position.x, ny, radius) && canStep(grid, position.x, position.y, position.x, ny)) position.y = ny;
}

export function moveWithSmoothTerrainCollisions(
  grid: CollisionGrid,
  position: { x: number; y: number },
  dx: number,
  dy: number,
  radius: number,
): void {
  const nx = position.x + dx;
  // Player traversal treats the heightfield as visual terrain. Walls still block,
  // but rolling hills must never feel like invisible stairs or snag points.
  if (canOccupy(grid, nx, position.y, radius)) position.x = nx;

  const ny = position.y + dy;
  if (canOccupy(grid, position.x, ny, radius)) position.y = ny;
}

export function randomWalkablePosition(
  grid: CollisionGrid,
  radius: number,
  random: () => number = Math.random,
): { x: number; y: number } {
  for (let attempt = 0; attempt < 200; attempt++) {
    const cx = 1 + Math.floor(random() * Math.max(1, grid.w - 2));
    const cy = 1 + Math.floor(random() * Math.max(1, grid.h - 2));
    const x = (cx + 0.5) * grid.cell;
    const y = (cy + 0.5) * grid.cell;
    if (canOccupy(grid, x, y, radius)) return { x, y };
  }

  for (let cy = 0; cy < grid.h; cy++) {
    for (let cx = 0; cx < grid.w; cx++) {
      const x = (cx + 0.5) * grid.cell;
      const y = (cy + 0.5) * grid.cell;
      if (canOccupy(grid, x, y, radius)) return { x, y };
    }
  }
  throw new Error("Floor has no walkable position");
}

// Sin-hash noise, ported 1:1 from WorldDecor.gd's _hash01 (Godot client) so the server can
// reproduce the exact same campfire spots the client will independently render — both sides
// already have the same floor collision grid, so no extra sync is needed. GDScript's int()
// truncates toward zero (same as Math.trunc) and its `%` keeps the dividend's sign (same as
// JS `%`), so this is bit-for-bit the same computation.
function hash01(x: number, y: number): number {
  const v = (Math.trunc(Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 10000) / 10000;
  return Math.abs(v);
}

const MAX_CAMPFIRES = 4;
const CAMPFIRE_MIN_SPACING = 760;

// Ported 1:1 from WorldDecor.gd's _campfire_spots(): scores open, wall-free cells by a bit of
// hash noise plus how open their surroundings are, then greedily picks one well-spread candidate
// per floor quadrant (up to MAX_CAMPFIRES), backfilling by score if a quadrant has none. Purely a
// function of the grid (deterministic per floor, no RNG) — same inputs, same output as the client.
export function campfireSpots(grid: CollisionGrid): { x: number; y: number }[] {
  const { w, h, cell, solid } = grid;
  const candidates: { pos: { x: number; y: number }; cell: { x: number; y: number }; score: number }[] = [];

  for (let cy = 2; cy < h - 2; cy++) {
    for (let cx = 2; cx < w - 2; cx++) {
      const i = cy * w + cx;
      if (solid[i] !== 0) continue;
      if (solid[i - 1] !== 0 || solid[i + 1] !== 0 || solid[i - w] !== 0 || solid[i + w] !== 0) continue;

      const noise = hash01(cx + 131, cy + 719) * 3.5;
      let openBonus = 0;
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          if (ox === 0 && oy === 0) continue;
          if (solid[(cy + oy) * w + (cx + ox)] === 0) openBonus += 0.08;
        }
      }
      candidates.push({
        pos: { x: (cx + 0.5) * cell, y: (cy + 0.5) * cell },
        cell: { x: cx, y: cy },
        score: noise + openBonus,
      });
    }
  }

  const chosen: { x: number; y: number }[] = [];
  const minSpacingSq = CAMPFIRE_MIN_SPACING * CAMPFIRE_MIN_SPACING;
  const tooClose = (pos: { x: number; y: number }) =>
    chosen.some((existing) => (pos.x - existing.x) ** 2 + (pos.y - existing.y) ** 2 < minSpacingSq);

  const anchors = [
    { x: w * 0.22, y: h * 0.22 },
    { x: w * 0.78, y: h * 0.22 },
    { x: w * 0.22, y: h * 0.78 },
    { x: w * 0.78, y: h * 0.78 },
  ];
  for (const anchor of anchors) {
    let best: (typeof candidates)[number] | null = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      if (tooClose(c.pos)) continue;
      const spreadScore = -Math.hypot(c.cell.x - anchor.x, c.cell.y - anchor.y) + c.score * 5;
      if (best === null || spreadScore > bestScore) {
        best = c;
        bestScore = spreadScore;
      }
    }
    if (best !== null) chosen.push(best.pos);
    if (chosen.length >= MAX_CAMPFIRES) return chosen;
  }

  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (tooClose(c.pos)) continue;
    chosen.push(c.pos);
    if (chosen.length >= MAX_CAMPFIRES) break;
  }
  return chosen;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
