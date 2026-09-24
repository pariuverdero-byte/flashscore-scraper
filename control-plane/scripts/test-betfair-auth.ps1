$ErrorActionPreference = 'Stop'

function Read-Secret([string]$Prompt) {
  $secureValue = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Convert-Secret([Security.SecureString]$SecureValue) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$tsx = Join-Path $projectRoot 'node_modules\.bin\tsx.cmd'
if (-not (Test-Path -LiteralPath $tsx)) {
  throw 'Dependencies are missing. Run pnpm install in control-plane first.'
}

$secretFile = 'C:\Users\raduj\.betfair-liveedge\secrets.clixml'
if (Test-Path -LiteralPath $secretFile) {
  $saved = Import-Clixml -LiteralPath $secretFile
  $env:BETFAIR_APP_KEY = Convert-Secret $saved.AppKey
  $env:BETFAIR_USERNAME = Convert-Secret $saved.Username
  $env:BETFAIR_PASSWORD = Convert-Secret $saved.Password
}
else {
  $env:BETFAIR_APP_KEY = Read-Secret 'Delayed App Key (input hidden)'
  $env:BETFAIR_USERNAME = Read-Host 'Betfair username'
  $env:BETFAIR_PASSWORD = Read-Secret 'Betfair password (input hidden)'
}
$env:BETFAIR_CERT_PATH = 'C:\Users\raduj\.betfair-liveedge\client-2048.crt'
$env:BETFAIR_KEY_PATH = 'C:\Users\raduj\.betfair-liveedge\client-2048.key'
$env:BETFAIR_JURISDICTION = 'RO'

try {
  & $tsx (Join-Path $projectRoot 'worker\test-auth.ts')
  exit $LASTEXITCODE
}
finally {
  Remove-Item Env:BETFAIR_APP_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:BETFAIR_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:BETFAIR_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:BETFAIR_CERT_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:BETFAIR_KEY_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:BETFAIR_JURISDICTION -ErrorAction SilentlyContinue
}
