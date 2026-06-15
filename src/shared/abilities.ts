import type { Ability } from "./types";

// Every hero starts with this action bar: a melee Wooden Sword in slot 1 (the
// AUTO-CAST slot — it auto-swings at the nearest foe) and throwable Rocks with
// limited ammo in slot 2. Better abilities are found as loot and swapped into
// the bar (Stream E). The shapes match `Ability`, so the rest of the engine is
// unchanged — only the starting contents changed.
export const DEFAULT_ABILITIES: Ability[] = [
  { id: "sword", category: "melee", cd: 550, range: 95, dmg: 12, projectile: false, name: "Wooden Sword", icon: "🗡️", color: "#caa46a" },
  { id: "rocks", category: "ranged", cd: 450, range: 470, dmg: 9, projectile: true, speed: 520, ammo: 20, maxAmmo: 20, name: "Rocks", icon: "🪨", color: "#a9a39a" },
];
