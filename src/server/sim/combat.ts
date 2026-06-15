import { MONSTER_MAX_HP, MONSTER_RESPAWN_MS, PLAYER_MAX_HP } from "../../shared/constants";
import type { BossState, MonsterState, PlayerState, WorldCtx } from "../state";

function isPlayer(t: PlayerState | MonsterState | BossState): t is PlayerState {
  return (t as PlayerState).status !== undefined;
}
function isBoss(t: PlayerState | MonsterState | BossState): t is BossState {
  return (t as BossState).tag === "boss";
}

// Everyone who has drawn threat on a foe (i.e. helped wear it down) but didn't
// land the finishing blow gets a teamwork assist — feeds the profile's
// teamwork axis without rewarding kill-stealing.
function awardAssists(ctx: WorldCtx, threat: Map<string, number>, killerId: string): void {
  for (const [pid, v] of threat) {
    if (pid === killerId || v <= 0) continue;
    const p = ctx.players.get(pid);
    if (p && p.status === "alive") ctx.pushPlay({ e: "assist", by: pid });
  }
}

// The single damage funnel. Friendly fire is just a player damaging a player —
// nothing special-cases it, because the server never trusts the client. This is
// the anti-cheat bedrock; keep ALL damage flowing through here. Heals go through
// applyHeal below, so dmg here is always positive.
//
// `ability` + `hitRange` (distance from the attacker to the target at impact)
// are threaded through so the playstyle profile can infer ranged vs melee from
// how the hit actually landed, not which ability slot was used.
export function applyDamage(
  ctx: WorldCtx,
  target: PlayerState | MonsterState | BossState,
  dmg: number,
  sourceId: string,
  sourceIsPlayer: boolean,
  slowMs = 0,
  ability = 0,
  hitRange = 0,
): void {
  if (isPlayer(target)) {
    if (target.status !== "alive") return;
    if (sourceIsPlayer && sourceId !== target.id) {
      ctx.pushPlay({ e: "hit", by: sourceId, targetKind: "player", range: hitRange, ability });
    }
    target.hp -= dmg;
    if (slowMs > 0) target.slowUntil = Math.max(target.slowUntil, ctx.now + slowMs);
    ctx.pushFx({ e: "dmg", x: target.x, y: target.y, amount: dmg });
    if (sourceIsPlayer && sourceId !== target.id) {
      ctx.pushPlay({ e: "friendlyFire", by: sourceId, amount: dmg });
    }
    if (target.hp <= 0) {
      // PERMADEATH (Phase 0): no respawn — the player becomes a spectator.
      target.status = "spectator";
      target.mvx = 0;
      target.mvy = 0;
      ctx.pushFx({ e: "death", x: target.x, y: target.y, id: target.id });
      if (sourceIsPlayer && sourceId !== target.id) {
        ctx.pushPlay({ e: "kill", by: sourceId, targetKind: "player" });
      }
    }
    return;
  }

  if (isBoss(target)) {
    if (target.dead) return;
    if (sourceIsPlayer) {
      target.threat.set(sourceId, (target.threat.get(sourceId) ?? 0) + dmg);
      ctx.pushPlay({ e: "hit", by: sourceId, targetKind: "monster", range: hitRange, ability });
    }
    target.hp -= dmg;
    ctx.pushFx({ e: "dmg", x: target.x, y: target.y, amount: dmg });
    if (target.hp <= 0) {
      target.dead = true;
      ctx.pushFx({ e: "boss", x: target.x, y: target.y, state: "dead" });
      ctx.pushFx({ e: "death", x: target.x, y: target.y, id: target.id });
      if (sourceIsPlayer) {
        ctx.pushPlay({ e: "kill", by: sourceId, targetKind: "monster" });
        awardAssists(ctx, target.threat, sourceId);
      }
    }
    return;
  }

  // Monster target.
  if (target.dead) return;
  if (sourceIsPlayer) {
    // Threat-based aggro (combat note): damage from a player draws aggro.
    target.threat.set(sourceId, (target.threat.get(sourceId) ?? 0) + dmg);
    ctx.pushPlay({ e: "hit", by: sourceId, targetKind: "monster", range: hitRange, ability });
  }
  if (slowMs > 0) target.slowUntil = Math.max(target.slowUntil, ctx.now + slowMs);
  target.hp -= dmg;
  ctx.pushFx({ e: "dmg", x: target.x, y: target.y, amount: dmg });
  if (target.hp <= 0) {
    target.dead = true;
    target.respawnAt = ctx.now + MONSTER_RESPAWN_MS;
    ctx.pushFx({ e: "death", x: target.x, y: target.y, id: target.id });
    if (sourceIsPlayer) {
      ctx.pushPlay({ e: "kill", by: sourceId, targetKind: "monster" });
      awardAssists(ctx, target.threat, sourceId);
    }
  }
}

// Heal the first thing a heal projectile strikes — ally, monster, or boss
// (aim carefully). Clamped to each target's max. Healing an ally feeds the
// support/teamwork playstyle axis.
export function applyHeal(
  ctx: WorldCtx,
  target: PlayerState | MonsterState | BossState,
  amount: number,
  sourceId: string,
): void {
  if (isPlayer(target)) {
    if (target.status !== "alive") return;
    target.hp = Math.min(PLAYER_MAX_HP, target.hp + amount);
    if (sourceId !== target.id) ctx.pushPlay({ e: "heal", by: sourceId, amount, ally: true });
  } else if (isBoss(target)) {
    if (target.dead) return;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    if (sourceId) ctx.pushPlay({ e: "heal", by: sourceId, amount, ally: false });
  } else {
    if (target.dead) return;
    target.hp = Math.min(MONSTER_MAX_HP, target.hp + amount);
    if (sourceId) ctx.pushPlay({ e: "heal", by: sourceId, amount, ally: false });
  }
  ctx.pushFx({ e: "heal", x: target.x, y: target.y, amount });
}
