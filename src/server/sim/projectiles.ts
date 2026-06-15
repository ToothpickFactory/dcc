import {
  AGGRO_HEAL_RADIUS,
  AGGRO_PER_HEAL,
  BOSS_PROJ_RADIUS,
  BOSS_RADIUS,
  MONSTER_RADIUS,
  PLAYER_RADIUS,
  PROJECTILE_RADIUS,
} from "../../shared/constants";
import type { BossState, MonsterState, PlayerState, ProjectileState, WorldCtx } from "../state";
import { applyDamage, applyHeal } from "./combat";

let seq = 0;

// Resolve a cast in the aim direction. BALLISTIC — there is no homing/target.
// Returns true if the cast fired (off cooldown).
export function castAbility(ctx: WorldCtx, caster: PlayerState, idx: number, aim: number): boolean {
  const ab = caster.abilities[idx];
  if (!ab) return false;
  if ((caster.cds[idx] ?? 0) > ctx.now) return false;
  caster.cds[idx] = ctx.now + ab.cd;
  caster.aim = aim;
  ctx.pushFx({ e: "cast", x: caster.x, y: caster.y, ability: idx });

  if (ab.projectile) {
    const speed = ab.speed ?? 600;
    ctx.projectiles.push({
      id: `pr_${(++seq).toString(36)}`,
      ownerId: caster.id,
      x: caster.x + Math.cos(aim) * (PLAYER_RADIUS + 4),
      y: caster.y + Math.sin(aim) * (PLAYER_RADIUS + 4),
      vx: Math.cos(aim) * speed,
      vy: Math.sin(aim) * speed,
      dmg: ab.dmg, // negative = heal projectile
      slowMs: ab.slowMs ?? 0,
      ability: idx,
      ttl: ab.range / speed,
      boss: false,
    });
    // Casting a heal aggravates nearby foes (ported): support play has a cost.
    if (ab.dmg < 0) {
      const threat = -ab.dmg * AGGRO_PER_HEAL;
      for (const m of ctx.monsters) {
        if (!m.dead && near(caster, m, AGGRO_HEAL_RADIUS)) m.threat.set(caster.id, (m.threat.get(caster.id) ?? 0) + threat);
      }
      if (ctx.boss && !ctx.boss.dead && near(caster, ctx.boss, AGGRO_HEAL_RADIUS)) {
        ctx.boss.threat.set(caster.id, (ctx.boss.threat.get(caster.id) ?? 0) + threat);
      }
    }
    return true;
  }

  // Melee cone (non-projectile): hit monsters, the boss, and OTHER players.
  const cone = Math.PI / 3;
  for (const m of ctx.monsters) {
    if (m.dead) continue;
    if (inCone(caster, m, aim, ab.range, cone)) applyDamage(ctx, m, ab.dmg, caster.id, true, ab.slowMs);
  }
  if (ctx.boss && !ctx.boss.dead && inCone(caster, ctx.boss, aim, ab.range, cone)) {
    applyDamage(ctx, ctx.boss, ab.dmg, caster.id, true, ab.slowMs);
  }
  for (const p of ctx.players.values()) {
    if (p.id === caster.id || p.status !== "alive") continue;
    if (inCone(caster, p, aim, ab.range, cone)) applyDamage(ctx, p, ab.dmg, caster.id, true, ab.slowMs);
  }
  return true;
}

function near(a: { x: number; y: number }, b: { x: number; y: number }, range: number): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) <= range;
}

function inCone(
  from: { x: number; y: number },
  to: { x: number; y: number },
  aim: number,
  range: number,
  cone: number,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) > range) return false;
  let d = Math.atan2(dy, dx) - aim;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= cone / 2;
}

// Advance projectiles. Boss bolts hit players only. A player's projectile hits
// the first thing it overlaps — monster, boss, or another player. Damage spells
// hurt; heal spells (negative dmg) mend whatever they strike (friend OR foe).
export function stepProjectiles(ctx: WorldCtx, dt: number): void {
  ctx.projectiles = ctx.projectiles.filter((pr) => {
    pr.ttl -= dt;
    if (pr.ttl <= 0) return false;
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;

    if (pr.boss) {
      for (const p of ctx.players.values()) {
        if (p.status !== "alive") continue;
        if (hit(pr.x, pr.y, p.x, p.y, BOSS_PROJ_RADIUS + PLAYER_RADIUS)) {
          applyDamage(ctx, p, pr.dmg, pr.ownerId, false, pr.slowMs);
          ctx.pushFx({ e: "hit", x: pr.x, y: pr.y, ability: pr.ability });
          return false;
        }
      }
      return true;
    }

    const isHeal = pr.dmg < 0;
    for (const m of ctx.monsters) {
      if (m.dead) continue;
      if (hit(pr.x, pr.y, m.x, m.y, PROJECTILE_RADIUS + MONSTER_RADIUS)) {
        resolve(ctx, m, pr, isHeal);
        return false;
      }
    }
    if (ctx.boss && !ctx.boss.dead && hit(pr.x, pr.y, ctx.boss.x, ctx.boss.y, PROJECTILE_RADIUS + BOSS_RADIUS)) {
      resolve(ctx, ctx.boss, pr, isHeal);
      return false;
    }
    for (const p of ctx.players.values()) {
      if (p.id === pr.ownerId || p.status !== "alive") continue; // can't hit yourself
      if (hit(pr.x, pr.y, p.x, p.y, PROJECTILE_RADIUS + PLAYER_RADIUS)) {
        resolve(ctx, p, pr, isHeal);
        return false;
      }
    }
    return true;
  });
}

function resolve(
  ctx: WorldCtx,
  target: PlayerState | MonsterState | BossState,
  pr: ProjectileState,
  isHeal: boolean,
): void {
  if (isHeal) applyHeal(ctx, target, -pr.dmg, pr.ownerId);
  else applyDamage(ctx, target, pr.dmg, pr.ownerId, true, pr.slowMs);
  ctx.pushFx({ e: "hit", x: pr.x, y: pr.y, ability: pr.ability });
}

function hit(ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy <= r * r;
}
