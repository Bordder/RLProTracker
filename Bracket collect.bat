@echo off
REM Double-click to keep the bracket data current. Local only.
REM
REM Fetches each event page from Liquipedia on its own schedule and rewrites
REM data/derived/bracket.json. Leave it running during a LAN.
title RL Pro Tracker - bracket collector
cd /d "%~dp0"

node scripts/collect.mjs

REM Without this the window vanishes on an error before it can be read.
echo.
echo Collector stopped. Press any key to close.
pause >nul
