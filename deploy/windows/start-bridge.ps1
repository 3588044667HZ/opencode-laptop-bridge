# 从用户保护文件读取 LAPTOP_MCP_TOKEN，校验非空后启动 bridge。
# Token 只进入当前进程环境，不写入命令行参数或日志。
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$EntryPoint = Join-Path $ProjectRoot "scripts\start-bridge.mjs"
$TokenFile = Join-Path $env:USERPROFILE ".config\opencode-laptop-bridge\token"

if (-not (Test-Path -LiteralPath $TokenFile -PathType Leaf)) {
    [Console]::Error.WriteLine("Token file not found: $TokenFile")
    exit 1
}

$token = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($token)) {
    [Console]::Error.WriteLine("Token file is empty: $TokenFile")
    exit 1
}

if (-not (Test-Path -LiteralPath $EntryPoint -PathType Leaf)) {
    [Console]::Error.WriteLine("Bridge entry point not found: $EntryPoint")
    exit 1
}

$env:LAPTOP_MCP_TOKEN = $token
Set-Location -LiteralPath $ProjectRoot

& node "scripts/start-bridge.mjs"
exit $LASTEXITCODE
