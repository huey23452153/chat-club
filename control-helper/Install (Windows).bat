@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed first. Get it from https://nodejs.org/ then run this again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)
node install.js %*
pause
