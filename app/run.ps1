# Uruchomienie jednego przebiegu na laptopie (Harmonogram zadań Windows albo ręcznie).
# Konfiguracja: app/.env. Log dnia: app/logs/RRRR-MM-DD.log (dopisywany).
# Ręcznie:  powershell -ExecutionPolicy Bypass -File "<sciezka>\app\run.ps1"
# Dodatkowe argumenty trafiają do przebiegu, np.:  run.ps1 --dry-run

Set-Location -Path $PSScriptRoot
# Node pisze w UTF-8; bez tego PowerShell odczytuje wyjście w stronie kodowej konsoli i psuje polskie znaki
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$katalogLogow = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $katalogLogow | Out-Null
$log = Join-Path $katalogLogow ((Get-Date -Format 'yyyy-MM-dd') + '.log')

Add-Content -Path $log -Value ('===== ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' start =====') -Encoding utf8
& node dist/cli.js run @args *>&1 | ForEach-Object { "$_" } | Add-Content -Path $log -Encoding utf8
$kod = $LASTEXITCODE
Add-Content -Path $log -Value ('===== koniec, kod wyjscia ' + $kod + ' =====') -Encoding utf8
exit $kod
