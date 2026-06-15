import type { Ability } from "./types";

// Every player starts vanilla with these four. Stream E (M5) replaces/extends
// them with playstyle-driven grants; the shapes are identical so the rest of the
// engine never changes.
export const DEFAULT_ABILITIES: Ability[] = [
  { id: "bolt", category: "ranged", cd: 600, range: 600, dmg: 16, projectile: true, speed: 620, name: "Bolt", icon: "🔥", color: "#ff6a3d" },
  { id: "frost", category: "ranged", cd: 1500, range: 520, dmg: 12, projectile: true, speed: 520, slowMs: 1500, name: "Frost", icon: "❄️", color: "#5fd0ff" },
  { id: "mend", category: "support", cd: 5000, range: 0, dmg: -34, projectile: false, name: "Mend", icon: "✨", color: "#5dff9b" },
  { id: "cleave", category: "melee", cd: 700, range: 120, dmg: 14, projectile: false, name: "Cleave", icon: "⚡", color: "#ffd34d" },
];
