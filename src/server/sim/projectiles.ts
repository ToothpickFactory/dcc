import {
  AGGRO_HEAL_RADIUS,
  AGGRO_PER_HEAL,
  BOSS_RADIUS,
  COMBO_FINISHER_CONE_MULT,
  COMBO_FINISHER_DMG_MULT,
  COMBO_FINISHER_KNOCK_MULT,
  COMBO_FINISHER_STEP,
  COMBO_LIGHT_CD_MULT,
  COMBO_WINDOW_MS,
  FIREBALL_PROJECTILE_SPRITE,
  ICE_PROJECTILE_SPRITE,
  MONSTER_KINDS,
  POISON_PROJECTILE_SPRITE,
  PLAYER_RADIUS,
  PROJECTILE_RADIUS,
} from "../../shared/constants";
import type { Ability } from "../../shared/types";
import type { BossState, MonsterState, PlayerState, ProjectileState, WorldCtx } from "../state";
import { blocked } from "../../procgen/collision";
import { applyCc, applyDamage, applyHeal } from "./combat";
import { propBlocking } from "./collision";

let seq = 0;
const AREA_BOLT_COUNT = 16;
const AREA_BOLT_RANGE = 150;
const AREA_BOLT_SPEED = 520;
const AREA_RADIUS_MIN = 120;
const AREA_RADIUS_MAX = 230;

// Resolve a cast in the aim direction. BALLISTIC — there is no homing/target.
// Returns true if the cast fired (off cooldown).
export function castAbility(ctx: WorldCtx, caster: PlayerState, idx: number, aim: number): boolean {
  const ab = caster.abilities[idx];
  if (!ab) return false;
  if ((caster.cds[idx] ?? 0) > ctx.now) return false;
  if (ab.groupBuff === "haste" && ctx.groupHasteReadyAt > ctx.now) return false; // shared party cooldown
  if (ab.ammo !== undefined && ab.ammo <= 0) return false; // out of charges (e.g. rocks)
  if (ab.ammo !== undefined) ab.ammo -= 1; // consume a charge
  // Gear/attributes scale the cast: haste lowers cooldown, power raises damage,
  // intellect raises healing. The bloodlust group buff shortens cooldowns further.
  const hasteFactor = caster.bloodlustUntil > ctx.now ? 0.6 : 1;
  // Melee combo: light swings chain at a reduced cooldown; the heavy finisher (and every
  // non-melee ability) uses the full cooldown as recovery. Deliberate CC abilities
  // (shield bash, frost nova, hamstring) are NOT part of the basic swing chain — they
  // keep their own long cooldown and never advance/consume the combo.
  const isMelee = !ab.projectile && !ab.taunt && ab.groupBuff !== "haste" && ab.dmg > 0 && !ab.stunMs && !ab.rootMs;
  if (isMelee && ctx.now > caster.comboExpireAt) caster.comboStep = 0; // chain lapsed
  const isFinisher = isMelee && caster.comboStep >= COMBO_FINISHER_STEP;
  const cdBase = ab.cd * caster.derived.cdMult * hasteFactor;
  caster.cds[idx] = ctx.now + (isMelee && !isFinisher ? cdBase * COMBO_LIGHT_CD_MULT : cdBase);
  caster.aim = aim;
  const dmg = ab.dmg < 0 ? ab.dmg * caster.derived.healPower : ab.dmg * caster.derived.spellPower;
  ctx.pushFx({ e: "cast", x: caster.x, y: caster.y, ability: idx });

  // Taunt: instant — yank nearby foes' aggro onto the caster (tank tool).
  if (ab.taunt) {
    tauntNearby(ctx, caster, ab.range);
    return true;
  }
  // Group haste (bloodlust): shared cooldown; buffs every nearby ally for a burst.
  if (ab.groupBuff === "haste") {
    applyGroupHaste(ctx, caster);
    return true;
  }

  if (isAreaAbility(ab)) {
    const origin = areaOrigin(ctx, caster, ab, aim);
    resolveArea(ctx, caster, idx, ab, origin.x, origin.y, dmg);
    spawnAreaBolts(ctx, caster, idx, ab, origin.x, origin.y);
    return true;
  }

  if (ab.projectile) {
    const speed = ab.speed ?? 600;
    const pellets = Math.max(1, ab.pellets ?? 1); // multishot fires several
    const spread = ab.spread ?? 0;
    for (let i = 0; i < pellets; i++) {
      const a = pellets > 1 ? aim - spread / 2 + (spread * i) / (pellets - 1) : aim;
      ctx.projectiles.push({
        id: `pr_${(++seq).toString(36)}`,
        ownerId: caster.id,
        x: caster.x + Math.cos(a) * (PLAYER_RADIUS + 4),
        y: caster.y + Math.sin(a) * (PLAYER_RADIUS + 4),
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        dmg, // negative = heal projectile
        slowMs: ab.slowMs ?? 0,
        stunMs: ab.stunMs, // CC carried to the first foe the bolt strikes (e.g. concussive shot)
        rootMs: ab.rootMs,
        freeze: ab.freeze,
        ability: idx,
        sprite: projectileSpriteForAbility(ab),
        proj: projectileRenderForAbility(ab),
        ttl: ab.range / speed,
        hitR: PROJECTILE_RADIUS,
        boss: false,
        allyOnly: ab.allyOnly, // support: only lands on allies
        shield: ab.shield, // support: absorb shield applied to the ally
      });
    }
    // Casting a heal aggravates nearby foes (ported): support play has a cost.
    if (dmg < 0) {
      const threat = -dmg * AGGRO_PER_HEAL;
      for (const m of ctx.monsters) {
        if (!m.dead && near(caster, m, AGGRO_HEAL_RADIUS)) m.threat.set(caster.id, (m.threat.get(caster.id) ?? 0) + threat);
      }
      if (ctx.boss && !ctx.boss.dead && near(caster, ctx.boss, AGGRO_HEAL_RADIUS)) {
        ctx.boss.threat.set(caster.id, (ctx.boss.threat.get(caster.id) ?? 0) + threat);
      }
    }
    return true;
  }

  // Melee cone (non-projectile): hit monsters, the boss, and OTHER players. The cone
  // widens with evolutions (blast blade / whirlwind). The combo finisher hits harder +
  // wider + shoves more, then resets the chain (rhythm + weight).
  const baseCone = ab.cone ?? Math.PI / 3;
  const cone = isFinisher ? baseCone * COMBO_FINISHER_CONE_MULT : baseCone;
  const meleeDmg = isFinisher ? dmg * COMBO_FINISHER_DMG_MULT : dmg;
  const knockMult = isFinisher ? COMBO_FINISHER_KNOCK_MULT : 1;
  for (const prop of ctx.props) {
    if (prop.hp > 0 && inCone(caster, prop, aim, ab.range, cone)) ctx.damageProp(prop, caster.id, true, idx);
  }
  for (const m of ctx.monsters) {
    if (m.dead) continue;
    if (inCone(caster, m, aim, ab.range, cone)) {
      applyDamage(ctx, m, meleeDmg, caster.id, true, ab.slowMs, idx, dist(caster, m), knockMult);
      applyCc(ctx, m, ab); // stun/root/freeze if this is a CC ability (no-op otherwise)
    }
  }
  if (ctx.boss && !ctx.boss.dead && inCone(caster, ctx.boss, aim, ab.range, cone)) {
    applyDamage(ctx, ctx.boss, meleeDmg, caster.id, true, ab.slowMs, idx, dist(caster, ctx.boss), knockMult);
    applyCc(ctx, ctx.boss, ab);
  }
  for (const p of ctx.players.values()) {
    if (p.id === caster.id || p.status !== "alive" || p.reached) continue;
    if (inCone(caster, p, aim, ab.range, cone)) applyDamage(ctx, p, meleeDmg, caster.id, true, ab.slowMs, idx, dist(caster, p), knockMult);
  }
  // Advance the chain (wrap after the finisher); keep it alive for COMBO_WINDOW_MS.
  if (isMelee) {
    caster.comboStep = isFinisher ? 0 : caster.comboStep + 1;
    caster.comboExpireAt = ctx.now + COMBO_WINDOW_MS;
  }
  return true;
}

function projectileSpriteForAbility(ab: Ability): number | undefined {
  const render = projectileRenderForAbility(ab);
  if (render === "ice") return ICE_PROJECTILE_SPRITE;
  if (render === "poison") return POISON_PROJECTILE_SPRITE;
  if (render === "fire") return FIREBALL_PROJECTILE_SPRITE;
  return undefined;
}

function projectileRenderForAbility(ab: Ability): "fire" | "ice" | "poison" | undefined {
  if (isIceOrRockProjectile(ab)) return "ice";
  if (isPoisonProjectile(ab)) return "poison";
  if (isFireballProjectile(ab)) return "fire";
  return ab.projectile ? "ice" : undefined;
}

function isAreaAbility(ab: Ability): boolean {
  if (ab.category === "aoe") return true;
  if (!ab.projectile) return false;
  if (ab.dmg <= 0) return false;
  return /\b(nova|burst|cataclysm|wildfire|detonation|shockwave|explosion|quake|storm|blast)\b/i.test(abilityTitle(ab));
}

function isNovaArea(ab: Ability): boolean {
  const title = abilityTitle(ab);
  return /\b(nova|whirlwind)\b/i.test(title) || (!ab.projectile && (ab.cone ?? 0) >= Math.PI * 1.8);
}

function abilityTitle(ab: Ability): string {
  return `${ab.name ?? ""} ${ab.flavor ?? ""} ${ab.twist ?? ""}`;
}

function areaOrigin(ctx: WorldCtx, caster: PlayerState, ab: Ability, aim: number): { x: number; y: number } {
  if (isNovaArea(ab)) return { x: caster.x, y: caster.y };
  const range = Math.max(0, ab.range);
  let x = caster.x + Math.cos(aim) * range;
  let y = caster.y + Math.sin(aim) * range;
  const step = Math.max(24, ctx.floor.collision.cell * 0.35);
  for (let d = range; d > 0 && blocked(ctx.floor.collision, x, y); d -= step) {
    x = caster.x + Math.cos(aim) * d;
    y = caster.y + Math.sin(aim) * d;
  }
  return { x, y };
}

function areaRadius(ab: Ability): number {
  if (isNovaArea(ab)) return Math.max(AREA_RADIUS_MIN, Math.min(AREA_RADIUS_MAX, ab.range));
  return Math.max(AREA_RADIUS_MIN, Math.min(AREA_RADIUS_MAX, ab.range * 0.38));
}

function resolveArea(ctx: WorldCtx, caster: PlayerState, idx: number, ab: Ability, x: number, y: number, dmg: number): void {
  const radius = areaRadius(ab);
  for (const prop of ctx.props) {
    if (prop.hp > 0 && hit(x, y, prop.x, prop.y, radius + prop.radius)) ctx.damageProp(prop, caster.id, true, idx);
  }
  for (const m of ctx.monsters) {
    if (m.dead) continue;
    if (hit(x, y, m.x, m.y, radius + MONSTER_KINDS[m.kind].radius)) {
      applyDamage(ctx, m, dmg, caster.id, true, ab.slowMs, idx, dist(caster, m));
      applyCc(ctx, m, ab);
    }
  }
  if (ctx.boss && !ctx.boss.dead && hit(x, y, ctx.boss.x, ctx.boss.y, radius + BOSS_RADIUS)) {
    applyDamage(ctx, ctx.boss, dmg, caster.id, true, ab.slowMs, idx, dist(caster, ctx.boss));
    applyCc(ctx, ctx.boss, ab);
  }
  for (const p of ctx.players.values()) {
    if (p.id === caster.id || p.status !== "alive" || p.reached) continue;
    if (hit(x, y, p.x, p.y, radius + PLAYER_RADIUS)) applyDamage(ctx, p, dmg, caster.id, true, ab.slowMs, idx, dist(caster, p));
  }
  ctx.pushFx({ e: "hit", x, y, ability: idx });
}

function spawnAreaBolts(ctx: WorldCtx, caster: PlayerState, idx: number, ab: Ability, x: number, y: number): void {
  const render = projectileRenderForAbility(ab);
  const sprite = projectileSpriteForAbility(ab);
  const range = Math.min(AREA_BOLT_RANGE, Math.max(80, areaRadius(ab) * 0.85));
  const speed = Math.max(ab.speed ?? AREA_BOLT_SPEED, 240);
  for (let i = 0; i < AREA_BOLT_COUNT; i++) {
    const a = (Math.PI * 2 * i) / AREA_BOLT_COUNT;
    ctx.projectiles.push({
      id: `pr_${(++seq).toString(36)}`,
      ownerId: caster.id,
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      dmg: 0,
      slowMs: 0,
      ability: idx,
      sprite,
      proj: render,
      ttl: range / speed,
      hitR: 0,
      boss: false,
      visualOnly: true,
    });
  }
}

function isIceOrRockProjectile(ab: Ability): boolean {
  const rockIds = new Set(["rocks", "sharprocks", "boulder", "multishot", "scattershot"]);
  return ab.projectile === true && (rockIds.has(ab.id) || (ab.slowMs ?? 0) > 0);
}

function isPoisonProjectile(ab: Ability): boolean {
  return ab.projectile === true && ab.dmg > 0 && ab.id.startsWith("loot-") && ab.category === "stealth";
}

function isFireballProjectile(ab: Ability): boolean {
  return ab.projectile === true && ab.dmg > 0 && ab.id.startsWith("loot-") && (ab.category === "ranged" || ab.category === "aoe");
}

// Taunt: set every foe within range to top-threat + a margin on the caster, so
// they peel onto the tank. Reuses the existing threat maps.
function tauntNearby(ctx: WorldCtx, caster: PlayerState, range: number): void {
  const TAUNT_BONUS = 50;
  const yank = (threat: Map<string, number>) => {
    let top = 0;
    for (const v of threat.values()) if (v > top) top = v;
    threat.set(caster.id, top + TAUNT_BONUS);
  };
  for (const m of ctx.monsters) if (!m.dead && near(caster, m, range)) yank(m.threat);
  if (ctx.boss && !ctx.boss.dead && near(caster, ctx.boss, range)) yank(ctx.boss.threat);
}

// Group haste: buff every alive ally near the caster for a short burst, on a
// shared party cooldown so it's a once-a-fight team power.
function applyGroupHaste(ctx: WorldCtx, caster: PlayerState): void {
  const RADIUS = 700;
  const DURATION = 8000; // ms of haste
  const SHARED_CD = 60000;
  ctx.groupHasteReadyAt = ctx.now + SHARED_CD;
  for (const p of ctx.players.values()) {
    if (p.status !== "alive" || p.reached) continue;
    if (near(caster, p, RADIUS)) p.bloodlustUntil = ctx.now + DURATION;
  }
  ctx.pushFx({ e: "heal", x: caster.x, y: caster.y, amount: 0 }); // a visible pop at the caster
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
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
  const grid = ctx.floor.collision;
  ctx.projectiles = ctx.projectiles.filter((pr) => {
    pr.ttl -= dt;
    if (pr.ttl <= 0) return false;
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    if (blocked(grid, pr.x, pr.y)) return false; // stopped by a wall
    if (pr.visualOnly) return true;
    const prop = propBlocking(ctx, pr.x, pr.y, pr.hitR);
    if (prop) {
      ctx.damageProp(prop, pr.ownerId, !pr.boss, pr.ability);
      return false;
    }

    // Enemy projectile (boss bolt OR monster bolt): affects players only.
    if (pr.boss) {
      for (const p of ctx.players.values()) {
        if (p.status !== "alive" || p.reached) continue;
        if (hit(pr.x, pr.y, p.x, p.y, pr.hitR + PLAYER_RADIUS)) {
          applyDamage(ctx, p, pr.dmg, pr.ownerId, false, pr.slowMs, 0, 0, 1, statusForProjectile(pr.proj));
          ctx.pushFx({ e: "hit", x: pr.x, y: pr.y, ability: pr.ability });
          return false;
        }
      }
      return true;
    }

    const isHeal = pr.dmg < 0;
    // Support projectiles (heals/shields) pass harmlessly THROUGH foes and only
    // ever land on an ally — so a healer/shielder can fire across a fight.
    if (!pr.allyOnly) {
      for (const m of ctx.monsters) {
        if (m.dead) continue;
        if (hit(pr.x, pr.y, m.x, m.y, pr.hitR + MONSTER_KINDS[m.kind].radius)) {
          resolve(ctx, m, pr, isHeal);
          return false;
        }
      }
      if (ctx.boss && !ctx.boss.dead && hit(pr.x, pr.y, ctx.boss.x, ctx.boss.y, pr.hitR + BOSS_RADIUS)) {
        resolve(ctx, ctx.boss, pr, isHeal);
        return false;
      }
    }
    for (const p of ctx.players.values()) {
      // Support can land on the caster too (self-shield/heal); offensive can't.
      if ((!pr.allyOnly && p.id === pr.ownerId) || p.status !== "alive" || p.reached) continue;
      if (hit(pr.x, pr.y, p.x, p.y, pr.hitR + PLAYER_RADIUS)) {
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
  // Absorb shield (support): only meaningful on a player ally.
  if (pr.shield && pr.shield > 0 && "status" in target) {
    target.shield = Math.max(target.shield, pr.shield);
    target.shieldUntil = ctx.now + 8000;
    ctx.pushFx({ e: "heal", x: pr.x, y: pr.y, amount: 0 }); // shield pop reuses the heal fx
    return;
  }
  if (isHeal) {
    applyHeal(ctx, target, -pr.dmg, pr.ownerId);
  } else {
    // How far the shooter was from the impact — drives the ranged/melee axes.
    const owner = ctx.players.get(pr.ownerId);
    const range = owner ? Math.hypot(owner.x - target.x, owner.y - target.y) : 0;
    applyDamage(ctx, target, pr.dmg, pr.ownerId, true, pr.slowMs, pr.ability, range, 1, statusForProjectile(pr.proj));
    applyCc(ctx, target, { stunMs: pr.stunMs, rootMs: pr.rootMs, freeze: pr.freeze }); // CC bolts (concussive shot)
  }
  ctx.pushFx({ e: "hit", x: pr.x, y: pr.y, ability: pr.ability });
}

function statusForProjectile(proj: ProjectileState["proj"]): "fire" | "frost" | "poison" {
  if (proj === "ice") return "frost";
  return proj ?? "fire";
}

function hit(ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy <= r * r;
}
