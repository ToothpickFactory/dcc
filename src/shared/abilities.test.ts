// Unit test for the ability-kit accumulation (hotbar + benched collection).
//   node --experimental-strip-types src/shared/abilities.test.ts  (npm run test:abilities)
import { addAbilityToKit, starterAbilities, potionHotbarSlot, findMergeTarget, mergeDuplicateAbility } from "./abilities.ts";
import { ABILITY_NODES, evolveCost } from "./skills.ts";
import { MERGE_XP_FRACTION, MERGE_STAT_BUMP, MERGE_RANGE_BUMP_RATIO, MERGE_CD_BUMP_RATIO, MERGE_CD_FLOOR_RATIO } from "./constants.ts";
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

// ---- findMergeTarget: same-category dedup selection -------------------------
{
  const kit = [abil({ id: "weak", category: "melee", dmg: 5 }), abil({ id: "strong", category: "melee", dmg: 20 }), abil({ id: "other", category: "ranged", dmg: 999 })];
  const target = findMergeTarget(kit, abil({ category: "melee" }));
  check("findMergeTarget picks the highest |dmg| same-category ability", target?.id === "strong", `got=${target?.id}`);
}
{
  const kit = [abil({ category: "ranged" }), abil({ category: "melee" })];
  const target = findMergeTarget(kit, abil({ category: "support" }));
  check("findMergeTarget returns null when no category matches", target === null);
}
{
  const kit = [{ ...potionHotbarSlot() }]; // category "support", usesItem: "consumable"
  const target = findMergeTarget(kit, abil({ category: "support" }));
  check("findMergeTarget skips hotbar consumable slots", target === null);
}

// ---- mergeDuplicateAbility: evolvable target banks xp, stats untouched ------
{
  const kit = [{ ...ABILITY_NODES.sword, tier: 0, xp: 0 }]; // sword -> cleaver/blastblade (has branches)
  const incoming = abil({ category: "melee" });
  const merge = mergeDuplicateAbility(kit, incoming, 1);
  const expectedXp = Math.round(evolveCost(0) * MERGE_XP_FRACTION * 1);
  check("evolvable merge returns statBump=false", merge?.statBump === false);
  check("evolvable merge grants the expected xp", kit[0].xp === expectedXp, `xp=${kit[0].xp} expected=${expectedXp}`);
  check("evolvable merge leaves dmg/range/cd/tier untouched", kit[0].dmg === ABILITY_NODES.sword.dmg && kit[0].range === ABILITY_NODES.sword.range && kit[0].cd === ABILITY_NODES.sword.cd && kit[0].tier === 0);
}

// ---- mergeDuplicateAbility: terminal target gets an immediate stat bump -----
{
  const kit = [{ ...ABILITY_NODES.executioner, tier: 0, xp: 0 }]; // no evolution branch
  const incoming = abil({ category: "melee" });
  const merge = mergeDuplicateAbility(kit, incoming, 1);
  const bump = MERGE_STAT_BUMP * 1;
  const expectedDmg = Math.round(ABILITY_NODES.executioner.dmg * (1 + bump));
  const expectedRange = Math.round(ABILITY_NODES.executioner.range * (1 + bump * MERGE_RANGE_BUMP_RATIO));
  const expectedCd = Math.round(ABILITY_NODES.executioner.cd * Math.max(1 - bump * MERGE_CD_BUMP_RATIO, MERGE_CD_FLOOR_RATIO));
  check("terminal merge returns statBump=true, xpGain=0", merge?.statBump === true && merge?.xpGain === 0);
  check("terminal merge bumps dmg as expected", kit[0].dmg === expectedDmg, `dmg=${kit[0].dmg} expected=${expectedDmg}`);
  check("terminal merge bumps range as expected", kit[0].range === expectedRange, `range=${kit[0].range} expected=${expectedRange}`);
  check("terminal merge shrinks cd as expected", kit[0].cd === expectedCd, `cd=${kit[0].cd} expected=${expectedCd}`);
  check("terminal merge increments tier", kit[0].tier === 1);
  check("terminal merge leaves xp untouched", kit[0].xp === 0);
}

// ---- mergeDuplicateAbility: heals (negative dmg) get stronger, not weaker ---
{
  const kit = [{ ...ABILITY_NODES.wavemend, tier: 0, xp: 0 }]; // support, dmg -22, no evolution branch
  const before = kit[0].dmg;
  mergeDuplicateAbility(kit, abil({ category: "support" }), 1);
  check("healing merge makes dmg more negative (a stronger heal)", kit[0].dmg < before, `before=${before} after=${kit[0].dmg}`);
}

// ---- mergeDuplicateAbility: no match yet -> null, no mutation ---------------
{
  const kit = starterAbilities(); // sword (melee), rocks (ranged)
  const snapshot = JSON.stringify(kit);
  const merge = mergeDuplicateAbility(kit, abil({ category: "support" }), 1);
  check("no-match merge returns null", merge === null);
  check("no-match merge does not mutate the kit", JSON.stringify(kit) === snapshot);
}

// ---- mergeDuplicateAbility: higher rarity yields a strictly bigger delta ----
{
  const low = [{ ...ABILITY_NODES.sword, tier: 0, xp: 0 }];
  const high = [{ ...ABILITY_NODES.sword, tier: 0, xp: 0 }];
  const lowMerge = mergeDuplicateAbility(low, abil({ category: "melee" }), 1);
  const highMerge = mergeDuplicateAbility(high, abil({ category: "melee" }), 2.1);
  check("higher rarityMult grants strictly more xp", (highMerge?.xpGain ?? 0) > (lowMerge?.xpGain ?? 0), `low=${lowMerge?.xpGain} high=${highMerge?.xpGain}`);
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall ability-kit checks passed");
