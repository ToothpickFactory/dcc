import { PLAYER_SPEED, SLOW_FACTOR, WORLD } from "../../shared/constants";
import type { PlayerState, WorldCtx } from "../state";

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Integrate a player's last input vector. Authoritative — the client predicts
// the same math locally (client/predict.ts) for responsiveness.
// PHASE-0: open-field movement (bounds clamp only). Floor-grid collision is
// added in Stream B Commit 2.
export function stepPlayer(ctx: WorldCtx, p: PlayerState, dt: number): void {
  if (p.status !== "alive") return;
  const len = Math.hypot(p.mvx, p.mvy);
  if (len > 0) {
    const speed = PLAYER_SPEED * (p.slowUntil > ctx.now ? SLOW_FACTOR : 1);
    const ux = p.mvx / len;
    const uy = p.mvy / len;
    p.x = clamp(p.x + ux * speed * dt, 16, WORLD.w - 16);
    p.y = clamp(p.y + uy * speed * dt, 16, WORLD.h - 16);
  }
}
