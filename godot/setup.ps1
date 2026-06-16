#!/usr/bin/env pwsh
# One-time setup for the DCC Godot client (Windows / PowerShell):
#   3a) vendor the GdUnit4 test addon   3b) copy art assets   3c) import the project
# Both 3a/3b are gitignored, so each machine runs this once. Idempotent.
# Usage:  pwsh godot/setup.ps1        (run from anywhere)
#         $env:GODOT="C:\path\to\Godot.exe"; pwsh godot/setup.ps1
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $Root
Write-Host "==> DCC Godot client setup  (repo: $Root)"

# Locate a Godot binary.
$Godot = $env:GODOT
if (-not $Godot) {
    foreach ($name in @("godot", "godot4", "Godot")) {
        $c = Get-Command $name -ErrorAction SilentlyContinue
        if ($c) { $Godot = $c.Source; break }
    }
}

# 3a. GdUnit4 test addon (gitignored).
if (Test-Path "godot/addons/gdUnit4/plugin.cfg") {
    Write-Host "==> GdUnit4 already installed, skipping."
} else {
    Write-Host "==> Installing GdUnit4 test addon..."
    $tmp = Join-Path $env:TEMP ("gdunit4_" + [System.Guid]::NewGuid().ToString())
    git clone --depth 1 https://github.com/MikeSchulze/gdUnit4.git $tmp
    New-Item -ItemType Directory -Force -Path "godot/addons" | Out-Null
    Copy-Item -Recurse -Force (Join-Path $tmp "addons/gdUnit4") "godot/addons/gdUnit4"
    Remove-Item -Recurse -Force $tmp
}

# 3b. Art assets (gitignored; source of truth is public/assets).
Write-Host "==> Copying art assets (public/assets -> godot/assets)..."
if (Test-Path "godot/assets") { Remove-Item -Recurse -Force "godot/assets" }
Copy-Item -Recurse -Force "public/assets" "godot/assets"

# 3c. Import (texture .import files + class cache).
if ($Godot) {
    Write-Host "==> Importing project with: $Godot"
    & $Godot --headless --path godot --import
    Write-Host "==> Done. Run it (against a local server):"
    Write-Host "     npm run dev   # in another terminal"
    Write-Host "     `$env:DCC_WS='ws://127.0.0.1:8787/ws'; & '$Godot' --path godot res://scenes/Main.tscn"
} else {
    Write-Host "!! Godot not found on PATH. Install Godot 4.6 (Standard), then run:"
    Write-Host "     godot --headless --path godot --import"
}
