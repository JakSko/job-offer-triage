@echo off
rem Jeden przebieg aplikacji z Wiersza polecenia (cmd) albo podwojnym kliknieciem.
rem Uruchamia run.ps1 przez PowerShell; log: logs\RRRR-MM-DD.log. Argumenty przechodza dalej, np. run.cmd --dry-run
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
set KOD=%ERRORLEVEL%
echo Przebieg zakonczony (kod wyjscia %KOD%). Szczegoly: %~dp0logs\
exit /b %KOD%
