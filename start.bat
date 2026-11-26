@echo off
setlocal
cd /d "%~dp0"

title CutLite - Minimal Video Editor

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not in PATH.
  echo Please install Node.js from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

where python >nul 2>nul
if not errorlevel 1 (
  echo Starting local Auto-Caption Server...
  start "CutLite Caption Server" /min cmd /c "python server\caption_server.py"
)

echo Starting CutLite...
call npm run dev -- --open
if errorlevel 1 (
  pause
)
