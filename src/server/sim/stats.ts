import { MONSTER_KINDS, PLAYER_MAX_HP, PLAYER_SPEED } from "../../shared/constants";
import { aggregateAttrs, deriveStats } from "../../shared/items";
import { CHAR_HP_PER_LEVEL, charLevelOf } from "../../shared/skills";
import type { MonsterState, PlayerState } from "../state";

// Recompute an entity's derived stats from its base attributes + equipped gear.
// Called once on spawn and again on any inventory change — NOT in the hot loop
// (the sim reads the cached `derived` each tick). Current HP is clamped down if
// removing gear lowered max HP. Character level adds flat max HP on top of gear.

export function recomputePlayer(p: PlayerState): void {
  const baseHp = PLAYER_MAX_HP + charLevelOf(p.charXp) * CHAR_HP_PER_LEVEL;
  p.derived = deriveStats(baseHp, PLAYER_SPEED, aggregateAttrs(p.base, p.inv));
  if (p.hp > p.derived.maxHp) p.hp = p.derived.maxHp;
}

export function recomputeMonster(m: MonsterState): void {
  const def = MONSTER_KINDS[m.kind];
  m.derived = deriveStats(def.hp, def.speed, aggregateAttrs(m.base, m.inv));
  m.maxHp = m.derived.maxHp; // keep the broadcast field in sync with gear
  if (m.hp > m.maxHp) m.hp = m.maxHp;
}
