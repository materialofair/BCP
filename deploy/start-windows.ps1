$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
$pythonExe = Join-Path (Get-Location) '.venv\Scripts\python.exe'
if (-not (Test-Path $pythonExe) -or -not (Test-Path 'frontend\dist\index.html')) {
    throw 'Run deploy\setup-windows.ps1 after the frontend has been built.'
}
New-Item -ItemType Directory -Force data | Out-Null
$apiPidPath = 'data\bcp-api.pid'
$workerPidPath = 'data\bcp-worker.pid'
function Start-BCPProcess($pidPath, $arguments, $stdoutPath, $stderrPath, $marker) {
    if (Test-Path $pidPath) {
        $oldPid = [int](Get-Content $pidPath -Raw)
        $oldProc = Get-CimInstance Win32_Process -Filter "ProcessId = $oldPid" -ErrorAction SilentlyContinue
        if ($oldProc -and $oldProc.CommandLine -like "*$marker*" -and $oldProc.CommandLine -like '*\.venv\Scripts\python.exe*') { return }
    }
    $proc = Start-Process -FilePath $pythonExe -ArgumentList $arguments -WorkingDirectory (Get-Location).Path -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden
    Set-Content -Path $pidPath -Value $proc.Id
}
Start-BCPProcess $apiPidPath @('-m','uvicorn','app.main:app','--app-dir','backend','--host','127.0.0.1','--port','8000') 'data\api-out.log' 'data\api-error.log' 'app.main:app'
Start-BCPProcess $workerPidPath @('-m','collector.worker') 'data\collector-out.log' 'data\collector-error.log' 'collector.worker'
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 2 | Out-Null
        Start-Process 'http://127.0.0.1:8000'
        Write-Host 'App opened at http://127.0.0.1:8000'
        exit 0
    } catch { Start-Sleep -Seconds 1 }
}
throw 'App failed to become ready. Check data\api-error.log and data\collector-error.log.'
