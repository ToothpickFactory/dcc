import { MONSTER_KINDS, PLAYER_MAX_HP, PLAYER_SPEED } from "../../shared/constants";
import { aggregateAttrs, deriveStats } from "../../shared/items";
import type { MonsterState, PlayerState } from "../state";

// Recompute an entity's derived stats from its base attributes + equipped gear.
// Called once on spawn and again on any inventory change — NOT in the hot loop
// (the sim reads the cached `derived` each tick). Current HP is clamped down if
// removing gear lowered max HP.

export function recomputePlayer(p: PlayerState): void {
  p.derived = deriveStats(PLAYER_MAX_HP, PLAYER_SPEED, aggregateAttrs(p.base, p.inv));
  if (p.hp > p.derived.maxHp) p.hp = p.derived.maxHp;
}

export function recomputeMonster(m: MonsterState): void {
  const def = MONSTER_KINDS[m.kind];
  m.derived = deriveStats(def.hp, def.speed, aggregateAttrs(m.base, m.inv));
  m.maxHp = m.derived.maxHp; // keep the broadcast field in sync with gear
  if (m.hp > m.maxHp) m.hp = m.maxHp;
}
