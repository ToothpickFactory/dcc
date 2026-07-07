import { blocked } from "../../procgen/collision";
import { applyDamage, applyHeal } from "./combat";
import type { CompanionState, PlayerState, WorldCtx } from "../state";

const COMPANION_SPEED = 195;
const COMPANION_FOLLOW_DIST = 95;
const COMPANION_MELEE_RANGE = 155;
const COMPANION_RANGED_RANGE = 370;
const COMPANION_ATTACK_CD: Record<string, number> = {
  barbarian: 850,
  cleric:   1300,
  paladin:  1100,
  ranger:   1500,
  rogue:     750,
  wizard:   1050,
};
const COMPANION_DMG: Record<string, number> = {
  barbarian: 22,
  cleric:    11,
  paladin:   15,
  ranger:    17,
  rogue:     17,
  wizard:    13,
};
const COMPANION_MELEE_CONE = 1.1;
const BARBARIAN_MELEE_CONE = 2.0;
const COMPANION_HEAL_CD = 5000;
const COMPANION_HEAL_AMOUNT = 30;
const COMPANION_SHIELD_CD = 8000;
const COMPANION_SHIELD_AMOUNT = 40;
let cseq = 0;

export function updateCompanions(ctx: WorldCtx, dt: number): void {
  ctx.companions = ctx.companions.filter((comp) => {
    if (comp.recruitedBy !== null && comp.expiresAt !== null && ctx.now >= comp.expiresAt) {
      return false;
    }
    if (comp.recruitedBy === null) return true;
    const owner = ctx.players.get(comp.recruitedBy);
    if (!owner || owner.status !== "alive") return true;
    moveTowardOwner(ctx, comp, owner, dt);
    attackNearestEnemy(ctx, comp, owner);
    runSupportAbility(ctx, comp, owner);
    return true;
  });
}

function moveTowardOwner(ctx: WorldCtx, comp: CompanionState, owner: PlayerState, dt: number): void {
  const dx = owner.x - comp.x;
  const dy = owner.y - comp.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= COMPANION_FOLLOW_DIST) return;
  const step = Math.min(COMPANION_SPEED * dt, dist - COMPANION_FOLLOW_DIST);
  const nx = dx / dist;
  const ny = dy / dist;
  const newX = comp.x + nx * step;
  const newY = comp.y + ny * step;
  if (!blocked(ctx.floor.collision, newX, newY)) {
    comp.x = newX;
    comp.y = newY;
    comp.aim = Math.atan2(dy, dx);
  }
}

function attackNearestEnemy(ctx: WorldCtx, comp: CompanionState, owner: PlayerState): void {
  if (ctx.now < comp.attackCdUntil) return;
  const isRanger = comp.klass === "ranger";
  const atkRange = isRanger ? COMPANION_RANGED_RANGE : COMPANION_MELEE_RANGE;
  const dmg = COMPANION_DMG[comp.klass] ?? 15;
  const cd = COMPANION_ATTACK_CD[comp.klass] ?? 1200;

  let nearestDist = atkRange;
  let tx = 0;
  let ty = 0;
  let found = false;

  for (const m of ctx.monsters) {
    if (m.dead) continue;
    const d = Math.hypot(m.x - comp.x, m.y - comp.y);
    if (d < nearestDist) {
      nearestDist = d;
      tx = m.x;
      ty = m.y;
      found = true;
    }
  }
  if (!found && ctx.boss && !ctx.boss.dead) {
    const d = Math.hypot(ctx.boss.x - comp.x, ctx.boss.y - comp.y);
    if (d < atkRange) {
      tx = ctx.boss.x;
      ty = ctx.boss.y;
      found = true;
    }
  }
  if (!found) return;

  comp.aim = Math.atan2(ty - comp.y, tx - comp.x);
  comp.attackCdUntil = ctx.now + cd;

  if (isRanger) {
    const arrowSpeed = 700;
    ctx.projectiles.push({
      id: `cp_${(++cseq).toString(36)}`,
      ownerId: owner.id,
      x: comp.x + Math.cos(comp.aim) * 20,
      y: comp.y + Math.sin(comp.aim) * 20,
      vx: Math.cos(comp.aim) * arrowSpeed,
      vy: Math.sin(comp.aim) * arrowSpeed,
      dmg,
      slowMs: 0,
      ability: 0,
      proj: "arrow",
      ttl: COMPANION_RANGED_RANGE / arrowSpeed,
      hitR: 7,
      boss: false,
    });
    ctx.pushFx({ e: "cast", x: comp.x, y: comp.y, ability: 0 });
  } else {
    const cone = comp.klass === "barbarian" ? BARBARIAN_MELEE_CONE : COMPANION_MELEE_CONE;
    for (const m of ctx.monsters) {
      if (m.dead) continue;
      if (inCone(comp, m, comp.aim, COMPANION_MELEE_RANGE, cone)) {
        applyDamage(ctx, m, dmg, owner.id, true, 0, 0, Math.hypot(m.x - comp.x, m.y - comp.y));
      }
    }
    if (ctx.boss && !ctx.boss.dead && inCone(comp, ctx.boss, comp.aim, COMPANION_MELEE_RANGE, cone)) {
      applyDamage(ctx, ctx.boss, dmg, owner.id, true, 0, 0, Math.hypot(ctx.boss.x - comp.x, ctx.boss.y - comp.y));
    }
    ctx.pushFx({ e: "melee", by: comp.id });
  }
}

function runSupportAbility(ctx: WorldCtx, comp: CompanionState, owner: PlayerState): void {
  if (ctx.now < comp.supportCdUntil) return;
  switch (comp.klass) {
    case "cleric":
      if (owner.hp < owner.derived.maxHp * 0.8) {
        applyHeal(ctx, owner, COMPANION_HEAL_AMOUNT, comp.id);
        ctx.pushFx({ e: "heal", x: owner.x, y: owner.y, amount: COMPANION_HEAL_AMOUNT });
        comp.supportCdUntil = ctx.now + COMPANION_HEAL_CD;
      }
      break;
    case "paladin":
      owner.shield = Math.max(owner.shield, COMPANION_SHIELD_AMOUNT);
      owner.shieldUntil = ctx.now + 8000;
      ctx.pushFx({ e: "heal", x: owner.x, y: owner.y, amount: 0 });
      comp.supportCdUntil = ctx.now + COMPANION_SHIELD_CD;
      break;
    default:
      comp.supportCdUntil = ctx.now + 10000;
      break;
  }
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
