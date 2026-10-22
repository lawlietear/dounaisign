$ErrorActionPreference = 'Stop'
$DounaiPackageRoot = Split-Path -Parent $PSScriptRoot

function Assert-WindowsNode {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'This code package targets Windows x64.'
    }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw 'Install Node.js 24 x64 first, then open a new terminal.'
    }
    & node.exe (Join-Path $DounaiPackageRoot 'scripts/check-node.js')
    if ($LASTEXITCODE -ne 0) { throw 'Node.js 24 x64 is required.' }
}

function Invoke-DounaiCommand {
    param([string[]]$DounaiArgs)
    Assert-WindowsNode
    & node.exe (Join-Path $DounaiPackageRoot 'app.js') @DounaiArgs
    exit $LASTEXITCODE
}
