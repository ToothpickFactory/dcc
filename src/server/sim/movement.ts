import { PLAYER_SPEED, SLOW_FACTOR, WORLD } from "../../shared/constants";
import type { CollisionGrid } from "../../procgen/types";
import type { PlayerState, WorldCtx } from "../state";

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

// True if the world-space point lands in a solid (blocked) grid cell — or out of
// bounds. Sim + (eventually) client prediction share this so they agree.
export function blocked(grid: CollisionGrid, x: number, y: number): boolean {
  const cx = Math.floor(x / grid.cell);
  const cy = Math.floor(y / grid.cell);
  if (cx < 0 || cy < 0 || cx >= grid.w || cy >= grid.h) return true;
  return grid.solid[cy * grid.w + cx] === 1;
}

// Integrate a player's last input vector. Authoritative — the client predicts
// the same math locally (client/predict.ts) for responsiveness. Movement is
// resolved per-axis against the floor's CollisionGrid so a player slides along
// walls instead of sticking. Stepping into a newly-revealed area emits an
// `explore` playstyle event (feeds the exploration axis).
export function stepPlayer(ctx: WorldCtx, p: PlayerState, dt: number): void {
  if (p.status !== "alive") return;
  const grid = ctx.floor.collision;
  const len = Math.hypot(p.mvx, p.mvy);
  if (len > 0) {
    const speed = PLAYER_SPEED * (p.slowUntil > ctx.now ? SLOW_FACTOR : 1);
    const ux = p.mvx / len;
    const uy = p.mvy / len;
    const nx = clamp(p.x + ux * speed * dt, 16, WORLD.w - 16);
    const ny = clamp(p.y + uy * speed * dt, 16, WORLD.h - 16);
    if (!blocked(grid, nx, p.y)) p.x = nx; // resolve X, then Y → wall-sliding
    if (!blocked(grid, p.x, ny)) p.y = ny;
  }
  revealAround(ctx, p, grid);
}

// Reveal the 3x3 of cells around the player; count cells seen for the first
// time and emit one explore event for the batch. Cheap (9 lookups), allocation
// only on genuinely new ground.
function revealAround(ctx: WorldCtx, p: PlayerState, grid: CollisionGrid): void {
  const cx = Math.floor(p.x / grid.cell);
  const cy = Math.floor(p.y / grid.cell);
  let fresh = 0;
  for (let gy = cy - 1; gy <= cy + 1; gy++) {
    if (gy < 0 || gy >= grid.h) continue;
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      if (gx < 0 || gx >= grid.w) continue;
      const idx = gy * grid.w + gx;
      if (!p.seen.has(idx)) {
        p.seen.add(idx);
        fresh++;
      }
    }
  }
  if (fresh > 0) ctx.pushPlay({ e: "explore", by: p.id, tilesNew: fresh });
}
