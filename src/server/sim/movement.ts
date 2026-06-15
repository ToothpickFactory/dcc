import { moveWithCollisions } from "../../procgen/collision";
import type { CollisionGrid } from "../../procgen/types";
import { PLAYER_RADIUS, PLAYER_SPEED, SLOW_FACTOR } from "../../shared/constants";
import type { PlayerState, WorldCtx } from "../state";

export function stepPlayer(ctx: WorldCtx, p: PlayerState, dt: number): void {
  if (p.status !== "alive") return;
  const grid = ctx.floor.collision;
  const len = Math.hypot(p.mvx, p.mvy);
  if (len > 0) {
    const speed = PLAYER_SPEED * (p.slowUntil > ctx.now ? SLOW_FACTOR : 1);
    moveWithCollisions(grid, p, (p.mvx / len) * speed * dt, (p.mvy / len) * speed * dt, PLAYER_RADIUS);
  }
  revealAround(ctx, p, grid);
}

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
