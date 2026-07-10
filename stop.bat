@echo off
REM Day Trader Pro stopper - kills whatever is listening on the app's ports.
REM Use this if closing the start window left something running.
echo Stopping Day Trader Pro (ports 4400 and 5173)...
for %%P in (4400 5173) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do (
    taskkill /PID %%A /F /T >nul 2>&1 && echo   killed PID %%A on port %%P
  )
)
echo Done.
timeout /t 2 >nul
