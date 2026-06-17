// Hand-authored room templates ("set-pieces") stamped into the procedural maze. This is the
// difference between "a maze" and "a dungeon": pure procgen can't look designed because nothing
// was — so we assemble handcrafted chunks with procedural connective tissue (Diablo/CoN/Hades).
//
// Each prefab is a small char grid in LOGICAL cells (the floor renders at 2× — a 7×7 prefab is a
// ~14×14 fine-cell room, generous and roomy). Characters:
//   '#' wall   '.' floor   ' ' leave untouched (lets a prefab be non-rectangular)
//   'o' floor + a set-dressing anchor   'O' floor + a LANDMARK anchor (big statue/altar)
// Connectivity is guaranteed by index.ts's reconnect() pass after stamping, so a sealed room
// (e.g. the vault) simply gets a doorway carved into it.

export interface Prefab {
  name: string;
  w: number;
  h: number;
  rows: string[];
}

export interface PrefabAnchor {
  x: number;
  y: number;
  landmark: boolean;
}

export const PREFABS: Prefab[] = [
  {
    name: "colonnade", // pillared hall
    w: 9,
    h: 5,
    rows: [
      ".........",
      ".#.#.#.#.",
      "....o....",
      ".#.#.#.#.",
      ".........",
    ],
  },
  {
    name: "shrine", // walled chamber around a central altar
    w: 7,
    h: 7,
    rows: [
      "#######",
      "#.....#",
      "#.....#",
      "#..O..#",
      "#.....#",
      "#.....#",
      "#######",
    ],
  },
  {
    name: "cross", // plus-shaped hall
    w: 7,
    h: 7,
    rows: [
      "  ...  ",
      "  ...  ",
      ".......",
      "...o...",
      ".......",
      "  ...  ",
      "  ...  ",
    ],
  },
  {
    name: "rotunda", // round room (cut corners)
    w: 7,
    h: 7,
    rows: [
      " ..... ",
      ".......",
      ".......",
      "...o...",
      ".......",
      ".......",
      " ..... ",
    ],
  },
  {
    name: "vault", // small sealed treasure vault (reconnect carves the door)
    w: 5,
    h: 4,
    rows: [
      "#####",
      "#.O.#",
      "#...#",
      "#####",
    ],
  },
  {
    name: "pillars4", // open hall framed by four thick pillars
    w: 8,
    h: 7,
    rows: [
      "........",
      ".##..##.",
      ".##..##.",
      "...o....",
      ".##..##.",
      ".##..##.",
      "........",
    ],
  },
];

// Stamp a prefab into the grid at top-left (ox,oy). Returns its centre + set-dressing anchors
// (in logical cell coords). Border cells are never touched, so the outer wall ring stays intact.
export function stampPrefab(
  solid: Uint8Array,
  w: number,
  h: number,
  p: Prefab,
  ox: number,
  oy: number,
): { center: { x: number; y: number }; anchors: PrefabAnchor[] } {
  const anchors: PrefabAnchor[] = [];
  for (let ry = 0; ry < p.h; ry++) {
    const row = p.rows[ry]!;
    for (let rx = 0; rx < p.w; rx++) {
      const ch = row[rx]!;
      if (ch === " ") continue; // untouched (non-rectangular footprint)
      const gx = ox + rx;
      const gy = oy + ry;
      if (gx < 1 || gy < 1 || gx >= w - 1 || gy >= h - 1) continue; // keep the border walls
      if (ch === "#") {
        solid[gy * w + gx] = 1;
      } else {
        solid[gy * w + gx] = 0;
        if (ch === "o" || ch === "O") anchors.push({ x: gx, y: gy, landmark: ch === "O" });
      }
    }
  }
  return { center: { x: ox + (p.w >> 1), y: oy + (p.h >> 1) }, anchors };
}
