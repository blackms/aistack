# Install aistack daemon as a Windows service via NSSM (AIG-636)
#
# Prerequisites:
#   1. Install NSSM: https://nssm.cc/download   (or `choco install nssm`)
#   2. Install aistack globally: npm i -g @blackms/aistack
#   3. Run this script in an elevated PowerShell prompt.
#
# Usage:
#   .\install.ps1                                 # default port 8787, no HMAC
#   .\install.ps1 -Port 9000 -HmacSecret <secret> # custom port + HMAC
#   .\install.ps1 -Remove                         # uninstall the service

param(
    [int]$Port = 8787,
    [string]$Host = "127.0.0.1",
    [string]$DataDir = "$env:ProgramData\aistack\daemon",
    [string]$HmacSecret = "",
    [string]$ServiceName = "aistack-daemon",
    [switch]$Remove
)

$ErrorActionPreference = "Stop"

# Locate nssm
$nssm = (Get-Command nssm.exe -ErrorAction SilentlyContinue).Source
if (-not $nssm) {
    Write-Error "nssm.exe not found in PATH. Install NSSM (https://nssm.cc/) and try again."
    exit 1
}

if ($Remove) {
    Write-Host "Stopping and removing $ServiceName..."
    & $nssm stop $ServiceName confirm 2>$null
    & $nssm remove $ServiceName confirm
    Write-Host "Service removed."
    exit 0
}

# Locate the aistack binary
$aistack = (Get-Command aistack.cmd -ErrorAction SilentlyContinue).Source
if (-not $aistack) {
    $aistack = (Get-Command aistack -ErrorAction SilentlyContinue).Source
}
if (-not $aistack) {
    Write-Error "aistack CLI not found in PATH. Run: npm i -g @blackms/aistack"
    exit 1
}

# Ensure data dir exists
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
}

$logDir = Join-Path $DataDir "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

Write-Host "Installing service $ServiceName..."
& $nssm install $ServiceName $aistack daemon start "--data-dir=$DataDir" "--port=$Port" "--host=$Host"

# Configure
& $nssm set $ServiceName AppDirectory $DataDir
& $nssm set $ServiceName DisplayName "aistack background agent runner"
& $nssm set $ServiceName Description "AIG-636 headless agent runner with webhook + file-watcher triggers"
& $nssm set $ServiceName Start SERVICE_AUTO_START
& $nssm set $ServiceName AppStdout (Join-Path $logDir "service-stdout.log")
& $nssm set $ServiceName AppStderr (Join-Path $logDir "service-stderr.log")
& $nssm set $ServiceName AppRotateFiles 1
& $nssm set $ServiceName AppRotateBytes 5242880

if ($HmacSecret -ne "") {
    & $nssm set $ServiceName AppEnvironmentExtra "AISTACK_DAEMON_HMAC_SECRET=$HmacSecret"
    Write-Host "HMAC secret configured via AISTACK_DAEMON_HMAC_SECRET env var."
} else {
    Write-Host "WARNING: no HMAC secret set. Webhook is open. Pass -HmacSecret to enable signature verification."
}

Write-Host "Starting service..."
& $nssm start $ServiceName

Write-Host ""
Write-Host "Done. Verify with:"
Write-Host "  & '$nssm' status $ServiceName"
Write-Host "  aistack daemon status --data-dir=$DataDir"
