import {
  BOSS_BOLT_SPRITE,
  BOSS_CAST_CD,
  BOSS_MELEE_CD,
  BOSS_MELEE_DMG,
  BOSS_MELEE_RANGE,
  BOSS_PROJ_DMG,
  BOSS_PROJ_LIFE,
  BOSS_PROJ_RADIUS,
  BOSS_PROJ_SPEED,
  BOSS_PROJ_SPREAD,
  BOSS_SPEED,
} from "../../shared/constants";
import type { BossState, PlayerState, WorldCtx } from "../state";
import { applyDamage } from "./combat";

let seq = 0;

// Boss AI (ported from the monolith): chase the highest-threat player, melee in
// range, and fire dodgeable straight-line bolt volleys.
export function updateBoss(ctx: WorldCtx, dt: number): void {
  const boss = ctx.boss;
  if (!boss) return;
  if (boss.dead) {
    ctx.boss = null; // cleared the tick after death (events already emitted)
    return;
  }

  const prey = pickTarget(ctx, boss);
  if (!prey) return;

  const dx = prey.x - boss.x;
  const dy = prey.y - boss.y;
  const d = Math.hypot(dx, dy) || 1;
  boss.aim = Math.atan2(dy, dx);

  if (d > BOSS_MELEE_RANGE) {
    boss.x += (dx / d) * BOSS_SPEED * dt;
    boss.y += (dy / d) * BOSS_SPEED * dt;
  } else if (ctx.now >= boss.meleeReadyAt) {
    boss.meleeReadyAt = ctx.now + BOSS_MELEE_CD;
    applyDamage(ctx, prey, BOSS_MELEE_DMG, boss.id, false);
  }

  if (ctx.now >= boss.castReadyAt) {
    boss.castReadyAt = ctx.now + BOSS_CAST_CD;
    bossCast(ctx, boss, prey);
  }
}

// A spread of straight-line bolts aimed where the player is NOW — dodge by
// stepping out of the line. Boss bolts only affect players (see projectiles.ts).
function bossCast(ctx: WorldCtx, boss: BossState, target: PlayerState): void {
  const ang = Math.atan2(target.y - boss.y, target.x - boss.x);
  for (const off of [-BOSS_PROJ_SPREAD, 0, BOSS_PROJ_SPREAD]) {
    const a = ang + off;
    ctx.projectiles.push({
      id: `bp_${(++seq).toString(36)}`,
      ownerId: boss.id,
      x: boss.x,
      y: boss.y,
      vx: Math.cos(a) * BOSS_PROJ_SPEED,
      vy: Math.sin(a) * BOSS_PROJ_SPEED,
      dmg: BOSS_PROJ_DMG,
      slowMs: 0,
      ability: BOSS_BOLT_SPRITE,
      ttl: BOSS_PROJ_LIFE,
      hitR: BOSS_PROJ_RADIUS,
      boss: true,
    });
  }
  ctx.pushFx({ e: "cast", x: boss.x, y: boss.y, ability: BOSS_BOLT_SPRITE });
}

function pickTarget(ctx: WorldCtx, boss: BossState): PlayerState | null {
  let best: PlayerState | null = null;
  let bestThreat = 0;
  for (const [id, v] of boss.threat) {
    const p = ctx.players.get(id);
    if (p && p.status === "alive" && v > bestThreat) {
      best = p;
      bestThreat = v;
    }
  }
  if (best) return best;

  // No threat yet — chase the nearest living player (boss has unlimited range).
  let near: PlayerState | null = null;
  let nd = Infinity;
  for (const p of ctx.players.values()) {
    if (p.status !== "alive") continue;
    const dx = p.x - boss.x;
    const dy = p.y - boss.y;
    const d = dx * dx + dy * dy;
    if (d < nd) {
      nd = d;
      near = p;
    }
  }
  return near;
}
