import { blocked, canOccupy } from "../../procgen/collision";
import { MONSTER_KINDS } from "../../shared/constants";
import { applyDamage, applyHeal } from "./combat";
import type { CompanionState, MonsterState, BossState, PlayerState, WorldCtx } from "../state";

const COMPANION_SPEED = 210;
const COMPANION_FOLLOW_DIST = 60;   // stop wandering toward owner when this close
const COMPANION_TELEPORT_DIST = 260; // teleport if stuck AND farther than this from owner
const COMPANION_STUCK_THRESHOLD = 8; // px moved in STUCK_WINDOW_MS to count as "not stuck"
const COMPANION_STUCK_WINDOW_MS = 2000;
const COMPANION_WANDER_RADIUS_MIN = 70;
const COMPANION_WANDER_RADIUS_MAX = 190;
const COMPANION_WANDER_RETARGET_MS = 2800;
const COMPANION_PURSUIT_RANGE = 300; // chase enemies within this distance
const COMPANION_RADIUS = 28;         // collision radius for hit detection from monsters
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
const COMPANION_MAX_HP: Record<string, number> = {
  barbarian: 220,
  cleric:    140,
  paladin:   200,
  ranger:    150,
  rogue:     160,
  wizard:    130,
};
const COMPANION_MELEE_CONE = 1.1;
const BARBARIAN_MELEE_CONE = 2.0;
const COMPANION_HIT_CD = 1200;     // ms between hits from monsters
const COMPANION_HEAL_CD = 5000;
const COMPANION_HEAL_AMOUNT = 30;
const COMPANION_SHIELD_CD = 8000;
const COMPANION_SHIELD_AMOUNT = 40;
let cseq = 0;

export function spawnCompanionFields(klass: CompanionState["klass"]): Pick<CompanionState,
  "hp" | "maxHp" | "dead" | "attackCdUntil" | "supportCdUntil" | "hitCdUntil" |
  "wanderX" | "wanderY" | "wanderUntil" | "stuckCheckAt" | "stuckLastX" | "stuckLastY"
> {
  const maxHp = COMPANION_MAX_HP[klass] ?? 150;
  return {
    hp: maxHp,
    maxHp,
    dead: false,
    attackCdUntil: 0,
    supportCdUntil: 0,
    hitCdUntil: 0,
    wanderX: 0,
    wanderY: 0,
    wanderUntil: 0,
    stuckCheckAt: 0,
    stuckLastX: 0,
    stuckLastY: 0,
  };
}

export function updateCompanions(ctx: WorldCtx, dt: number): void {
  ctx.companions = ctx.companions.filter((comp) => {
    if (comp.dead) return false;
    if (comp.recruitedBy === null) return true;
    const owner = ctx.players.get(comp.recruitedBy);
    if (!owner || owner.status !== "alive") return true;

    const distToOwner = Math.hypot(owner.x - comp.x, owner.y - comp.y);

    if (!teleportIfStuck(ctx, comp, owner, distToOwner)) {
      const target = nearestEnemy(ctx, comp, COMPANION_PURSUIT_RANGE);
      if (target) {
        moveToward(ctx, comp, target.x, target.y, dt);
      } else {
        wanderNearOwner(ctx, comp, owner, distToOwner, dt);
      }
    }

    attackNearestEnemy(ctx, comp, owner);
    runSupportAbility(ctx, comp, owner);
    takeDamageFromMonsters(ctx, comp);
    return !comp.dead;
  });
}

// ---- movement ---------------------------------------------------------------

function teleportIfStuck(ctx: WorldCtx, comp: CompanionState, owner: PlayerState, distToOwner: number): boolean {
  if (ctx.now < comp.stuckCheckAt) return false;
  comp.stuckCheckAt = ctx.now + COMPANION_STUCK_WINDOW_MS;
  const movedSq = (comp.x - comp.stuckLastX) ** 2 + (comp.y - comp.stuckLastY) ** 2;
  comp.stuckLastX = comp.x;
  comp.stuckLastY = comp.y;
  if (movedSq > COMPANION_STUCK_THRESHOLD ** 2 || distToOwner <= COMPANION_TELEPORT_DIST) return false;
  // Teleport to a spot near the owner
  const angle = Math.random() * Math.PI * 2;
  const r = 80 + Math.random() * 60;
  const tx = owner.x + Math.cos(angle) * r;
  const ty = owner.y + Math.sin(angle) * r;
  if (canOccupy(ctx.floor.collision, tx, ty, COMPANION_RADIUS)) {
    comp.x = tx;
    comp.y = ty;
    comp.wanderUntil = 0; // force new wander target after teleport
  }
  return true;
}

function moveToward(ctx: WorldCtx, comp: CompanionState, tx: number, ty: number, dt: number): void {
  const dx = tx - comp.x;
  const dy = ty - comp.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return;
  const step = Math.min(COMPANION_SPEED * dt, dist);
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

function wanderNearOwner(
  ctx: WorldCtx,
  comp: CompanionState,
  owner: PlayerState,
  distToOwner: number,
  dt: number,
): void {
  // Pick a new wander target when the old one expired or companion reached it
  const atTarget = Math.hypot(comp.wanderX - comp.x, comp.wanderY - comp.y) < 25;
  const needNew = ctx.now >= comp.wanderUntil || atTarget || distToOwner > COMPANION_WANDER_RADIUS_MAX * 2;
  if (needNew) {
    const angle = Math.random() * Math.PI * 2;
    const r = COMPANION_WANDER_RADIUS_MIN + Math.random() * (COMPANION_WANDER_RADIUS_MAX - COMPANION_WANDER_RADIUS_MIN);
    comp.wanderX = owner.x + Math.cos(angle) * r;
    comp.wanderY = owner.y + Math.sin(angle) * r;
    comp.wanderUntil = ctx.now + COMPANION_WANDER_RETARGET_MS;
  }
  // Only move if outside the follow deadzone
  if (distToOwner >= COMPANION_FOLLOW_DIST) {
    moveToward(ctx, comp, comp.wanderX, comp.wanderY, dt);
  }
}

// ---- combat -----------------------------------------------------------------

function nearestEnemy(ctx: WorldCtx, comp: CompanionState, range: number): { x: number; y: number } | null {
  let nearestDist = range;
  let result: { x: number; y: number } | null = null;
  for (const m of ctx.monsters) {
    if (m.dead) continue;
    const d = Math.hypot(m.x - comp.x, m.y - comp.y);
    if (d < nearestDist) { nearestDist = d; result = m; }
  }
  if (ctx.boss && !ctx.boss.dead) {
    const d = Math.hypot(ctx.boss.x - comp.x, ctx.boss.y - comp.y);
    if (d < nearestDist) { nearestDist = d; result = ctx.boss; }
  }
  return result;
}

function attackNearestEnemy(ctx: WorldCtx, comp: CompanionState, owner: PlayerState): void {
  if (ctx.now < comp.attackCdUntil) return;
  const isRanger = comp.klass === "ranger";
  const atkRange = isRanger ? COMPANION_RANGED_RANGE : COMPANION_MELEE_RANGE;
  const dmg = COMPANION_DMG[comp.klass] ?? 15;
  const cd = COMPANION_ATTACK_CD[comp.klass] ?? 1200;

  const target = nearestEnemy(ctx, comp, atkRange);
  if (!target) return;

  comp.aim = Math.atan2(target.y - comp.y, target.x - comp.x);
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

function takeDamageFromMonsters(ctx: WorldCtx, comp: CompanionState): void {
  if (ctx.now < comp.hitCdUntil) return;
  for (const m of ctx.monsters) {
    if (m.dead) continue;
    const def = MONSTER_KINDS[m.kind];
    if (!def || def.meleeRange === 0) continue;
    const dist = Math.hypot(m.x - comp.x, m.y - comp.y);
    if (dist > def.meleeRange + COMPANION_RADIUS) continue;
    const dmg = def.dmg * m.dmgMult;
    comp.hp = Math.max(0, comp.hp - dmg);
    comp.hitCdUntil = ctx.now + COMPANION_HIT_CD;
    if (comp.hp <= 0) {
      comp.dead = true;
      ctx.pushFx({ e: "death", x: comp.x, y: comp.y, id: comp.id });
    }
    return;
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

// ---- helpers ----------------------------------------------------------------

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
