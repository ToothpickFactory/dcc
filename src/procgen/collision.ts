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

export function moveWithCollisions(
  grid: CollisionGrid,
  position: { x: number; y: number },
  dx: number,
  dy: number,
  radius: number,
): void {
  const nx = position.x + dx;
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
