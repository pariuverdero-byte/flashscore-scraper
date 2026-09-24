$ErrorActionPreference = 'Stop'

$logFile = 'C:\Users\raduj\.betfair-liveedge\service-watchdog.log'
$taskNames = @('LiveEdge-LiveFeed', 'LiveEdge-Betfair-DryRun')

foreach ($taskName in $taskNames) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -eq $task) {
    Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) Missing task: $taskName"
    continue
  }
  if ($task.State -ne 'Running') {
    Start-ScheduledTask -TaskName $taskName
    Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) Restarted task: $taskName (previous state: $($task.State))"
  }
}
