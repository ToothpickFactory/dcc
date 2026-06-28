import { canOccupy, canStep } from "../../procgen/collision";
import { BOSS_RADIUS, MONSTER_KINDS, PLAYER_RADIUS } from "../../shared/constants";
import type { BossState, MonsterState, PlayerState, PropState, WorldCtx } from "../state";

type CharacterState = PlayerState | MonsterState | BossState;

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

export function characterRadius(entity: CharacterState): number {
  if ("tag" in entity && entity.tag === "boss") return BOSS_RADIUS;
  if ("kind" in entity) return MONSTER_KINDS[entity.kind].radius;
  return PLAYER_RADIUS;
}

export function characterBlocking(
  ctx: WorldCtx,
  x: number,
  y: number,
  radius: number,
  ignore?: CharacterState,
  fromX?: number,
  fromY?: number,
): CharacterState | null {
  const blocks = (entity: CharacterState, entityRadius: number): boolean => {
    if (entity === ignore) return false;
    const rr = radius + entityRadius;
    const dx = x - entity.x;
    const dy = y - entity.y;
    if (dx * dx + dy * dy >= rr * rr) return false;

    // If something spawned or reconnected already overlapping, allow movement
    // that increases separation so actors can naturally untangle.
    if (fromX !== undefined && fromY !== undefined) {
      const fdx = fromX - entity.x;
      const fdy = fromY - entity.y;
      if (fdx * fdx + fdy * fdy < rr * rr && dx * dx + dy * dy >= fdx * fdx + fdy * fdy) return false;
    }
    return true;
  };

  for (const p of ctx.players.values()) {
    if (p.status !== "alive" || p.reached) continue;
    if (blocks(p, PLAYER_RADIUS)) return p;
  }
  for (const m of ctx.monsters) {
    if (m.dead) continue;
    if (blocks(m, MONSTER_KINDS[m.kind].radius)) return m;
  }
  if (ctx.boss && !ctx.boss.dead && blocks(ctx.boss, BOSS_RADIUS)) return ctx.boss;
  return null;
}

export function canOccupyWorld(
  ctx: WorldCtx,
  x: number,
  y: number,
  radius: number,
  ignoreCharacter?: CharacterState,
  fromX?: number,
  fromY?: number,
): boolean {
  return (
    canOccupy(ctx.floor.collision, x, y, radius) &&
    propBlocking(ctx, x, y, radius) === null &&
    characterBlocking(ctx, x, y, radius, ignoreCharacter, fromX, fromY) === null
  );
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
  if (canOccupyWorld(ctx, nx, position.y, radius, position as CharacterState, position.x, position.y) && canStep(grid, position.x, position.y, nx, position.y)) position.x = nx;

  const ny = position.y + dy;
  // Y step measured from the POST-X position (mirrors procgen + the Godot predictor).
  if (canOccupyWorld(ctx, position.x, ny, radius, position as CharacterState, position.x, position.y) && canStep(grid, position.x, position.y, position.x, ny)) position.y = ny;
}

export function movePlayerWithWorldCollisions(
  ctx: WorldCtx,
  position: { x: number; y: number },
  dx: number,
  dy: number,
  radius: number,
): void {
  const nx = position.x + dx;
  // Player movement collides with walls, live props, and live characters. The
  // heightfield is a visual ground surface, so hills cannot desync prediction or
  // trap the player.
  if (canOccupyWorld(ctx, nx, position.y, radius, position as CharacterState, position.x, position.y)) position.x = nx;

  const ny = position.y + dy;
  if (canOccupyWorld(ctx, position.x, ny, radius, position as CharacterState, position.x, position.y)) position.y = ny;
}
