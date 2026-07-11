// GLB optimizer: welds/deduplicates meshes and simplifies geometry.
// Usage:
//   node scripts/compress-glb.mjs <input.glb> <output.glb> [--ratio 0.35]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, resample, simplify, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const [, , inputPath, outputPath, ...args] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/compress-glb.mjs <input.glb> <output.glb> [--ratio 0.35]");
  process.exit(1);
}

const ratio = numberArg(args, "--ratio", 0.35);
const error = numberArg(args, "--error", 1e-2);

await MeshoptSimplifier.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(inputPath);
const beforeBytes = readFileSync(inputPath).length;
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
await mkdir(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, glb);

console.log(JSON.stringify({
  input: inputPath,
  output: outputPath,
  beforeBytes,
  afterBytes: glb.byteLength,
  beforeVertices,
  afterVertices,
  byteReductionPct: pct(beforeBytes, glb.byteLength),
  vertexReductionPct: pct(beforeVertices, afterVertices),
}));

function numberArg(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : fallback;
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

function pct(before, after) {
  if (before <= 0) return 0;
  return Number(((1 - after / before) * 100).toFixed(1));
}
