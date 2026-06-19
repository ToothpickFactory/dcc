import { CRIT_MULT, FREEZE_SLOW_TAIL_MS, KNOCK_MS, KNOCK_RESIST, KNOCK_SPEED, MONSTER_RESPAWN_MS } from "../../shared/constants";
import { allItems, emptyInventory } from "../../shared/items";
import type { StatusEffect } from "../../protocol";
import type { Ability } from "../../shared/types";
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
  knockMult = 1,
  statusOverride?: StatusEffect,
): void {
  // Player attacks can critically strike (scaled by crit chance) and tanks
  // generate extra threat. Resolve both once, up front, for all target types.
  let crit = false;
  let threatMult = 1;
  let status: StatusEffect | undefined = statusOverride;
  if (sourceIsPlayer) {
    const attacker = ctx.players.get(sourceId);
    if (attacker) {
      status = status ?? statusForAbility(attacker.abilities[ability]);
      threatMult = attacker.threatMult;
      if (dmg > 0 && Math.random() < attacker.derived.critChance) {
        crit = true;
        dmg *= CRIT_MULT;
      }
    }
  }

  if (isPlayer(target)) {
    if (target.status !== "alive") return;
    if (target.reached) return; // safe in the waiting room — out of play
    if (ctx.now < target.dashIframeUntil) return; // dodged — i-frames negate the hit
    let taken = dmg * (1 - target.derived.dr); // armor mitigates
    // Absorb shield (support talent) soaks damage before HP.
    if (target.shieldUntil > ctx.now && target.shield > 0) {
      const absorbed = Math.min(target.shield, taken);
      target.shield -= absorbed;
      taken -= absorbed;
    }
    if (sourceIsPlayer && sourceId !== target.id) {
      ctx.pushPlay({ e: "hit", by: sourceId, targetKind: "player", range: hitRange, ability });
    }
    target.hp -= taken;
    if (slowMs > 0) target.slowUntil = Math.max(target.slowUntil, ctx.now + slowMs);
    ctx.pushFx({ e: "dmg", x: target.x, y: target.y, amount: taken, by: sourceId, crit, status });
    if (sourceIsPlayer && sourceId !== target.id) {
      ctx.pushPlay({ e: "friendlyFire", by: sourceId, amount: taken });
    }
    if (target.hp <= 0) {
      // PERMADEATH (Phase 0): no respawn — the player becomes a spectator and
      // drops ALL their gear on the ground (their items are gone for good).
      target.status = "spectator";
      target.mvx = 0;
      target.mvy = 0;
      ctx.dropLoot(target.x, target.y, allItems(target.inv), target.id, sourceIsPlayer && sourceId !== target.id ? sourceId : undefined);
      target.inv = emptyInventory();
      ctx.pushFx({ e: "death", x: target.x, y: target.y, id: target.id });
      if (sourceIsPlayer && sourceId !== target.id) {
        ctx.pushPlay({ e: "kill", by: sourceId, targetKind: "player" });
        ctx.gainXp(sourceId, ability, true);
      }
    }
    return;
  }

  if (isBoss(target)) {
    if (target.dead) return;
    if (sourceIsPlayer) {
      target.threat.set(sourceId, (target.threat.get(sourceId) ?? 0) + dmg * threatMult);
      ctx.pushPlay({ e: "hit", by: sourceId, targetKind: "monster", range: hitRange, ability });
      ctx.gainXp(sourceId, ability, false);
    }
    target.hp -= dmg;
    ctx.pushFx({ e: "dmg", x: target.x, y: target.y, amount: dmg, by: sourceId, crit, status });
    if (target.hp <= 0) {
      target.dead = true;
      ctx.pushFx({ e: "boss", x: target.x, y: target.y, state: "dead", by: sourceId });
      ctx.pushFx({ e: "death", x: target.x, y: target.y, id: target.id });
      if (sourceIsPlayer) {
        ctx.pushPlay({ e: "kill", by: sourceId, targetKind: "monster" });
        awardAssists(ctx, target.threat, sourceId);
        ctx.gainXp(sourceId, ability, true, "boss");
        ctx.shareKillXp(target.x, target.y, sourceId, "boss"); // co-op: the whole party shares the boss
      }
    }
    return;
  }

  // Monster target.
  if (target.dead) return;
  const taken = dmg * (1 - target.derived.dr); // monster armor mitigates too
  if (sourceIsPlayer) {
    // Threat-based aggro (combat note): damage from a player draws aggro (tanks ×threatMult).
    target.threat.set(sourceId, (target.threat.get(sourceId) ?? 0) + taken * threatMult);
    ctx.pushPlay({ e: "hit", by: sourceId, targetKind: "monster", range: hitRange, ability });
    ctx.gainXp(sourceId, ability, false);
    // Knockback: shove the monster away from the attacker (per-kind resistance) so hits
    // have weight and interrupt its wind-up — a swarm bug flies, a brute barely budges.
    if (dmg > 0) {
      const src = ctx.players.get(sourceId);
      const ang = src ? Math.atan2(target.y - src.y, target.x - src.x) : target.aim;
      const resist = KNOCK_RESIST[target.kind] ?? 1;
      target.knockVx = Math.cos(ang) * KNOCK_SPEED * resist * knockMult;
      target.knockVy = Math.sin(ang) * KNOCK_SPEED * resist * knockMult;
      target.knockUntil = ctx.now + KNOCK_MS;
      target.windupUntil = 0; // stagger cancels a pending swing
    }
  }
  if (slowMs > 0) target.slowUntil = Math.max(target.slowUntil, ctx.now + slowMs);
  target.hp -= taken;
  ctx.pushFx({ e: "dmg", x: target.x, y: target.y, amount: taken, by: sourceId, crit, status });
  if (target.hp <= 0) {
    target.dead = true;
    target.respawnAt = ctx.now + MONSTER_RESPAWN_MS;
    // Roll drops: NOT every kill drops (chance per kind), and when it does it's a
    // fresh floor-appropriate item — not a copy of the monster's own stat gear, so
    // the floor doesn't drown in loot. (Players still drop everything on death.)
    ctx.rollDrops(target, sourceIsPlayer ? sourceId : undefined);
    ctx.pushFx({ e: "death", x: target.x, y: target.y, id: target.id });
    if (sourceIsPlayer) {
      ctx.pushPlay({ e: "kill", by: sourceId, targetKind: "monster" });
      awardAssists(ctx, target.threat, sourceId);
      ctx.gainXp(sourceId, ability, true, target.kind);
      ctx.shareKillXp(target.x, target.y, sourceId, target.kind); // co-op: nearby allies share XP
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
    if (target.reached) return; // safe in the waiting room — out of play
    target.hp = Math.min(target.derived.maxHp, target.hp + amount);
    if (sourceId !== target.id) ctx.pushPlay({ e: "heal", by: sourceId, amount, ally: true });
  } else if (isBoss(target)) {
    if (target.dead) return;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    if (sourceId) ctx.pushPlay({ e: "heal", by: sourceId, amount, ally: false });
  } else {
    if (target.dead) return;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    if (sourceId) ctx.pushPlay({ e: "heal", by: sourceId, amount, ally: false });
  }
  ctx.pushFx({ e: "heal", x: target.x, y: target.y, amount });
}

// Apply hard crowd control to an ENEMY (monster or boss) — never a player; CC is a
// player-side class tool against foes. `root` locks movement only; `stun`/`freeze`
// lock movement AND action and interrupt any pending wind-up. A stun/freeze is never
// downgraded to a root while still active (priority), though a longer one extends it.
// `freeze` leaves a short SLOW tail once it thaws. No-ops if the ability has no CC.
function statusForAbility(ab: Ability | undefined): StatusEffect | undefined {
  if (!ab || ab.dmg <= 0) return undefined;
  const text = `${ab.id} ${ab.name ?? ""} ${ab.flavor ?? ""} ${ab.twist ?? ""}`.toLowerCase();
  if (ab.category === "stealth" || /\b(poison|venom|toxin|toxic|acid|blight)\b/.test(text)) return "poison";
  if (ab.freeze || (ab.slowMs ?? 0) > 0 || /\b(frost|ice|icy|freeze|frozen|nova|snow|chill)\b/.test(text)) return "frost";
  if (ab.id.startsWith("loot-") && (ab.category === "ranged" || ab.category === "aoe")) return "fire";
  if (/\b(fire|flame|wildfire|burn|ember|inferno|blaze|detonation|explosion)\b/.test(text)) return "fire";
  return undefined;
}

export function applyCc(
  ctx: WorldCtx,
  target: PlayerState | MonsterState | BossState,
  cc: { stunMs?: number; rootMs?: number; freeze?: boolean },
): void {
  if (isPlayer(target)) return; // CC only ever lands on foes
  if (target.dead) return;
  const stun = cc.stunMs ?? 0;
  const root = cc.rootMs ?? 0;
  if (stun <= 0 && root <= 0) return;
  const kind = stun > 0 ? (cc.freeze ? "freeze" : "stun") : "root";
  const ms = stun > 0 ? stun : root;

  const hardActive = target.ccUntil > ctx.now && (target.ccKind === "stun" || target.ccKind === "freeze");
  if (!(hardActive && kind === "root")) target.ccKind = kind; // don't let a root override an active stun/freeze
  target.ccUntil = Math.max(target.ccUntil, ctx.now + ms);

  // Interrupt a pending swing/cast — the whole point of a stun is to break a tell.
  if (isBoss(target)) {
    target.meleeWindupUntil = 0;
    target.castWindupUntil = 0;
  } else {
    target.windupUntil = 0;
    // A freeze leaves a short slow once the foe thaws (monsters only — the boss has no slow).
    if (kind === "freeze") target.slowUntil = Math.max(target.slowUntil, target.ccUntil + FREEZE_SLOW_TAIL_MS);
  }
  ctx.pushFx({ e: "cc", x: target.x, y: target.y, id: target.id, kind, ms });
}
