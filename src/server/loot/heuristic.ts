import type { Ability, AbilityCategory, PlaystyleProfile, Rarity, Theme } from "../../shared/types";

export interface LootContext {
  trigger: "kill" | "chest" | "floorEnd";
  depth: number;
  rarity: Rarity;
  theme: Theme;
  rng: () => number;
}

export interface LootEngine {
  grant(profile: PlaystyleProfile, ctx: LootContext): Ability;
}

// PHASE-0 STUB: returns one fixed ranged ability scaled by depth. Stream E / M5
// maps the profile vector to a category + clamped integer power budget. The LLM
// is never involved in any number here.
export class StubLootEngine implements LootEngine {
  grant(_profile: PlaystyleProfile, ctx: LootContext): Ability {
    const category: AbilityCategory = "ranged";
    return {
      id: `loot-${ctx.depth}-${Math.floor(ctx.rng() * 1e6).toString(36)}`,
      category,
      cd: 800,
      range: 560,
      dmg: 14 + ctx.depth,
      projectile: true,
      speed: 600,
      name: "Trinket Bolt",
      color: "#c9a0ff",
    };
  }
}
