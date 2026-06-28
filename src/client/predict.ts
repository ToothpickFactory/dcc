import { moveWithSmoothTerrainCollisions } from "../procgen/collision";
import type { CollisionGrid } from "../procgen/types";
import type { EntityDTO } from "../protocol";
import { BOSS_RADIUS, MONSTER_KINDS, PLAYER_RADIUS, PLAYER_SPEED } from "../shared/constants";
import type { Net } from "./net";

interface Blocker {
  id: string;
  x: number;
  y: number;
  r: number;
}

export class Predictor {
  x = 0;
  y = 0;
  private inited = false;
  private collision: CollisionGrid | null = null;
  private blockers: Blocker[] = [];

  setCollision(collision: CollisionGrid): void {
    this.collision = collision;
  }

  setBlockers(ents: EntityDTO[], selfId: string): void {
    this.blockers = [];
    for (const e of ents) {
      if (e.id === selfId || e.dead) continue;
      if (e.kind === "prop") this.blockers.push({ id: e.id, x: e.x, y: e.y, r: Math.max(12, 24 * (e.scale ?? 1)) });
      else if (e.kind === "player") this.blockers.push({ id: e.id, x: e.x, y: e.y, r: PLAYER_RADIUS });
      else if (e.kind === "boss") this.blockers.push({ id: e.id, x: e.x, y: e.y, r: BOSS_RADIUS });
      else if (e.kind === "monster") this.blockers.push({ id: e.id, x: e.x, y: e.y, r: MONSTER_KINDS[e.monKind ?? "grunt"].radius });
    }
  }

  private blockedByEntity(nx: number, ny: number, radius: number): boolean {
    for (const b of this.blockers) {
      const rr = radius + b.r;
      const dx = nx - b.x;
      const dy = ny - b.y;
      if (dx * dx + dy * dy >= rr * rr) continue;

      const fdx = this.x - b.x;
      const fdy = this.y - b.y;
      if (fdx * fdx + fdy * fdy < rr * rr && dx * dx + dy * dy >= fdx * fdx + fdy * fdy) continue;
      return true;
    }
    return false;
  }

  private move(dx: number, dy: number, radius: number): void {
    const nx = this.x + dx;
    if (!this.blockedByEntity(nx, this.y, radius)) {
      if (this.collision) {
        const p = { x: this.x, y: this.y };
        moveWithSmoothTerrainCollisions(this.collision, p, dx, 0, radius);
        this.x = p.x;
      } else {
        this.x = nx;
      }
    }

    const ny = this.y + dy;
    if (!this.blockedByEntity(this.x, ny, radius)) {
      if (this.collision) {
        const p = { x: this.x, y: this.y };
        moveWithSmoothTerrainCollisions(this.collision, p, 0, dy, radius);
        this.y = p.y;
      } else {
        this.y = ny;
      }
    }
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
      this.move(dx, dy, PLAYER_RADIUS);
    }
    this.x += (net.self.x - this.x) * 0.15;
    this.y += (net.self.y - this.y) * 0.15;
  }
}
