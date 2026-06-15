// Unit test for the deterministic heuristic LootEngine (Stream E / M5).
//   node --experimental-strip-types src/server/loot/heuristic.test.ts
//   (or: npm run test:loot)
import { HeuristicLootEngine } from "./heuristic.ts";
import type { LootContext } from "./heuristic.ts";
import type { PlaystyleProfile, Rarity } from "../../shared/types.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}${detail ? "  — " + detail : ""}`);
  }
}

// Seeded PRNG (mulberry32) so each grant is reproducible.
function seeded(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const FLAT: PlaystyleProfile = { stealth: 0, ranged: 0, melee: 0, support: 0, aggression: 0, exploration: 0, teamwork: 0 };
const prof = (o: Partial<PlaystyleProfile>): PlaystyleProfile => ({ ...FLAT, ...o });
const ctx = (o: Partial<LootContext> & { seed: number }): LootContext => ({
  trigger: "kill",
  depth: o.depth ?? 1,
  rarity: o.rarity ?? "common",
  theme: o.theme ?? "fantasy",
  rng: seeded(o.seed),
  ...(({ seed, ...rest }) => rest)(o),
});

const eng = new HeuristicLootEngine();

// ---- Category tracks the dominant axis -------------------------------------
{
  check("ranged profile → ranged", eng.grant(prof({ ranged: 0.9, aggression: 0.6 }), ctx({ seed: 1 })).category === "ranged");
  check("melee profile → melee", eng.grant(prof({ melee: 0.9, aggression: 0.6 }), ctx({ seed: 1 })).category === "melee");
  check("support profile → support", eng.grant(prof({ support: 0.9, teamwork: 0.5 }), ctx({ seed: 1 })).category === "support");
  check("stealth profile → stealth", eng.grant(prof({ stealth: 0.9 }), ctx({ seed: 1 })).category === "stealth");
}

// ---- Restorative scales with LIVE support (anti-exploit) -------------------
{
  const strong = eng.grant(prof({ support: 0.95 }), ctx({ seed: 7, rarity: "rare" }));
  const weak = eng.grant(prof({ support: 0.45 }), ctx({ seed: 7, rarity: "rare" }));
  check("both grants are heals", strong.dmg < 0 && weak.dmg < 0, `${strong.dmg} / ${weak.dmg}`);
  check("higher support → stronger heal", Math.abs(strong.dmg) > Math.abs(weak.dmg), `strong=${strong.dmg} weak=${weak.dmg}`);
}

// ---- Numbers are clamped integers ------------------------------------------
{
  const a = eng.grant(prof({ ranged: 0.9 }), ctx({ seed: 3, depth: 80, rarity: "legendary" }));
  check("dmg is an integer", Number.isInteger(a.dmg), String(a.dmg));
  check("cd is an integer", Number.isInteger(a.cd), String(a.cd));
  check("dmg clamped to playable cap", a.dmg <= 60, String(a.dmg));
  check("cd clamped to floor", a.cd >= 360, String(a.cd));
}

// ---- Depth scales power ----------------------------------------------------
{
  const shallow = eng.grant(prof({ ranged: 0.9 }), ctx({ seed: 5, depth: 1, rarity: "common" }));
  const deep = eng.grant(prof({ ranged: 0.9 }), ctx({ seed: 5, depth: 30, rarity: "common" }));
  check("deeper floor → more damage", deep.dmg > shallow.dmg, `d1=${shallow.dmg} d30=${deep.dmg}`);
}

// ---- Determinism: same (profile, ctx) → identical ability ------------------
{
  const p = prof({ aggression: 0.8, melee: 0.6 });
  const a = eng.grant(p, ctx({ seed: 42, depth: 9, rarity: "epic" }));
  const b = eng.grant(p, ctx({ seed: 42, depth: 9, rarity: "epic" }));
  check("identical seed → identical ability", JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall loot checks passed");
