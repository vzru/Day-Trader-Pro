@echo off
REM Day Trader Pro launcher - double-click to start.
REM The browser opens automatically. CLOSE THIS WINDOW (the X, or Ctrl+C) to stop the server.
title Day Trader Pro  -  close this window to STOP the server
cd /d "%~dp0"

REM Safety net: if node isn't on PATH (e.g. installed after this shell's parent
REM started), add the default install location.
where node >nul 2>&1 || set "PATH=C:\Program Files\nodejs;%PATH%"

echo ============================================================
echo   Day Trader Pro is starting...
echo   A browser tab will open at http://localhost:5173
echo.
echo   To STOP: close this window (X) or press Ctrl+C.
echo ============================================================
echo.

call npm run dev
