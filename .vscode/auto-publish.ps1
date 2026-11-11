$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$gitCandidates = @(
    (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
)
$git = $gitCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$logRoot = Join-Path $env:TEMP 'ManriqueGeovisorAutoPublish'
$logFile = Join-Path $logRoot 'watcher.log'
$quietSeconds = 8

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Write-Log([string]$message) {
    Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message"
}

function Invoke-Git([string[]]$arguments) {
    $output = & $git -C $repo @arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ($output -join [Environment]::NewLine)
    }
    return ($output -join [Environment]::NewLine)
}

if (-not $git) {
    Write-Log 'Git no encontrado en las ubicaciones habituales.'
    exit 1
}

$mutex = [Threading.Mutex]::new($false, 'ManriqueGeovisorAutoPublish')
if (-not $mutex.WaitOne(0)) { exit 0 }
Write-Log "Vigilando $repo"

$pendingSince = $null
$lastStatus = ''
$lastPushAttempt = [DateTime]::MinValue

while ($true) {
    try {
        $status = Invoke-Git @('status', '--porcelain', '--untracked-files=all')
        if ($status -ne $lastStatus) {
            $lastStatus = $status
            $pendingSince = if ($status) { Get-Date } else { $null }
        }

        if ($status -and $pendingSince -and ((Get-Date) - $pendingSince).TotalSeconds -ge $quietSeconds) {
            Invoke-Git @('add', '-A') | Out-Null
            $staged = Invoke-Git @('diff', '--cached', '--name-only')
            if ($staged) {
                $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
                Invoke-Git @('commit', '-m', "Actualización automática $stamp") | Out-Null
                Write-Log "Cambios guardados en un commit automático."
            }
            $lastStatus = ''
            $pendingSince = $null
        }

        if (((Get-Date) - $lastPushAttempt).TotalSeconds -ge 30) {
            $aheadBehind = (Invoke-Git @('rev-list', '--left-right', '--count', 'origin/main...HEAD')).Trim() -split '\s+'
            if ($aheadBehind.Count -eq 2 -and [int]$aheadBehind[1] -gt 0) {
                $lastPushAttempt = Get-Date
                Invoke-Git @('push', 'origin', 'main') | Out-Null
                Write-Log 'Cambios enviados a GitHub.'
            }
        }
    }
    catch {
        Write-Log "Error: $($_.Exception.Message)"
        $lastPushAttempt = Get-Date
    }
    Start-Sleep -Seconds 3
}
