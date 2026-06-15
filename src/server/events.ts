// Playstyle event taxonomy: Stream B (combat) EMITS these; Stream E (profile)
// CONSUMES them. Defined here so neither side imports the other's implementation.
export type PlaystyleEvent =
  | { e: "hit"; by: string; targetKind: "monster" | "player"; range: number; ability: number }
  | { e: "kill"; by: string; targetKind: "monster" | "player" }
  | { e: "heal"; by: string; amount: number; ally: boolean }
  | { e: "friendlyFire"; by: string; amount: number }
  | { e: "explore"; by: string; tilesNew: number }
  | { e: "assist"; by: string };
