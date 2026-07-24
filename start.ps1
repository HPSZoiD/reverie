param(
  [switch]$NoFrontend,
  [switch]$NoBackend
)

$ScriptPath = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location -LiteralPath $ScriptPath

$Host.UI.RawUI.WindowTitle = "Reverie"

function Start-Frontend {
  $job = Start-Job -Name "Frontend" -ScriptBlock {
    param($dir)
    Set-Location $dir
    npm run dev 2>&1
  } -ArgumentList $ScriptPath
  return $job
}

function Start-Backend {
  $job = Start-Job -Name "Backend" -ScriptBlock {
    param($dir)
    Set-Location $dir
    .\venv\Scripts\python -m uvicorn server:app --reload --port 8000 --log-level info 2>&1
  } -ArgumentList $ScriptPath
  return $job
}

function Wait-ForPort($port, $label, $timeout = 15) {
  $elapsed = 0
  while ($elapsed -lt $timeout) {
    $conn = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -WarningAction SilentlyContinue -InformationAction SilentlyContinue 2>$null
    if ($conn.TcpTestSucceeded) {
      Write-Host "  $label ready on port $port" -ForegroundColor Green
      return $true
    }
    Start-Sleep -Seconds 1
    $elapsed++
  }
  Write-Host "  $label did not start within ${timeout}s" -ForegroundColor Yellow
  return $false
}

function Show-JobOutput($job, $prefix) {
  $output = Receive-Job -Job $job
  if ($output) {
    foreach ($line in $output) {
      Write-Host "$prefix $line"
    }
  }
}

# ─── Logging ────────────────────────────────────────────────────
$logFile = Join-Path $ScriptPath "server.log"
"=== Reverie $(Get-Date) ===" | Out-File $logFile

Write-Host "╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         Reverie Engine               ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════╝" -ForegroundColor Cyan
""

# ─── Start Processes ────────────────────────────────────────────
$jobs = @()

if (-not $NoBackend) {
  Write-Host "→ Starting backend..." -ForegroundColor Cyan
  $bj = Start-Backend
  $jobs += $bj
} else {
  Write-Host "→ Backend skipped" -ForegroundColor Yellow
}

if (-not $NoFrontend) {
  Write-Host "→ Starting frontend..." -ForegroundColor Cyan
  $fj = Start-Frontend
  $jobs += $fj
} else {
  Write-Host "→ Frontend skipped" -ForegroundColor Yellow
}

""; Write-Host "Waiting for servers..." -ForegroundColor Cyan

# Poll for ports or initial output
$backendReady = $NoBackend
$frontendReady = $NoFrontend
$startTime = Get-Date
$timeoutSec = 20

while ((-not $backendReady -or -not $frontendReady) -and ((Get-Date) - $startTime).TotalSeconds -lt $timeoutSec) {
  if (-not $backendReady) { $backendReady = Wait-ForPort 8000 "Backend" 1 }
  if (-not $frontendReady) {
    $output = Receive-Job -Job $fj | Out-String
    if ($output -match "http://localhost:5173" -or $output -match "ready in") {
      $frontendReady = $true
      Write-Host "  Frontend ready on port 5173" -ForegroundColor Green
    }
  }
  if (-not $backendReady -or -not $frontendReady) {
    Start-Sleep -Milliseconds 500
  }
}

""; Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
if (-not $NoFrontend) { Write-Host " Frontend : http://localhost:5173" -ForegroundColor White }
if (-not $NoBackend)  { Write-Host " Backend  : http://127.0.0.1:8000"  -ForegroundColor White }
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
""; Write-Host "Live output (Ctrl+C to stop all):" -ForegroundColor Cyan

# ─── Streaming Loop ─────────────────────────────────────────────
try {
  while ($true) {
    $anyRunning = $false
    foreach ($job in $jobs) {
      $state = $job.State
      if ($state -eq "Running") { $anyRunning = $true }
      elseif ($state -eq "Failed") {
        Write-Host "[$($job.Name) FAILED]" -ForegroundColor Red
        Show-JobOutput $job "[$($job.Name)]"
      }
      Show-JobOutput $job "[$($job.Name)]"
    }
    if (-not $anyRunning) {
      Write-Host "All processes have stopped." -ForegroundColor Yellow
      break
    }
    Start-Sleep -Seconds 1
  }
} finally {
  # Cleanup on Ctrl+C or exit
  foreach ($job in $jobs) {
    if ($job.State -eq "Running") {
      Stop-Job $job | Out-Null
      Remove-Job $job -Force | Out-Null
    }
  }
  Write-Host ""; Write-Host "Servers stopped." -ForegroundColor Cyan
}
