$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source
$pidFile = Join-Path $project '.bot-managed.pid'
$mutex = [System.Threading.Mutex]::new($false, 'Local\CraftlandIndiaBot')
$ownsMutex = $false
try {
    $ownsMutex = $mutex.WaitOne(0)
    if (-not $ownsMutex) { exit 0 }
    Set-Location -LiteralPath $project
    if (Test-Path -LiteralPath $pidFile) {
        try {
            $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
            $old = Get-CimInstance Win32_Process -Filter "ProcessId = $($saved.id)"
            if ($old -and $old.Name -eq 'node.exe' -and
                $old.CommandLine -match '[\\/]dist[\\/]index\.js' -and
                [Math]::Abs($old.CreationDate.ToUniversalTime().Ticks - [long]$saved.startedTicks) -lt 10000000) {
                Stop-Process -Id $old.ProcessId -Force -ErrorAction Stop
            }
        } catch {
            "$(Get-Date -Format o) Stale process cleanup failed: $($_.Exception.Message)" |
                Out-File -FilePath 'bot-managed.log' -Append -Encoding utf8
        }
        Remove-Item -LiteralPath $pidFile -Force
    }
    while ($true) {
        "$(Get-Date -Format o) Starting Craftland bot" | Out-File -FilePath 'bot-managed.log' -Append -Encoding utf8
        $child = Start-Process -FilePath $node -ArgumentList '.\dist\index.js' -WorkingDirectory $project -WindowStyle Hidden -RedirectStandardOutput (Join-Path $project 'bot-managed.stdout.log') -RedirectStandardError (Join-Path $project 'bot-managed.stderr.log') -PassThru
        @{ id = $child.Id; startedTicks = $child.StartTime.ToUniversalTime().Ticks } |
            ConvertTo-Json -Compress | Out-File -LiteralPath $pidFile -Encoding utf8
        $child.WaitForExit()
        if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
        "$(Get-Date -Format o) Bot exited with code $($child.ExitCode); restarting in 10 seconds" | Out-File -FilePath 'bot-managed.log' -Append -Encoding utf8
        Start-Sleep -Seconds 10
    }
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
