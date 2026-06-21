#!/usr/bin/env pwsh
# Launch the DCC Godot client against a local wrangler dev server.
#
# Usage from the repo root:
#   powershell -ExecutionPolicy Bypass -File godot/run-local.ps1
#   powershell -ExecutionPolicy Bypass -File godot/run-local.ps1 -Godot "C:\path\to\Godot.exe"
#   powershell -ExecutionPolicy Bypass -File godot/run-local.ps1 -WsUrl "ws://127.0.0.1:8787/ws"
#
# This is the Windows/PowerShell equivalent of:
#   DCC_WS=ws://127.0.0.1:8787/ws godot --path godot res://scenes/Main.tscn

param(
  [string]$Godot = $env:GODOT,
  [string]$WsUrl = "ws://127.0.0.1:8787/ws",
  [switch]$SkipAssetCopy,
  [switch]$Import
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $Root

function Find-Godot {
  if ($Godot -and (Test-Path -LiteralPath $Godot)) {
    return (Resolve-Path -LiteralPath $Godot).Path
  }

  foreach ($name in @("godot", "godot4", "Godot")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }

  $downloadCandidates = @(
    (Join-Path $env:USERPROFILE "Downloads\Godot_v*-stable_win64.exe\Godot_v*-stable_win64.exe"),
    (Join-Path $env:USERPROFILE "Downloads\Godot_v*-stable_win64.exe\Godot_v*-stable_win64_console.exe"),
    (Join-Path $env:USERPROFILE "Downloads\Godot_v*-stable_win64_console.exe"),
    (Join-Path $env:USERPROFILE "Downloads\Godot_v*-stable_win64.exe")
  )

  foreach ($pattern in $downloadCandidates) {
    $match = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($match) { return $match.FullName }
  }

  throw "Could not find Godot. Put godot on PATH or pass -Godot C:\path\to\Godot.exe."
}

$GodotExe = Find-Godot
Write-Host "==> Using Godot: $GodotExe"

if (-not $SkipAssetCopy) {
  Write-Host "==> Copying assets: assets -> godot/assets"
  if (-not (Test-Path "assets")) {
    throw "assets does not exist."
  }
  if (Test-Path "godot/assets") {
    Remove-Item -Recurse -Force "godot/assets"
  }
  Copy-Item -Recurse -Force "assets" "godot/assets"
}

if ($Import) {
  Write-Host "==> Importing Godot project assets"
  & $GodotExe --headless --path godot --import
}

Write-Host "==> Launching Godot client against $WsUrl"
$env:DCC_WS = $WsUrl
& $GodotExe --path godot res://scenes/Main.tscn
