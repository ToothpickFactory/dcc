import {
  MONSTER_AGGRO,
  MONSTER_ATTACK_CD,
  MONSTER_DMG,
  MONSTER_MAX_HP,
  MONSTER_MELEE_RANGE,
  MONSTER_SPEED,
  SLOW_FACTOR,
  THREAT_DECAY,
  WORLD,
} from "../../shared/constants";
import type { MonsterState, PlayerState, WorldCtx } from "../state";
import { applyDamage } from "./combat";

// Threat-based aggro (combat note): a monster chases whoever has hit it most,
// falling back to the nearest player in range when no one has drawn threat.
export function updateMonsters(ctx: WorldCtx, dt: number): void {
  for (const m of ctx.monsters) {
    if (m.dead) {
      // Respawn so collective kills keep accruing toward the boss trigger.
      if (ctx.now >= m.respawnAt) {
        m.dead = false;
        m.hp = MONSTER_MAX_HP;
        m.x = 200 + Math.random() * (WORLD.w - 400);
        m.y = 200 + Math.random() * (WORLD.h - 400);
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

    const speed = MONSTER_SPEED * (m.slowUntil > ctx.now ? SLOW_FACTOR : 1);
    const prey = pickTarget(ctx, m);
    if (prey) {
      const dx = prey.x - m.x;
      const dy = prey.y - m.y;
      const d = Math.hypot(dx, dy) || 1;
      m.aim = Math.atan2(dy, dx);
      if (d <= MONSTER_MELEE_RANGE) {
        if (ctx.now >= m.attackReadyAt) {
          m.attackReadyAt = ctx.now + MONSTER_ATTACK_CD;
          applyDamage(ctx, prey, MONSTER_DMG, m.id, false);
        }
      } else {
        m.x += (dx / d) * speed * dt;
        m.y += (dy / d) * speed * dt;
      }
    } else {
      // Wander.
      if (ctx.now >= m.wanderAt) {
        m.wanderAt = ctx.now + 2000 + Math.random() * 3000;
        m.aim = Math.random() * Math.PI * 2;
      }
      m.x = clamp(m.x + Math.cos(m.aim) * speed * 0.5 * dt, 24, WORLD.w - 24);
      m.y = clamp(m.y + Math.sin(m.aim) * speed * 0.5 * dt, 24, WORLD.h - 24);
    }
  }
}

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

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
