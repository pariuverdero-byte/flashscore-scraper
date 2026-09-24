$ErrorActionPreference = 'Stop'

$secretDirectory = 'C:\Users\raduj\.betfair-liveedge'
$secretFile = Join-Path $secretDirectory 'secrets.clixml'
New-Item -ItemType Directory -Path $secretDirectory -Force | Out-Null

# Remove an App Key accidentally entered as a standalone PowerShell command.
$historyPath = (Get-PSReadLineOption -ErrorAction SilentlyContinue).HistorySavePath
if ($historyPath -and (Test-Path -LiteralPath $historyPath)) {
  $safeHistory = [IO.File]::ReadAllLines($historyPath) | Where-Object { $_ -notmatch '^[A-Za-z0-9]{16}$' }
  [IO.File]::WriteAllLines($historyPath, $safeHistory)
}
Clear-History -ErrorAction SilentlyContinue
Clear-Host

$appKey = Read-Host 'Delayed App Key (input hidden)' -AsSecureString
$usernameText = Read-Host 'Betfair username'
$username = ConvertTo-SecureString $usernameText -AsPlainText -Force
$password = Read-Host 'Betfair password (input hidden)' -AsSecureString

[pscustomobject]@{
  AppKey = $appKey
  Username = $username
  Password = $password
} | Export-Clixml -LiteralPath $secretFile

icacls $secretFile /inheritance:r /grant:r 'raduj:(R,W)' | Out-Null
Write-Host "Betfair secrets saved with Windows user encryption: $secretFile"
