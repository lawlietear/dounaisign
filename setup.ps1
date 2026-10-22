param(
    [Parameter(Mandatory = $true)][string]$Account,
    [string]$ChromePath = '',
    [string]$Proxy = ''
)
. (Join-Path $PSScriptRoot 'scripts/common.ps1')
Assert-WindowsNode
if (-not $Account.Trim()) { throw 'Account must be your Dounai username.' }
$configPath = Join-Path $DounaiPackageRoot 'config.json'
if (Test-Path -LiteralPath $configPath) {
    $existing = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($existing.expectedAccount -ne $Account.Trim()) {
        throw 'Existing config has a different account. Edit config.json deliberately; setup will not overwrite it.'
    }
}

$launcher = Get-Command py.exe -ErrorAction SilentlyContinue
$launcherArgs = @('-3.12')
if (-not $launcher) {
    $launcher = Get-Command python.exe -ErrorAction SilentlyContinue
    $launcherArgs = @()
}
if (-not $launcher) { throw 'Install CPython 3.12 x64 first. Python is not bundled.' }
& $launcher.Source @launcherArgs (Join-Path $DounaiPackageRoot 'scripts/check-python.py')
if ($LASTEXITCODE -ne 0) { throw 'CPython 3.12 x64 is required.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd was not found with Node.js.' }

Push-Location -LiteralPath $DounaiPackageRoot
try {
    & npm.cmd ci --no-audit --no-fund --cache (Join-Path $DounaiPackageRoot 'temp/npm-cache')
    if ($LASTEXITCODE -ne 0) { throw 'Locked Node dependency installation failed.' }
    $ocrDir = Join-Path $DounaiPackageRoot 'tools/ocr'
    & $launcher.Source @launcherArgs -m venv (Join-Path $ocrDir '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Local Python venv creation failed.' }
    $pythonExe = Join-Path $ocrDir '.venv/Scripts/python.exe'
    & $pythonExe -m pip install --disable-pip-version-check --require-hashes --only-binary=:all: --cache-dir (Join-Path $DounaiPackageRoot 'temp/pip-cache') -r (Join-Path $ocrDir 'requirements.lock.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Pinned OCR dependency installation failed. Do not silently upgrade versions.' }
    if (-not (Test-Path -LiteralPath $configPath)) {
        $config = [ordered]@{
            expectedAccount = $Account.Trim()
            proxy = $Proxy
            chromePath = $ChromePath
            headless = $false
            timeoutMs = 60000
        }
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), $utf8)
    }
    & node.exe (Join-Path $DounaiPackageRoot 'app.js') doctor
    if ($LASTEXITCODE -ne 0) { throw 'Environment is not ready; review doctor output.' }
    Write-Host 'Setup complete. Run login.ps1 first, then signin.ps1.'
} finally {
    Pop-Location
}
