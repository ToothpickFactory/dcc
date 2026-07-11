// Batch optimize source GLB assets and mirror them to public/godot asset trees.
// Usage:
//   node scripts/optimize-glbs.mjs [--ratio 0.35] [--root assets]

import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, resample, simplify, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const ratio = numberArg(args, "--ratio", 0.35);
const error = numberArg(args, "--error", 1e-2);
const sourceRoot = join(repo, stringArg(args, "--root", "assets"));
const publicRoot = join(repo, "public", "assets");
const godotRoot = join(repo, "godot", "assets");
const reportPath = join(repo, ".tmp", "glb-optimize-report.json");

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const files = listGlbs(sourceRoot);
const report = [];

for (let index = 0; index < files.length; index++) {
  const file = files[index];
  const rel = relative(sourceRoot, file);
  const beforeBytes = statSync(file).size;
  const document = await io.read(file);
  const beforeVertices = countVertices(document);

  await document.transform(
    dedup(),
    weld({ tolerance: 1e-4 }),
    simplify({ simplifier: MeshoptSimplifier, ratio, error }),
    resample(),
    prune(),
  );

  const afterVertices = countVertices(document);
  const glb = await io.writeBinary(document);
  const temp = `${file}.tmp`;
  writeFileSync(temp, glb);
  renameSync(temp, file);

  const item = {
    file: rel.replaceAll("\\", "/"),
    beforeBytes,
    afterBytes: glb.byteLength,
    beforeVertices,
    afterVertices,
    byteReductionPct: pct(beforeBytes, glb.byteLength),
    vertexReductionPct: pct(beforeVertices, afterVertices),
  };
  report.push(item);
  console.log(`[${index + 1}/${files.length}] ${item.file} vertices ${beforeVertices} -> ${afterVertices} (${item.vertexReductionPct}%) bytes ${bytes(beforeBytes)} -> ${bytes(glb.byteLength)}`);
}

mirrorPublicAssets(sourceRoot, publicRoot);
mirrorAssets(sourceRoot, godotRoot);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify({ ratio, error, files: report, totals: totals(report) }, null, 2));
console.log(`Wrote ${relative(repo, reportPath)}`);

function listGlbs(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".glb")) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

function mirrorAssets(source, target) {
  if (!existsSync(target)) mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}

function mirrorPublicAssets(source, target) {
  const copyDirs = ["Heroes", "Enemies", "Bosses", "Bolt", "Weapons", "Tiles", "Props", "StatusEffects"];
  for (const dir of copyDirs) {
    const src = join(source, dir);
    if (!existsSync(src)) continue;
    const dest = join(target, dir);
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, {
      recursive: true,
      filter: (path) => {
        const normalized = path.replaceAll("\\", "/");
        return !/\/StatusEffects\/[^/]+\/[^/]+\.glb$/i.test(normalized);
      },
    });
  }
}

function countVertices(document) {
  let total = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      total += primitive.getAttribute("POSITION")?.getCount() ?? 0;
    }
  }
  return total;
}

function totals(report) {
  const total = report.reduce((acc, item) => {
    acc.beforeBytes += item.beforeBytes;
    acc.afterBytes += item.afterBytes;
    acc.beforeVertices += item.beforeVertices;
    acc.afterVertices += item.afterVertices;
    return acc;
  }, { beforeBytes: 0, afterBytes: 0, beforeVertices: 0, afterVertices: 0 });
  return {
    ...total,
    byteReductionPct: pct(total.beforeBytes, total.afterBytes),
    vertexReductionPct: pct(total.beforeVertices, total.afterVertices),
  };
}

function numberArg(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

function stringArg(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function pct(before, after) {
  if (before <= 0) return 0;
  return Number(((1 - after / before) * 100).toFixed(1));
}

function bytes(value) {
  return `${(value / 1048576).toFixed(2)} MB`;
}
