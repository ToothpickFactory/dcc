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
$LocalWsUrl = "ws://127.0.0.1:8787/ws"

function Invoke-GodotStep {
  param(
    [Parameter(Mandatory = $true)]
    [string[]] $Args,
    [Parameter(Mandatory = $true)]
    [string] $Label
  )

  $OldPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $Output = & $Godot @Args 2>&1
    $ExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $OldPreference
  }

  if ($Output) {
    $Output |
      Where-Object { "$_" -notmatch 'Condition "f\.is_null\(\)" is true\. Continuing\.' } |
      ForEach-Object { Write-Host $_ }
  }

  if ($ExitCode -ne 0) {
    throw "$Label failed with exit code $ExitCode"
  }
}

function Test-WebSocketUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Url,
    [int] $TimeoutMs = 3000
  )

  $Client = [System.Net.WebSockets.ClientWebSocket]::new()
  $Cancel = [System.Threading.CancellationTokenSource]::new($TimeoutMs)
  try {
    $Client.ConnectAsync([Uri] $Url, $Cancel.Token).GetAwaiter().GetResult()
    return $Client.State -eq [System.Net.WebSockets.WebSocketState]::Open
  } catch {
    return $false
  } finally {
    if ($Client.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
      try {
        $Client.CloseAsync(
          [System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
          "launcher probe",
          [System.Threading.CancellationToken]::None
        ).GetAwaiter().GetResult()
      } catch {
        # Probe cleanup should never block launching.
      }
    }
    $Client.Dispose()
    $Cancel.Dispose()
  }
}

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
    Copy-Item -Recurse -Force "assets/*" "godot/assets/" -ErrorAction SilentlyContinue
  }
  Write-Host "==> Building the latest client (~20s)..."
  Invoke-GodotStep -Args @("--headless", "--path", "godot", "--import", "--quit") -Label "Godot import"
  New-Item -ItemType Directory -Force (Split-Path $App) | Out-Null
  Invoke-GodotStep -Args @("--headless", "--path", "godot", "--export-release", "Windows Desktop", $App) -Label "Godot export"
  if (-not (Test-Path $App)) {
    Write-Host "!! Build failed. See godot/SETUP.md for export template help."
    Read-Host "Press enter to close"
    exit 1
  }
}

Write-Host "==> Launching DCC..."
$WsOverride = $env:DCC_WS
if (-not $WsOverride) {
  $WranglerProc = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*wrangler*dev*" -or $_.CommandLine -like "*npm*run*dev*" } |
    Select-Object -First 1
  try {
    $LocalHealth = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8787/" -TimeoutSec 1 -ErrorAction Stop
    if ($LocalHealth.StatusCode -ge 200 -and $LocalHealth.StatusCode -lt 500) {
      $env:DCC_WS = $LocalWsUrl
      Write-Host "    Local wrangler dev detected; using $LocalWsUrl"
    }
  } catch {
    if ($WranglerProc) {
      $env:DCC_WS = $LocalWsUrl
      Write-Host "    Wrangler dev appears to be starting/running, but 127.0.0.1:8787 did not respond yet."
      Write-Host "    Using $LocalWsUrl; if connect fails, restart npm run dev and wait for 'Ready'."
    } else {
      Write-Host "    No local wrangler dev detected; using the default deployed server."
    }
  }
} else {
  Write-Host "    Using DCC_WS=$WsOverride"
  if ($WsOverride -like "ws://127.0.0.1:8787*") {
    $WranglerDevs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.CommandLine -like "*$Root*" -and
        $_.CommandLine -like "*wrangler*" -and
        $_.CommandLine -like "*dev*" -and
        $_.CommandLine -like "*8787*"
      }
    if (($WranglerDevs | Measure-Object).Count -gt 2) {
      Write-Host "!! Multiple local wrangler dev processes are running for this project."
      Write-Host "   The newest terminal can say Ready while an older workerd still owns port 8787."
    }
    if (Test-WebSocketUrl -Url $WsOverride) {
      Write-Host "    Local WebSocket accepted $WsOverride."
    } else {
      Write-Host "!! DCC_WS points at local dev, but $WsOverride did not accept a WebSocket."
      Write-Host "   Stop duplicate npm run dev/wrangler processes, start one npm run dev, wait for Ready, then relaunch."
    }
  }
}

if ($env:DCC_FORCE_THEME) {
  Write-Host "    Using DCC_FORCE_THEME=$env:DCC_FORCE_THEME"
}

& $App
