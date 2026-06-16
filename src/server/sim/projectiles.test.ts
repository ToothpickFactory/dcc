// Integration test for the trinity/support mechanics (RPG Phase 2F): ally-only
// heals/shields pass through foes, shields absorb, taunt yanks threat, bloodlust
// buffs the group. Drives the real castAbility/stepProjectiles against a minimal
// hand-built WorldCtx (no Durable Object needed).
//   node --experimental-strip-types src/server/sim/projectiles.test.ts
import { castAbility, stepProjectiles } from "./projectiles.ts";
import { ABILITY_NODES } from "../../shared/skills.ts";
import { deriveStats, zeroAttrs } from "../../shared/items.ts";
import type { MonsterState, PlayerState, WorldCtx } from "../state.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? "  — " + detail : ""}`); }
}

function player(id: string, x: number, y: number, over: Partial<PlayerState> = {}): PlayerState {
  const derived = deriveStats(100, 230, zeroAttrs());
  return {
    id, name: id, x, y, aim: 0, mvx: 0, mvy: 0, hp: 100, status: "alive", reached: false, gold: 0,
    cds: {}, lastSeq: 0, abilities: [], charXp: 0, chosenClass: null, talents: {}, talentPoints: 0,
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
  };
}
function ctxOf(players: PlayerState[], monsters: MonsterState[]): WorldCtx {
  const grid = { w: 40, h: 40, cell: 80, solid: new Uint8Array(40 * 40) }; // all open
  return {
    now: 1000, players: new Map(players.map((p) => [p.id, p])), monsters, projectiles: [], boss: null,
    lootBags: [], groupHasteReadyAt: 0, floor: { collision: grid } as WorldCtx["floor"],
    pushFx() {}, pushPlay() {}, dropLoot() {}, rollDrops() {}, gainXp() {},
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

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall projectile/support checks passed");
