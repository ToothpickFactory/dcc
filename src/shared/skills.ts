import type { Ability, MonsterKind } from "./types";

// ===========================================================================
// SKILL / EVOLUTION SYSTEM (shared by client + server)
//
// Every action-bar ability earns XP as you USE it (hits) and KILL with it. When
// it has earned enough, it can EVOLVE into one of a branching set of stronger
// abilities — and each of those branches further. Players craft their character
// by which branches they pick. Permadeath wipes all of it.
//
// `ABILITY_NODES` is the catalog of every node (base + evolutions). `EVOLUTIONS`
// is the tree: a node id -> the ids it can become. Adding a new branch is just
// data here — the engine needs no changes.
// ===========================================================================

// A node template. Cloned onto the bar; `xp`/`tier` are tracked per-instance.
export const ABILITY_NODES: Record<string, Ability> = {
  // ---- Sword line (melee cone) ----
  sword: { id: "sword", category: "melee", cd: 550, range: 95, dmg: 12, projectile: false, name: "Wooden Sword", icon: "🗡️", color: "#caa46a", flavor: "A whittled training blade." },
  cleaver: { id: "cleaver", category: "melee", cd: 600, range: 105, dmg: 21, projectile: false, name: "Iron Cleaver", icon: "🔪", color: "#d7d2c4", flavor: "Heavier. Hits harder." },
  greatcleaver: { id: "greatcleaver", category: "melee", cd: 650, range: 115, dmg: 34, projectile: false, name: "Greatcleaver", icon: "⚔️", color: "#e6e0cf", flavor: "A two-handed brute of a blade." },
  executioner: { id: "executioner", category: "melee", cd: 780, range: 120, dmg: 52, projectile: false, name: "Executioner", icon: "🪓", color: "#ff7a5c", flavor: "One swing, one sentence." },
  blastblade: { id: "blastblade", category: "melee", cd: 600, range: 130, dmg: 14, projectile: false, cone: 1.5, name: "Blast Blade", icon: "💥", color: "#ffb14d", flavor: "A wide arc of force in front of you." },
  whirlwind: { id: "whirlwind", category: "melee", cd: 720, range: 150, dmg: 17, projectile: false, cone: Math.PI * 2, name: "Whirlwind", icon: "🌀", color: "#7fd4ff", flavor: "Spin to win — hits all around you." },

  // ---- Rocks line (thrown projectile) ----
  rocks: { id: "rocks", category: "ranged", cd: 450, range: 470, dmg: 9, projectile: true, speed: 520, ammo: 20, maxAmmo: 20, name: "Rocks", icon: "🪨", color: "#a9a39a", flavor: "A pocketful of throwing stones." },
  sharprocks: { id: "sharprocks", category: "ranged", cd: 400, range: 500, dmg: 15, projectile: true, speed: 560, ammo: 26, maxAmmo: 26, name: "Sharp Stones", icon: "🗿", color: "#bfb6a6", flavor: "Knapped to an edge." },
  boulder: { id: "boulder", category: "aoe", cd: 720, range: 460, dmg: 32, projectile: true, speed: 380, ammo: 14, maxAmmo: 14, name: "Boulder Toss", icon: "🪨", color: "#9c8e7a", flavor: "One big rock. It hurts." },
  multishot: { id: "multishot", category: "ranged", cd: 520, range: 460, dmg: 7, projectile: true, speed: 540, pellets: 3, spread: 0.35, ammo: 30, maxAmmo: 30, name: "Sling Volley", icon: "🎯", color: "#c2b8a4", flavor: "Three stones at once." },
  scattershot: { id: "scattershot", category: "ranged", cd: 560, range: 440, dmg: 6, projectile: true, speed: 540, pellets: 5, spread: 0.55, ammo: 40, maxAmmo: 40, name: "Scattershot", icon: "✴️", color: "#d8cdb4", flavor: "A cone of stinging shot." },

  // ---- Support line (heals only ever land on allies — never the enemy) ----
  mend: { id: "mend", category: "support", cd: 3200, range: 480, dmg: -28, projectile: true, speed: 520, allyOnly: true, name: "Mend", icon: "✨", color: "#5dff9b", flavor: "Lob a mending bolt at an ally." },
  wavemend: { id: "wavemend", category: "support", cd: 4200, range: 520, dmg: -22, projectile: true, speed: 480, pellets: 3, spread: 0.5, allyOnly: true, name: "Healing Wave", icon: "🌊", color: "#7dffd0", flavor: "A fan of healing that mends several allies." },
  shieldward: { id: "shieldward", category: "support", cd: 9000, range: 520, dmg: 0, projectile: true, speed: 560, allyOnly: true, shield: 45, name: "Shield Ward", icon: "🛡️", color: "#9be7ff", flavor: "Bolt an ally with an absorb shield." },

  // ---- Trinity utilities (tank threat + group haste) ----
  taunt: { id: "taunt", category: "utility", cd: 8000, range: 320, dmg: 0, projectile: false, taunt: true, name: "Taunt", icon: "🗯️", color: "#ff9a4d", flavor: "Roar — nearby foes turn on you." },
  bloodlust: { id: "bloodlust", category: "support", cd: 60000, range: 0, dmg: 0, projectile: false, groupBuff: "haste", name: "Bloodlust", icon: "🩸", color: "#ff5b6e", flavor: "Hasten the whole party for a short burst." },

  // ---- Hard crowd control (class-defining; granted by a talent) ----
  // Warrior: a wide frontal shield bash that STUNS — interrupts a wind-up, sets up a finisher.
  shieldbash: { id: "shieldbash", category: "utility", cd: 7000, range: 118, dmg: 10, projectile: false, cone: Math.PI * 0.7, stunMs: 1500, name: "Shield Bash", icon: "🛡️", color: "#ffd24d", flavor: "Slam your shield — a stunning frontal blow." },
  // Hunter: a head-ringing ranged shot that STUNS the first foe it hits.
  concussive: { id: "concussive", category: "ranged", cd: 8000, range: 470, dmg: 8, projectile: true, speed: 560, stunMs: 1300, name: "Concussive Shot", icon: "💥", color: "#ffd24d", flavor: "A ringing shot that stuns at range." },
  // Rogue: a crippling cut that ROOTS — the foe can still swing, but it can't chase you.
  hamstring: { id: "hamstring", category: "utility", cd: 7000, range: 120, dmg: 13, projectile: false, cone: Math.PI / 3, rootMs: 2000, name: "Hamstring", icon: "🪢", color: "#9be07a", flavor: "Cut the legs — they can't move, only flail." },
  // Mage: an AoE burst that FREEZES every foe around you solid, then a slow on thaw.
  frostnova: { id: "frostnova", category: "aoe", cd: 9000, range: 205, dmg: 12, projectile: false, cone: Math.PI * 2, stunMs: 1500, freeze: true, name: "Frost Nova", icon: "❄️", color: "#9be7ff", flavor: "Flash-freeze everything around you." },
};

// node id -> the evolutions you may choose when it matures.
export const EVOLUTIONS: Record<string, string[]> = {
  sword: ["cleaver", "blastblade"],
  cleaver: ["greatcleaver"],
  greatcleaver: ["executioner"],
  blastblade: ["whirlwind"],
  rocks: ["sharprocks", "multishot"],
  sharprocks: ["boulder"],
  multishot: ["scattershot"],
  mend: ["wavemend"],
};

// XP required to be ready to evolve at a given tier (deeper evolutions cost more).
export function evolveCost(tier: number): number {
  return 15 + tier * 25; // 15, 40, 65, 90, ...  (~3 grunt-kills for the first)
}

// Is this ability matured enough to evolve, and does it have anywhere to go?
export function canEvolve(ability: Ability): boolean {
  const opts = EVOLUTIONS[ability.id];
  if (!opts || opts.length === 0) return false;
  return (ability.xp ?? 0) >= evolveCost(ability.tier ?? 0);
}

// XP awarded for a kill, by monster kind (the boss is worth a lot).
export const MONSTER_XP: Record<MonsterKind | "boss", number> = {
  grunt: 5,
  swarm: 3,
  brute: 12,
  ranged: 8,
  healer: 7, // support unit — worth killing first to stop the camp's heals
  boss: 60,
};
export const HIT_XP = 1; // landing a hit (on a monster/boss) trickles a little XP
export const PVP_KILL_XP = 10;

// ---- Character level (overall) ----
// Total XP across the run -> a character level, granting small passive bonuses.
export function charLevelOf(charXp: number): number {
  // each level costs a bit more: level L reached at 40 * L*(L+1)/2 cumulative.
  let lvl = 0;
  let need = 40;
  let acc = 0;
  while (charXp >= acc + need) {
    acc += need;
    lvl++;
    need += 35;
  }
  return lvl;
}
export function charXpForNext(charXp: number): { into: number; need: number } {
  let need = 40;
  let acc = 0;
  while (charXp >= acc + need) {
    acc += need;
    need += 35;
  }
  return { into: charXp - acc, need };
}
export const CHAR_HP_PER_LEVEL = 12; // +max HP per character level
