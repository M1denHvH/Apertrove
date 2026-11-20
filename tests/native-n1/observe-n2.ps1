param(
  [Parameter(Mandatory=$true)][ValidateSet('Snapshot','Monitor')][string]$Mode,
  [Parameter(Mandatory=$true)][ValidateSet('Before','During','After','Synthetic')][string]$Phase,
  [Parameter(Mandatory=$true)][string]$RuntimePath,
  [Parameter(Mandatory=$true)][string]$PidsPath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [Parameter(Mandatory=$true)][string]$StopPath,
  [ValidateRange(100,1000)][int]$IntervalMs = 350,
  [ValidateRange(1000,45000)][int]$DurationMs = 30000
)

# Passive observations only. No Canon application, DLL, camera handle or addon is opened.
# Each potentially slow CIM call has a 2s operation timeout. The Node controller also
# bounds this entire process and confirms its exit independently of a kill request.
$ErrorActionPreference = 'Stop'
foreach ($entry in @(@{Name='RuntimePath';Value=$RuntimePath},@{Name='PidsPath';Value=$PidsPath},@{Name='OutputPath';Value=$OutputPath},@{Name='StopPath';Value=$StopPath})) {
  if (-not [IO.Path]::IsPathRooted($entry.Value)) { throw ($entry.Name + '_ABSOLUTE_PATH_REQUIRED') }
}
if (-not [IO.File]::Exists($RuntimePath)) { throw 'RUNTIME_FILE_MISSING' }
if (-not [IO.Directory]::Exists([IO.Path]::GetDirectoryName($OutputPath))) { throw 'OUTPUT_DIRECTORY_MISSING' }
if ([IO.File]::Exists($OutputPath)) { throw 'OBSERVATION_OUTPUT_EXISTS' }

$script:clock=[Diagnostics.Stopwatch]::StartNew()
$script:stream=[IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
$script:writer=New-Object IO.StreamWriter($script:stream,(New-Object Text.UTF8Encoding($false)))
$script:frames=0
$script:limitReached=$false
$script:budgetMs=12000

function Get-Hash([string]$Value) {
  $sha=[Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function Read-PathTrust([string]$Value) {
  $item=Get-Item -LiteralPath $Value
  $acl=Get-Acl -LiteralPath $Value
  $sddl=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
  $ordinary=@('S-1-1-0','S-1-5-11','S-1-5-32-545','S-1-5-32-546','S-1-15-2-1','S-1-15-2-2')
  $trustedWriters=@('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  $writeMask=[int64]([Security.AccessControl.FileSystemRights]::Write) -bor [int64]([Security.AccessControl.FileSystemRights]::Delete) -bor [int64]([Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles) -bor [int64]([Security.AccessControl.FileSystemRights]::ChangePermissions) -bor [int64]([Security.AccessControl.FileSystemRights]::TakeOwnership) -bor 0x40000000 -bor 0x10000000
  $aces=@()
  $untrusted=@()
  foreach ($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    $sid=$ace.IdentityReference.Value
    $inheritOnly=([int]$ace.PropagationFlags -band [int][Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0
    $writeAllowed=($ace.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and -not $inheritOnly -and ([int64]$ace.FileSystemRights -band $writeMask) -ne 0)
    $row=@{sid=$sid;type=[string]$ace.AccessControlType;rights=[string]$ace.FileSystemRights;isInherited=$ace.IsInherited;inheritOnly=$inheritOnly;writeAllowed=$writeAllowed}
    $aces+=$row
    if ($writeAllowed -and $trustedWriters -notcontains $sid) { $untrusted+=$row }
  }
  return @{path=$item.FullName;ownerSid=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;aclSha256=(Get-Hash $sddl);sddl=$sddl;reparsePoint=([int]$item.Attributes -band [int][IO.FileAttributes]::ReparsePoint) -ne 0;ordinaryUserWriteAllowed=(@($aces | Where-Object { $ordinary -contains $_.sid -and $_.writeAllowed }).Count -gt 0);untrustedWriteAllowed=($untrusted.Count -gt 0);aces=$aces}
}
function Read-RuntimeTrust {
  $entries=@()
  $issues=@()
  $pathEntry=$RuntimePath
  while ($pathEntry) {
    if ($pathEntry -eq [IO.Path]::GetPathRoot($pathEntry)) { break }
    $entry=Read-PathTrust $pathEntry
    $entries+=$entry
    if ($entry.reparsePoint) { $issues+=('REPARSE_POINT:'+ $entry.path) }
    if ($entry.ordinaryUserWriteAllowed -or $entry.untrustedWriteAllowed) { $issues+=('UNTRUSTED_WRITE_ACE:'+ $entry.path) }
    $parent=[IO.Path]::GetDirectoryName($pathEntry)
    if ($parent -eq $pathEntry) { break }
    $pathEntry=$parent
  }
  $sig=Get-AuthenticodeSignature -LiteralPath $RuntimePath
  $signature=@{status=[string]$sig.Status;signer=if($sig.SignerCertificate){$sig.SignerCertificate.Subject}else{$null};thumbprint=if($sig.SignerCertificate){$sig.SignerCertificate.Thumbprint}else{$null}}
  if ($sig.Status -ne 'Valid' -or $signature.signer -notmatch '(?:^|,\s*)O=Canon Inc\.?(?:,|$)') { $issues+='RUNTIME_CANON_SIGNATURE_NOT_VALID' }
  return @{status=if($issues.Count -eq 0){'REVIEWED_PROTECTED'}else{'UNTRUSTED_OR_UNCONFIRMED'};signature=$signature;paths=$entries;issues=$issues;limitations='DACL evidence rejects observed write grants to non-administrative identities. It is not an AuthZ effective-access proof, does not prevent privileged administrators replacing files, and does not eliminate hash-to-load TOCTOU.'}
}
function Read-TargetPids {
  if (-not [IO.File]::Exists($PidsPath)) { return @() }
  if ((Get-Item -LiteralPath $PidsPath).Length -gt 65536) { throw 'PID_FILE_SIZE_LIMIT' }
  $parsed=Get-Content -Raw -LiteralPath $PidsPath | ConvertFrom-Json
  $values=@($parsed.pids)
  if ($values.Count -gt 32) { throw 'PID_COUNT_LIMIT' }
  $ids=@()
  foreach ($value in $values) {
    if ($value -isnot [ValueType] -or [long]$value -ne [double]$value -or [long]$value -lt 1 -or [long]$value -gt [int]::MaxValue) { throw 'PID_VALUE_INVALID' }
    $ids += [int]$value
  }
  return @($ids | Select-Object -Unique)
}
function Read-Targets {
  $targets=@()
  foreach ($pidValue in (Read-TargetPids)) {
    try {
      $process=Get-Process -Id $pidValue -ErrorAction Stop
      try {
        $entry=@{pid=[int]$pidValue;status='VISIBLE';name=$process.ProcessName;startTimeUtc=$process.StartTime.ToUniversalTime().ToString('o');handleCount=$process.HandleCount;threadCount=$process.Threads.Count;moduleStatus='READ';modules=@();moduleLimit=256;modulesTruncated=$false}
        try {
          $all=@($process.Modules)
          $entry.modules=@($all | Select-Object -First 256 | ForEach-Object {@{name=$_.ModuleName;path=$_.FileName}})
          $entry.modulesTruncated=($all.Count -gt 256)
        } catch { $entry.moduleStatus='ACCESS_OR_QUERY_FAILED';$entry.moduleError=$_.Exception.GetType().Name }
        $targets += $entry
      } finally { $process.Dispose() }
    } catch { $targets += @{pid=[int]$pidValue;status='NOT_RUNNING_OR_NOT_VISIBLE';error=$_.Exception.GetType().Name} }
  }
  return @($targets)
}
function Budget-Allows([string]$Name,$Errors) {
  if ($script:clock.ElapsedMilliseconds -lt $script:budgetMs) { return $true }
  $Errors.Add($Name+':SKIPPED_BUDGET')
  return $false
}
function Get-FullSnapshot {
  $errors=New-Object System.Collections.Generic.List[string]
  $runtime=$null
  try {
    $item=Get-Item -LiteralPath $RuntimePath
    $runtime=@{path=$item.FullName;sizeBytes=$item.Length;fileVersion=$item.VersionInfo.FileVersion;productVersion=$item.VersionInfo.ProductVersion;sha256=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
  } catch { $errors.Add('runtime:'+$_.Exception.GetType().Name) }
  $runtimeTrust=$null
  try { $runtimeTrust=Read-RuntimeTrust }
  catch { $errors.Add('runtimeTrust:'+$_.Exception.GetType().Name);$runtimeTrust=@{status='QUERY_FAILED';issues=@($_.Exception.GetType().Name)} }
  $targetProcesses=@()
  try { $targetProcesses=@(Read-Targets) } catch { $errors.Add('targets:'+$_.Exception.Message) }
  $os=$null
  if (Budget-Allows 'os' $errors) {
    try {
      $w=Get-CimInstance -ClassName Win32_OperatingSystem -OperationTimeoutSec 2
      $os=@{caption=$w.Caption;version=$w.Version;build=$w.BuildNumber;architecture=$w.OSArchitecture;observerProcessArchitecture=$env:PROCESSOR_ARCHITECTURE}
    } catch { $errors.Add('os:'+$_.Exception.GetType().Name) }
  }
  $canon=@{status='NOT_SAMPLED';items=@();limit=128;truncated=$false}
  if (Budget-Allows 'canonProcesses' $errors) {
    try {
      $filter="Name LIKE 'Canon%' OR Name LIKE 'EOS%' OR Name LIKE 'PSE%' OR Name = 'EULauncher.exe' OR Name = 'EWCService.exe' OR Name = 'EWCProxy.exe'"
      $all=@(Get-CimInstance -ClassName Win32_Process -Filter $filter -OperationTimeoutSec 2)
      $items=@($all | Select-Object -First 128 | ForEach-Object {@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;name=$_.Name;path=$_.ExecutablePath;creationUtc=if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{$null}}})
      $canon=@{status='SNAPSHOT';items=$items;limit=128;truncated=($all.Count -gt 128)}
    } catch { $canon.status='QUERY_FAILED';$errors.Add('canonProcesses:'+$_.Exception.GetType().Name) }
  }
  $services=@{status='NOT_SAMPLED';items=@();limit=128;truncated=$false}
  if (Budget-Allows 'services' $errors) {
    try {
      $filter="Name LIKE 'Canon%' OR Name LIKE 'EOS%' OR Name LIKE 'EWC%' OR DisplayName LIKE '%Canon%' OR DisplayName LIKE '%EOS Utility%' OR DisplayName LIKE '%EOS Webcam%' OR DisplayName LIKE '%Picture Style%'"
      $all=@(Get-CimInstance -ClassName Win32_Service -Filter $filter -OperationTimeoutSec 2)
      $items=@($all | Select-Object -First 128 | ForEach-Object {@{name=$_.Name;displayName=$_.DisplayName;state=$_.State;startMode=$_.StartMode;processId=[int]$_.ProcessId}})
      $services=@{status='SNAPSHOT';items=$items;limit=128;truncated=($all.Count -gt 128)}
    } catch { $services.status='QUERY_FAILED';$errors.Add('services:'+$_.Exception.GetType().Name) }
  }
  $devices=@{status='NOT_SAMPLED';items=@();limit=128;truncated=$false}
  if (Budget-Allows 'cameraDevices' $errors) {
    try {
      $filter="(PNPClass = 'Camera' OR PNPClass = 'Image' OR Name LIKE '%Canon%' OR Name LIKE '%EOS%') AND Present = TRUE"
      $all=@(Get-CimInstance -ClassName Win32_PnPEntity -Filter $filter -OperationTimeoutSec 2)
      $items=@($all | Select-Object -First 128 | ForEach-Object {@{class=$_.PNPClass;status=$_.Status;friendlyName=$_.Name;instanceIdSha256=(Get-Hash ([string]$_.PNPDeviceID))}})
      $devices=@{status='PASSIVE_PNP_SNAPSHOT';items=$items;limit=128;truncated=($all.Count -gt 128)}
    } catch { $devices.status='QUERY_FAILED';$errors.Add('cameraDevices:'+$_.Exception.GetType().Name) }
  }
  $tcp=@{status='NO_TARGET_PIDS';items=@();limit=256;truncated=$false}
  $udp=@{status='NO_TARGET_PIDS';items=@();limit=256;truncated=$false}
  $targetIds=@()
  try { $targetIds=@(Read-TargetPids) } catch { $errors.Add('networkTargets:'+$_.Exception.Message) }
  if ($targetIds.Count -gt 0) {
    $filter=($targetIds | ForEach-Object { 'OwningProcess = '+$_ }) -join ' OR '
    if (Budget-Allows 'tcp' $errors) {
      try {
        $all=@(Get-CimInstance -Namespace root/StandardCimv2 -ClassName MSFT_NetTCPConnection -Filter $filter -OperationTimeoutSec 2)
        $items=@($all | Select-Object -First 256 | ForEach-Object {@{pid=[int]$_.OwningProcess;state=[int]$_.State;localPort=[int]$_.LocalPort;remotePort=[int]$_.RemotePort;remoteAddressSha256=(Get-Hash ([string]$_.RemoteAddress))}})
        $tcp=@{status='ENDPOINT_SNAPSHOT';items=$items;limit=256;truncated=($all.Count -gt 256)}
      } catch { $tcp.status='QUERY_FAILED';$errors.Add('tcp:'+$_.Exception.GetType().Name) }
    }
    if (Budget-Allows 'udp' $errors) {
      try {
        $all=@(Get-CimInstance -Namespace root/StandardCimv2 -ClassName MSFT_NetUDPEndpoint -Filter $filter -OperationTimeoutSec 2)
        $items=@($all | Select-Object -First 256 | ForEach-Object {@{pid=[int]$_.OwningProcess;localPort=[int]$_.LocalPort}})
        $udp=@{status='ENDPOINT_SNAPSHOT';items=$items;limit=256;truncated=($all.Count -gt 256)}
      } catch { $udp.status='QUERY_FAILED';$errors.Add('udp:'+$_.Exception.GetType().Name) }
    }
  }
  return @{os=$os;runtime=$runtime;runtimeTrust=$runtimeTrust;canonProcesses=$canon;targetProcesses=$targetProcesses;services=$services;network=@{tcp=$tcp;udp=$udp};cameraDevices=$devices;sectionErrors=@($errors.ToArray())}
}
function Write-Record($Snapshot,[string]$Label) {
  if ($script:frames -ge 128 -or $script:stream.Position -ge 8MB) { $script:limitReached=$true;return $false }
  $script:frames++
  $Snapshot.schema=1
  $Snapshot.atUtc=[DateTime]::UtcNow.ToString('o')
  $Snapshot.phase=$Label
  $Snapshot.sequence=$script:frames
  $Snapshot.elapsedMs=$script:clock.ElapsedMilliseconds
  $Snapshot.observerPid=$PID
  $json=$Snapshot | ConvertTo-Json -Depth 12 -Compress
  if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 1MB) { throw 'OBSERVATION_RECORD_LIMIT' }
  $script:writer.WriteLine($json)
  $script:writer.Flush()
  return $true
}

try {
  if ($Mode -eq 'Snapshot') {
    $snapshot=Get-FullSnapshot
    $null=Write-Record $snapshot $Phase
    [Console]::Out.WriteLine((@{ready=$true;phase=$Phase;output=$OutputPath;sectionErrors=$snapshot.sectionErrors;elapsedMs=$script:clock.ElapsedMilliseconds} | ConvertTo-Json -Compress))
    exit 0
  }
  # Fast monitor samples only the explicit PID file. Expensive machine-wide CIM,
  # passive device and network tables are collected separately before/after.
  $sequence=0
  do {
    $errors=@()
    $targets=@()
    try { $targets=@(Read-Targets) } catch { $errors+=('targets:'+$_.Exception.Message) }
    $null=Write-Record @{targetProcesses=$targets;sectionErrors=$errors} $Phase
    $sequence++
    if ($sequence -eq 1) {
      [Console]::Out.WriteLine((@{ready=$true;phase=$Phase;output=$OutputPath;observerPid=$PID} | ConvertTo-Json -Compress))
      [Console]::Out.Flush()
    }
    if ([IO.File]::Exists($StopPath) -or $script:limitReached) { break }
    Start-Sleep -Milliseconds $IntervalMs
  } while ($script:clock.ElapsedMilliseconds -lt $DurationMs)
  [Console]::Out.WriteLine((@{ready=$true;phase=$Phase;sequence=$sequence;stopped=[IO.File]::Exists($StopPath);limitReached=$script:limitReached;output=$OutputPath} | ConvertTo-Json -Compress))
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 2
} finally {
  if ($script:writer) { $script:writer.Dispose() }
}
