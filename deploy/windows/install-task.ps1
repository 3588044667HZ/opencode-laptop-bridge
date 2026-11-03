# Run as the normal logged-in user, not as Administrator.
$ErrorActionPreference = "Stop"
$TaskName = "OpenCodeLaptopBridge"

$Project = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Launcher = Join-Path $Project "deploy\windows\start-hidden.vbs"
$Wrapper = Join-Path $Project "deploy\windows\start-bridge.ps1"
$EntryPoint = Join-Path $Project "scripts\start-bridge.mjs"
$TokenFile = Join-Path $env:USERPROFILE ".config\opencode-laptop-bridge\token"

foreach ($required in @($Launcher, $Wrapper, $EntryPoint)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Missing required file: $required"
    }
}

if (-not (Test-Path -LiteralPath $TokenFile -PathType Leaf)) {
    $tokenDir = Split-Path -Parent $TokenFile
    New-Item -ItemType Directory -Force -Path $tokenDir | Out-Null
    Write-Host "Create a token file first:"
    Write-Host "  node -e `"console.log(require('node:crypto').randomBytes(32).toString('hex'))`" > `"$TokenFile`""
    Write-Host "Then protect it:"
    Write-Host "  icacls `"$TokenFile`" /inheritance:r /grant:r `"$($env:USERNAME):(F)`""
    throw "Token file not found: $TokenFile"
}

$Action = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument ('"' + $Launcher + '"') `
    -WorkingDirectory $Project

$UserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $UserId
$Principal = New-ScheduledTaskPrincipal `
    -UserId $UserId `
    -LogonType Interactive `
    -RunLevel Limited

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $Principal `
    -Settings $Settings `
    -Description "Runs the OpenCode Laptop Bridge in the user's interactive session." `
    -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "The task starts at the next user logon. Start it now with:"
Write-Host "  Start-ScheduledTask -TaskName `"$TaskName`""
Write-Host "Logs: $(Join-Path $Project 'logs\bridge.log')"
