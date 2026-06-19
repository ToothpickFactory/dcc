import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outRoot = join(root, "public", "assets");

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

const copyPairs = [
  [join(root, "assets", "Heroes"), join(outRoot, "Heroes")],
  [join(root, "assets", "Enemies"), join(outRoot, "Enemies")],
  [join(root, "assets", "Bosses"), join(outRoot, "Bosses")],
  [join(root, "assets", "Tiles"), join(outRoot, "Tiles")],
  [join(root, "assets", "Props"), join(outRoot, "Props")],
  [join(root, "assets", "StatusEffects"), join(outRoot, "StatusEffects")],
];

for (const [src, dst] of copyPairs) {
  if (!existsSync(src)) continue;
  cpSync(src, dst, { recursive: true, force: true });
}

console.log("Synced sprite atlases to public/assets");
