@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Stopping Series Lab on :5344 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$c = Get-NetTCPConnection -LocalPort 5344 -State Listen -ErrorAction SilentlyContinue;" ^
  "if (-not $c) { Write-Host '[INFO] Nothing listening on :5344.'; exit 0 };" ^
  "$c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue; Write-Host ('[OK] Stopped PID ' + $_.OwningProcess) }"
echo.
pause
