# DCC Godot Client — Dev Setup

Onboarding for the native Godot client (`godot/`). It connects to the same Cloudflare
server as the web client over `/ws`. See [GODOT_PORT.md](../GODOT_PORT.md) for the design.

> Two things are **gitignored** and must be set up locally per machine: the **GdUnit4**
> test addon and a copy of the **art assets**. Steps 3a/3b below handle them.

## Prerequisites
- **Godot 4.6.x — Standard (GDScript) build.** *Not* the .NET/Mono build.
- **git**, and access to the repo (`github.com/ToothpickFactory/dcc`).
- Optional (only to run the server locally): **Node 22+** and the repo's npm deps.

## 1. Get the code
```bash
git clone https://github.com/ToothpickFactory/dcc.git
cd dcc
```

## 2. Install Godot 4.6 (Standard / GDScript)
- **macOS (Homebrew):** `brew install --cask godot`
  Optional CLI on PATH (Apple Silicon): `ln -s /Applications/Godot.app/Contents/MacOS/Godot /opt/homebrew/bin/godot`
- **Windows:** `winget install GodotEngine.GodotEngine` **or** `scoop install godot` **or** download
  `Godot_v4.6.x-stable_win64.exe` (the plain build, *not* `…_mono_…`) from <https://godotengine.org/download>.
  To use `godot` from PowerShell, add its folder to PATH, or rename the exe to `godot.exe` on PATH,
  or set `$env:GODOT` to the full exe path before the commands below.
- **Linux:** download the Godot 4.6.x Standard zip from <https://godotengine.org/download>, unzip,
  and put the binary on PATH as `godot` (or use Flatpak: `flatpak run org.godotengine.Godot`).
- Verify: `godot --version` → `4.6.x.stable…` (or launch the app).

## 3. One-time project setup (the gitignored bits)
**Easiest — run the setup script** (does 3a–3c: vendor GdUnit4, copy assets, import):
```bash
# macOS / Linux:
./godot/setup.sh
# Windows (PowerShell):
pwsh godot/setup.ps1
```
Set `GODOT`/`$env:GODOT` first if Godot isn't on PATH (e.g. `$env:GODOT="C:\Tools\Godot.exe"`).

<details><summary>Or do the three steps manually (from the repo root)</summary>

**3a. Vendor the GdUnit4 test addon** (tested with 6.2.0):
```bash
git clone --depth 1 https://github.com/MikeSchulze/gdUnit4.git /tmp/gdunit4 \
  && cp -R /tmp/gdunit4/addons/gdUnit4 godot/addons/gdUnit4
```
**3b. Copy the art assets** (source of truth lives in `public/assets`):
```bash
cp -R public/assets godot/assets        # Windows: Copy-Item -Recurse public/assets godot/assets
```
**3c. Import** (generates texture `.import` files + the class cache):
```bash
godot --headless --path godot --import
```
(If `godot` isn't on PATH, use the full path, e.g. macOS
`/Applications/Godot.app/Contents/MacOS/Godot …`.)
</details>

## 4. Run the game
You need a server that speaks **protocol v6** (sends `floor.geometry`). Easiest is local
(step 5); or use the deployed server once someone has run `npm run deploy`.

**From the editor:** open the Godot Project Manager → **Import** → select
`dcc/godot/project.godot` → open it → press **F5**. (If prompted, enable the GdUnit4 plugin.)
To point at a local server, edit the **Main** node's `server_url` export, or set the
`DCC_WS` env var before launching.

**From the CLI (macOS / Linux):**
```bash
godot --path godot res://scenes/Main.tscn                               # live server (default)
DCC_WS=ws://127.0.0.1:8787/ws godot --path godot res://scenes/Main.tscn  # local server
```
**From the CLI (Windows / PowerShell):**
```powershell
godot --path godot res://scenes/Main.tscn                               # live server (default)
$env:DCC_WS="ws://127.0.0.1:8787/ws"; godot --path godot res://scenes/Main.tscn  # local server
```
Launch it twice to test two players.

## 5. Run the server locally (optional but recommended)
From the repo root:
```bash
npm install                 # once
cp .dev.vars.example .dev.vars               # once (local secrets); Windows: copy .dev.vars.example .dev.vars
npm run dev                 # wrangler dev on http://127.0.0.1:8787  (WS at /ws)
```
Reset the run anytime (local admin is open): `curl -X POST http://127.0.0.1:8787/admin/new-run`

## 6. Run the tests (GdUnit4)
```bash
godot --headless --path godot -s res://addons/gdUnit4/bin/GdUnitCmdTool.gd \
  --add res://test/geo_test.gd --ignoreHeadlessMode
```
`geo_test.gd` checks the pure-logic ports (geometry decode, collision, line-of-sight).

## 7. Controls
- **WASD / arrows** move · **mouse** aim · **1–4 / left-click** cast
- **I** inventory/character (equip, drop, sell) · **K** skills & evolution · **Q** drink a potion · **E** loot a nearby bag
- **Tab** cycle spectate target · **V** toggle free-cam (while dead/in the waiting room)
- **F2** start a new run (admin reset — works while the server's `ADMIN_OPEN=true`)

## 8. Dev env flags (optional)
| Var | Effect |
|-----|--------|
| `DCC_WS=ws://…/ws` | Override the server URL |
| `DCC_NOLOGIN=1` | Skip the name screen (auto-join as `GodotHero`) |
| `DCC_DEBUG=1` | Per-second state prints (cam/pred/floor/ents) |
| `DCC_SMOKE=1` | Run ~7s then quit (headless CI smoke; skips login) |
| `DCC_SHOT=1` | Save a viewport screenshot to `/tmp/dcc_shot.png` after ~4.5s |
| `DCC_OPENUI=inv\|skills` | Auto-open the inventory/skills panel after ~3.8s (for screenshots) |
| `DCC_RESET=1` | Fire the F2 admin reset ~2.5s after launch (smoke test) |

## 9. Building a native release (Phase 3 packaging)
Produces a standalone app — no Godot install needed to *play* it (you do need Godot to *build* it).

**Prereqs:** Godot 4.6 (step 2) + `git`. The blocks below handle everything else (assets,
GdUnit4, the ~1.2 GB export templates, and the build). Run them from the **repo root**.

### Build from scratch — macOS (one copy-paste, run from repo root)
```bash
GODOT="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"   # or: export GODOT=godot
VER="$("$GODOT" --version | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+' | head -1)"

./godot/setup.sh                                                 # GdUnit4 + assets + import

TPL="$HOME/Library/Application Support/Godot/export_templates/${VER}.stable"   # one-time
if [ ! -d "$TPL" ]; then
  curl -L -o /tmp/dcc-tpl.tpz "https://github.com/godotengine/godot-builds/releases/download/${VER}-stable/Godot_v${VER}-stable_export_templates.tpz"
  rm -rf /tmp/dcc-tpl && unzip -q /tmp/dcc-tpl.tpz -d /tmp/dcc-tpl
  mkdir -p "$TPL" && cp /tmp/dcc-tpl/templates/* "$TPL/"
fi

mkdir -p "$PWD/godot/build/macos"
"$GODOT" --headless --path godot --export-release "macOS" "$PWD/godot/build/macos/DCC.app"
open "$PWD/godot/build/macos/DCC.app"
```

### Build from scratch — Windows (one copy-paste, PowerShell, run from repo root)
```powershell
$Godot = if ($env:GODOT) { $env:GODOT } else { "godot" }         # or full path to Godot.exe
$Ver = ((& $Godot --version) -join "") -replace '^(\d+\.\d+\.\d+).*','$1'

pwsh godot/setup.ps1                                             # GdUnit4 + assets + import

$Tpl = "$env:APPDATA\Godot\export_templates\$Ver.stable"        # one-time
if (-not (Test-Path $Tpl)) {
  Invoke-WebRequest "https://github.com/godotengine/godot-builds/releases/download/$Ver-stable/Godot_v$Ver-stable_export_templates.tpz" -OutFile "$env:TEMP\dcc-tpl.zip"
  Expand-Archive "$env:TEMP\dcc-tpl.zip" "$env:TEMP\dcc-tpl" -Force
  New-Item -ItemType Directory -Force $Tpl | Out-Null
  Copy-Item "$env:TEMP\dcc-tpl\templates\*" $Tpl
}

New-Item -ItemType Directory -Force "$PWD\godot\build\windows" | Out-Null
& $Godot --headless --path godot --export-release "Windows Desktop" "$PWD\godot\build\windows\DCC.exe"
& "$PWD\godot\build\windows\DCC.exe"
```

> **Gotcha (the error you hit):** Godot resolves the export path **relative to the project
> dir** (`--path`), and it does **not** create the output folder. So use an **absolute** path
> (as above) or `cd godot` + a project-relative `build/...` path, and `mkdir` the folder first.
> A bare repo-root `godot/build/macos/...` with `--path godot` fails with *"Target folder does
> not exist."*

The macOS preset builds a **universal** (Intel + Apple Silicon) `.app`; `build/` is gitignored.
Builds are **unsigned**: on macOS first-run, `xattr -dr com.apple.quarantine godot/build/macos/DCC.app`
(or right-click → Open); on Windows, click "More info → Run anyway" past SmartScreen. For real
distribution, add a signing identity + notarization in `export_presets.cfg`.

> Templates are a one-time, version-matched download (re-run the `TPL`/`$Tpl` block after a Godot
> upgrade). The universal macOS export needs `rendering/textures/vram_compression/import_etc2_astc`
> (already set in `project.godot`). The server URL defaults to the deployed worker; override with `DCC_WS`.

### Click-to-play launcher (macOS, dev machines)
**`godot/launch-dcc.command`** is a double-clickable launcher: it fast-forwards `main` to the
latest (only if your working tree is clean), re-exports the `.app` when there's a new version,
then launches it (connected to the live server). Right-click → Open the first time, or drag an
alias of it to your Desktop/Dock. Needs Godot + the export templates. If your tree has local
changes it skips the auto-update and just launches your current code.

## 10. Troubleshooting
- **Black screen / "No floor geometry" toast** → the server isn't on protocol v6. Run a
  local server (step 5) and use `DCC_WS=ws://127.0.0.1:8787/ws`, or have someone `npm run deploy`.
- **Missing textures / blank sprites, or an entity shows a flat colored square** (e.g. the
  boss renders as a purple box) → your `godot/assets` copy is **stale or incomplete**. The art
  is gitignored and copied locally, so when new art lands in `public/assets` (a new boss/enemy)
  your local copy won't have it. Re-run `./godot/setup.sh` (it wipes + re-copies + re-imports),
  or manually `cp -R public/assets/<Dir> godot/assets/` and re-import. Then **relaunch** — a
  running client caches missing clips and won't re-probe them.
- **`GdUnitCmdTool.gd` not found / tests won't run** → you skipped step 3a (GdUnit4 vendor).
- **UI too big/small** → it scales with window size; resize the window (it re-scales live).
- **`godot: command not found`** → use the full app path, or symlink the CLI (step 2).
