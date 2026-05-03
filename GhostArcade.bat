@echo off
title GhostArcade - Projection Mapping
cd /d "%~dp0"
echo Starting GhostArcade...
echo.
echo Once started, the app will open in your browser at http://localhost:5173
echo Press Ctrl+C to stop the server
echo.
start "" "http://localhost:5173"
npm run start
