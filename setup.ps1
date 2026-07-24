#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Reverie — One‑command setup launcher
.DESCRIPTION
  Checks prerequisites, installs dependencies, initialises the database,
  and starts both the FastAPI backend and Vite frontend dev server.
  Designed for first‑time users — zero config required.
.NOTES
  HPS Labs — Reverie v0.0.1
#>

$ScriptPath = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RootDir    = Split-Path -Parent $ScriptPath  # go up from repo/ to project root
Set-Location -LiteralPath $RootDir
$Host.UI.RawUI.WindowTitle = "Reverie — Setup"

# ─── Colours ──────────────────────────────────────────
$C = @{
  Cyan    = 'Cyan'
  Green   = 'Green'
  Yellow  = 'Yellow'
  Red     = 'Red'
  White   = 'White'
  Magenta = 'Magenta'
}

function Banner {
  Clear-Host
  Write-Host @"

  ╔══════════════════════════════════════╗
  ║          R E V E R I E              ║
  ║      Music Intelligence Engine       ║
  ║          H P S   L a b s            ║
  ╚══════════════════════════════════════╝

"@ -ForegroundColor $C.Magenta
}

function Step($msg) {
  Write-Host "`n → $msg" -ForegroundColor $C.Cyan
}

function Ok($msg) {
  Write-Host "   ✔ $msg" -ForegroundColor $C.Green
}

function Warn($msg) {
  Write-Host "   ⚠ $msg" -ForegroundColor $C.Yellow
}

function Fail($msg) {
  Write-Host "   ✘ $msg" -ForegroundColor $C.Red
  exit 1
}

# ═══════════════════════════════════════════════════════
#  1.  PREREQUISITE CHECK
# ═══════════════════════════════════════════════════════

Banner

Step "Checking prerequisites..."

# Python
$py = Get-Command "python" -ErrorAction SilentlyContinue
if (-not $py) {
  Fail "Python is not installed. Download from https://www.python.org/downloads/"
}
$pyVer = & python --version 2>&1
Ok "Python $pyVer"

# Node.js
$node = Get-Command "node" -ErrorAction SilentlyContinue
if (-not $node) {
  Fail "Node.js is not installed. Download from https://nodejs.org/"
}
$nodeVer = & node --version
Ok "Node.js $nodeVer"

# npm
$npm = Get-Command "npm" -ErrorAction SilentlyContinue
if (-not $npm) {
  Fail "npm is not installed (should ship with Node.js)."
}
$npmVer = & npm --version
Ok "npm v$npmVer"

# yt-dlp (optional)
$ytdlp = Get-Command "yt-dlp" -ErrorAction SilentlyContinue
if (-not $ytdlp) {
  Warn "yt-dlp not found on PATH — will use venv-bundled version"
} else {
  Ok "yt-dlp found on PATH"
}

# ═══════════════════════════════════════════════════════
#  2.  PYTHON VIRTUAL ENVIRONMENT
# ═══════════════════════════════════════════════════════

Step "Setting up Python virtual environment..."

if (-not (Test-Path "venv")) {
  & python -m venv venv
  Ok "Virtual environment created"
} else {
  Ok "Virtual environment already exists"
}

# ═══════════════════════════════════════════════════════
#  3.  INSTALL PYTHON DEPENDENCIES
# ═══════════════════════════════════════════════════════

Step "Installing Python dependencies (this may take a while)..."

$pip = Join-Path $RootDir "venv\Scripts\pip.exe"
& $pip install -r requirements.txt 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Fail "pip install failed. Check requirements.txt"
}
Ok "Python dependencies installed"

# ═══════════════════════════════════════════════════════
#  4.  INSTALL NODE DEPENDENCIES
# ═══════════════════════════════════════════════════════

Step "Installing Node.js dependencies..."

if (-not (Test-Path "node_modules")) {
  & npm install 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Fail "npm install failed. Check package.json"
  }
  Ok "Node.js dependencies installed"
} else {
  Ok "node_modules already exists (run 'npm install' to update)"
}

# ═══════════════════════════════════════════════════════
#  5.  INITIALISE DATABASE
# ═══════════════════════════════════════════════════════

Step "Initialising database..."

$dbPath = "database/music_player.db"
if (-not (Test-Path $dbPath)) {
  # A quick DB init: just import the backend which creates tables on import
  & $pip install -q fastapi uvicorn 2>&1 | Out-Null
  & .\venv\Scripts\python -c "import sys; sys.path.insert(0,'.'); from backend.database import DatabaseManager; DatabaseManager('$dbPath')" 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Ok "Database created at $dbPath"
  } else {
    Warn "Could not pre‑create database; server will create it on first run"
  }
} else {
  Ok "Database already exists at $dbPath"
}

# ═══════════════════════════════════════════════════════
#  6.  START SERVERS
# ═══════════════════════════════════════════════════════

Step "Starting Reverie servers..."

Write-Host @"
  ┌─────────────────────────────────────────────┐
  │  Backend   → http://127.0.0.1:8000          │
  │  Frontend  → http://localhost:5173          │
  │  Static UI → http://127.0.0.1:8000/         │
  └─────────────────────────────────────────────┘
"@ -ForegroundColor $C.White

Write-Host "`nPress Ctrl+C to stop all servers.`n" -ForegroundColor $C.Yellow

# Start backend as background job
$backendJob = Start-Job -Name "Reverie-Backend" -ScriptBlock {
  param($dir)
  Set-Location $dir
  $env:PYTHONUNBUFFERED = "1"
  & ".\venv\Scripts\python.exe" -m uvicorn server:app --reload --port 8000 --log-level info --host 127.0.0.1
} -ArgumentList $RootDir

Start-Sleep -Seconds 3

# Start frontend as background job (if package.json exists with dev script)
$frontendJob = $null
if (Test-Path "package.json") {
  $frontendJob = Start-Job -Name "Reverie-Frontend" -ScriptBlock {
    param($dir)
    Set-Location $dir
    & "npm" run dev
  } -ArgumentList $RootDir
}

# ─── Poll for readiness ──────────────────────────────
$backendReady = $false
$frontendReady = $false
$timeout = 30
$elapsed = 0

while ((-not $backendReady -or -not $frontendReady) -and $elapsed -lt $timeout) {
  if (-not $backendReady) {
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8000/" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
      if ($resp.StatusCode -eq 200) {
        $backendReady = $true
        Ok "Backend ready on http://127.0.0.1:8000"
      }
    } catch {}
  }
  if (-not $frontendReady -and $frontendJob) {
    $output = Receive-Job -Job $frontendJob | Out-String
    if ($output -match "localhost:5173" -or $output -match "ready in") {
      $frontendReady = $true
      Ok "Frontend ready on http://localhost:5173"
    }
  }
  Start-Sleep -Seconds 1
  $elapsed++
}

if (-not $backendReady) {
  Warn "Backend did not become ready within ${timeout}s (check for port conflicts on :8000)"
}
if (-not $frontendReady -and $frontendJob) {
  Warn "Frontend did not become ready within ${timeout}s (check for port conflicts on :5173)"
}

# ─── Output loop ─────────────────────────────────────
try {
  $jobs = @($backendJob) + @($frontendJob | Where-Object { $_ -ne $null })
  while ($true) {
    $anyRunning = $false
    foreach ($job in $jobs) {
      $state = $job.State
      if ($state -eq "Running") {
        $anyRunning = $true
      } elseif ($state -eq "Failed") {
        Write-Host "[$($job.Name) FAILED]" -ForegroundColor $C.Red
      }
      $output = Receive-Job -Job $job
      if ($output) {
        foreach ($line in $output) {
          Write-Host "[$($job.Name)] $line"
        }
      }
    }
    if (-not $anyRunning) {
      Write-Host "`nAll servers stopped." -ForegroundColor $C.Yellow
      break
    }
    Start-Sleep -Seconds 1
  }
} finally {
  foreach ($job in $jobs) {
    if ($job.State -eq "Running") {
      Stop-Job $job | Out-Null
      Remove-Job $job -Force | Out-Null
    }
  }
  Write-Host "`nServers stopped. See you next session!" -ForegroundColor $C.Cyan
}
