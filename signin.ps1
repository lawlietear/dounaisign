param([switch]$Interactive)
. (Join-Path $PSScriptRoot 'scripts/common.ps1')
$signinArgs = @('signin')
if ($Interactive) { $signinArgs += '--interactive' }
Invoke-DounaiCommand -DounaiArgs $signinArgs
