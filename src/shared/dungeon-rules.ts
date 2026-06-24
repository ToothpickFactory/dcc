import {
  BOSS_NAME,
  BRIAR_REVENANT_BOSS_NAME,
  ICE_GOLEM_BOSS_NAME,
  JAILOR_BOSS_NAME,
  JUGGERNAUT_BOSS_NAME,
  PRIMAL_CONFLUX_BOSS_NAME,
  TERRORBOT_BOSS_NAME,
} from "./constants";
import type { DamageType, EnemyVisualKind, ProjectileRender, Theme } from "./types";

export interface AttackProfile {
  bolt: DamageType;
  melee: DamageType;
}

export interface BossProfile extends AttackProfile {
  name: string;
}

export const BOSS_BY_THEME: Record<Theme, BossProfile> = {
  forest: { name: BRIAR_REVENANT_BOSS_NAME, bolt: "poison", melee: "stun" },
  icedungeon: { name: ICE_GOLEM_BOSS_NAME, bolt: "frost", melee: "bleed" },
  fantasy: { name: JAILOR_BOSS_NAME, bolt: "electric", melee: "stun" },
  nightmare: { name: JUGGERNAUT_BOSS_NAME, bolt: "fire", melee: "stun" },
  clockwork: { name: PRIMAL_CONFLUX_BOSS_NAME, bolt: "fire", melee: "bleed" },
  cyberpunk: { name: TERRORBOT_BOSS_NAME, bolt: "electric", melee: "bleed" },
  pirate: { name: BOSS_NAME, bolt: "poison", melee: "poison" },
};

export const ENEMIES_BY_THEME: Record<Theme, EnemyVisualKind[]> = {
  cyberpunk: ["alien_squid", "skeleton", "zombie"],
  forest: ["ent", "skeleton", "troll", "wraith"],
  fantasy: ["goblin", "orc"],
  clockwork: ["goblin", "wraith", "zombie"],
  nightmare: ["ghoul", "infernax", "skeleton", "wraith", "zombie"],
  pirate: ["pirate", "sharkman"],
  icedungeon: ["wraith"],
};

export const ENEMY_ATTACKS: Record<EnemyVisualKind, AttackProfile> = {
  alien_squid: { bolt: "electric", melee: "bleed" },
  ent: { bolt: "poison", melee: "stun" },
  ghoul: { bolt: "shadow", melee: "shadow" },
  goblin: { bolt: "bleed", melee: "bleed" },
  infernax: { bolt: "fire", melee: "shadow" },
  orc: { bolt: "electric", melee: "stun" },
  pirate: { bolt: "frost", melee: "bleed" },
  sharkman: { bolt: "frost", melee: "bleed" },
  skeleton: { bolt: "poison", melee: "bleed" },
  troll: { bolt: "poison", melee: "bleed" },
  wraith: { bolt: "shadow", melee: "shadow" },
  zombie: { bolt: "poison", melee: "stun" },
};

const RANDOM_BOLT_TYPES: DamageType[] = ["bleed", "electric", "fire", "frost", "poison", "shadow", "stun"];

export function bossProfileForTheme(theme: Theme, rng: () => number): BossProfile {
  const base = BOSS_BY_THEME[theme];
  if (base.name === PRIMAL_CONFLUX_BOSS_NAME) return { ...base, bolt: pick(RANDOM_BOLT_TYPES, rng) };
  if (base.name === TERRORBOT_BOSS_NAME) return { ...base, bolt: pick(["electric", "fire"], rng) };
  return base;
}

export function enemyVisualForTheme(theme: Theme, rng: () => number): EnemyVisualKind {
  return pick(ENEMIES_BY_THEME[theme] ?? ENEMIES_BY_THEME.fantasy, rng);
}

export function attackProfileForEnemy(enemy: EnemyVisualKind): AttackProfile {
  return ENEMY_ATTACKS[enemy] ?? ENEMY_ATTACKS.goblin;
}

export function projectileRenderForDamage(type: DamageType): ProjectileRender {
  switch (type) {
    case "frost": return "ice";
    case "electric": return "electric";
    case "shadow": return "shadow";
    case "bleed":
      return "bleed";
    case "stun":
      return "stun";
    case "poison": return "poison";
    case "fire":
    default: return "fire";
  }
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]!;
}
