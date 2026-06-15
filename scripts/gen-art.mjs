// Game-art generator for DCC.
//
// Calls OpenAI's image model (gpt-image-1) and writes PNGs into public/sprites/,
// where the Worker serves them as static assets and the client loads them with
// graceful fallback to the built-in emoji/vector art.
//
// Usage:
//   $env:OPENAI_API_KEY="sk-..."   (PowerShell)   or put the key in a
//   gitignored file named  .openai-key  at the repo root.
//   npm run gen:art                  # generate only missing assets
//   npm run gen:art -- --force       # regenerate everything
//   npm run gen:art -- icon-fireball terrain   # only named assets
//
// Cost: gpt-image-1 is pay-per-image. At "medium" quality a 1024x1024 image is
// roughly $0.04; "low" is roughly $0.01. This whole set is a handful of cents.

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "sprites");

const STYLE =
  "Top-down video game asset for a dark-fantasy action RPG, crisp readable " +
  "silhouette, vivid saturated colors, soft inner glow, clean edges, no text, " +
  "no watermark, no UI frame, centered composition.";

// Each entry becomes public/sprites/<name>.png
const ASSETS = [
  {
    name: "icon-fireball",
    quality: "low",
    background: "transparent",
    prompt:
      "Skill icon: a blazing orange-red fireball with curling flames. " + STYLE,
  },
  {
    name: "icon-frostbolt",
    quality: "low",
    background: "transparent",
    prompt:
      "Skill icon: a shard of cyan-blue ice crackling with frost. " + STYLE,
  },
  {
    name: "icon-heal",
    quality: "low",
    background: "transparent",
    prompt:
      "Skill icon: a radiant green healing sigil with soft sparkles. " + STYLE,
  },
  {
    name: "icon-smite",
    quality: "low",
    background: "transparent",
    prompt:
      "Skill icon: a golden-yellow lightning bolt of holy smite. " + STYLE,
  },
  {
    name: "proj-fireball",
    quality: "low",
    background: "transparent",
    prompt:
      "Glowing orange fireball projectile orb with a bright hot core and a " +
      "fiery aura, seen from above. " + STYLE,
  },
  {
    name: "proj-frostbolt",
    quality: "low",
    background: "transparent",
    prompt:
      "Glowing cyan frostbolt projectile orb of jagged ice with a bright " +
      "core, seen from above. " + STYLE,
  },
  {
    name: "terrain",
    quality: "medium",
    background: "opaque",
    prompt:
      "Seamless tileable top-down dungeon floor texture: weathered dark stone " +
      "flagstones with subtle moss in the cracks, even lighting, no shadows " +
      "cast by objects, no characters, no text. Designed to tile edge-to-edge.",
  },
];

async function getKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  const keyFile = join(ROOT, ".openai-key");
  if (existsSync(keyFile)) return (await readFile(keyFile, "utf8")).trim();
  console.error(
    "\nNo OpenAI API key found.\n" +
      "  PowerShell:  $env:OPENAI_API_KEY=\"sk-...\"\n" +
      "  or create a gitignored file  .openai-key  in the repo root.\n"
  );
  process.exit(1);
}

async function generate(key, asset) {
  const body = {
    model: "gpt-image-1",
    prompt: asset.prompt,
    n: 1,
    size: "1024x1024",
    quality: asset.quality,
    background: asset.background,
    output_format: "png",
  };
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("OpenAI " + res.status + ": " + text);
  }
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data in response");
  return Buffer.from(b64, "base64");
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const only = args.filter((a) => !a.startsWith("--"));
  const key = await getKey();

  await mkdir(OUT_DIR, { recursive: true });

  const todo = ASSETS.filter((a) => only.length === 0 || only.includes(a.name));
  if (todo.length === 0) {
    console.error("No matching assets. Available: " + ASSETS.map((a) => a.name).join(", "));
    process.exit(1);
  }

  for (const asset of todo) {
    const outPath = join(OUT_DIR, asset.name + ".png");
    if (!force && existsSync(outPath)) {
      console.log("· skip   " + asset.name + " (exists, use --force to redo)");
      continue;
    }
    process.stdout.write("⏳ make  " + asset.name + " … ");
    try {
      const png = await generate(key, asset);
      await writeFile(outPath, png);
      console.log("✓ " + (png.length / 1024).toFixed(0) + " KB");
    } catch (err) {
      console.log("✗");
      console.error("   " + err.message);
    }
  }
  console.log("\nDone. PNGs are in public/sprites/  →  served at /sprites/<name>.png");
}

main();
