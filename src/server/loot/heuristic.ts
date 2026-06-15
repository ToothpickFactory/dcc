import type { Ability, AbilityCategory, PlaystyleProfile, Rarity, Theme } from "../../shared/types";

export interface LootContext {
  trigger: "kill" | "chest" | "floorEnd";
  depth: number;
  rarity: Rarity;
  theme: Theme;
  rng: () => number; // seeded — same (profile, ctx) ALWAYS yields the same ability
}

export interface LootEngine {
  grant(profile: PlaystyleProfile, ctx: LootContext): Ability;
}

// Rarity scales the power budget (never the category — that's playstyle-driven).
const RARITY_MULT: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.18,
  rare: 1.4,
  epic: 1.7,
  legendary: 2.1,
};

const PRESENTATION: Record<AbilityCategory, { icon: string; color: string; noun: string }> = {
  ranged: { icon: "🏹", color: "#ff6a3d", noun: "Bolt" },
  melee: { icon: "🗡️", color: "#ffd34d", noun: "Edge" },
  aoe: { icon: "💥", color: "#ff8a3d", noun: "Burst" },
  support: { icon: "✨", color: "#5dff9b", noun: "Mend" },
  utility: { icon: "❄️", color: "#5fd0ff", noun: "Snare" },
  stealth: { icon: "🌑", color: "#b06aff", noun: "Strike" },
};

function clampInt(v: number, lo: number, hi: number): number {
  const r = Math.round(v);
  return r < lo ? lo : r > hi ? hi : r;
}

// Map the 7-axis profile to an ability category. Each category scores from the
// axes that define that playstyle; a small seeded jitter keeps identical
// profiles from being perfectly deterministic in ties without ever overriding a
// clearly dominant axis. THIS is what makes loot track who you are.
function pickCategory(p: PlaystyleProfile, rng: () => number): AbilityCategory {
  const scores: Record<AbilityCategory, number> = {
    ranged: p.ranged * 1.0 + p.aggression * 0.15,
    melee: p.melee * 1.0 + p.aggression * 0.2,
    aoe: p.aggression * 0.7 + p.exploration * 0.1,
    support: p.support * 1.0 + p.teamwork * 0.5,
    utility: p.exploration * 0.7 + p.teamwork * 0.4 + p.ranged * 0.1,
    stealth: p.stealth * 1.0,
  };
  let best: AbilityCategory = "ranged";
  let bestVal = -Infinity;
  for (const k of Object.keys(scores) as AbilityCategory[]) {
    const v = scores[k] + rng() * 0.12;
    if (v > bestVal) {
      bestVal = v;
      best = k;
    }
  }
  return best;
}

// Deterministic profile -> playable Ability. The LLM is NEVER involved in any
// number here — only the display name/flavor/twist (filled later, overwritable).
// Restorative power scales with the LIVE support axis, so a player who farmed
// support and then went DPS gets only a feeble heal (closes that exploit).
export class HeuristicLootEngine implements LootEngine {
  grant(profile: PlaystyleProfile, ctx: LootContext): Ability {
    const cat = pickCategory(profile, ctx.rng);
    const mult = RARITY_MULT[ctx.rarity];
    const power = (1 + ctx.depth * 0.06) * mult; // grows with depth & rarity
    const pres = PRESENTATION[cat];
    const id = `loot-${ctx.depth}-${Math.floor(ctx.rng() * 1e9).toString(36)}`;

    const base = {
      id,
      category: cat,
      name: `${ctx.rarity} ${pres.noun}`,
      icon: pres.icon,
      color: pres.color,
    };

    switch (cat) {
      case "ranged":
        return { ...base, cd: clampInt(900 - ctx.depth * 6, 360, 1000), range: clampInt(520 + ctx.depth * 5, 380, 760), dmg: clampInt(14 * power, 8, 60), projectile: true, speed: 600 };
      case "melee":
        return { ...base, cd: clampInt(720 - ctx.depth * 5, 300, 820), range: clampInt(110 + ctx.depth, 90, 170), dmg: clampInt(17 * power, 10, 72), projectile: false };
      case "aoe":
        return { ...base, cd: clampInt(1300 - ctx.depth * 8, 700, 1500), range: clampInt(440 + ctx.depth * 4, 320, 640), dmg: clampInt(19 * power, 10, 80), projectile: true, speed: 460 };
      case "stealth":
        return { ...base, cd: clampInt(1100 - ctx.depth * 6, 600, 1300), range: clampInt(480 + ctx.depth * 4, 380, 700), dmg: clampInt(22 * power, 12, 92), projectile: true, speed: 760 };
      case "utility":
        return { ...base, cd: clampInt(1400 - ctx.depth * 6, 800, 1600), range: clampInt(480 + ctx.depth * 3, 360, 680), dmg: clampInt(10 * power, 6, 40), projectile: true, speed: 520, slowMs: clampInt(1200 + ctx.depth * 25, 800, 2600) };
      case "support": {
        // Live-support scaling: 0.25x heal at support≈0, full at support≈1.
        const restorative = (0.25 + 0.75 * profile.support) * 30 * power;
        return { ...base, cd: clampInt(4800 - ctx.depth * 12, 2600, 5200), range: clampInt(480 + ctx.depth * 3, 360, 660), dmg: -clampInt(restorative, 6, 80), projectile: true, speed: 520 };
      }
    }
  }
}

// PHASE-0 STUB retained as a fallback / for tests. Returns one fixed ranged
// ability scaled by depth.
export class StubLootEngine implements LootEngine {
  grant(_profile: PlaystyleProfile, ctx: LootContext): Ability {
    return {
      id: `loot-${ctx.depth}-${Math.floor(ctx.rng() * 1e6).toString(36)}`,
      category: "ranged",
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
