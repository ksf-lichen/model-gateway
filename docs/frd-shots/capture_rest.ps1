$ErrorActionPreference = "Continue"
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$userData = Join-Path $outDir "edge-profile"
$pages = @(
  "access:07-access",
  "usage:08-usage",
  "usage-detail:09-usage-detail",
  "integration:10-integration",
  "security-policies:11-security-policies",
  "audit-platform:12-audit-platform",
  "audit-policy:13-audit-policy",
  "audit-request:14-audit-request",
  "alerts:15-alerts",
  "assistant:16-assistant"
)
foreach ($pair in $pages) {
  $parts = $pair.Split(":")
  $id = $parts[0]
  $f = $parts[1]
  $out = Join-Path $outDir "frd-$f.png"
  Write-Host "capture $id -> $out"
  & $edge --headless=new --disable-gpu --hide-scrollbars --window-size=1440,1100 --virtual-time-budget=12000 --user-data-dir="$userData" --screenshot="$out" "http://127.0.0.1:8765/index.html?v=20261118b#$id" 2>$null
}
# also copy from cursor temp
Copy-Item "$env:LOCALAPPDATA\Temp\cursor\screenshots\frd-*.png" $outDir -Force -ErrorAction SilentlyContinue
Get-ChildItem $outDir -Filter "frd-*.png" | Sort-Object Name | ForEach-Object { Write-Host $_.Name $_.Length }
