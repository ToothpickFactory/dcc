// Unit test for the skill / evolution data + curves.
//   node --experimental-strip-types src/shared/skills.test.ts  (npm run test:skills)
import { ABILITY_NODES, EVOLUTIONS, MONSTER_XP, canEvolve, charLevelOf, charXpForNext, evolveCost } from "./skills.ts";
import type { Ability } from "./types.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}${detail ? "  — " + detail : ""}`);
  }
}

// ---- tree integrity: every node referenced exists; every evolve key is a node ----
{
  let allExist = true;
  for (const [from, tos] of Object.entries(EVOLUTIONS)) {
    if (!ABILITY_NODES[from]) allExist = false;
    for (const to of tos) if (!ABILITY_NODES[to]) allExist = false;
  }
  check("every evolution node exists in the catalog", allExist);
  check("node ids are self-consistent", Object.entries(ABILITY_NODES).every(([id, a]) => a.id === id));
  check("starter nodes (sword/rocks) have branches", (EVOLUTIONS.sword?.length ?? 0) >= 2 && (EVOLUTIONS.rocks?.length ?? 0) >= 2);
}

// ---- evolve readiness ----
{
  const sword: Ability = { ...ABILITY_NODES.sword, xp: 0, tier: 0 };
  check("fresh ability cannot evolve", !canEvolve(sword));
  sword.xp = evolveCost(0);
  check("ability with enough XP can evolve", canEvolve(sword));
  // a leaf node (no branches) never evolves even with XP
  const leaf: Ability = { ...ABILITY_NODES.executioner, xp: 9999, tier: 3 };
  check("a leaf node can't evolve", !canEvolve(leaf));
  // deeper tiers cost more
  check("evolve cost rises with tier", evolveCost(1) > evolveCost(0) && evolveCost(2) > evolveCost(1));
}

// ---- character level curve ----
{
  check("0 XP → level 0", charLevelOf(0) === 0);
  check("40 XP → level 1", charLevelOf(40) === 1);
  check("levels are monotonic", charLevelOf(500) >= charLevelOf(200) && charLevelOf(200) >= charLevelOf(40));
  const { into, need } = charXpForNext(50);
  check("xp-for-next is sane", into >= 0 && need > 0 && into < need, `into=${into} need=${need}`);
}

// ---- monster XP ----
{
  check("boss is worth the most XP", MONSTER_XP.boss > MONSTER_XP.brute && MONSTER_XP.brute > MONSTER_XP.grunt);
  check("all kinds give positive XP", Object.values(MONSTER_XP).every((v) => v > 0));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall skill checks passed");
