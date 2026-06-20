import { moveWithSmoothTerrainCollisions } from "../procgen/collision";
import type { CollisionGrid } from "../procgen/types";
import { PLAYER_RADIUS, PLAYER_SPEED } from "../shared/constants";
import type { Net } from "./net";

export class Predictor {
  x = 0;
  y = 0;
  private inited = false;
  private collision: CollisionGrid | null = null;

  setCollision(collision: CollisionGrid): void {
    this.collision = collision;
  }

  update(net: Net, mv: [number, number], dt: number) {
    if (!net.self) return;
    if (!this.inited) {
      this.x = net.self.x;
      this.y = net.self.y;
      this.inited = true;
    }
    const len = Math.hypot(mv[0], mv[1]);
    if (len > 0) {
      const dx = (mv[0] / len) * PLAYER_SPEED * dt;
      const dy = (mv[1] / len) * PLAYER_SPEED * dt;
      if (this.collision) moveWithSmoothTerrainCollisions(this.collision, this, dx, dy, PLAYER_RADIUS);
      else {
        this.x += dx;
        this.y += dy;
      }
    }
    this.x += (net.self.x - this.x) * 0.15;
    this.y += (net.self.y - this.y) * 0.15;
  }
}
