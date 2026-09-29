$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
foreach ($service in @('api', 'worker')) {
    $pidPath = "data\bcp-$service.pid"
    if (-not (Test-Path $pidPath)) { continue }
    $servicePid = [int](Get-Content $pidPath -Raw)
    $marker = if ($service -eq 'api') { 'app.main:app' } else { 'collector.worker' }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $servicePid" -ErrorAction SilentlyContinue
    if ($proc -and $proc.CommandLine -like "*$marker*" -and $proc.CommandLine -like '*\.venv\Scripts\python.exe*') {
        Stop-Process -Id $servicePid
        Write-Host "Stopped $service (PID $servicePid)."
    }
    Remove-Item $pidPath
}
