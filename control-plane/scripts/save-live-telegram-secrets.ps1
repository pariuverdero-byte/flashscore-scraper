$ErrorActionPreference = 'Stop'

$secretFile = 'C:\Users\raduj\.betfair-liveedge\secrets.clixml'
$saved = Import-Clixml -LiteralPath $secretFile

$pvToken = Read-Host 'PariuVerde Telegram bot token (input hidden)' -AsSecureString
$pvChatIdText = Read-Host 'PariuVerde Telegram chat ID [@pariuverde]'
if ([string]::IsNullOrWhiteSpace($pvChatIdText)) { $pvChatIdText = '@pariuverde' }
$pvChatId = ConvertTo-SecureString $pvChatIdText -AsPlainText -Force

$values = [ordered]@{}
foreach ($property in $saved.PSObject.Properties) {
  $values[$property.Name] = $property.Value
}
$values['TelegramPvBotToken'] = $pvToken
$values['TelegramPvChatId'] = $pvChatId

[pscustomobject]$values | Export-Clixml -LiteralPath $secretFile
icacls $secretFile /inheritance:r /grant:r 'raduj:(R,W)' | Out-Null
Write-Host "Telegram secrets saved with Windows user encryption: $secretFile"

$task = Get-ScheduledTask -TaskName 'LiveEdge-LiveFeed' -ErrorAction SilentlyContinue
if ($null -ne $task) {
  Stop-ScheduledTask -TaskName 'LiveEdge-LiveFeed' -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName 'LiveEdge-LiveFeed'
  Write-Host 'LiveEdge-LiveFeed restarted. New active signals will now be sent to Telegram.'
}
