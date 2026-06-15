import { moveWithCollisions, randomWalkablePosition } from "../../procgen/collision";
import { MONSTER_AGGRO, MONSTER_BOLT_SPRITE, MONSTER_KINDS, SLOW_FACTOR, THREAT_DECAY } from "../../shared/constants";
import type { MonsterState, PlayerState, WorldCtx } from "../state";
import { applyDamage } from "./combat";

let seq = 0;

// Per-kind monster AI (Stream B). All kinds use threat-based aggro — chase
// whoever has hit them most, else the nearest player in range. They differ in
// stats (HP/speed/damage/reach) and in HOW they engage:
//   grunt — baseline melee chaser
//   brute — slow, tanky, heavy melee
//   swarm — fast, fragile, light melee
//   ranged — kites to a standoff and fires dodgeable bolts (no melee)
export function updateMonsters(ctx: WorldCtx, dt: number): void {
  for (const m of ctx.monsters) {
    const def = MONSTER_KINDS[m.kind];
    if (m.dead) {
      // Respawn so collective kills keep accruing toward the boss trigger.
      if (ctx.now >= m.respawnAt) {
        m.dead = false;
        m.hp = m.maxHp;
        const spawn = randomWalkablePosition(ctx.floor.collision, def.radius);
        m.x = spawn.x;
        m.y = spawn.y;
        m.slowUntil = 0;
        m.threat.clear();
      }
      continue;
    }

    // Decay threat every tick so aggro eventually resets.
    for (const [id, v] of m.threat) {
      const nv = v * THREAT_DECAY;
      if (nv < 0.5) m.threat.delete(id);
      else m.threat.set(id, nv);
    }

    const speed = def.speed * (m.slowUntil > ctx.now ? SLOW_FACTOR : 1);
    const prey = pickTarget(ctx, m);

    if (!prey) {
      wander(ctx, m, speed, dt);
      continue;
    }

    const dx = prey.x - m.x;
    const dy = prey.y - m.y;
    const d = Math.hypot(dx, dy) || 1;
    m.aim = Math.atan2(dy, dx);

    if (def.ranged) {
      // Kite: back off if too close, close in if out of shooting range, else hold.
      const r = def.ranged;
      if (d < r.kite) {
        moveWithCollisions(ctx.floor.collision, m, -(dx / d) * speed * dt, -(dy / d) * speed * dt, def.radius);
      } else if (d > r.shootRange) {
        moveWithCollisions(ctx.floor.collision, m, (dx / d) * speed * dt, (dy / d) * speed * dt, def.radius);
      }
      if (d <= r.shootRange && ctx.now >= m.attackReadyAt) {
        m.attackReadyAt = ctx.now + def.attackCd;
        shoot(ctx, m, prey, r.projSpeed, r.projDmg);
      }
    } else if (d <= def.meleeRange) {
      if (ctx.now >= m.attackReadyAt) {
        m.attackReadyAt = ctx.now + def.attackCd;
        applyDamage(ctx, prey, def.dmg, m.id, false);
      }
    } else {
      moveWithCollisions(ctx.floor.collision, m, (dx / d) * speed * dt, (dy / d) * speed * dt, def.radius);
    }
  }
}

// Straight-line monster bolt — dodgeable, affects players only (boss=true path).
function shoot(ctx: WorldCtx, m: MonsterState, prey: PlayerState, projSpeed: number, projDmg: number): void {
  const ang = Math.atan2(prey.y - m.y, prey.x - m.x);
  ctx.projectiles.push({
    id: `mb_${(++seq).toString(36)}`,
    ownerId: m.id,
    x: m.x + Math.cos(ang) * (MONSTER_KINDS[m.kind].radius + 4),
    y: m.y + Math.sin(ang) * (MONSTER_KINDS[m.kind].radius + 4),
    vx: Math.cos(ang) * projSpeed,
    vy: Math.sin(ang) * projSpeed,
    dmg: projDmg,
    slowMs: 0,
    ability: MONSTER_BOLT_SPRITE,
    ttl: 4,
    hitR: 7,
    boss: true,
  });
  ctx.pushFx({ e: "cast", x: m.x, y: m.y, ability: MONSTER_BOLT_SPRITE });
}

function wander(ctx: WorldCtx, m: MonsterState, speed: number, dt: number): void {
  if (ctx.now >= m.wanderAt) {
    m.wanderAt = ctx.now + 2000 + Math.random() * 3000;
    m.aim = Math.random() * Math.PI * 2;
  }
  moveWithCollisions(
    ctx.floor.collision,
    m,
    Math.cos(m.aim) * speed * 0.5 * dt,
    Math.sin(m.aim) * speed * 0.5 * dt,
    MONSTER_KINDS[m.kind].radius,
  );
}

// Threat-based aggro: chase whoever has hit it most, falling back to the nearest
// player in range when no one has drawn threat.
function pickTarget(ctx: WorldCtx, m: MonsterState): PlayerState | null {
  let best: PlayerState | null = null;
  let bestThreat = 0;
  for (const [id, v] of m.threat) {
    const p = ctx.players.get(id);
    if (p && p.status === "alive" && v > bestThreat) {
      best = p;
      bestThreat = v;
    }
  }
  if (best) return best;

  let near: PlayerState | null = null;
  let nd = MONSTER_AGGRO * MONSTER_AGGRO;
  for (const p of ctx.players.values()) {
    if (p.status !== "alive") continue;
    const dx = p.x - m.x;
    const dy = p.y - m.y;
    const d = dx * dx + dy * dy;
    if (d < nd) {
      nd = d;
      near = p;
    }
  }
  return near;
}

