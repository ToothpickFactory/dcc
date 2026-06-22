// One-shot GLB compressor: weld → simplify → dequantize → texture resize.
// Produces standard glTF 2.0 with no proprietary extensions, compatible with
// both Three.js (web client) and Godot 4's built-in GLTF importer.
//
// Usage: node scripts/compress-glb.mjs <input.glb> <output.glb>

import { NodeIO } from "file:///C:/Users/Dallas/AppData/Local/npm-cache/_npx/a6797f7ff67bb1f2/node_modules/@gltf-transform/core/dist/index.js";
import { ALL_EXTENSIONS } from "file:///C:/Users/Dallas/AppData/Local/npm-cache/_npx/a6797f7ff67bb1f2/node_modules/@gltf-transform/extensions/dist/index.js";
import { weld, simplify, dequantize, prune, dedup, resample } from "file:///C:/Users/Dallas/AppData/Local/npm-cache/_npx/a6797f7ff67bb1f2/node_modules/@gltf-transform/functions/dist/index.js";
import { MeshoptSimplifier } from "file:///C:/Users/Dallas/AppData/Local/npm-cache/_npx/a6797f7ff67bb1f2/node_modules/meshoptimizer/meshopt_simplifier.js";
import sharp from "file:///C:/Users/Dallas/AppData/Local/npm-cache/_npx/a6797f7ff67bb1f2/node_modules/sharp/lib/index.js";
import { readFileSync, writeFileSync } from "fs";
import path from "path";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: node compress-glb.mjs <input.glb> <output.glb>");
  process.exit(1);
}

await MeshoptSimplifier.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(inputPath);

const beforeBytes = readFileSync(inputPath).length;
console.log(`Input: ${inputPath} (${(beforeBytes / 1048576).toFixed(2)} MB)`);

await document.transform(
  dedup(),
  weld({ tolerance: 1e-4 }),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.02, error: 1.0 }),
  dequantize(),   // convert quantized int16 → float32, removes KHR_mesh_quantization
  resample(),
  prune(),
);

// Resize embedded textures to 512×512 max using sharp.
const root = document.getRoot();
for (const texture of root.listTextures()) {
  const data = texture.getImage();
  if (!data) continue;
  const mimeType = texture.getMimeType();
  const isWebP = mimeType === "image/webp";
  const resized = await sharp(Buffer.from(data))
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  texture.setImage(new Uint8Array(resized));
  texture.setMimeType("image/jpeg");
}

const glb = await io.writeBinary(document);
writeFileSync(outputPath, glb);
const afterBytes = glb.byteLength;
console.log(`Output: ${outputPath} (${(afterBytes / 1048576).toFixed(2)} MB)`);
console.log(`Reduced by ${((1 - afterBytes / beforeBytes) * 100).toFixed(1)}%`);
