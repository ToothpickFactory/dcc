import {
  BOSS_BOLT_SPRITE,
  BOSS_CAST_CD,
  BOSS_CAST_WINDUP_MS,
  BOSS_MELEE_CD,
  BOSS_MELEE_DMG,
  BOSS_MELEE_WINDUP_MS,
  BOSS_MELEE_RANGE,
  BOSS_PROJ_DMG,
  BOSS_PROJ_LIFE,
  BOSS_PROJ_RADIUS,
  BOSS_PROJ_SPEED,
  BOSS_PROJ_SPREAD,
  BOSS_RADIUS,
  BOSS_SPEED,
} from "../../shared/constants";
import type { BossState, PlayerState, WorldCtx } from "../state";
import { applyDamage } from "./combat";
import { moveWithWorldCollisions } from "./collision";
import { leadTarget } from "./monsters";

let seq = 0;

// Boss AI (ported from the monolith): chase the highest-threat player, melee in
// range, and fire dodgeable straight-line bolt volleys.
export function updateBoss(ctx: WorldCtx, dt: number): void {
  const boss = ctx.boss;
  if (!boss) return;
  if (boss.dead) {
    if (ctx.corpseLootExists(boss.id)) return;
    ctx.boss = null; // cleared the tick after death (events already emitted)
    return;
  }

  // Hard CC: a stun/freeze fully locks the boss out (its wind-ups were cancelled when the
  // CC landed) — the floor's interrupt window. A root only pins its movement (below).
  if (boss.ccUntil > ctx.now && (boss.ccKind === "stun" || boss.ccKind === "freeze")) return;

  // Resolve a pending melee wind-up: the swing lands if a prey is still in range
  // (step out during the tell to dodge it).
  if (boss.meleeWindupUntil > 0 && ctx.now >= boss.meleeWindupUntil) {
    boss.meleeWindupUntil = 0;
    const t = pickTarget(ctx, boss);
    if (t && Math.hypot(t.x - boss.x, t.y - boss.y) <= BOSS_MELEE_RANGE + 14) {
      ctx.pushFx({ e: "melee", by: boss.id });
      applyDamage(ctx, t, BOSS_MELEE_DMG * boss.dmgMult, boss.id, false);
    }
  }
  // Resolve a pending bolt-fan wind-up: fire at the locked target's CURRENT position.
  if (boss.castWindupUntil > 0 && ctx.now >= boss.castWindupUntil) {
    boss.castWindupUntil = 0;
    const t = ctx.players.get(boss.castTarget) ?? pickTarget(ctx, boss);
    if (t) bossCast(ctx, boss, t);
  }

  const prey = pickTarget(ctx, boss);
  if (!prey) return;

  const dx = prey.x - boss.x;
  const dy = prey.y - boss.y;
  const d = Math.hypot(dx, dy) || 1;
  boss.aim = Math.atan2(dy, dx);

  // While winding up a melee swing, the boss is committed — plant (no chase/new attack).
  if (boss.meleeWindupUntil > ctx.now) return;

  const rooted = boss.ccUntil > ctx.now; // ccKind === "root" here — pin movement, keep melee/cast
  if (d > BOSS_MELEE_RANGE) {
    if (!rooted) moveWithWorldCollisions(ctx, boss, (dx / d) * BOSS_SPEED * dt, (dy / d) * BOSS_SPEED * dt, BOSS_RADIUS);
  } else if (ctx.now >= boss.meleeReadyAt) {
    // Telegraph the heavy swing — resolved above after the wind-up.
    boss.meleeReadyAt = ctx.now + BOSS_MELEE_CD + BOSS_MELEE_WINDUP_MS;
    boss.meleeWindupUntil = ctx.now + BOSS_MELEE_WINDUP_MS;
    ctx.pushFx({ e: "windup", by: boss.id, x: boss.x, y: boss.y, ms: BOSS_MELEE_WINDUP_MS });
  }

  if (ctx.now >= boss.castReadyAt && boss.castWindupUntil === 0) {
    // Telegraph the bolt fan — gives you a beat to pre-dodge the line.
    boss.castReadyAt = ctx.now + BOSS_CAST_CD + BOSS_CAST_WINDUP_MS;
    boss.castWindupUntil = ctx.now + BOSS_CAST_WINDUP_MS;
    boss.castTarget = prey.id;
    ctx.pushFx({ e: "windup", by: boss.id, x: boss.x, y: boss.y, ms: BOSS_CAST_WINDUP_MS });
  }
}

// A spread of straight-line bolts aimed where the player is NOW — dodge by
// stepping out of the line. Boss bolts only affect players (see projectiles.ts).
function bossCast(ctx: WorldCtx, boss: BossState, target: PlayerState): void {
  const lt = leadTarget(ctx, target);
  const ang = Math.atan2(lt.y - boss.y, lt.x - boss.x);
  for (const off of [-BOSS_PROJ_SPREAD, 0, BOSS_PROJ_SPREAD]) {
    const a = ang + off;
    ctx.projectiles.push({
      id: `bp_${(++seq).toString(36)}`,
      ownerId: boss.id,
      x: boss.x,
      y: boss.y,
      vx: Math.cos(a) * BOSS_PROJ_SPEED,
      vy: Math.sin(a) * BOSS_PROJ_SPEED,
      dmg: BOSS_PROJ_DMG * boss.dmgMult,
      slowMs: 0,
      ability: BOSS_BOLT_SPRITE,
      proj: "fire",
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
    if (p && p.status === "alive" && !p.reached && v > bestThreat) {
      best = p;
      bestThreat = v;
    }
  }
  if (best) return best;

  // No threat yet — chase the nearest living player (boss has unlimited range).
  let near: PlayerState | null = null;
  let nd = Infinity;
  for (const p of ctx.players.values()) {
    if (p.status !== "alive" || p.reached) continue;
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
