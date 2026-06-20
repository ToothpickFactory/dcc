import { canOccupy, canStep } from "../../procgen/collision";
import type { PropState, WorldCtx } from "../state";

export function propBlocking(ctx: WorldCtx, x: number, y: number, radius: number, ignore?: PropState): PropState | null {
  for (const p of ctx.props) {
    if (p === ignore || p.hp <= 0) continue;
    const rr = radius + p.radius;
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy < rr * rr) return p;
  }
  return null;
}

export function canOccupyWorld(ctx: WorldCtx, x: number, y: number, radius: number): boolean {
  return canOccupy(ctx.floor.collision, x, y, radius) && propBlocking(ctx, x, y, radius) === null;
}

export function moveWithWorldCollisions(
  ctx: WorldCtx,
  position: { x: number; y: number },
  dx: number,
  dy: number,
  radius: number,
): void {
  const grid = ctx.floor.collision;
  const nx = position.x + dx;
  if (canOccupyWorld(ctx, nx, position.y, radius) && canStep(grid, position.x, position.y, nx, position.y)) position.x = nx;

  const ny = position.y + dy;
  // Y step measured from the POST-X position (mirrors procgen + the Godot predictor).
  if (canOccupyWorld(ctx, position.x, ny, radius) && canStep(grid, position.x, position.y, position.x, ny)) position.y = ny;
}

export function movePlayerWithWorldCollisions(
  ctx: WorldCtx,
  position: { x: number; y: number },
  dx: number,
  dy: number,
  radius: number,
): void {
  const nx = position.x + dx;
  // Player movement collides with walls and live props only. The heightfield is a
  // visual ground surface, so hills cannot desync prediction or trap the player.
  if (canOccupyWorld(ctx, nx, position.y, radius)) position.x = nx;

  const ny = position.y + dy;
  if (canOccupyWorld(ctx, position.x, ny, radius)) position.y = ny;
}
