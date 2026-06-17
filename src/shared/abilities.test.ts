// Unit test for the ability-kit accumulation (hotbar + benched collection).
//   node --experimental-strip-types src/shared/abilities.test.ts  (npm run test:abilities)
import { addAbilityToKit, starterAbilities, potionHotbarSlot } from "./abilities.ts";
import type { Ability } from "./types.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? "  — " + detail : ""}`); }
}

const HOTBAR = 6;
const MAX = 12;
let seq = 0;
function abil(over: Partial<Ability> = {}): Ability {
  return { id: `a${++seq}`, category: "ranged", cd: 500, range: 400, dmg: 10, projectile: true, name: `A${seq}`, ...over };
}

// ---- abilities accumulate past the hotbar (kept, not evicted at 6) ----------
{
  const kit = starterAbilities(); // 2 starters
  for (let i = 0; i < 8; i++) addAbilityToKit(kit, abil(), MAX, HOTBAR);
  check("kit grows past the 6-slot hotbar", kit.length === 10, `len=${kit.length}`);
  check("kit is capped at MAX", (() => { const k = starterAbilities(); for (let i = 0; i < 50; i++) addAbilityToKit(k, abil(), MAX, HOTBAR); return k.length === MAX; })());
}

// ---- at MAX, the weakest BENCHED ability is replaced; hotbar untouched -------
{
  const kit = starterAbilities();
  // fill to MAX: slots 0-1 starters, 2-5 strong (dmg 100), 6-11 weak (dmg 1)
  for (let i = 0; i < 4; i++) addAbilityToKit(kit, abil({ dmg: 100, id: `hot${i}` }), MAX, HOTBAR);
  for (let i = 0; i < 6; i++) addAbilityToKit(kit, abil({ dmg: 1, id: `bench${i}` }), MAX, HOTBAR);
  check("kit is full at MAX", kit.length === MAX);
  const hotbarBefore = kit.slice(0, HOTBAR).map((a) => a.id);
  addAbilityToKit(kit, abil({ dmg: 50, id: "newcomer" }), MAX, HOTBAR);
  check("kit stays at MAX (no growth past cap)", kit.length === MAX);
  check("hotbar (slots 0-5) is never evicted", kit.slice(0, HOTBAR).map((a) => a.id).join(",") === hotbarBefore.join(","));
  check("the newcomer landed in a benched slot", kit.slice(HOTBAR).some((a) => a.id === "newcomer"));
}

// ---- protections: talent + consumable bench slots survive random loot -------
{
  const kit = starterAbilities();
  for (let i = 0; i < 4; i++) addAbilityToKit(kit, abil({ dmg: 100 }), MAX, HOTBAR); // fill hotbar
  addAbilityToKit(kit, { ...potionHotbarSlot() }, MAX, HOTBAR); // a benched potion slot
  addAbilityToKit(kit, abil({ dmg: 1, fromTalent: true, id: "talentAb" }), MAX, HOTBAR); // a benched talent
  while (kit.length < MAX) addAbilityToKit(kit, abil({ dmg: 1 }), MAX, HOTBAR); // pad to full with weak loot
  // a random (non-talent) loot grant must not evict the potion or talent slots
  for (let i = 0; i < 5; i++) addAbilityToKit(kit, abil({ dmg: 1 }), MAX, HOTBAR);
  check("benched potion slot survives random loot", kit.some((a) => a.usesItem));
  check("benched talent ability survives random loot", kit.some((a) => a.id === "talentAb"));
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall ability-kit checks passed");
