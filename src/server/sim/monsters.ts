import { randomWalkablePosition } from "../../procgen/collision";
import { BRUTE_WINDUP_MULT, KNOCK_MS, MELEE_WINDUP_MS, MONSTER_AGGRO, MONSTER_BOLT_SPRITE, MONSTER_KINDS, SLOW_FACTOR, THREAT_DECAY } from "../../shared/constants";
import type { BossState, MonsterState, PlayerState, WorldCtx } from "../state";
import { applyDamage, applyHeal } from "./combat";
import { moveWithWorldCollisions } from "./collision";

let seq = 0;

// Per-kind monster AI (Stream B). All kinds use threat-based aggro — chase
// whoever has hit them most, else the nearest player in range. They differ in
// stats (HP/speed/damage/reach) and in HOW they engage:
//   grunt — baseline melee chaser
//   brute — slow, tanky, heavy melee
//   swarm — fast, fragile, light melee
//   ranged — kites to a standoff and fires dodgeable bolts (no melee)
//   healer — hangs at the back of its camp, mends the most-wounded ally (group play)
export function updateMonsters(ctx: WorldCtx, dt: number): void {
  for (const m of ctx.monsters) {
    const def = MONSTER_KINDS[m.kind];
    if (m.dead) {
      if (ctx.corpseLootExists(m.id)) continue;
      // Respawn so collective kills keep accruing toward the boss trigger.
      if (ctx.now >= m.respawnAt) {
        m.dead = false;
        m.hp = m.maxHp;
        const spawn = randomWalkablePosition(ctx.floor.collision, def.radius);
        m.x = spawn.x;
        m.y = spawn.y;
        m.slowUntil = 0;
        m.ccUntil = 0;
        m.ccKind = "";
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

    // Knockback: shoved back + staggered by a player hit — no AI act this tick.
    if (m.knockUntil > ctx.now) {
      const kf = (m.knockUntil - ctx.now) / KNOCK_MS; // 1 -> 0 decay over the impulse
      moveWithWorldCollisions(ctx, m, m.knockVx * kf * dt, m.knockVy * kf * dt, def.radius);
      continue;
    }

    // Hard CC: a stun/freeze fully locks the monster out (no act, no move) — a wind-up
    // was already cancelled when the CC landed. A root (handled below via speed=0) only
    // stops movement, so a rooted foe can still swing if you stay in its reach.
    if (m.ccUntil > ctx.now && (m.ccKind === "stun" || m.ccKind === "freeze")) continue;

    // Resolve a pending melee wind-up: the hit lands now — UNLESS you stepped out of
    // range during the tell (the dodge payoff). Then it whiffs.
    if (m.windupUntil > 0 && ctx.now >= m.windupUntil) {
      m.windupUntil = 0;
      const tgt = ctx.players.get(m.windupTarget);
      if (tgt && tgt.status === "alive" && !tgt.reached && Math.hypot(tgt.x - m.x, tgt.y - m.y) <= def.meleeRange + 10) {
        ctx.pushFx({ e: "melee", by: m.id });
        applyDamage(ctx, tgt, def.dmg * m.dmgMult, m.id, false);
      }
    }
    // While winding up, the monster is committed to the swing — plant + face, no move.
    if (m.windupUntil > ctx.now) {
      const t = ctx.players.get(m.windupTarget);
      if (t) m.aim = Math.atan2(t.y - m.y, t.x - m.x);
      continue;
    }

    // A root (the only CC still active here — stun/freeze returned above) pins movement
    // to 0 while letting attacks resolve; otherwise a slow halves speed.
    const rooted = m.ccUntil > ctx.now; // ccKind === "root" at this point
    const speed = rooted ? 0 : m.derived.moveSpeed * (m.slowUntil > ctx.now ? SLOW_FACTOR : 1);
    const prey = pickTarget(ctx, m);

    if (def.heal) {
      updateHealer(ctx, m, def.heal, prey, speed, dt);
      continue;
    }

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
        moveWithWorldCollisions(ctx, m, -(dx / d) * speed * dt, -(dy / d) * speed * dt, def.radius);
      } else if (d > r.shootRange) {
        moveWithWorldCollisions(ctx, m, (dx / d) * speed * dt, (dy / d) * speed * dt, def.radius);
      }
      if (d <= r.shootRange && ctx.now >= m.attackReadyAt) {
        m.attackReadyAt = ctx.now + def.attackCd;
        shoot(ctx, m, prey, r.projSpeed, r.projDmg * m.dmgMult);
      }
    } else if (d <= def.meleeRange) {
      if (ctx.now >= m.attackReadyAt) {
        // Telegraph: start a wind-up; damage lands later (resolved above) if you stay close.
        const windup = MELEE_WINDUP_MS * (m.kind === "brute" ? BRUTE_WINDUP_MULT : 1);
        m.windupUntil = ctx.now + windup;
        m.windupTarget = prey.id;
        m.attackReadyAt = ctx.now + def.attackCd + windup;
        ctx.pushFx({ e: "windup", by: m.id, x: m.x, y: m.y, ms: Math.round(windup) });
      }
    } else {
      moveWithWorldCollisions(ctx, m, (dx / d) * speed * dt, (dy / d) * speed * dt, def.radius);
    }
  }
}

// Aim point that LEADS a moving target — deeper floors predict further ahead (capped),
// so ranged enemies threaten a running player as you descend. Floor 1 ≈ aim at current pos.
export function leadTarget(ctx: WorldCtx, prey: PlayerState): { x: number; y: number } {
  const lead = Math.min(0.35, ctx.floor.depth * 0.025);
  const l = Math.hypot(prey.mvx, prey.mvy);
  if (l < 0.1 || lead <= 0) return { x: prey.x, y: prey.y };
  return { x: prey.x + (prey.mvx / l) * prey.derived.moveSpeed * lead, y: prey.y + (prey.mvy / l) * prey.derived.moveSpeed * lead };
}

// Straight-line monster bolt — dodgeable, affects players only (boss=true path).
function shoot(ctx: WorldCtx, m: MonsterState, prey: PlayerState, projSpeed: number, projDmg: number): void {
  const t = leadTarget(ctx, prey);
  const ang = Math.atan2(t.y - m.y, t.x - m.x);
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
    proj: "fire",
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
  moveWithWorldCollisions(
    ctx,
    m,
    Math.cos(m.aim) * speed * 0.5 * dt,
    Math.sin(m.aim) * speed * 0.5 * dt,
    MONSTER_KINDS[m.kind].radius,
  );
}

// Healer/support AI: stays at the back of its camp and mends the most-wounded
// ally (monster or boss). Kites away from any threatening player to survive, and
// drifts toward a wounded ally when it's out of heal range — so a camp with a
// medic is much stickier than a lone pack (group play, by design).
function updateHealer(
  ctx: WorldCtx,
  m: MonsterState,
  heal: NonNullable<(typeof MONSTER_KINDS)[keyof typeof MONSTER_KINDS]["heal"]>,
  prey: PlayerState | null,
  speed: number,
  dt: number,
): void {
  const radius = MONSTER_KINDS[m.kind].radius;

  // Kite: if a player is closing in, back away to keep healing from the rear.
  if (prey) {
    const px = prey.x - m.x;
    const py = prey.y - m.y;
    const pd = Math.hypot(px, py) || 1;
    m.aim = Math.atan2(py, px);
    if (pd < heal.kite) {
      moveWithWorldCollisions(ctx, m, -(px / pd) * speed * dt, -(py / pd) * speed * dt, radius);
    }
  }

  // Find the most-wounded ally (by HP fraction) within range that isn't full.
  const ally = mostWoundedAlly(ctx, m, heal.range);
  if (ally) {
    if (ctx.now >= m.attackReadyAt) {
      m.attackReadyAt = ctx.now + heal.cd;
      m.aim = Math.atan2(ally.y - m.y, ally.x - m.x);
      applyHeal(ctx, ally, heal.amount, m.id);
      ctx.pushFx({ e: "cast", x: m.x, y: m.y, ability: MONSTER_BOLT_SPRITE });
    }
    return;
  }

  // Nobody to heal in range: drift toward the most-wounded ally anywhere, else
  // wander, so it regroups with its camp instead of stranding itself.
  if (!prey) {
    const far = mostWoundedAlly(ctx, m, Infinity);
    if (far) {
      const dx = far.x - m.x;
      const dy = far.y - m.y;
      const d = Math.hypot(dx, dy) || 1;
      m.aim = Math.atan2(dy, dx);
      moveWithWorldCollisions(ctx, m, (dx / d) * speed * dt, (dy / d) * speed * dt, radius);
    } else {
      wander(ctx, m, speed, dt);
    }
  }
}

// The ally (other living monster, or the boss) with the lowest HP fraction that
// is missing health and within `range`. Healers never target themselves.
function mostWoundedAlly(ctx: WorldCtx, m: MonsterState, range: number): MonsterState | BossState | null {
  let best: MonsterState | BossState | null = null;
  let bestFrac = 1;
  const consider = (a: MonsterState | BossState, max: number) => {
    if (a.hp >= max) return;
    const dx = a.x - m.x;
    const dy = a.y - m.y;
    if (Math.hypot(dx, dy) > range) return;
    const frac = a.hp / max;
    if (frac < bestFrac) {
      bestFrac = frac;
      best = a;
    }
  };
  for (const other of ctx.monsters) {
    if (other === m || other.dead) continue;
    consider(other, other.maxHp);
  }
  if (ctx.boss && !ctx.boss.dead) consider(ctx.boss, ctx.boss.maxHp);
  return best;
}

// Threat-based aggro: chase whoever has hit it most, falling back to the nearest
// player in range when no one has drawn threat.
function pickTarget(ctx: WorldCtx, m: MonsterState): PlayerState | null {
  let best: PlayerState | null = null;
  let bestThreat = 0;
  for (const [id, v] of m.threat) {
    const p = ctx.players.get(id);
    if (p && p.status === "alive" && !p.reached && v > bestThreat) {
      best = p;
      bestThreat = v;
    }
  }
  if (best) return best;

  let near: PlayerState | null = null;
  let nd = MONSTER_AGGRO * MONSTER_AGGRO;
  for (const p of ctx.players.values()) {
    if (p.status !== "alive" || p.reached) continue;
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

