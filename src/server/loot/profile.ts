import type { PlayerClass, PlaystyleProfile } from "../../shared/types";
import type { PlaystyleEvent } from "../events";

export interface ProfileTracker {
  record(ev: PlaystyleEvent): void; // O(1), in-loop, no IO
  get(playerId: string): PlaystyleProfile;
  classOf(playerId: string): PlayerClass;
}

const AXES = ["stealth", "ranged", "melee", "support", "aggression", "exploration", "teamwork"] as const;
type Axis = (typeof AXES)[number];

const FLAT: PlaystyleProfile = {
  stealth: 0,
  ranged: 0,
  melee: 0,
  support: 0,
  aggression: 0,
  exploration: 0,
  teamwork: 0,
};

// ---- Tuning (see ROADMAP.md M5) -------------------------------------------
// EMA weight per recorded event. ~0.08 gives a memory of roughly the last
// 12–25 events: responsive enough that a play shift re-labels you within an
// engagement, smooth enough that one stray action doesn't.
const ALPHA = 0.08;
// A hit at/beyond RANGED_REF reads as fully "ranged"; under MELEE_REF as fully
// "melee" (these key off the impact distance the combat sim reports, so the
// axes are inferred from how you actually fight, not which ability you hold).
const RANGED_REF = 520; // px (~ default Bolt range)
const MELEE_REF = 200; // px (~ Cleave range + a margin)
const HEAL_REF = 34; // a full-strength Mend = a maxed support sample
const EXPLORE_REF = 8; // new tiles revealed in one step = a maxed exploration sample
// Friendly fire is punished asymmetrically and with longer memory than the
// positive axes build (anti-grief, ROADMAP risk table): it multiplicatively
// knocks down the pro-social axes instead of just nudging an EMA.
const FF_REF = 30; // damage that counts as a "full" betrayal sample
const FF_TEAMWORK_CUT = 0.5;
const FF_SUPPORT_CUT = 0.35;
// classOf gating: need a little history AND a clear leading role, else "vanilla".
const MIN_EVENTS = 6;
const CLASS_CONFIDENCE = 0.16;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function ema(prev: number, sample: number): number {
  return prev + (sample - prev) * ALPHA;
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// What each event contributes to each axis, as an intensity in [0,1]. Axes not
// named contribute 0 — and because record() EMAs *every* axis toward its sample
// each event (0 included), the profile naturally reflects the MIX of recent
// behavior, giving rate-normalization for free (spamming heals decays your
// combat axes; going quiet on heals decays support).
function sample(ev: Exclude<PlaystyleEvent, { e: "friendlyFire" }>): Partial<Record<Axis, number>> {
  switch (ev.e) {
    case "hit": {
      const ranged = clamp01(ev.range / RANGED_REF);
      const melee = clamp01((MELEE_REF - ev.range) / MELEE_REF);
      // Landing a hit is inherently aggressive; PvP hits more so.
      return { aggression: ev.targetKind === "player" ? 1 : 0.85, ranged, melee };
    }
    case "kill":
      // Securing the finishing blow: aggressive, and a clean kill reads as the
      // mark of a picker/assassin (stealth), more so against another player.
      return { aggression: 1, stealth: ev.targetKind === "player" ? 0.9 : 0.7 };
    case "heal":
      // Mending an ally is the core support signal and also reads as teamwork;
      // a non-ally heal (e.g. a stray heal on a foe) earns only weak support.
      return ev.ally
        ? { support: clamp01(ev.amount / HEAL_REF), teamwork: 0.8 }
        : { support: clamp01(ev.amount / HEAL_REF) * 0.4 };
    case "explore":
      return { exploration: clamp01(ev.tilesNew / EXPLORE_REF) };
    case "assist":
      return { teamwork: 0.9, support: 0.4 };
  }
}

interface Agg {
  a: Record<Axis, number>;
  n: number; // events recorded (warmup gate for classOf)
}

// Real M5 tracker: per-player EMA across the 7 axes derived from the playstyle
// event taxonomy, plus an emergent classOf. All operations are O(1) and
// allocation-free on the hot path — safe to call inside the tick funnels.
export class EmaProfileTracker implements ProfileTracker {
  private agg = new Map<string, Agg>();

  private ensure(id: string): Agg {
    let s = this.agg.get(id);
    if (!s) {
      s = { a: { stealth: 0, ranged: 0, melee: 0, support: 0, aggression: 0, exploration: 0, teamwork: 0 }, n: 0 };
      this.agg.set(id, s);
    }
    return s;
  }

  record(ev: PlaystyleEvent): void {
    const s = this.ensure(ev.by);
    s.n++;

    if (ev.e === "friendlyFire") {
      // Betraying an ally: cut the pro-social axes hard (multiplicative, so it
      // lingers) and let it read as aggression. No EMA toward 0 on the others,
      // so a single misfire doesn't wipe your whole identity.
      const sev = clamp01(ev.amount / FF_REF);
      s.a.teamwork *= 1 - FF_TEAMWORK_CUT * sev;
      s.a.support *= 1 - FF_SUPPORT_CUT * sev;
      s.a.aggression = ema(s.a.aggression, 0.6);
      return;
    }

    const v = sample(ev);
    for (const ax of AXES) s.a[ax] = ema(s.a[ax], v[ax] ?? 0);
  }

  get(playerId: string): PlaystyleProfile {
    const s = this.agg.get(playerId);
    if (!s) return { ...FLAT };
    const a = s.a;
    return {
      stealth: round3(clamp01(a.stealth)),
      ranged: round3(clamp01(a.ranged)),
      melee: round3(clamp01(a.melee)),
      support: round3(clamp01(a.support)),
      aggression: round3(clamp01(a.aggression)),
      exploration: round3(clamp01(a.exploration)),
      teamwork: round3(clamp01(a.teamwork)),
    };
  }

  // Emergent class: score each archetype from the live axes and take the leader,
  // falling back to "vanilla" until there's enough history and a clear role.
  // Recomputed cheaply (called per grant and in the broadcast snapshot).
  classOf(playerId: string): PlayerClass {
    const s = this.agg.get(playerId);
    if (!s || s.n < MIN_EVENTS) return "vanilla";
    const a = s.a;
    // Aggression is high for ANY fighter, so it's only a minor tie-breaker —
    // each combat class is led by its distinguishing axis (melee/ranged/stealth).
    const scores: Record<Exclude<PlayerClass, "vanilla">, number> = {
      berserker: a.melee * 0.95 + a.aggression * 0.25,
      hunter: a.ranged * 0.95 + a.aggression * 0.2,
      shadow: a.stealth * 0.95 + a.aggression * 0.15,
      protector: a.support * 0.9 + a.teamwork * 0.3,
      negotiator: a.teamwork * 0.9 + a.support * 0.2 + a.exploration * 0.25,
    };
    let best: PlayerClass = "vanilla";
    let bestScore = CLASS_CONFIDENCE;
    for (const cls of Object.keys(scores) as Array<Exclude<PlayerClass, "vanilla">>) {
      if (scores[cls] > bestScore) {
        bestScore = scores[cls];
        best = cls;
      }
    }
    return best;
  }
}

// Retained as the always-available degenerate fallback (feature-flag / tests).
// PHASE-0 STUB: records a count but always reports a flat profile + "vanilla".
export class StubProfileTracker implements ProfileTracker {
  private seen = new Map<string, number>();
  record(ev: PlaystyleEvent): void {
    this.seen.set(ev.by, (this.seen.get(ev.by) ?? 0) + 1);
  }
  get(_playerId: string): PlaystyleProfile {
    return { ...FLAT };
  }
  classOf(_playerId: string): PlayerClass {
    return "vanilla";
  }
}
