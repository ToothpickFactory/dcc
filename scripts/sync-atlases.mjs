import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outRoot = join(root, "public", "assets");

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

const copyPairs = [
  [join(root, "assets", "Heroes"), join(outRoot, "Heroes")],
  [join(root, "assets", "Enemies"), join(outRoot, "Enemies")],
];

for (const [src, dst] of copyPairs) {
  if (!existsSync(src)) continue;
  cpSync(src, dst, { recursive: true, force: true });
}

console.log("Synced sprite atlases to public/assets");
