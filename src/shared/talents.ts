// ===========================================================================
// TALENT TREES (RPG Phase 2) — shared by client + server.
//
// At the FIRST character level-up you choose a class (see classes.ts). From then
// on every level grants 1 talent point. Points are spent in your class's tree to
// UNLOCK hotbar abilities or take PASSIVE bonuses. Deeper rows are gated by the
// number of points already spent in the tree, and a couple of "spec" nodes are
// mutually-exclusive choices (pick one of two) — the build-defining fork.
//
// `grants.ability` references an ABILITY_NODES id (skills.ts) so talents reuse the
// existing ability + evolution machinery. `grants.passive` references PASSIVES.
// Adding/retuning a tree is pure data here.
// ===========================================================================
import type { Attributes } from "./items";
import type { Klass } from "./types";

export interface TalentNode {
  id: string;
  row: number; // display row; also the gating tier
  requires?: number; // total points spent in this tree before this node unlocks
  maxRank?: number; // default 1
  choiceGroup?: string; // mutually-exclusive: only one node per group may be taken
  grants?: { ability?: string; passive?: string };
  name: string;
  icon?: string;
  desc?: string;
}

// Passive bonuses a talent can grant: flat attribute bonuses and/or a threat
// multiplier (the tank identity). Folded into derived stats on recompute.
export const PASSIVES: Record<string, { attrs?: Partial<Attributes>; threatMult?: number }> = {
  toughness: { attrs: { armor: 14, stamina: 8 }, threatMult: 3 }, // warrior tank
  bloodthirst: { attrs: { strength: 6, crit: 5 } }, // warrior dps
  pyromania: { attrs: { intellect: 6, crit: 6 } }, // mage burst
  spellweave: { attrs: { intellect: 9 } }, // mage power
  holylight: { attrs: { intellect: 9 } }, // priest healing
  divinity: { attrs: { intellect: 5, stamina: 8 } }, // priest survivability
  deadly: { attrs: { agility: 6, crit: 6 } }, // rogue burst
  swift: { attrs: { agility: 9 } }, // rogue/hunter
  marksman: { attrs: { agility: 6, crit: 5 } }, // hunter
  // ---- Row-3 "mastery" passives (ranked; modest per-rank so they scale, not spike) ----
  warmight: { attrs: { strength: 5 } }, // warrior
  sorcery: { attrs: { intellect: 5 } }, // mage
  zeal: { attrs: { intellect: 4, stamina: 4 } }, // priest
  finesse: { attrs: { agility: 5 } }, // rogue
  precision: { attrs: { agility: 4, crit: 3 } }, // hunter
};

export const TALENT_TREES: Record<Klass, TalentNode[]> = {
  warrior: [
    { id: "w_cleave", row: 0, grants: { ability: "cleaver" }, name: "Cleave", icon: "🔪", desc: "Unlock Iron Cleaver." },
    { id: "w_tough", row: 0, choiceGroup: "w_spec", maxRank: 2, grants: { passive: "toughness" }, name: "Toughness", icon: "🛡️", desc: "Tank: +armor/stamina and 3× threat. (2 ranks)" },
    { id: "w_blood", row: 0, choiceGroup: "w_spec", maxRank: 2, grants: { passive: "bloodthirst" }, name: "Bloodthirst", icon: "🩸", desc: "DPS: +strength and +crit. (2 ranks)" },
    { id: "w_taunt", row: 1, requires: 2, grants: { ability: "taunt" }, name: "Taunt", icon: "🗯️", desc: "Unlock Taunt (hold aggro)." },
    { id: "w_shield", row: 1, requires: 2, grants: { ability: "shieldward" }, name: "Shield Ward", icon: "🛡️", desc: "Unlock an ally absorb shield." },
    { id: "w_bash", row: 1, requires: 2, grants: { ability: "shieldbash" }, name: "Shield Bash", icon: "🛡️", desc: "Unlock a stunning frontal bash." },
    { id: "w_whirl", row: 2, requires: 4, grants: { ability: "whirlwind" }, name: "Whirlwind", icon: "🌀", desc: "Capstone: spin to hit all around." },
    { id: "w_master", row: 3, requires: 6, maxRank: 3, grants: { passive: "warmight" }, name: "Warmastery", icon: "⚔️", desc: "+strength per rank. (3 ranks)" },
  ],
  mage: [
    { id: "m_bolts", row: 0, grants: { ability: "sharprocks" }, name: "Arcane Bolts", icon: "🔷", desc: "Unlock sharper ranged bolts." },
    { id: "m_pyro", row: 0, choiceGroup: "m_spec", maxRank: 2, grants: { passive: "pyromania" }, name: "Pyromania", icon: "🔥", desc: "+intellect and +crit. (2 ranks)" },
    { id: "m_weave", row: 0, choiceGroup: "m_spec", maxRank: 2, grants: { passive: "spellweave" }, name: "Spellweave", icon: "🌌", desc: "+intellect (steady power). (2 ranks)" },
    { id: "m_multi", row: 1, requires: 2, grants: { ability: "multishot" }, name: "Arcane Missiles", icon: "🎯", desc: "Unlock a 3-bolt volley." },
    { id: "m_warp", row: 1, requires: 2, grants: { ability: "bloodlust" }, name: "Time Warp", icon: "🩸", desc: "Unlock a group haste burst." },
    { id: "m_frost", row: 1, requires: 2, grants: { ability: "frostnova" }, name: "Frost Nova", icon: "❄️", desc: "Unlock an AoE freeze burst." },
    { id: "m_scatter", row: 2, requires: 4, grants: { ability: "scattershot" }, name: "Arcane Barrage", icon: "✴️", desc: "Capstone: a cone of bolts." },
    { id: "m_master", row: 3, requires: 6, maxRank: 3, grants: { passive: "sorcery" }, name: "Arcane Mastery", icon: "🔮", desc: "+intellect per rank. (3 ranks)" },
  ],
  priest: [
    { id: "p_mend", row: 0, grants: { ability: "mend" }, name: "Mend", icon: "✨", desc: "Unlock a healing bolt (allies only)." },
    { id: "p_holy", row: 0, choiceGroup: "p_spec", maxRank: 2, grants: { passive: "holylight" }, name: "Holy Light", icon: "🌟", desc: "+intellect (stronger heals). (2 ranks)" },
    { id: "p_div", row: 0, choiceGroup: "p_spec", maxRank: 2, grants: { passive: "divinity" }, name: "Divinity", icon: "🕊️", desc: "+intellect and +stamina. (2 ranks)" },
    { id: "p_shield", row: 1, requires: 2, grants: { ability: "shieldward" }, name: "Power Word: Shield", icon: "🛡️", desc: "Unlock an ally absorb shield." },
    { id: "p_inspire", row: 1, requires: 2, grants: { ability: "bloodlust" }, name: "Inspire", icon: "🩸", desc: "Unlock a group haste burst." },
    { id: "p_wave", row: 2, requires: 4, grants: { ability: "wavemend" }, name: "Wave of Mending", icon: "🌊", desc: "Capstone: heal several allies." },
    { id: "p_master", row: 3, requires: 6, maxRank: 3, grants: { passive: "zeal" }, name: "Zeal", icon: "🕊️", desc: "+intellect/stamina per rank. (3 ranks)" },
  ],
  rogue: [
    { id: "r_strike", row: 0, grants: { ability: "cleaver" }, name: "Quick Strikes", icon: "🔪", desc: "Unlock faster melee strikes." },
    { id: "r_deadly", row: 0, choiceGroup: "r_spec", maxRank: 2, grants: { passive: "deadly" }, name: "Deadliness", icon: "☠️", desc: "+agility and +crit. (2 ranks)" },
    { id: "r_swift", row: 0, choiceGroup: "r_spec", maxRank: 2, grants: { passive: "swift" }, name: "Swiftness", icon: "💨", desc: "+agility (speed + power). (2 ranks)" },
    { id: "r_blast", row: 1, requires: 2, grants: { ability: "blastblade" }, name: "Blade Flurry", icon: "💥", desc: "Unlock a wide melee arc." },
    { id: "r_knives", row: 1, requires: 2, grants: { ability: "sharprocks" }, name: "Throwing Knives", icon: "🗿", desc: "Unlock thrown blades." },
    { id: "r_ham", row: 1, requires: 2, grants: { ability: "hamstring" }, name: "Hamstring", icon: "🪢", desc: "Unlock a crippling root." },
    { id: "r_fan", row: 2, requires: 4, grants: { ability: "whirlwind" }, name: "Fan of Knives", icon: "🌀", desc: "Capstone: strike all around." },
    { id: "r_master", row: 3, requires: 6, maxRank: 3, grants: { passive: "finesse" }, name: "Finesse", icon: "🗡️", desc: "+agility per rank. (3 ranks)" },
  ],
  hunter: [
    { id: "h_aim", row: 0, grants: { ability: "sharprocks" }, name: "Steady Aim", icon: "🎯", desc: "Unlock sharper shots." },
    { id: "h_mark", row: 0, choiceGroup: "h_spec", maxRank: 2, grants: { passive: "marksman" }, name: "Marksman", icon: "🏹", desc: "+agility and +crit. (2 ranks)" },
    { id: "h_swift", row: 0, choiceGroup: "h_spec", maxRank: 2, grants: { passive: "swift" }, name: "Fleet", icon: "💨", desc: "+agility (speed + power). (2 ranks)" },
    { id: "h_multi", row: 1, requires: 2, grants: { ability: "multishot" }, name: "Multi-Shot", icon: "🎯", desc: "Unlock a 3-shot volley." },
    { id: "h_rapid", row: 1, requires: 2, grants: { ability: "bloodlust" }, name: "Rapid Fire", icon: "🩸", desc: "Unlock a group haste burst." },
    { id: "h_conc", row: 1, requires: 2, grants: { ability: "concussive" }, name: "Concussive Shot", icon: "💥", desc: "Unlock a stunning ranged shot." },
    { id: "h_scatter", row: 2, requires: 4, grants: { ability: "scattershot" }, name: "Volley", icon: "✴️", desc: "Capstone: a cone of shots." },
    { id: "h_master", row: 3, requires: 6, maxRank: 3, grants: { passive: "precision" }, name: "Precision", icon: "🏹", desc: "+agility/crit per rank. (3 ranks)" },
  ],
};

// Flat id -> node lookup across all trees.
export const TALENT_BY_ID: Record<string, TalentNode> = (() => {
  const m: Record<string, TalentNode> = {};
  for (const tree of Object.values(TALENT_TREES)) for (const n of tree) m[n.id] = n;
  return m;
})();

// 1 talent point per character level.
export function pointsForLevel(level: number): number {
  return Math.max(0, level);
}

// Total points already spent in a talents map.
export function talentSpent(talents: Record<string, number>): number {
  let n = 0;
  for (const v of Object.values(talents)) n += v;
  return n;
}

// May this player put a point into `nodeId` right now? Validates: the node is in
// the class tree, points are available, rank room remains, the row is unlocked
// (enough points already spent), and no conflicting choice has been taken.
export function canSpendTalent(klass: Klass, talents: Record<string, number>, talentPoints: number, nodeId: string): boolean {
  if (talentPoints <= 0) return false;
  const tree = TALENT_TREES[klass];
  const node = tree.find((n) => n.id === nodeId);
  if (!node) return false;
  const rank = talents[nodeId] ?? 0;
  if (rank >= (node.maxRank ?? 1)) return false;
  if ((node.requires ?? 0) > talentSpent(talents)) return false;
  if (node.choiceGroup) {
    for (const other of tree) {
      if (other.id !== nodeId && other.choiceGroup === node.choiceGroup && (talents[other.id] ?? 0) > 0) return false;
    }
  }
  return true;
}

// Sum the passive effects (attribute bonuses + threat multiplier) a talents map
// grants. Folded into derived stats on recompute.
export function talentPassives(talents: Record<string, number>): { attrs: Partial<Attributes>; threatMult: number } {
  const attrs: Partial<Attributes> = {};
  let threatMult = 1;
  for (const [id, rank] of Object.entries(talents)) {
    if (rank <= 0) continue;
    const node = TALENT_BY_ID[id];
    const passiveId = node?.grants?.passive;
    if (!passiveId) continue;
    const p = PASSIVES[passiveId];
    if (!p) continue;
    if (p.attrs) for (const [k, v] of Object.entries(p.attrs)) attrs[k as keyof Attributes] = (attrs[k as keyof Attributes] ?? 0) + (v as number) * rank;
    if (p.threatMult) threatMult = Math.max(threatMult, p.threatMult);
  }
  return { attrs, threatMult };
}
