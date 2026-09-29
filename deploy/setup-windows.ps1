$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw 'Python launcher (py) 3.11+ is required.'
}
py -3 -m venv .venv
$pythonExe = Join-Path (Get-Location) '.venv\Scripts\python.exe'
if (Test-Path 'wheelhouse\windows') {
    & $pythonExe -m pip install --no-index --find-links wheelhouse\windows -r backend\requirements.txt
} else {
    & $pythonExe -m pip install -r backend\requirements.txt
}
if ($LASTEXITCODE -ne 0) { throw 'Python package installation failed.' }
if (-not (Test-Path 'frontend\dist\index.html')) {
    throw 'Frontend build missing. Build with: cd frontend; npm ci; npm run build'
}
New-Item -ItemType Directory -Force data | Out-Null
Write-Host 'Setup complete. Double-click deploy\start-windows.bat to open the app.'
