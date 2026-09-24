$ErrorActionPreference = 'Stop'

function Convert-Secret([Security.SecureString]$SecureValue) {
  if ($null -eq $SecureValue) { return $null }
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
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$nodeDirectory = 'C:\Users\raduj\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$node = Join-Path $nodeDirectory 'node.exe'
$logFile = 'C:\Users\raduj\.betfair-liveedge\live-feed-task.log'

if (-not (Test-Path -LiteralPath $node)) {
  throw "Node.js runtime not found: $node"
}

$env:PATH = "$nodeDirectory;$env:PATH"
$env:CONTROL_API_TOKEN = Convert-Secret $saved.ControlApiToken
$env:CONTROL_PLANE_URL = 'https://liveedge-control.vercel.app'
$env:INPUT_SOURCE = 'live'
$env:LIVE_POLL_SECONDS = '75'
$env:LIVE_TELEGRAM_MAX_SIGNALS_PER_DAY = '4'

foreach ($mapping in @(
  @{ Property = 'TelegramPvBotToken'; Environment = 'TELEGRAM_PV_BOT_TOKEN' },
  @{ Property = 'TelegramPvChatId'; Environment = 'TELEGRAM_PV_CHAT_ID' },
  @{ Property = 'TelegramGbtBotToken'; Environment = 'TELEGRAM_GBT_BOT_TOKEN' },
  @{ Property = 'TelegramGbtChatId'; Environment = 'TELEGRAM_GBT_CHAT_ID' }
)) {
  $property = $saved.PSObject.Properties[$mapping.Property]
  if ($null -ne $property -and $null -ne $property.Value) {
    Set-Item -Path "Env:$($mapping.Environment)" -Value (Convert-Secret $property.Value)
  }
}

try {
  Push-Location -LiteralPath $projectRoot
  Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) Starting continuous live signal feed. Betfair execution remains controlled by the separate dry-run worker."
  $previousErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $node (Join-Path $projectRoot 'live-betting\scripts\daemon.js') 2>&1 | Out-File -LiteralPath $logFile -Append -Encoding utf8
  $nodeExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorPreference
  if ($nodeExitCode -ne 0) { throw "Live feed daemon exited with code $nodeExitCode" }
  exit 0
}
catch {
  Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) Live feed failed: $($_.Exception.Message)"
  throw
}
finally {
  Pop-Location -ErrorAction SilentlyContinue
  foreach ($name in @('CONTROL_API_TOKEN','CONTROL_PLANE_URL','INPUT_SOURCE','LIVE_POLL_SECONDS','LIVE_TELEGRAM_MAX_SIGNALS_PER_DAY','TELEGRAM_PV_BOT_TOKEN','TELEGRAM_PV_CHAT_ID','TELEGRAM_GBT_BOT_TOKEN','TELEGRAM_GBT_CHAT_ID')) {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
}
