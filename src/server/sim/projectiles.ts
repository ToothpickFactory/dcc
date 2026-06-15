import { BOSS_PROJ_RADIUS, BOSS_RADIUS, MONSTER_RADIUS, PLAYER_RADIUS, PROJECTILE_RADIUS } from "../../shared/constants";
import type { PlayerState, WorldCtx } from "../state";
import { applyDamage } from "./combat";

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
      dmg: ab.dmg,
      slowMs: ab.slowMs ?? 0,
      ability: idx,
      ttl: ab.range / speed,
      boss: false,
    });
    return true;
  }

  // Self heal.
  if (ab.dmg < 0 && ab.range === 0) {
    applyDamage(ctx, caster, ab.dmg, caster.id, true);
    return true;
  }

  // Melee cone: hit monsters, the boss, and OTHER players within range and ~60°.
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
// the first thing it overlaps — monster, boss, or another player (friendly fire).
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

    for (const m of ctx.monsters) {
      if (m.dead) continue;
      if (hit(pr.x, pr.y, m.x, m.y, PROJECTILE_RADIUS + MONSTER_RADIUS)) {
        applyDamage(ctx, m, pr.dmg, pr.ownerId, true, pr.slowMs);
        ctx.pushFx({ e: "hit", x: pr.x, y: pr.y, ability: pr.ability });
        return false;
      }
    }
    if (ctx.boss && !ctx.boss.dead && hit(pr.x, pr.y, ctx.boss.x, ctx.boss.y, PROJECTILE_RADIUS + BOSS_RADIUS)) {
      applyDamage(ctx, ctx.boss, pr.dmg, pr.ownerId, true, pr.slowMs);
      ctx.pushFx({ e: "hit", x: pr.x, y: pr.y, ability: pr.ability });
      return false;
    }
    for (const p of ctx.players.values()) {
      if (p.id === pr.ownerId || p.status !== "alive") continue;
      if (hit(pr.x, pr.y, p.x, p.y, PROJECTILE_RADIUS + PLAYER_RADIUS)) {
        applyDamage(ctx, p, pr.dmg, pr.ownerId, true, pr.slowMs); // friendly fire
        ctx.pushFx({ e: "hit", x: pr.x, y: pr.y, ability: pr.ability });
        return false;
      }
    }
    return true;
  });
}

function hit(ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy <= r * r;
}
