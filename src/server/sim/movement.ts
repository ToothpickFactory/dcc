import type { CollisionGrid } from "../../procgen/types";
import { DASH_SPEED, PLAYER_RADIUS, SLOW_FACTOR } from "../../shared/constants";
import type { PlayerState, WorldCtx } from "../state";
import { movePlayerWithWorldCollisions } from "./collision";

export function stepPlayer(ctx: WorldCtx, p: PlayerState, dt: number): void {
  if (p.status !== "alive") return;
  const grid = ctx.floor.collision;
  if (p.dashUntil > ctx.now) {
    // Dash burst overrides input movement (and ignores slow — it's the escape tool).
    movePlayerWithWorldCollisions(ctx, p, p.dashDirX * DASH_SPEED * dt, p.dashDirY * DASH_SPEED * dt, PLAYER_RADIUS);
    revealAround(ctx, p, grid);
    return;
  }
  const len = Math.hypot(p.mvx, p.mvy);
  if (len > 0) {
    // moveSpeed comes from the player's gear/attributes (agility), not a constant.
    const speed = p.derived.moveSpeed * (p.slowUntil > ctx.now ? SLOW_FACTOR : 1);
    movePlayerWithWorldCollisions(ctx, p, (p.mvx / len) * speed * dt, (p.mvy / len) * speed * dt, PLAYER_RADIUS);
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
