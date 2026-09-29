@echo off
set "PROJECT_DIR=%~dp0"

start "Autosupply API" /d "%PROJECT_DIR%" cmd /k node server.js
start "Autosupply Web" /d "%PROJECT_DIR%" cmd /k node_modules\.bin\vite.cmd

echo Autosupply is starting at http://localhost:2026/
start "" "http://localhost:2026/"