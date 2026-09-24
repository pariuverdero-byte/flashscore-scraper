$ErrorActionPreference = 'Stop'

function Convert-Secret([Security.SecureString]$SecureValue) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$secretFile = 'C:\Users\raduj\.betfair-liveedge\secrets.clixml'
$saved = Import-Clixml -LiteralPath $secretFile
$projectRoot = Split-Path -Parent $PSScriptRoot
$tsx = Join-Path $projectRoot 'node_modules\.bin\tsx.cmd'

$env:BETFAIR_APP_KEY = Convert-Secret $saved.AppKey
$env:BETFAIR_USERNAME = Convert-Secret $saved.Username
$env:BETFAIR_PASSWORD = Convert-Secret $saved.Password
$env:CONTROL_API_TOKEN = Convert-Secret $saved.ControlApiToken
$env:BETFAIR_CERT_PATH = 'C:\Users\raduj\.betfair-liveedge\client-2048.crt'
$env:BETFAIR_KEY_PATH = 'C:\Users\raduj\.betfair-liveedge\client-2048.key'
$env:BETFAIR_JURISDICTION = 'RO'
$env:CONTROL_PLANE_URL = 'https://liveedge-control.vercel.app'
$env:REPOSITORY_ROOT = Split-Path -Parent $projectRoot
$env:POLL_INTERVAL_MS = '15000'
$env:LIVE_BETTING_ENABLED = 'false'
Remove-Item Env:LIVE_BETTING_ACK -ErrorAction SilentlyContinue

try {
  Write-Host 'Starting LiveEdge worker in DRY RUN mode. No bets can be placed.'
  & $tsx (Join-Path $projectRoot 'worker\index.ts')
  exit $LASTEXITCODE
}
finally {
  foreach ($name in @('BETFAIR_APP_KEY','BETFAIR_USERNAME','BETFAIR_PASSWORD','CONTROL_API_TOKEN','BETFAIR_CERT_PATH','BETFAIR_KEY_PATH','BETFAIR_JURISDICTION','CONTROL_PLANE_URL','REPOSITORY_ROOT','POLL_INTERVAL_MS','LIVE_BETTING_ENABLED')) {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
}
