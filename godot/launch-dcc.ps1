# DCC one-command click-to-play launcher (Windows / PowerShell).
# First run installs setup pieces, then exports and launches the native client.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $Root
Write-Host "==> DCC launcher ($Root)"

# Locate a Godot binary.
$Godot = $env:GODOT
if (-not $Godot) {
  foreach ($Name in @("godot", "godot4", "Godot")) {
    $Candidate = Get-Command $Name -ErrorAction SilentlyContinue
    if ($Candidate) {
      $Godot = $Candidate.Source
      break
    }
  }
}

$BundledGodotDir = Join-Path $env:USERPROFILE "Downloads\Godot_v4.6.3-stable_win64.exe"
$BundledGodotConsole = Join-Path $BundledGodotDir "Godot_v4.6.3-stable_win64_console.exe"
$BundledGodotGui = Join-Path $BundledGodotDir "Godot_v4.6.3-stable_win64.exe"
if (-not $Godot -and (Test-Path $BundledGodotConsole)) {
  $Godot = $BundledGodotConsole
}

if (-not $Godot) {
  Write-Host "!! Godot 4.6 not found. Install it or set `$env:GODOT, then re-run."
  Write-Host "   Example: `$env:GODOT = `"$BundledGodotConsole`""
  Read-Host "Press enter to close"
  exit 1
}

Write-Host "    Godot: $Godot"

# One-time: vendor GdUnit4 + copy the gitignored art assets if missing.
if (-not (Test-Path "godot/addons/gdUnit4/plugin.cfg") -or -not (Test-Path "godot/assets")) {
  Write-Host "==> First-time setup (GdUnit4 + art assets)..."
  $env:GODOT = $Godot
  & powershell -ExecutionPolicy Bypass -File "godot/setup.ps1"
}

# One-time: install the matching export templates if missing.
$Ver = ((& $Godot --version) -join "") -replace '^(\d+\.\d+\.\d+).*', '$1'
$Tpl = Join-Path $env:APPDATA "Godot\export_templates\$Ver.stable"
if ($Ver -and -not (Test-Path $Tpl)) {
  Write-Host "==> Installing Godot $Ver export templates (one-time, ~1.2 GB)..."
  try {
    $Zip = Join-Path $env:TEMP "dcc-tpl.zip"
    $Extracted = Join-Path $env:TEMP "dcc-tpl"
    Invoke-WebRequest "https://github.com/godotengine/godot-builds/releases/download/$Ver-stable/Godot_v$Ver-stable_export_templates.tpz" -OutFile $Zip
    Expand-Archive $Zip $Extracted -Force
    New-Item -ItemType Directory -Force $Tpl | Out-Null
    Copy-Item (Join-Path $Extracted "templates\*") $Tpl
  } catch {
    Write-Host "!! Template download failed. Install via the editor: Manage Export Templates."
  }
}

$App = Join-Path $Root "godot\build\windows\DCC.exe"
$NeedBuild = $false

# Update check: fast-forward main only if the working tree is clean and behind.
if ((Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path ".git")) {
  Write-Host "==> Checking for updates..."
  git fetch --quiet origin main 2>$null
  $Local = (git rev-parse '@').Trim()
  $Remote = (git rev-parse origin/main).Trim()
  if ($Local -ne $Remote) {
    $Dirty = git status --porcelain
    git merge-base --is-ancestor $Local $Remote 2>$null
    $IsAncestor = ($LASTEXITCODE -eq 0)
    if (-not $Dirty -and $IsAncestor) {
      Write-Host "    Update found; pulling latest..."
      git pull --ff-only --quiet origin main
      $NeedBuild = $true
    } else {
      Write-Host "    Local changes or diverged branch; launching your current code."
    }
  } else {
    Write-Host "    Already up to date."
  }
}

# Rebuild when there is no exe yet or source files are newer than the build.
if (-not (Test-Path $App)) {
  $NeedBuild = $true
}

if ((Test-Path $App) -and -not $NeedBuild) {
  $BuildTime = (Get-Item $App).LastWriteTime
  $SourceRoots = @("godot/scripts", "godot/scenes", "godot/shaders") | Where-Object { Test-Path $_ }
  $SrcNewer = Get-ChildItem -Recurse $SourceRoots -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -gt $BuildTime } |
    Select-Object -First 1
  if ($SrcNewer -or (Get-Item "godot/project.godot").LastWriteTime -gt $BuildTime) {
    Write-Host "    Source changed since last build; rebuilding."
    $NeedBuild = $true
  }
}

if ($NeedBuild) {
  # Overlay any new or updated art assets into existing installs.
  if (Test-Path "godot/assets") {
    Copy-Item -Recurse -Force "public/assets/*" "godot/assets/" -ErrorAction SilentlyContinue
  }
  Write-Host "==> Building the latest client (~20s)..."
  & $Godot --headless --path godot --import 2>$null
  New-Item -ItemType Directory -Force (Split-Path $App) | Out-Null
  & $Godot --headless --path godot --export-release "Windows Desktop" $App
  if (-not (Test-Path $App)) {
    Write-Host "!! Build failed. See godot/SETUP.md for export template help."
    Read-Host "Press enter to close"
    exit 1
  }
}

Write-Host "==> Launching DCC..."
& $App
