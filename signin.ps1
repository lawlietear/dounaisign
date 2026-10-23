param([switch]$Interactive, [switch]$RetryCaptcha)
. (Join-Path $PSScriptRoot 'scripts/common.ps1')
$signinArgs = @('signin')
if ($Interactive) { $signinArgs += '--interactive' }
if ($RetryCaptcha) { $signinArgs += '--retry-captcha' }
Invoke-DounaiCommand -DounaiArgs $signinArgs
