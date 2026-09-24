$ErrorActionPreference = 'Stop'

$secretFile = 'C:\Users\raduj\.betfair-liveedge\secrets.clixml'
if (-not (Test-Path -LiteralPath $secretFile)) {
  throw 'Encrypted Betfair secrets file does not exist.'
}

Read-Host 'Now copy the full 16-character Delayed App Key from Betfair, then return here and press Enter' | Out-Null
$appKeyText = (Get-Clipboard -Raw).Trim()
try {
  if ($appKeyText -notmatch '^[A-Za-z0-9]{16}$') {
    throw 'Clipboard does not contain a valid 16-character Betfair App Key.'
  }

  $saved = Import-Clixml -LiteralPath $secretFile
  $saved.AppKey = ConvertTo-SecureString $appKeyText -AsPlainText -Force
  $saved | Export-Clixml -LiteralPath $secretFile
  icacls $secretFile /inheritance:r /grant:r 'raduj:(R,W)' | Out-Null
  Write-Host 'Betfair App Key updated and encrypted successfully.'
}
finally {
  Set-Clipboard -Value 'cleared'
  $appKeyText = $null
}
