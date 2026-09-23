@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Series Lab Studio

where fnm >nul 2>nul && (
  for /f "tokens=*" %%i in ('fnm env --shell cmd') do call %%i
  fnm use --install-if-missing --silent-if-unchanged >nul 2>nul
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not in PATH. Install Node 20+ and retry.
  pause
  exit /b 1
)

echo Node:
node --version

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed
    pause
    exit /b 1
  )
)

rem Free port 5344 if a previous Lab is still running
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-NetTCPConnection -LocalPort 5344 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo.
echo Series Lab Studio: http://127.0.0.1:5344/studio/
echo Language switch: UK / EN in header
echo Close this window to stop the server.
echo.

rem Open browser after the server has a moment to bind
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:5344/studio/"

node server\index.mjs
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo [ERROR] Server exited with code %ERR%
)
pause
exit /b %ERR%
