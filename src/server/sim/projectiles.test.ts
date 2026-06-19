// Integration test for the trinity/support mechanics (RPG Phase 2F): ally-only
// heals/shields pass through foes, shields absorb, taunt yanks threat, bloodlust
// buffs the group. Drives the real castAbility/stepProjectiles against a minimal
// hand-built WorldCtx (no Durable Object needed).
//   node --experimental-strip-types src/server/sim/projectiles.test.ts
import { castAbility, stepProjectiles } from "./projectiles.ts";
import { updateMonsters } from "./monsters.ts";
import { recomputePlayer } from "./stats.ts";
import { ABILITY_NODES } from "../../shared/skills.ts";
import { starterAbilities } from "../../shared/abilities.ts";
import { CLASS_KIT } from "../../shared/classes.ts";
import { talentSpent } from "../../shared/talents.ts";
import { ATTR_KEYS, deriveStats, zeroAttrs } from "../../shared/items.ts";
import type { MonsterState, PlayerState, WorldCtx } from "../state.ts";
import type { GameEvent } from "../../protocol.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? "  — " + detail : ""}`); }
}

function player(id: string, x: number, y: number, over: Partial<PlayerState> = {}): PlayerState {
  const derived = deriveStats(100, 230, zeroAttrs());
  return {
    id, name: id, x, y, aim: 0, mvx: 0, mvy: 0, hp: 100, status: "alive", reached: false, gold: 0,
    cds: {}, lastSeq: 0, abilities: [], charXp: 0, chosenClass: null, talents: {}, talentPoints: 0, attrPoints: 0, shop: [],
    threatMult: 1, shield: 0, shieldUntil: 0, bloodlustUntil: 0, slowUntil: 0, potionReadyAt: 0,
    seen: new Set(), base: zeroAttrs(), inv: { equipped: {}, bagEquip: [null, null, null, null], carried: [] },
    derived, ws: {} as WebSocket, linkdead: false, ...over,
  };
}
function monster(id: string, x: number, y: number): MonsterState {
  return {
    id, kind: "grunt", x, y, aim: 0, maxHp: 60, hp: 60, dead: false, respawnAt: 0, attackReadyAt: 0,
    wanderAt: 0, slowUntil: 0, base: zeroAttrs(), inv: { equipped: {}, bagEquip: [null, null, null, null], carried: [] },
    derived: deriveStats(60, 95, zeroAttrs()), threat: new Map(),
    dmgMult: 1, windupUntil: 0, windupTarget: "", knockUntil: 0, knockVx: 0, knockVy: 0, ccUntil: 0, ccKind: "",
  };
}
function ctxOf(players: PlayerState[], monsters: MonsterState[], events: GameEvent[] = []): WorldCtx {
  const grid = { w: 40, h: 40, cell: 80, solid: new Uint8Array(40 * 40) }; // all open
  return {
    now: 1000, players: new Map(players.map((p) => [p.id, p])), monsters, projectiles: [], boss: null,
    lootBags: [], props: [], groupHasteReadyAt: 0, floor: { collision: grid } as WorldCtx["floor"],
    pushFx(e) { events.push(e); }, pushPlay() {}, dropLoot() {}, rollDrops() {}, gainXp() {},
  };
}

// ---- ally-only heal passes THROUGH a foe and only mends the ally -----------
{
  const healer = player("H", 0, 0, { abilities: [{ ...ABILITY_NODES.mend }] });
  const ally = player("A", 300, 0, { hp: 10 });
  const mob = monster("M", 150, 0); // directly between healer and ally
  const ctx = ctxOf([healer, ally], [mob]);
  check("cast mend fired", castAbility(ctx, healer, 0, 0) === true);
  for (let i = 0; i < 20 && ctx.projectiles.length; i++) stepProjectiles(ctx, 0.05);
  check("ally was healed", ally.hp > 10, `ally.hp=${ally.hp}`);
  check("foe in the path was NOT touched by the heal", mob.hp === 60, `mob.hp=${mob.hp}`);
}

// ---- shield projectile grants an absorb to the ally ------------------------
{
  const caster = player("H", 0, 0, { abilities: [{ ...ABILITY_NODES.shieldward }] });
  const ally = player("A", 300, 0);
  const ctx = ctxOf([caster, ally], []);
  castAbility(ctx, caster, 0, 0);
  for (let i = 0; i < 20 && ctx.projectiles.length; i++) stepProjectiles(ctx, 0.05);
  check("ally gained an absorb shield", ally.shield > 0 && ally.shieldUntil > ctx.now, `shield=${ally.shield}`);
}

// ---- taunt yanks every nearby foe's threat onto the tank -------------------
{
  const tank = player("T", 0, 0, { abilities: [{ ...ABILITY_NODES.taunt }] });
  const mob = monster("M", 100, 0);
  mob.threat.set("someoneElse", 30); // another player had aggro
  const ctx = ctxOf([tank], [mob]);
  castAbility(ctx, tank, 0, 0);
  const top = [...mob.threat.entries()].sort((a, b) => b[1] - a[1])[0];
  check("taunt makes the tank top-threat", top?.[0] === "T", JSON.stringify([...mob.threat]));
}

// ---- bloodlust buffs the group on a shared cooldown ------------------------
{
  const caster = player("C", 0, 0, { abilities: [{ ...ABILITY_NODES.bloodlust }] });
  const mate = player("D", 200, 0);
  const ctx = ctxOf([caster, mate], []);
  check("bloodlust fired", castAbility(ctx, caster, 0, 0) === true);
  check("nearby ally got the haste buff", mate.bloodlustUntil > ctx.now);
  check("shared cooldown was set", ctx.groupHasteReadyAt > ctx.now);
  check("bloodlust blocked while shared cd active", castAbility(ctx, caster, 0, 0) === false);
}

// ---- hard CC: a stun fully locks a foe out + interrupts its wind-up --------
{
  const war = player("W", 0, 0, { abilities: [{ ...ABILITY_NODES.shieldbash }] });
  const mob = monster("M", 60, 0); // inside the bash cone (range 118, aim 0)
  mob.windupUntil = 1300; // mid-swing — the bash should interrupt it
  const ctx = ctxOf([war], [mob]);
  check("shield bash fired", castAbility(ctx, war, 0, 0) === true);
  check("bash stunned the foe", mob.ccKind === "stun" && mob.ccUntil > ctx.now, `ccKind=${mob.ccKind} until=${mob.ccUntil}`);
  check("stun interrupted the wind-up", mob.windupUntil === 0, `windupUntil=${mob.windupUntil}`);
  // Isolate the stun from the hit's knockback, then prove the AI is inert.
  mob.knockUntil = 0;
  const x0 = mob.x;
  for (let i = 0; i < 6; i++) { ctx.now += 50; updateMonsters(ctx, 0.05); }
  check("stunned foe did not move", mob.x === x0, `x0=${x0} x=${mob.x}`);
  check("stunned foe did not wind up an attack", mob.windupUntil === 0, `windupUntil=${mob.windupUntil}`);
}

// ---- hard CC: a root pins movement but the foe can still act ----------------
{
  const rogue = player("R", 0, 0, { abilities: [{ ...ABILITY_NODES.hamstring }] });
  const mob = monster("M", 70, 0); // inside the hamstring cone (range 120)
  const ctx = ctxOf([rogue], [mob]);
  check("hamstring fired", castAbility(ctx, rogue, 0, 0) === true);
  check("hamstring rooted the foe", mob.ccKind === "root" && mob.ccUntil > ctx.now, `ccKind=${mob.ccKind}`);
  // Yank the rogue far away: a free grunt would chase, a rooted one can't.
  rogue.x = 700;
  mob.knockUntil = 0;
  const x0 = mob.x;
  for (let i = 0; i < 6; i++) { ctx.now += 50; updateMonsters(ctx, 0.05); }
  check("rooted foe could not chase", mob.x === x0, `x0=${x0} x=${mob.x}`);
}

// ---- hard CC: a concussive bolt carries the stun to the foe it strikes ------
{
  const hunter = player("H", 0, 0, { abilities: [{ ...ABILITY_NODES.concussive }] });
  const mob = monster("M", 200, 0);
  const ctx = ctxOf([hunter], [mob]);
  check("concussive fired", castAbility(ctx, hunter, 0, 0) === true);
  for (let i = 0; i < 30 && ctx.projectiles.length; i++) stepProjectiles(ctx, 0.05);
  check("concussive bolt stunned on impact", mob.ccKind === "stun" && mob.ccUntil > ctx.now, `ccKind=${mob.ccKind}`);
}

// ---- targeted AoE: resolves at the aimed point and fans visual bolts --------
{
  const mage = player("A", 0, 0, { abilities: [{ ...ABILITY_NODES.boulder }] });
  const near = monster("N", 460, 0);
  const splash = monster("S", 520, 70);
  const far = monster("F", 760, 0);
  const ctx = ctxOf([mage], [near, splash, far]);
  check("targeted AoE fired", castAbility(ctx, mage, 0, 0) === true);
  check("targeted AoE hit the target point", near.hp < 60, `near.hp=${near.hp}`);
  check("targeted AoE splashed nearby foes", splash.hp < 60, `splash.hp=${splash.hp}`);
  check("targeted AoE left distant foes alone", far.hp === 60, `far.hp=${far.hp}`);
  check("targeted AoE spawned radial visual bolts", ctx.projectiles.length === 16 && ctx.projectiles.every((p) => p.visualOnly === true), `projectiles=${ctx.projectiles.length}`);
}

// ---- enemy fire projectiles tag the damage event for status overlays --------
{
  const hero = player("P", 0, 0);
  const events: GameEvent[] = [];
  const ctx = ctxOf([hero], [], events);
  ctx.projectiles.push({
    id: "enemy-fire",
    ownerId: "monster",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    dmg: 5,
    slowMs: 0,
    ability: 98,
    proj: "fire",
    ttl: 1,
    hitR: 7,
    boss: true,
  });
  stepProjectiles(ctx, 0.1);
  const dmg = events.find((e) => e.e === "dmg");
  check("enemy fire projectile tagged damage status", dmg?.e === "dmg" && dmg.status === "fire", JSON.stringify(dmg));
}

// ---- temporary test mode: any damaging projectile gets a status overlay -----
{
  const caster = player("C", 0, 0);
  const mob = monster("M", 0, 0);
  const events: GameEvent[] = [];
  const ctx = ctxOf([caster], [mob], events);
  ctx.projectiles.push({
    id: "plain-projectile",
    ownerId: "C",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    dmg: 5,
    slowMs: 0,
    ability: 0,
    ttl: 1,
    hitR: 7,
    boss: false,
  });
  stepProjectiles(ctx, 0.1);
  const dmg = events.find((e) => e.e === "dmg");
  check("plain damaging projectile defaults to fire status", dmg?.e === "dmg" && dmg.status === "fire", JSON.stringify(dmg));
}

// ---- nova AoE: originates on the caster, not at max range -------------------
{
  const mage = player("NOVA", 0, 0, { abilities: [{ ...ABILITY_NODES.frostnova }] });
  const close = monster("C", 120, 0);
  const far = monster("F", 360, 0);
  const ctx = ctxOf([mage], [close, far]);
  check("frost nova fired", castAbility(ctx, mage, 0, 0) === true);
  check("frost nova hit around the caster", close.hp < 60 && close.ccKind === "freeze", `hp=${close.hp} cc=${close.ccKind}`);
  check("frost nova did not hit at max range", far.hp === 60, `far.hp=${far.hp}`);
  check("frost nova spawned radial visual bolts", ctx.projectiles.length === 16 && ctx.projectiles.every((p) => p.visualOnly === true), `projectiles=${ctx.projectiles.length}`);
}

// ---- build depth: attribute points feed derived stats (spendAttr core) -----
// Spent points live in `base`; recomputePlayer folds base -> derived. This is the
// exact path WorldDO.spendAttr drives (p.base[attr] += 1; recomputePlayer).
{
  const p = player("AP", 0, 0);
  recomputePlayer(p);
  const hp0 = p.derived.maxHp;
  const sp0 = p.derived.spellPower;
  p.base.stamina += 1; recomputePlayer(p);
  check("attr point: +1 stamina = +8 maxHp", p.derived.maxHp === hp0 + 8, `${hp0}->${p.derived.maxHp}`);
  p.base.strength += 1; recomputePlayer(p); // no class -> mainStat defaults to strength
  check("attr point: +1 strength raises spellPower", p.derived.spellPower > sp0, `${sp0}->${p.derived.spellPower}`);
}

// ---- build depth: class-flavored starting kit (applyClassKit core) ----------
{
  const defaults = starterAbilities();
  const p = player("KIT", 0, 0, { abilities: starterAbilities() });
  const untouched = defaults.every((d, i) => p.abilities[i]?.id === d.id);
  check("starter bar is the untouched defaults", untouched);
  if (untouched) CLASS_KIT.mage.forEach((id, i) => { p.abilities[i] = { ...ABILITY_NODES[id], tier: 0, xp: 0 }; });
  check("mage kit swaps the opener to sharprocks+rocks", p.abilities[0].id === "sharprocks" && p.abilities[1].id === "rocks");
  // Guard: a customized bar (already evolved) must NOT be treated as untouched (no clobber).
  const q = player("KIT2", 0, 0, { abilities: [{ ...ABILITY_NODES.cleaver }, { ...ABILITY_NODES.rocks }] });
  check("a customized bar is not clobbered by the kit", !defaults.every((d, i) => q.abilities[i]?.id === d.id));
}

// ---- build depth: respec refunds both pools + strips talent grants ----------
{
  const p = player("RS", 0, 0);
  p.base.strength = 4; p.base.stamina = 2; // 6 attribute points spent (base only grows via spendAttr)
  p.attrPoints = 1;
  p.talentPoints = 0;
  p.talents = { w_tough: 2, w_cleave: 1 }; // 3 talent points spent
  p.abilities = [{ ...ABILITY_NODES.sword }, { ...ABILITY_NODES.rocks }, { ...ABILITY_NODES.taunt, fromTalent: true }];
  // respec core (mirrors WorldDO.respec):
  let attrSpent = 0; for (const k of ATTR_KEYS) attrSpent += p.base[k];
  p.attrPoints += attrSpent; p.base = zeroAttrs();
  p.talentPoints += talentSpent(p.talents); p.talents = {};
  p.abilities = p.abilities.filter((a) => a.fromTalent !== true);
  check("respec refunds attribute points (1+6=7)", p.attrPoints === 7, `${p.attrPoints}`);
  check("respec zeroes base", ATTR_KEYS.every((k) => p.base[k] === 0));
  check("respec refunds talent points (0+3=3)", p.talentPoints === 3, `${p.talentPoints}`);
  check("respec strips the talent-granted ability", p.abilities.length === 2 && !p.abilities.some((a) => a.fromTalent));
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall projectile/support checks passed");
