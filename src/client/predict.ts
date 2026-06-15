import { PLAYER_SPEED } from "../shared/constants";
import type { Net } from "./net";

// Local-player movement prediction. We integrate our own input every frame and
// gently correct toward the server's authoritative position. Hit OUTCOMES are
// never predicted — the server owns those, which keeps friendly fire fair and
// uncheatable (ROADMAP.md M3).
export class Predictor {
  x = 0;
  y = 0;
  private inited = false;

  update(net: Net, mv: [number, number], dt: number) {
    if (!net.self) return;
    if (!this.inited) {
      this.x = net.self.x;
      this.y = net.self.y;
      this.inited = true;
    }
    const len = Math.hypot(mv[0], mv[1]);
    if (len > 0) {
      this.x += (mv[0] / len) * PLAYER_SPEED * dt;
      this.y += (mv[1] / len) * PLAYER_SPEED * dt;
    }
    // Reconcile toward the authoritative position (simple smoothing; Stream C
    // upgrades to seq-based replay against `ack`).
    this.x += (net.self.x - this.x) * 0.15;
    this.y += (net.self.y - this.y) * 0.15;
  }
}
