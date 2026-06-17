# DCC — one-command click-to-play launcher (Windows / PowerShell).
#   0. first run only: vendor GdUnit4 + copy assets + download export templates (~1.2 GB),
#   1. fast-forward `main` to the latest (only if your tree is clean),
#   2. re-export the native .exe when there's a new version (or it's missing),
#   3. launch the game (connects to the live server by default).
#
# This is the SINGLE command — it self-installs everything it needs the first time.
# Run it:   pwsh godot/launch-dcc.ps1     (only prereqs: git + Godot 4.6)
# Desktop shortcut: target `pwsh -File C:\path\to\dcc\godot\launch-dcc.ps1`.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $Root
Write-Host "==> DCC launcher  ($Root)"

# Locate a Godot binary.
$Godot = $env:GODOT
if (-not $Godot) {
  foreach ($n in @("godot", "godot4", "Godot")) {
    $c = Get-Command $n -ErrorAction SilentlyContinue
    if ($c) { $Godot = $c.Source; break }
  }
}
if (-not $Godot) {
  Write-Host "!! Godot 4.6 not found. Install it or set `$env:GODOT, then re-run."
  Read-Host "Press enter to close"; exit 1
}

# One-time: vendor GdUnit4 + copy the gitignored art assets if missing.
if (-not (Test-Path "godot/addons/gdUnit4/plugin.cfg") -or -not (Test-Path "godot/assets")) {
  Write-Host "==> First-time setup (GdUnit4 + art assets)..."
  $env:GODOT = $Godot
  pwsh godot/setup.ps1
}

# One-time: install the matching export templates (~1.2 GB) if missing.
$Ver = ((& $Godot --version) -join "") -replace '^(\d+\.\d+\.\d+).*', '$1'
$Tpl = "$env:APPDATA\Godot\export_templates\$Ver.stable"
if ($Ver -and -not (Test-Path $Tpl)) {
  Write-Host "==> Installing Godot $Ver export templates (one-time, ~1.2 GB)..."
  try {
    Invoke-WebRequest "https://github.com/godotengine/godot-builds/releases/download/$Ver-stable/Godot_v$Ver-stable_export_templates.tpz" -OutFile "$env:TEMP\dcc-tpl.zip"
    Expand-Archive "$env:TEMP\dcc-tpl.zip" "$env:TEMP\dcc-tpl" -Force
    New-Item -ItemType Directory -Force $Tpl | Out-Null
    Copy-Item "$env:TEMP\dcc-tpl\templates\*" $Tpl
  } catch {
    Write-Host "!! Template download failed (offline?). Install via the editor: Manage Export Templates."
  }
}

$App = Join-Path $Root "godot\build\windows\DCC.exe"
$NeedBuild = $false

# Update check — fast-forward main only if the working tree is clean & behind.
if ((Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path ".git")) {
  Write-Host "==> Checking for updates..."
  git fetch --quiet origin main 2>$null
  $local = (git rev-parse '@').Trim()
  $remote = (git rev-parse origin/main).Trim()
  if ($local -ne $remote) {
    $dirty = (git status --porcelain)
    git merge-base --is-ancestor $local $remote 2>$null
    $isAncestor = ($LASTEXITCODE -eq 0)
    if (-not $dirty -and $isAncestor) {
      Write-Host "    Update found — pulling latest..."
      git pull --ff-only --quiet origin main; $NeedBuild = $true
    } else {
      Write-Host "    Local changes or diverged branch — launching your current code."
    }
  } else { Write-Host "    Already up to date." }
}

# (Re)build when there's a new version, no exe yet, OR the source is newer than the build
# (covers a dev box that already has the commits but a stale .exe).
if (-not (Test-Path $App)) { $NeedBuild = $true }
if ((Test-Path $App) -and -not $NeedBuild) {
  $buildTime = (Get-Item $App).LastWriteTime
  $srcNewer = Get-ChildItem -Recurse godot/scripts, godot/scenes, godot/shaders -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -gt $buildTime } | Select-Object -First 1
  if ($srcNewer -or (Get-Item godot/project.godot).LastWriteTime -gt $buildTime) {
    Write-Host "    Source changed since last build — rebuilding."
    $NeedBuild = $true
  }
}
if ($NeedBuild) {
  Write-Host "==> Building the latest client (~20s)..."
  & $Godot --headless --path godot --import 2>$null
  New-Item -ItemType Directory -Force (Split-Path $App) | Out-Null
  & $Godot --headless --path godot --export-release "Windows Desktop" $App
  if (-not (Test-Path $App)) {
    Write-Host "!! Build failed. See godot/SETUP.md (export templates?)."
    Read-Host "Press enter to close"; exit 1
  }
}

Write-Host "==> Launching DCC..."
& $App
