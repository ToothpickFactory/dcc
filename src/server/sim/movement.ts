import { PLAYER_SPEED, WORLD } from "../../shared/constants";
import type { PlayerState } from "../state";

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Integrate a player's last input vector. Authoritative — the client predicts
// the same math locally (client/predict.ts) for responsiveness.
// PHASE-0: open-field movement (bounds clamp only). Stream B/D add collision
// against the floor's CollisionGrid.
export function stepPlayer(p: PlayerState, dt: number): void {
  if (p.status !== "alive") return;
  const len = Math.hypot(p.mvx, p.mvy);
  if (len > 0) {
    const ux = p.mvx / len;
    const uy = p.mvy / len;
    p.x = clamp(p.x + ux * PLAYER_SPEED * dt, 16, WORLD.w - 16);
    p.y = clamp(p.y + uy * PLAYER_SPEED * dt, 16, WORLD.h - 16);
  }
}
