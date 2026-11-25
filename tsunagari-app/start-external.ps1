$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 24 or later is required. See HOME_SERVER.md.' }
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { throw 'cloudflared is not installed. See the official download link in HOME_SERVER.md.' }
Write-Host 'External trial: an HTTPS URL will expose only this SNS login page. Posts require SNS login.'
Write-Host 'The URL changes each run. Use test data only. Ctrl+C stops the server and tunnel.'
$previousSetup = $env:ADMIN_SETUP_TOKEN
$setupSecure = Read-Host 'First run: enter a private setup code (32+ characters). Existing admin: press Enter' -AsSecureString
$setupPointer = [IntPtr]::Zero
try {
    $setupPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($setupSecure)
    $setupText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($setupPointer)
    if ($setupText.Length -gt 0 -and $setupText.Length -lt 32) { throw 'The initial setup code must have at least 32 characters.' }
    $env:ADMIN_SETUP_TOKEN = $setupText
    $setupText = $null
    & node build.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    & node external-trial.mjs
    if ($LASTEXITCODE -ne 0) { throw 'External trial did not complete. Check the displayed connection error.' }
} finally {
    $env:ADMIN_SETUP_TOKEN = $previousSetup
    $setupText = $null
    if ($setupPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($setupPointer) }
    $setupSecure.Dispose()
}
