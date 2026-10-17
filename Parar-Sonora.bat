@echo off
chcp 65001 >nul
echo [SONORA] A encerrar processos da Sonora em segundo plano...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -like '*Bot discord*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo [SONORA] Bot desligado com sucesso.
timeout /t 3 >nul
