import type { AbilityCategory, AbilityFlavor, Rarity, Theme } from "../../shared/types";

export interface FlavorService {
  flavor(category: AbilityCategory, rarity: Rarity, theme: Theme): Promise<AbilityFlavor>;
}

// PHASE-0 STUB: deterministic static names. Stream E / M5 swaps in Workers AI /
// Claude behind AI Gateway — with THIS remaining the always-available fallback
// table the game degrades to. Gameplay never blocks on the model.
export class StubFlavorService implements FlavorService {
  async flavor(category: AbilityCategory, rarity: Rarity, _theme: Theme): Promise<AbilityFlavor> {
    return { name: `${rarity} ${category}`, flavor: "A plain implement, awaiting its legend." };
  }
}
