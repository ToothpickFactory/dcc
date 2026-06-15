// Unit test for the 7-axis EMA ProfileTracker (Stream E / M5). Driven entirely
// by MOCK playstyle events — the taxonomy in events.ts — so it exercises the
// profile independently of Stream B's combat emission (per WORKSTREAMS.md, E
// develops against mock events until B lands).
//
//   node --experimental-strip-types src/server/loot/profile.test.ts
//   (or: npm run test:profile)
import { EmaProfileTracker } from "./profile.ts";
import type { PlaystyleEvent } from "../events.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? "  — " + detail : ""}`);
  }
}

// Feed a stream of events many times to let the EMA converge.
function feed(t: EmaProfileTracker, id: string, stream: PlaystyleEvent[], reps: number) {
  for (let i = 0; i < reps; i++) for (const ev of stream) t.record(ev);
}

const hit = (by: string, range: number, targetKind: "monster" | "player" = "monster"): PlaystyleEvent => ({ e: "hit", by, targetKind, range, ability: 0 });
const kill = (by: string, targetKind: "monster" | "player" = "monster"): PlaystyleEvent => ({ e: "kill", by, targetKind });
const heal = (by: string, amount: number, ally = true): PlaystyleEvent => ({ e: "heal", by, amount, ally });
const assist = (by: string): PlaystyleEvent => ({ e: "assist", by });
const explore = (by: string, tilesNew: number): PlaystyleEvent => ({ e: "explore", by, tilesNew });
const ff = (by: string, amount: number): PlaystyleEvent => ({ e: "friendlyFire", by, amount });

// ---- Archetype → expected class --------------------------------------------
{
  const t = new EmaProfileTracker();

  // Hunter: lands ranged hits at distance, secures kills.
  feed(t, "hunter", [hit("hunter", 500), hit("hunter", 480), hit("hunter", 520), kill("hunter")], 12);
  // Berserker: lands hits point-blank, secures kills.
  feed(t, "zerk", [hit("zerk", 40), hit("zerk", 60), hit("zerk", 30), kill("zerk")], 12);
  // Protector: heals allies, no fighting.
  feed(t, "prot", [heal("prot", 34), heal("prot", 30), heal("prot", 34)], 12);
  // Negotiator: assists allies (no kills of their own).
  feed(t, "nego", [assist("nego"), assist("nego"), heal("nego", 12)], 12);
  // Shadow: picks off other players with clean kills.
  feed(t, "shadow", [kill("shadow", "player"), hit("shadow", 420, "player"), kill("shadow", "player")], 12);

  check("hunter → hunter", t.classOf("hunter") === "hunter", t.classOf("hunter"));
  check("berserker → berserker", t.classOf("zerk") === "berserker", t.classOf("zerk"));
  check("protector → protector", t.classOf("prot") === "protector", t.classOf("prot"));
  check("negotiator → negotiator", t.classOf("nego") === "negotiator", t.classOf("nego"));
  check("shadow → shadow", t.classOf("shadow") === "shadow", t.classOf("shadow"));

  // Axis dominance sanity.
  const h = t.get("hunter");
  check("hunter ranged > melee", h.ranged > h.melee, `ranged=${h.ranged} melee=${h.melee}`);
  const z = t.get("zerk");
  check("berserker melee > ranged", z.melee > z.ranged, `melee=${z.melee} ranged=${z.ranged}`);
  const p = t.get("prot");
  check("protector support high", p.support > 0.5 && p.teamwork > 0.3, `support=${p.support} teamwork=${p.teamwork}`);
}

// ---- Every axis stays within [0,1] -----------------------------------------
{
  const t = new EmaProfileTracker();
  feed(t, "x", [hit("x", 600, "player"), kill("x", "player"), heal("x", 100), explore("x", 50), assist("x")], 30);
  const pr = t.get("x");
  const inRange = Object.values(pr).every((v) => v >= 0 && v <= 1);
  check("all axes within [0,1]", inRange, JSON.stringify(pr));
}

// ---- Warmup: vanilla until enough history; unseen player is flat -----------
{
  const t = new EmaProfileTracker();
  check("unseen player is vanilla", t.classOf("ghost") === "vanilla");
  const flat = t.get("ghost");
  check("unseen profile is flat", Object.values(flat).every((v) => v === 0), JSON.stringify(flat));
  t.record(hit("rookie", 500));
  t.record(kill("rookie"));
  check("classOf vanilla under MIN_EVENTS", t.classOf("rookie") === "vanilla", t.classOf("rookie"));
}

// ---- Friendly fire knocks a healer off the protector pedestal --------------
{
  const t = new EmaProfileTracker();
  feed(t, "medic", [heal("medic", 34), heal("medic", 34), assist("medic")], 12);
  const before = t.get("medic");
  const clsBefore = t.classOf("medic");
  // A burst of betrayal.
  for (let i = 0; i < 8; i++) t.record(ff("medic", 30));
  const after = t.get("medic");
  check("FF cuts teamwork", after.teamwork < before.teamwork, `before=${before.teamwork} after=${after.teamwork}`);
  check("FF cuts support", after.support < before.support, `before=${before.support} after=${after.support}`);
  check("healer started as protector", clsBefore === "protector", clsBefore);
  check("griefing healer is no longer protector", t.classOf("medic") !== "protector", t.classOf("medic"));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall profile checks passed");
