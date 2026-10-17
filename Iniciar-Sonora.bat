@echo off
chcp 65001 >nul
title SONORA — Discord Music Bot & Web Player
cd /d "%~dp0"
echo [SONORA] A iniciar o bot e o servidor...
npm run dev:server
pause
