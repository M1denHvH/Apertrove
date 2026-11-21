param(
  [Parameter(Mandatory=$true)][string]$LogPath,
  [ValidateRange(10000,60000)][int]$MaxLifetimeMs = 45000,
  [switch]$TestOnly
)

$ErrorActionPreference = 'Stop'
$script:job = [IntPtr]::Zero
$script:rootProcess = [IntPtr]::Zero
$script:rootProcessId = 0
$script:rootAssignmentAttempted = $false
$script:writer = $null
$script:handoff = $false
$script:exitCode = 0
$script:runId = [Guid]::NewGuid().ToString('N')
$script:startedUtc = [DateTime]::UtcNow
$script:clock = [Diagnostics.Stopwatch]::StartNew()
$script:simulateQueryFailure = $false
$script:controlOutputClosed = $false

$nativeSource = @'
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
namespace Apertrove.N2Admission {
  public static class ControlInput {
    static readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
    static volatile bool ended;
    static string error;
    static Thread reader;
    public static bool Ended { get { return ended; } }
    public static string Error { get { return error; } }
    public static void Start() {
      if (reader != null) throw new InvalidOperationException("CONTROL_READER_ALREADY_STARTED");
      reader = new Thread(delegate() {
        try {
          string line;
          while ((line = Console.ReadLine()) != null) {
            if (line.Length > 65536 || Lines.Count >= 128)
              throw new InvalidOperationException("CONTROL_INPUT_LIMIT");
            Lines.Enqueue(line);
          }
        } catch (Exception ex) { error = ex.Message; }
        finally { ended = true; }
      });
      reader.IsBackground = true;
      reader.Name = "N2 bounded supervisor control reader";
      reader.Start();
    }
    public static bool TryRead(out string line) { return Lines.TryDequeue(out line); }
  }

  public static class JobApi {
    public static long FileTimeMillis(long fileTime) { return fileTime / 10000; }
    const uint PROCESS_TERMINATE = 0x0001;
    const uint PROCESS_SET_QUOTA = 0x0100;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const uint SYNCHRONIZE = 0x00100000;
    const uint WAIT_OBJECT_0 = 0;
    const uint WAIT_TIMEOUT = 258;
    const int JobObjectBasicAccountingInformation = 1;
    const int JobObjectBasicProcessIdList = 3;
    const int JobObjectExtendedLimitInformation = 9;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

    [StructLayout(LayoutKind.Sequential)]
    public struct BasicLimitInformation {
      public long PerProcessUserTimeLimit;
      public long PerJobUserTimeLimit;
      public uint LimitFlags;
      public UIntPtr MinimumWorkingSetSize;
      public UIntPtr MaximumWorkingSetSize;
      public uint ActiveProcessLimit;
      public UIntPtr Affinity;
      public uint PriorityClass;
      public uint SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct IoCounters {
      public ulong ReadOperationCount;
      public ulong WriteOperationCount;
      public ulong OtherOperationCount;
      public ulong ReadTransferCount;
      public ulong WriteTransferCount;
      public ulong OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct ExtendedLimitInformation {
      public BasicLimitInformation BasicLimitInformation;
      public IoCounters IoInfo;
      public UIntPtr ProcessMemoryLimit;
      public UIntPtr JobMemoryLimit;
      public UIntPtr PeakProcessMemoryUsed;
      public UIntPtr PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct BasicAccountingInformation {
      public long TotalUserTime;
      public long TotalKernelTime;
      public long ThisPeriodUserTime;
      public long ThisPeriodKernelTime;
      public uint TotalPageFaultCount;
      public uint TotalProcesses;
      public uint ActiveProcesses;
      public uint TotalTerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct FileTime { public uint Low; public uint High; }

    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateJobObjectW(IntPtr securityAttributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length, out uint returnLength);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref uint length);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetProcessTimes(IntPtr process, out FileTime created, out FileTime exited, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool FreeConsole();

    public static bool DetachConsole(out int error) {
      bool ok = FreeConsole();
      error = ok ? 0 : Marshal.GetLastWin32Error();
      // ERROR_INVALID_HANDLE means there was no console attached.
      return ok || error == 6;
    }

    public static IntPtr CreateKillOnCloseJob(out int error) {
      IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
      if (job == IntPtr.Zero) { error = Marshal.GetLastWin32Error(); return IntPtr.Zero; }
      ExtendedLimitInformation limits = new ExtendedLimitInformation();
      limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      int size = Marshal.SizeOf(typeof(ExtendedLimitInformation));
      IntPtr buffer = Marshal.AllocHGlobal(size);
      try {
        Marshal.StructureToPtr(limits, buffer, false);
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)size)) {
          error = Marshal.GetLastWin32Error(); CloseHandle(job); return IntPtr.Zero;
        }
      } finally { Marshal.FreeHGlobal(buffer); }
      error = 0; return job;
    }

    public static bool Assign(IntPtr job, uint pid, string expectedImage, long expectedCreatedMillis, out IntPtr retainedProcess, out int error) {
      retainedProcess = IntPtr.Zero;
      IntPtr process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE |
          PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, false, pid);
      if (process == IntPtr.Zero) { error = Marshal.GetLastWin32Error(); return false; }
      try {
        StringBuilder image = new StringBuilder(32768);
        uint length = (uint)image.Capacity;
        if (!QueryFullProcessImageNameW(process, 0, image, ref length)) {
          error = Marshal.GetLastWin32Error(); CloseHandle(process); return false;
        }
        FileTime created, exited, kernel, user;
        if (!GetProcessTimes(process, out created, out exited, out kernel, out user)) {
          error = Marshal.GetLastWin32Error(); CloseHandle(process); return false;
        }
        long actualCreatedMillis = (long)(((ulong)created.High << 32) | created.Low) / 10000;
        if (!String.Equals(Path.GetFullPath(image.ToString()), Path.GetFullPath(expectedImage), StringComparison.OrdinalIgnoreCase) ||
            actualCreatedMillis != expectedCreatedMillis) {
          error = 1168; CloseHandle(process); return false;
        }
      } catch {
        CloseHandle(process); throw;
      }
      bool ok = AssignProcessToJobObject(job, process);
      if (!ok) { error = Marshal.GetLastWin32Error(); CloseHandle(process); return false; }
      retainedProcess = process;
      error = 0; return true;
    }

    public static bool TerminateRoot(IntPtr process, uint exitCode, out int error) {
      if (process == IntPtr.Zero) { error = 6; return false; }
      bool ok = TerminateProcess(process, exitCode);
      error = ok ? 0 : Marshal.GetLastWin32Error(); return ok;
    }

    public static bool RootState(IntPtr process, out bool signaled, out uint exitCode, out int error) {
      signaled = false; exitCode = 259;
      if (process == IntPtr.Zero) { error = 6; return false; }
      uint wait = WaitForSingleObject(process, 0);
      if (wait == WAIT_TIMEOUT) { error = 0; return true; }
      if (wait != WAIT_OBJECT_0) { error = Marshal.GetLastWin32Error(); return false; }
      signaled = true;
      if (!GetExitCodeProcess(process, out exitCode)) {
        error = Marshal.GetLastWin32Error(); return false;
      }
      error = 0; return true;
    }

    public static bool TerminateTree(IntPtr job, uint exitCode, out int error) {
      bool ok = TerminateJobObject(job, exitCode);
      error = ok ? 0 : Marshal.GetLastWin32Error(); return ok;
    }

    public static BasicAccountingInformation Accounting(IntPtr job, out int error) {
      IntPtr buffer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(BasicAccountingInformation)));
      try {
        uint returned;
        if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, buffer,
            (uint)Marshal.SizeOf(typeof(BasicAccountingInformation)), out returned)) {
          error = Marshal.GetLastWin32Error(); return new BasicAccountingInformation();
        }
        error = 0; return (BasicAccountingInformation)Marshal.PtrToStructure(buffer, typeof(BasicAccountingInformation));
      } finally { Marshal.FreeHGlobal(buffer); }
    }

    public static uint[] ProcessIds(IntPtr job, out uint assigned, out int error) {
      int ptrSize = IntPtr.Size;
      for (int capacity = 32; capacity <= 4096; capacity *= 2) {
        int headerSize = 8; // ULONG AssignedProcesses; ULONG ListLength.
        int size = checked(headerSize + ptrSize * capacity);
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
          uint returned;
          if (!QueryInformationJobObject(job, JobObjectBasicProcessIdList, buffer, (uint)size, out returned)) {
            error = Marshal.GetLastWin32Error(); assigned = 0; return new uint[0];
          }
          uint total = unchecked((uint)Marshal.ReadInt32(buffer));
          uint listed = unchecked((uint)Marshal.ReadInt32(buffer, 4));
          assigned = total;
          if (listed > capacity || listed < total) continue;
          uint[] ids = new uint[(int)listed];
          for (int i = 0; i < ids.Length; i++) {
            long value = Marshal.ReadIntPtr(buffer, headerSize + ptrSize * i).ToInt64();
            ids[i] = unchecked((uint)value);
          }
          error = 0; return ids;
        } finally { Marshal.FreeHGlobal(buffer); }
      }
      error = 122; assigned = 0; return new uint[0];
    }
  }
}
'@

function Write-Event([hashtable]$Event, [switch]$Response) {
  $Event.runId = $script:runId
  $Event.atUtc = [DateTime]::UtcNow.ToString('o')
  $line = $Event | ConvertTo-Json -Depth 12 -Compress
  if ($script:writer) { $script:writer.WriteLine($line); $script:writer.Flush() }
  if (-not $script:handoff -and -not $script:controlOutputClosed) {
    try { [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
    catch { $script:controlOutputClosed = $true }
  }
}

function Get-JobState {
  $accountError = 0
  $account = [Apertrove.N2Admission.JobApi]::Accounting($script:job, [ref]$accountError)
  $assigned = 0
  $pidError = 0
  $ids = [Apertrove.N2Admission.JobApi]::ProcessIds($script:job, [ref]$assigned, [ref]$pidError)
  $rootSignaled = $false
  $rootExitCode = [uint32]259
  $rootError = 0
  $rootAssigned = $script:rootProcess -ne [IntPtr]::Zero
  $rootSucceeded = $true
  if ($rootAssigned) {
    $rootSucceeded = [Apertrove.N2Admission.JobApi]::RootState($script:rootProcess, [ref]$rootSignaled, [ref]$rootExitCode, [ref]$rootError)
  }
  $succeeded = ($accountError -eq 0 -and $pidError -eq 0 -and $rootSucceeded)
  if ($script:simulateQueryFailure) { $succeeded = $false; $pidError = 995 }
  return @{
    querySucceeded = $succeeded
    activeProcesses = [int]$account.ActiveProcesses
    totalProcesses = [int]$account.TotalProcesses
    totalTerminatedProcesses = [int]$account.TotalTerminatedProcesses
    assignedProcessCount = [int]$assigned
    processIds = @($ids | ForEach-Object { [int]$_ })
    accountingError = $accountError
    processListError = $pidError
    rootAssigned = $rootAssigned
    rootProcessId = $script:rootProcessId
    rootQuerySucceeded = $rootSucceeded
    rootSignaled = if ($rootAssigned) { $rootSignaled } else { $null }
    rootExitCode = if ($rootAssigned -and $rootSignaled -and $rootSucceeded) { [long]$rootExitCode } else { $null }
    rootQueryError = $rootError
  }
}

function Complete-Job([string]$Reason, [int]$GraceMs = 2000) {
  $initial = $null
  $state = $null
  $treeTerminationRequested = $false
  $confirmed = $false
  $closeAccepted = $false
  try {
    $initial = Get-JobState
    if (-not $initial.querySucceeded -or $initial.activeProcesses -gt 0 -or ($initial.rootAssigned -and -not $initial.rootSignaled)) {
      $errorCode = 0
      $treeTerminationRequested = [Apertrove.N2Admission.JobApi]::TerminateTree($script:job, 570425345, [ref]$errorCode)
      Write-Event @{ kind='termination'; reason=$Reason; method='TerminateJobObject'; requestAccepted=$treeTerminationRequested; errorCode=$errorCode; initialState=$initial }
    }
    $deadlineMs = $script:clock.ElapsedMilliseconds + [Math]::Max(0, [Math]::Min(2000, $GraceMs))
    $state = Get-JobState
    while ($script:clock.ElapsedMilliseconds -lt $deadlineMs) {
      $confirmed = $state.querySucceeded -and $state.activeProcesses -eq 0 -and (-not $state.rootAssigned -or $state.rootSignaled)
      if ($confirmed) { break }
      Start-Sleep -Milliseconds 50
      $state = Get-JobState
    }
    $confirmed = $state.querySucceeded -and $state.activeProcesses -eq 0 -and (-not $state.rootAssigned -or $state.rootSignaled)
  } finally {
    if ($script:job -ne [IntPtr]::Zero) {
      $closeAccepted = [Apertrove.N2Admission.JobApi]::CloseHandle($script:job)
      if ($closeAccepted) { $script:job = [IntPtr]::Zero }
    }
  }
  if (-not $closeAccepted) { $confirmed = $false }
  $disposition = if ($confirmed) { 'PROCESS_TREE_EXIT_CONFIRMED' } else { 'UNKNOWN_KILL_ON_JOB_CLOSE_REQUESTED' }
  Write-Event @{ kind='final'; reason=$Reason; disposition=$disposition; processTreeExitConfirmed=$confirmed; terminationRequested=$treeTerminationRequested; jobHandleClosed=$closeAccepted; finalState=$state; note='Closing the last kill-on-close Job Object handle requests OS termination; it is not, by itself, proof that every process exited.' }
  if (-not $confirmed) { $script:exitCode = 3 }
  return @{ disposition=$disposition; processTreeExitConfirmed=$confirmed; terminationRequested=$treeTerminationRequested; jobHandleClosed=$closeAccepted; finalState=$state }
}

try {
  if (-not [IO.Path]::IsPathRooted($LogPath)) { throw 'ABSOLUTE_LOG_PATH_REQUIRED' }
  $logDirectory = [IO.Path]::GetDirectoryName($LogPath)
  if (-not [IO.Directory]::Exists($logDirectory)) { throw 'LOG_DIRECTORY_MISSING' }
  $stream = [IO.File]::Open($LogPath, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
  $script:writer = New-Object IO.StreamWriter($stream, (New-Object Text.UTF8Encoding($false)))
  Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop
  $errorCode = 0
  $consoleError = 0
  $consoleDetached = [Apertrove.N2Admission.JobApi]::DetachConsole([ref]$consoleError)
  if (-not $consoleDetached) { throw "SUPERVISOR_CONSOLE_DETACH_FAILED:$consoleError" }
  $script:job = [Apertrove.N2Admission.JobApi]::CreateKillOnCloseJob([ref]$errorCode)
  if ($script:job -eq [IntPtr]::Zero) { throw "JOB_CREATE_OR_CONFIGURATION_FAILED:$errorCode" }
  Write-Event @{ kind='ready'; status='READY'; supervisorPid=$PID; supervisorProcessId=$PID; jobPolicy='JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE'; maxLifetimeMs=$MaxLifetimeMs; inheritedConsoleDetached=$consoleDetached; consoleDetachError=$consoleError }
  $jobDeadlineMs = [long]$MaxLifetimeMs
  $handoffDeadlineMs = $null
  [Apertrove.N2Admission.ControlInput]::Start()
  while ($true) {
    $elapsedMs = $script:clock.ElapsedMilliseconds
    if ($elapsedMs -ge $jobDeadlineMs) {
      $null = Complete-Job 'SUPERVISOR_HARD_DEADLINE'
      break
    }
    if ($script:controlOutputClosed) {
      $null = Complete-Job 'CONTROL_OUTPUT_CLOSED'
      break
    }
    if ($script:handoff -and $null -ne $handoffDeadlineMs -and $elapsedMs -ge $handoffDeadlineMs) {
      $null = Complete-Job 'BOUNDED_HANDOFF_DEADLINE'
      break
    }
    if ($script:handoff) {
      $state = Get-JobState
      Write-Event @{ kind='monitor'; state=$state } -Response:$false
      if ($state.querySucceeded -and $state.activeProcesses -eq 0 -and (-not $state.rootAssigned -or $state.rootSignaled)) {
        $null = Complete-Job 'HANDED_OFF_TREE_EXIT_CONFIRMED'
        break
      }
      Start-Sleep -Milliseconds 200
      continue
    }
    $line = $null
    if ([Apertrove.N2Admission.ControlInput]::TryRead([ref]$line)) {
      try { $request = $line | ConvertFrom-Json -ErrorAction Stop }
      catch { Write-Event @{ kind='response'; id=$null; ok=$false; error='INVALID_CONTROL_MESSAGE' } -Response; continue }
      $id = $request.id
      switch ($request.command) {
        'status' {
          Write-Event @{ kind='response'; id=$id; ok=$true; state=(Get-JobState) } -Response
        }
        'assign' {
          $pidValue = 0
          try { $pidValue = [int]$request.pid } catch {}
          if ($script:rootAssignmentAttempted) {
            Write-Event @{ kind='response'; id=$id; ok=$false; error='ROOT_ASSIGNMENT_ALREADY_ATTEMPTED'; state=(Get-JobState) } -Response
          } elseif ($pidValue -le 0) {
            Write-Event @{ kind='response'; id=$id; ok=$false; error='INVALID_PROCESS_ID' } -Response
          } else {
            $script:rootAssignmentAttempted = $true
            try {
              $expectedImage = [string]$request.imagePath
              $expectedParentPid = [int]$request.expectedParentPid
              $marker = [string]$request.commandMarker
              if (-not [IO.Path]::IsPathRooted($expectedImage) -or $expectedParentPid -le 0 -or $marker -notmatch '^[a-fA-F0-9-]{32,48}$') { throw 'ROOT_IDENTITY_EXPECTATIONS_REQUIRED' }
              $instances = @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$pidValue" -OperationTimeoutSec 1 -ErrorAction Stop)
              if ($instances.Count -ne 1) { throw 'ROOT_IDENTITY_PROCESS_ABSENT' }
              $instance = $instances[0]
              if ([int]$instance.ParentProcessId -ne $expectedParentPid -or -not ([string]$instance.CommandLine).Contains($marker) -or -not $instance.CreationDate) { throw 'ROOT_IDENTITY_COMMAND_OR_PARENT_MISMATCH' }
              $created = ([DateTime]$instance.CreationDate).ToUniversalTime()
              $expectedCreatedMillis = [Apertrove.N2Admission.JobApi]::FileTimeMillis($created.ToFileTimeUtc())
              $errorCode = 0
              $retainedProcess = [IntPtr]::Zero
              $ok = [Apertrove.N2Admission.JobApi]::Assign($script:job, [uint32]$pidValue, $expectedImage, $expectedCreatedMillis, [ref]$retainedProcess, [ref]$errorCode)
              if ($ok) { $script:rootProcess = $retainedProcess; $script:rootProcessId = $pidValue }
              $state = Get-JobState
              Write-Event @{ kind='response'; id=$id; ok=$ok; command='assign'; pid=$pidValue; errorCode=$errorCode; state=$state; identity=@{ image=$expectedImage; parentProcessId=$expectedParentPid; creationFileTimeMilliseconds=$expectedCreatedMillis; commandMarkerMatched=$true } } -Response
            } catch {
              Write-Event @{ kind='response'; id=$id; ok=$false; command='assign'; pid=$pidValue; error='ROOT_IDENTITY_VALIDATION_FAILED'; detail=$_.Exception.Message; state=(Get-JobState) } -Response
            }
          }
        }
        'terminateProcess' {
          $pidValue = 0
          try { $pidValue = [int]$request.pid } catch {}
          $errorCode = 0
          if ($script:rootProcess -eq [IntPtr]::Zero -or $pidValue -ne $script:rootProcessId) {
            Write-Event @{ kind='response'; id=$id; ok=$false; command='terminateProcess'; pid=$pidValue; requestAccepted=$false; error='EXACT_ASSIGNED_ROOT_REQUIRED'; state=(Get-JobState) } -Response
          } else {
            $ok = [Apertrove.N2Admission.JobApi]::TerminateRoot($script:rootProcess, 570425346, [ref]$errorCode)
            Write-Event @{ kind='response'; id=$id; ok=$ok; command='terminateProcess'; pid=$script:rootProcessId; requestAccepted=$ok; errorCode=$errorCode; state=(Get-JobState) } -Response
          }
        }
        'terminateTree' {
          $errorCode = 0
          $ok = [Apertrove.N2Admission.JobApi]::TerminateTree($script:job, 570425347, [ref]$errorCode)
          Write-Event @{ kind='response'; id=$id; ok=$ok; command='terminateTree'; requestAccepted=$ok; errorCode=$errorCode; state=(Get-JobState) } -Response
        }
        'handoff' {
          $requested = [int]$request.durationMs
          if ($requested -lt 1000 -or $requested -gt 30000) {
            Write-Event @{ kind='response'; id=$id; ok=$false; error='HANDOFF_BOUND_INVALID'; state=(Get-JobState) } -Response
          } else {
            $remaining = [Math]::Max(0, [long]($jobDeadlineMs - $script:clock.ElapsedMilliseconds))
            $duration = [Math]::Min($requested, $remaining)
            $handoffDeadlineMs = $script:clock.ElapsedMilliseconds + $duration
            Write-Event @{ kind='response'; id=$id; ok=$true; command='handoff'; supervisorPid=$PID; durationMs=$duration; finalDeadlineUtc=([DateTime]::UtcNow.AddMilliseconds($duration).ToString('o')); state=(Get-JobState) } -Response
            $script:handoff = $true
          }
        }
        'testFaultQuery' {
          if (-not $TestOnly) {
            Write-Event @{ kind='response'; id=$id; ok=$false; error='TEST_ONLY_COMMAND_DENIED' } -Response
          } else {
            $script:simulateQueryFailure = $true
            Write-Event @{ kind='response'; id=$id; ok=$true; command='testFaultQuery'; state=(Get-JobState) } -Response
          }
        }
        'shutdown' {
          $result = Complete-Job 'CONTROLLED_SHUTDOWN'
          Write-Event @{ kind='response'; id=$id; ok=$result.processTreeExitConfirmed; command='shutdown'; result=$result } -Response
          break
        }
        default {
          Write-Event @{ kind='response'; id=$id; ok=$false; error='UNKNOWN_CONTROL_COMMAND' } -Response
        }
      }
      if ($request.command -eq 'shutdown') { break }
    } else {
      if ([Apertrove.N2Admission.ControlInput]::Ended) {
        $inputError = [Apertrove.N2Admission.ControlInput]::Error
        if ($inputError) { Write-Event @{ kind='controlError'; error=$inputError } }
        $null = Complete-Job 'CONTROL_PIPE_CLOSED'
        break
      }
      Start-Sleep -Milliseconds 25
    }
  }
} catch {
  $script:exitCode = 2
  try { Write-Event @{ kind='fatal'; error=$_.Exception.Message; stack=$_.ScriptStackTrace } } catch {}
  if ($script:job -ne [IntPtr]::Zero) { try { $null = Complete-Job 'SUPERVISOR_FAILURE' } catch {} }
} finally {
  if ($script:job -ne [IntPtr]::Zero) {
    try { $null = Complete-Job 'SUPERVISOR_FINALIZER' } catch {}
    finally {
      if ($script:job -ne [IntPtr]::Zero) {
        try { $null = [Apertrove.N2Admission.JobApi]::CloseHandle($script:job) } catch {}
        $script:job = [IntPtr]::Zero
      }
    }
  }
  if ($script:rootProcess -ne [IntPtr]::Zero) {
    try { $null = [Apertrove.N2Admission.JobApi]::CloseHandle($script:rootProcess) } catch {}
    $script:rootProcess = [IntPtr]::Zero
  }
  if ($script:writer) { $script:writer.Dispose() }
}
exit $script:exitCode
