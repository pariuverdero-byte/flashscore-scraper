$ErrorActionPreference = 'Stop'

$secretFile = 'C:\Users\raduj\.betfair-liveedge\secrets.clixml'
if (-not (Test-Path -LiteralPath $secretFile)) {
  throw 'Encrypted Betfair secrets file does not exist.'
}

$saved = Import-Clixml -LiteralPath $secretFile
$saved.Password = Read-Host 'New Betfair password (input hidden)' -AsSecureString
$saved | Export-Clixml -LiteralPath $secretFile
icacls $secretFile /inheritance:r /grant:r 'raduj:(R,W)' | Out-Null

Write-Host "Betfair password updated with Windows user encryption: $secretFile"
