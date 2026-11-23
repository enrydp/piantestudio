@echo off
chcp 65001 >nul
title PianteStudio
cd /d "%~dp0"

echo ==========================================
echo   Avvio di PianteStudio...
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRORE] Node.js non trovato. Installa Node.js da https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installazione dipendenze in corso...
  call npm install
  if errorlevel 1 (
    echo [ERRORE] Installazione dipendenze fallita.
    pause
    exit /b 1
  )
)

echo Server in avvio su http://localhost:5173
echo Chiudi questa finestra o premi Ctrl+C per arrestare l'app.
echo.

call npm run dev -- --open
if errorlevel 1 pause
