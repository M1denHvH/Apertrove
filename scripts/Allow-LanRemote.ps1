[CmdletBinding(SupportsShouldProcess=$true)]
param(
  [Parameter(Mandatory=$true)][string]$Program,
  [Parameter(Mandatory=$true)][string]$InterfaceAlias,
  [ValidateRange(1024,65535)][int]$Port=8765
)
$ErrorActionPreference='Stop'
$executable=(Resolve-Path -LiteralPath $Program).Path
if ([IO.Path]::GetExtension($executable) -ne '.exe') { throw 'Program must be an existing .exe.' }
$adapter=Get-NetAdapter -Name $InterfaceAlias -Physical -ErrorAction Stop
if ($adapter.Status -ne 'Up') { throw 'Select an active physical LAN/Wi-Fi adapter.' }
$profile=Get-NetConnectionProfile -InterfaceIndex $adapter.ifIndex -ErrorAction Stop
if ($profile.NetworkCategory -ne 'Private') { throw 'The selected network must already be Private. This helper does not change its category.' }
$identity=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $WhatIfPreference -and -not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run PowerShell as Administrator to add the scoped rule.' }
$sha=[Security.Cryptography.SHA256]::Create()
try { $digest=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($executable.ToLowerInvariant()))).Replace('-','').Substring(0,12) } finally { $sha.Dispose() }
$ruleName="Apertrove-LAN-$digest-$Port"
if ($PSCmdlet.ShouldProcess("$executable / $InterfaceAlias / TCP $Port / Private LocalSubnet",'Allow inbound LAN camera remote')) {
  if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) {
    Set-NetFirewallRule -Name $ruleName -Enabled True -Profile Private -Direction Inbound -Action Allow -InterfaceAlias $InterfaceAlias -EdgeTraversalPolicy Block | Out-Null
  } else {
    New-NetFirewallRule -Name $ruleName -DisplayName "Apertrove LAN remote ($Port)" -Direction Inbound -Action Allow -Enabled True -Program $executable -Protocol TCP -LocalPort $Port -Profile Private -InterfaceAlias $InterfaceAlias -RemoteAddress LocalSubnet -EdgeTraversalPolicy Block | Out-Null
  }
  Write-Host "Allowed private local-subnet access for this executable on TCP $Port. Rule: $ruleName"
}
