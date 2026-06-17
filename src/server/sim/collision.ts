import { canOccupy } from "../../procgen/collision";
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
  const nx = position.x + dx;
  if (canOccupyWorld(ctx, nx, position.y, radius)) position.x = nx;

  const ny = position.y + dy;
  if (canOccupyWorld(ctx, position.x, ny, radius)) position.y = ny;
}
