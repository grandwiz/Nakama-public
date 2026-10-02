param(
    [string]$AndroidSdk = $env:ANDROID_HOME,
    [string]$Python = 'python',
    [int]$Jobs = 6,
    [switch]$VerifyOnly
)
$ErrorActionPreference = 'Stop'
$taskArgs = @((Join-Path $PSScriptRoot 'build-bundled-speech-runtime.py'), '--jobs', $Jobs)
if ($AndroidSdk) { $taskArgs += @('--android-sdk', $AndroidSdk) }
if ($VerifyOnly) { $taskArgs += '--verify-only' }
& $Python @taskArgs
if ($LASTEXITCODE -ne 0) { throw "ASR-only Android runtime build failed ($LASTEXITCODE)." }
