$ErrorActionPreference = 'Stop'

$secretFile = 'C:\Users\raduj\.betfair-liveedge\secrets.clixml'
$saved = Import-Clixml -LiteralPath $secretFile
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($saved.ControlApiToken)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  Set-Clipboard -Value $token
  Write-Host 'Control token copied. Paste it into LiveEdge Control, click Connect, then return here.'
  Read-Host 'Press Enter after pasting to clear the clipboard' | Out-Null
}
finally {
  Set-Clipboard -Value 'cleared'
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $token = $null
}
