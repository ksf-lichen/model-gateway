param(
  [int]$StaticPort = 8765,
  [int]$ProdPort = 8787,
  [int]$TestPort = 8788
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerDir = Join-Path $Root "server"
$DistDir = Join-Path $Root "dist"

Write-Host "Aegis Model Gateway launcher" -ForegroundColor Cyan
Write-Host "  console : http://127.0.0.1:$StaticPort"
Write-Host "  gateway : http://127.0.0.1:$ProdPort  (prod)"
Write-Host "  gateway : http://127.0.0.1:$TestPort  (test)"
Write-Host "  admin   : X-Admin-Token: local-dev-token (see server/.env.example)"

$env:PROD_PORT = "$ProdPort"
$env:TEST_PORT = "$TestPort"
$env:ADMIN_TOKEN = if ($env:ADMIN_TOKEN) { $env:ADMIN_TOKEN } else { "local-dev-token" }

# Static console
$static = Start-Process -PassThru -WindowStyle Minimized -FilePath "python" -ArgumentList @(
  "-m", "http.server", "$StaticPort", "--bind", "127.0.0.1"
) -WorkingDirectory $DistDir

# Gateway (prod + test in one process)
$gateway = Start-Process -PassThru -WindowStyle Minimized -FilePath "python" -ArgumentList @(
  "app.py"
) -WorkingDirectory $ServerDir

Write-Host ""
Write-Host "Started PID static=$($static.Id) gateway=$($gateway.Id)"
Write-Host "Press Ctrl+C to stop both..."

try {
  while ($true) {
    Start-Sleep -Seconds 2
    if ($static.HasExited -or $gateway.HasExited) {
      Write-Host "A child process exited; shutting down." -ForegroundColor Yellow
      break
    }
  }
} finally {
  foreach ($p in @($static, $gateway)) {
    try {
      if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    } catch {}
  }
}
