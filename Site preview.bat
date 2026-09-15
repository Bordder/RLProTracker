@echo off
REM Double-click to view the whole site, brackets included, at localhost:5173.
title RL Pro Tracker - site preview
cd /d "%~dp0"

start "" http://localhost:5173/brackets
node scripts/serve.mjs

echo.
echo Preview stopped. Press any key to close.
pause >nul
