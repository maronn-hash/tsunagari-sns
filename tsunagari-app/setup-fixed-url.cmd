@echo off
setlocal
title Tsunagari - Fixed URL Setup
cd /d "%~dp0"
where node >nul 2>nul
if not errorlevel 1 goto run
if not exist "%ProgramFiles%\nodejs\node.exe" goto missing
set "PATH=%ProgramFiles%\nodejs;%PATH%"
:run
node setup-fixed-url.mjs
echo.
pause
exit /b
:missing
echo Node.js 24 or later is required. Install Node.js and try again.
pause
exit /b 1
