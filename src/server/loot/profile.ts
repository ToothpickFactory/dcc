import type { PlayerClass, PlaystyleProfile } from "../../shared/types";
import type { PlaystyleEvent } from "../events";

export interface ProfileTracker {
  record(ev: PlaystyleEvent): void; // O(1), in-loop, no IO
  get(playerId: string): PlaystyleProfile;
  classOf(playerId: string): PlayerClass;
}

const FLAT: PlaystyleProfile = {
  stealth: 0,
  ranged: 0,
  melee: 0,
  support: 0,
  aggression: 0,
  exploration: 0,
  teamwork: 0,
};

// PHASE-0 STUB: records a count but always reports a flat profile + "vanilla".
// Stream E / M5 implements EMA aggregation across the 7 axes and the emergent
// classOf (Protector/Hunter/Shadow/...).
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
