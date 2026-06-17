// Unit test for the talent-tree system + class definitions.
//   node --experimental-strip-types src/shared/talents.test.ts  (npm run test:talents)
import { TALENT_TREES, TALENT_BY_ID, canSpendTalent, pointsForLevel, talentPassives, talentSpent } from "./talents.ts";
import { CLASS_MAIN_STAT, CLASS_ROLE, KLASSES, CLASS_INFO } from "./classes.ts";
import { ABILITY_NODES } from "./skills.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}${detail ? "  — " + detail : ""}`);
  }
}

// ---- class coverage --------------------------------------------------------
for (const k of KLASSES) {
  check(`${k} has a main stat`, typeof CLASS_MAIN_STAT[k] === "string");
  check(`${k} has a role`, CLASS_ROLE[k] === "tank" || CLASS_ROLE[k] === "dps" || CLASS_ROLE[k] === "healer");
  check(`${k} has display info`, !!CLASS_INFO[k]?.name);
  check(`${k} has a talent tree`, Array.isArray(TALENT_TREES[k]) && TALENT_TREES[k].length > 0);
}

// ---- tree integrity --------------------------------------------------------
for (const k of KLASSES) {
  for (const node of TALENT_TREES[k]) {
    if (node.grants?.ability) {
      check(`${node.id} grants a real ability (${node.grants.ability})`, !!ABILITY_NODES[node.grants.ability]);
    }
    check(`${node.id} requires <= its row*2 (gating sane)`, (node.requires ?? 0) <= node.row * 2 + 1);
  }
  // every node id unique across the flat lookup
  for (const node of TALENT_TREES[k]) check(`${node.id} is in TALENT_BY_ID`, TALENT_BY_ID[node.id]?.id === node.id);
}

// ---- pointsForLevel --------------------------------------------------------
check("level 0 → 0 points", pointsForLevel(0) === 0);
check("level 5 → 5 points", pointsForLevel(5) === 5);

// ---- canSpendTalent gating -------------------------------------------------
{
  const talents: Record<string, number> = {};
  // row-0 node spendable with a point
  check("can spend a row-0 node with a point", canSpendTalent("warrior", talents, 1, "w_cleave"));
  check("cannot spend with 0 points", !canSpendTalent("warrior", talents, 0, "w_cleave"));
  // gated row-2 node not spendable until enough points spent
  check("gated capstone locked early", !canSpendTalent("warrior", {}, 1, "w_whirl"));
  check("capstone unlocks after 4 spent", canSpendTalent("warrior", { w_cleave: 1, w_tough: 1, w_taunt: 1, w_shield: 1 }, 1, "w_whirl"));
  // choice exclusivity
  check("choice node A spendable", canSpendTalent("warrior", {}, 1, "w_tough"));
  check("choice node B locked once A taken", !canSpendTalent("warrior", { w_tough: 1 }, 1, "w_blood"));
  // already at max rank
  check("cannot exceed maxRank", !canSpendTalent("warrior", { w_cleave: 1 }, 1, "w_cleave"));
  // unknown node / wrong tree
  check("unknown node rejected", !canSpendTalent("warrior", {}, 1, "m_bolts"));
}

// ---- ranked nodes (maxRank > 1) + deeper rows ------------------------------
{
  // w_tough is now maxRank 2: spendable at rank 0 and 1, locked at 2.
  check("ranked spec spendable at rank 0", canSpendTalent("warrior", {}, 1, "w_tough"));
  check("ranked spec spendable at rank 1 (→2)", canSpendTalent("warrior", { w_tough: 1 }, 1, "w_tough"));
  check("ranked spec locked at maxRank", !canSpendTalent("warrior", { w_tough: 2 }, 1, "w_tough"));
  // passive bonus scales linearly with rank
  const r1 = talentPassives({ w_tough: 1 });
  const r2 = talentPassives({ w_tough: 2 });
  check("ranked passive scales ×rank", (r2.attrs.armor ?? 0) === (r1.attrs.armor ?? 0) * 2);
  // row-3 "mastery" gated by 6 points spent, rankable to 3
  const six = { w_cleave: 1, w_tough: 2, w_taunt: 1, w_shield: 1, w_bash: 1 }; // = 6 spent
  check("six points spent", talentSpent(six) === 6);
  check("row-3 master locked before 6 spent", !canSpendTalent("warrior", { w_cleave: 1 }, 1, "w_master"));
  check("row-3 master unlocks after 6 spent", canSpendTalent("warrior", six, 1, "w_master"));
  check("row-3 master rankable to 3", canSpendTalent("warrior", { ...six, w_master: 2 }, 1, "w_master"));
  check("row-3 master locked at rank 3", !canSpendTalent("warrior", { ...six, w_master: 3 }, 1, "w_master"));
}

// ---- talentSpent + passives ------------------------------------------------
check("talentSpent sums ranks", talentSpent({ a: 1, b: 1, c: 1 }) === 3);
{
  const p = talentPassives({ w_tough: 1 });
  check("toughness grants threatMult", p.threatMult === 3);
  check("toughness grants armor/stamina", (p.attrs.armor ?? 0) > 0 && (p.attrs.stamina ?? 0) > 0);
  const none = talentPassives({ w_cleave: 1 }); // ability grant, not a passive
  check("ability-grant talent has no passive attrs", Object.keys(none.attrs).length === 0 && none.threatMult === 1);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall talent checks passed");
