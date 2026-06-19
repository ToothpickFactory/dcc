import { VISION_RADIUS } from "./render";
import type { CollisionGrid } from "../procgen/types";
import type { EntityDTO } from "../protocol";

// A discovery minimap: cells you've had line-of-sight to (per floor) are revealed
// and drawn to a small corner canvas, with your position, the exit (once seen),
// and living teammates. Purely client-side; mirrors the fog's LoS so the two agree.
const SIZE = 168; // canvas px (square)
const REDRAW_MS = 80; // ~12 fps is plenty for a minimap

export class Minimap {
  private canvas = document.getElementById("minimap") as HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private grid: CollisionGrid | null = null;
  private stairs: { x: number; y: number } | null = null;
  private discovered = new Set<number>();
  private scale = 1; // world px -> minimap px
  private lastCell = -1; // recompute discovery only when the player's cell changes
  private nextDraw = 0;

  constructor() {
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D;
  }

  setFloor(grid: CollisionGrid, stairs: { x: number; y: number } | null): void {
    this.grid = grid;
    this.stairs = stairs;
    this.discovered.clear();
    this.lastCell = -1;
    this.scale = SIZE / (grid.w * grid.cell);
    this.canvas.style.display = "block";
  }

  // px/py = local player world pos (for the "you" dot + LoS reveal). inPlay=false
  // (waiting room / dead) freezes discovery but still redraws allies.
  update(px: number, py: number, ents: EntityDTO[], youId: string, inPlay: boolean): void {
    if (!this.grid) return;
    if (inPlay) this.reveal(px, py);
    const now = performance.now();
    if (now < this.nextDraw) return;
    this.nextDraw = now + REDRAW_MS;
    this.draw(px, py, ents, youId);
  }

  private reveal(px: number, py: number): void {
    const grid = this.grid!;
    const cell = grid.cell;
    const cx = Math.floor(px / cell);
    const cy = Math.floor(py / cell);
    const here = cy * grid.w + cx;
    if (here === this.lastCell) return;
    this.lastCell = here;
    const r = Math.ceil(VISION_RADIUS / cell);
    for (let y = Math.max(0, cy - r); y <= Math.min(grid.h - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(grid.w - 1, cx + r); x++) {
        const wx = (x + 0.5) * cell;
        const wy = (y + 0.5) * cell;
        const dx = wx - px;
        const dy = wy - py;
        if (dx * dx + dy * dy > VISION_RADIUS * VISION_RADIUS) continue;
        if (lineOfSight(grid, px, py, wx, wy)) this.discovered.add(y * grid.w + x);
      }
    }
  }

  private draw(px: number, py: number, ents: EntityDTO[], youId: string): void {
    const grid = this.grid!;
    const ctx = this.ctx;
    const s = this.scale;
    const cs = Math.ceil(grid.cell * s);
    ctx.clearRect(0, 0, SIZE, SIZE);
    for (const idx of this.discovered) {
      const x = idx % grid.w;
      const y = (idx / grid.w) | 0;
      ctx.fillStyle = grid.solid[idx] === 1 ? "#39445e" : "#16213a";
      ctx.fillRect(Math.floor(x * grid.cell * s), Math.floor(y * grid.cell * s), cs, cs);
    }
    // Stairs — only once their cell has been discovered.
    if (this.stairs) {
      const sx = Math.floor(this.stairs.x / grid.cell);
      const sy = Math.floor(this.stairs.y / grid.cell);
      if (this.discovered.has(sy * grid.w + sx)) {
        ctx.fillStyle = "#5dff9b";
        dot(ctx, this.stairs.x * s, this.stairs.y * s, 3);
      }
    }
    // Living teammates (always shown for co-op awareness).
    for (const e of ents) {
      if (e.kind !== "player" || e.id === youId) continue;
      ctx.fillStyle = "#4f8cff";
      dot(ctx, e.x * s, e.y * s, 2.5);
    }
    // You.
    ctx.fillStyle = "#5dd6ff";
    dot(ctx, px * s, py * s, 3);
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Grid line-of-sight (Amanatides–Woo) — the DDA twin of render's canSee, kept
// local so the minimap stands alone. True if no solid cell lies between the two
// points (the target's own cell never self-blocks).
function lineOfSight(grid: CollisionGrid, ax: number, ay: number, bx: number, by: number): boolean {
  const cell = grid.cell;
  let cx = Math.floor(ax / cell);
  let cy = Math.floor(ay / cell);
  const ecx = Math.floor(bx / cell);
  const ecy = Math.floor(by / cell);
  const dx = bx - ax;
  const dy = by - ay;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const invDx = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
  const invDy = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
  let tMaxX = dx !== 0 ? (stepX > 0 ? (cx + 1) * cell - ax : ax - cx * cell) * invDx : Infinity;
  let tMaxY = dy !== 0 ? (stepY > 0 ? (cy + 1) * cell - ay : ay - cy * cell) * invDy : Infinity;
  const tDeltaX = cell * invDx;
  const tDeltaY = cell * invDy;
  for (let guard = grid.w + grid.h + 2; guard > 0; guard--) {
    if (cx === ecx && cy === ecy) return true;
    if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
    if (cx < 0 || cy < 0 || cx >= grid.w || cy >= grid.h) return true;
    if (cx === ecx && cy === ecy) return true;
    if (grid.solid[cy * grid.w + cx] === 1) return false;
  }
  return true;
}
