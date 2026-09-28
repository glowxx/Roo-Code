<#
.SYNOPSIS
    Reproducible, Empirical Desktop Performance Measurement Harness (ZERO ESTIMATIONS).
.DESCRIPTION
    Measures Cold & Warm Startup, Memory Working Set / Private Bytes for complete process trees,
    Installer & Unpacked File Sizes, and IPC Latency/Throughput for Electron and Tauri 2.
.PARAMETER Target
    "All", "Electron", or "Tauri"
.PARAMETER WarmIterations
    Number of warm startup iterations to measure and average (default: 3)
.PARAMETER OutputJson
    Path to save the JSON benchmark results (default: "scratch/empirical_benchmark_results.json")
#>

[CmdletBinding()]
param(
    [ValidateSet("All", "Electron", "Tauri")]
    [string]$Target = "All",

    [int]$WarmIterations = 3,

    [string]$OutputJson = "scratch/empirical_benchmark_results.json"
)

$ErrorActionPreference = "Continue"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   ROO CODE DESKTOP EMPIRICAL BENCHMARK HARNESS (ZERO ESTIMATION)   " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Timestamp   : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "Target      : $Target"
Write-Host "Machine     : $env:COMPUTERNAME ($([System.Environment]::OSVersion.VersionString))"
Write-Host "CPU Cores   : $([System.Environment]::ProcessorCount)"
Write-Host "=================================================================`n"

$repoRoot = (Resolve-Path "$PSScriptRoot/../..").Path

function Kill-ProcessTreeByPid([int]$rootPid) {
    if (-not $rootPid) { return }
    try {
        # Win32 recursive termination
        $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $rootPid" -ErrorAction SilentlyContinue
        foreach ($child in $children) {
            Kill-ProcessTreeByPid $child.ProcessId
        }
        Stop-Process -Id $rootPid -Force -ErrorAction SilentlyContinue
    } catch {}
}

function Ensure-CleanState {
    Get-Process -Name "Roo Code", "roo-desktop", "roo_desktop" -ErrorAction SilentlyContinue | ForEach-Object {
        Kill-ProcessTreeByPid $_.Id
    }
    Start-Sleep -Milliseconds 500
}

function Get-FullProcessTree([int]$rootPid) {
    $allProcs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    if (-not $allProcs) { return @() }

    $visited = New-Object System.Collections.Generic.HashSet[int]
    $queue = New-Object System.Collections.Generic.Queue[int]
    $treePids = New-Object System.Collections.Generic.List[int]

    $queue.Enqueue($rootPid)
    $visited.Add($rootPid) | Out-Null
    $treePids.Add($rootPid) | Out-Null

    while ($queue.Count -gt 0) {
        $curr = $queue.Dequeue()
        $children = $allProcs | Where-Object { $_.ParentProcessId -eq $curr }
        foreach ($ch in $children) {
            if (-not $visited.Contains($ch.ProcessId)) {
                $visited.Add($ch.ProcessId) | Out-Null
                $queue.Enqueue($ch.ProcessId)
                $treePids.Add($ch.ProcessId) | Out-Null
            }
        }
    }

    # Also check for WebView2 children if root is roo-desktop
    $webviewProcs = $allProcs | Where-Object { 
        $_.Name -like "*msedgewebview2*" -and ($_.CommandLine -like "*com.roocode.desktop*" -or $_.CommandLine -like "*apps/desktop*")
    }
    foreach ($wp in $webviewProcs) {
        if (-not $visited.Contains($wp.ProcessId)) {
            $visited.Add($wp.ProcessId) | Out-Null
            $treePids.Add($wp.ProcessId) | Out-Null
        }
    }

    $results = @()
    foreach ($pidNum in $treePids) {
        try {
            $p = Get-Process -Id $pidNum -ErrorAction Stop
            $cim = $allProcs | Where-Object { $_.ProcessId -eq $pidNum } | Select-Object -First 1
            $cmd = if ($cim) { $cim.CommandLine } else { "" }
            
            # Determine process role
            $role = "Other"
            if ($p.ProcessName -like "*roo-desktop*" -or $p.ProcessName -like "*roo_desktop*") {
                $role = "RustShell"
            } elseif ($p.ProcessName -eq "Roo Code") {
                if ($cmd -like "*--type=renderer*") { $role = "ElectronRenderer" }
                elseif ($cmd -like "*--type=gpu-process*") { $role = "ElectronGPU" }
                elseif ($cmd -like "*--type=utility*") { $role = "ElectronUtility" }
                elseif ($cmd -like "*--type=crashpad-handler*") { $role = "Crashpad" }
                else { $role = "ElectronMain" }
            } elseif ($p.ProcessName -like "*msedgewebview2*") {
                if ($cmd -like "*--type=renderer*") { $role = "WebView2Renderer" }
                elseif ($cmd -like "*--type=gpu-process*") { $role = "WebView2GPU" }
                else { $role = "WebView2Browser" }
            } elseif ($p.ProcessName -eq "node") {
                $role = "NodeSidecar"
            }

            $results += [PSCustomObject]@{
                Id            = $p.Id
                ProcessName   = $p.ProcessName
                Role          = $role
                WorkingSetMB  = [math]::Round($p.WorkingSet64 / 1MB, 2)
                PrivateMB     = [math]::Round($p.PrivateMemorySize64 / 1MB, 2)
                CommandLine   = $cmd
            }
        } catch {}
    }

    return $results
}

function Measure-AppExecution([string]$name, [string]$exePath, [string]$healthUrl) {
    Write-Host ">>> Testing [$name] executable at: $exePath" -ForegroundColor Yellow

    if (-not (Test-Path $exePath)) {
        Write-Host "    [!] Binary NOT FOUND on disk ($exePath). ZERO ESTIMATION: Status = NOT_BUILT." -ForegroundColor Red
        return [PSCustomObject]@{
            Name              = $name
            Status            = "NOT_BUILT"
            ExePath           = $exePath
            ColdStartupMs     = $null
            WarmStartupMs     = $null
            WarmRunsMs        = @()
            TotalWorkingSetMB = $null
            TotalPrivateMB    = $null
            ProcessTree       = @()
        }
    }

    # 1. COLD STARTUP
    Ensure-CleanState
    Write-Host "    -> Launching Cold Startup..." -ForegroundColor Gray
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath $exePath -PassThru

    $coldReadyMs = $null
    $readySuccess = $false

    if ($healthUrl) {
        for ($i = 0; $i -lt 150; $i++) {
            Start-Sleep -Milliseconds 100
            try {
                $res = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1 -ErrorAction Stop
                if ($res.status -eq "ok") {
                    $coldReadyMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
                    $readySuccess = $true
                    break
                }
            } catch {}
        }
    } else {
        # Check window handle
        for ($i = 0; $i -lt 150; $i++) {
            Start-Sleep -Milliseconds 100
            $proc.Refresh()
            if ($proc.MainWindowHandle -ne 0) {
                $coldReadyMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
                $readySuccess = $true
                break
            }
        }
    }

    if (-not $readySuccess) {
        Write-Host "    [!] Process started but did NOT respond to readiness probe within 15 seconds." -ForegroundColor Red
        Kill-ProcessTreeByPid $proc.Id
        return [PSCustomObject]@{
            Name              = $name
            Status            = "UNRESPONSIVE_OR_UNWIRED"
            ExePath           = $exePath
            ColdStartupMs     = $null
            WarmStartupMs     = $null
            WarmRunsMs        = @()
            TotalWorkingSetMB = $null
            TotalPrivateMB    = $null
            ProcessTree       = @()
        }
    }

    Write-Host "    [+] Cold Startup Time : $coldReadyMs ms" -ForegroundColor Green

    # Settle for 2.5s to capture baseline idle memory
    Start-Sleep -Milliseconds 2500
    $processTree = Get-FullProcessTree $proc.Id
    $totalWs = [math]::Round(($processTree | Measure-Object -Property WorkingSetMB -Sum).Sum, 2)
    $totalPriv = [math]::Round(($processTree | Measure-Object -Property PrivateMB -Sum).Sum, 2)

    Write-Host "    [+] Working Set (Total) : $totalWs MB across $($processTree.Count) processes" -ForegroundColor Green
    Write-Host "    [+] Private Bytes (Total): $totalPriv MB" -ForegroundColor Green

    foreach ($pt in $processTree) {
        Write-Host ("        - PID {0,5} | {1,-18} | WS: {2,7} MB | Priv: {3,7} MB" -f $pt.Id, $pt.Role, $pt.WorkingSetMB, $pt.PrivateMB) -ForegroundColor DarkGray
    }

    # Clean kill
    Kill-ProcessTreeByPid $proc.Id
    Start-Sleep -Milliseconds 1000

    # 2. WARM STARTUP RUNS
    $warmRuns = @()
    for ($w = 1; $w -le $WarmIterations; $w++) {
        Ensure-CleanState
        $swWarm = [System.Diagnostics.Stopwatch]::StartNew()
        $pWarm = Start-Process -FilePath $exePath -PassThru
        $warmReady = $null

        if ($healthUrl) {
            for ($i = 0; $i -lt 150; $i++) {
                Start-Sleep -Milliseconds 50
                try {
                    $res = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1 -ErrorAction Stop
                    if ($res.status -eq "ok") {
                        $warmReady = [math]::Round($swWarm.Elapsed.TotalMilliseconds, 2)
                        break
                    }
                } catch {}
            }
        } else {
            for ($i = 0; $i -lt 150; $i++) {
                Start-Sleep -Milliseconds 50
                $pWarm.Refresh()
                if ($pWarm.MainWindowHandle -ne 0) {
                    $warmReady = [math]::Round($swWarm.Elapsed.TotalMilliseconds, 2)
                    break
                }
            }
        }

        if ($warmReady) {
            $warmRuns += $warmReady
            Write-Host "    [+] Warm Run #$w : $warmReady ms" -ForegroundColor Green
        } else {
            Write-Host "    [!] Warm Run #$w failed to signal readiness" -ForegroundColor Yellow
        }
        Kill-ProcessTreeByPid $pWarm.Id
        Start-Sleep -Milliseconds 500
    }

    $avgWarm = if ($warmRuns.Count -gt 0) {
        [math]::Round(($warmRuns | Measure-Object -Average).Average, 2)
    } else { $null }

    return [PSCustomObject]@{
        Name              = $name
        Status            = "VERIFIED"
        ExePath           = $exePath
        ColdStartupMs     = $coldReadyMs
        WarmStartupMs     = $avgWarm
        WarmRunsMs        = $warmRuns
        TotalWorkingSetMB = $totalWs
        TotalPrivateMB    = $totalPriv
        ProcessTree       = $processTree
    }
}

function Measure-Storage([string]$name, [string]$installerPath, [string]$unpackedPath) {
    Write-Host ">>> Measuring Storage & Packaging for [$name]..." -ForegroundColor Yellow

    $instObj = $null
    if (Test-Path $installerPath) {
        $file = Get-Item $installerPath
        $instObj = [PSCustomObject]@{
            Status  = "EXISTS"
            Path    = $installerPath
            Bytes   = $file.Length
            SizeMB  = [math]::Round($file.Length / 1MB, 2)
        }
        Write-Host "    [+] Installer Size: $($instObj.SizeMB) MB ($($instObj.Bytes) bytes)" -ForegroundColor Green
    } else {
        $instObj = [PSCustomObject]@{
            Status  = "NOT_BUILT"
            Path    = $installerPath
            Bytes   = $null
            SizeMB  = $null
        }
        Write-Host "    [!] Installer NOT FOUND ($installerPath). Status: NOT_BUILT." -ForegroundColor Red
    }

    $unpackedObj = $null
    if (Test-Path $unpackedPath) {
        $files = Get-ChildItem -Path $unpackedPath -Recurse -File -ErrorAction SilentlyContinue
        $totalBytes = ($files | Measure-Object -Property Length -Sum).Sum
        $unpackedObj = [PSCustomObject]@{
            Status     = "EXISTS"
            Path       = $unpackedPath
            FileCount  = $files.Count
            Bytes      = $totalBytes
            SizeMB     = [math]::Round($totalBytes / 1MB, 2)
        }
        Write-Host "    [+] Unpacked Directory Size: $($unpackedObj.SizeMB) MB ($($unpackedObj.FileCount) files)" -ForegroundColor Green
    } else {
        $unpackedObj = [PSCustomObject]@{
            Status     = "NOT_FOUND"
            Path       = $unpackedPath
            FileCount  = 0
            Bytes      = $null
            SizeMB     = $null
        }
        Write-Host "    [!] Unpacked Directory NOT FOUND ($unpackedPath)." -ForegroundColor Red
    }

    return [PSCustomObject]@{
        Name      = $name
        Installer = $instObj
        Unpacked  = $unpackedObj
    }
}

function Measure-Ipc([string]$name, [string]$transportType, [int]$port = 4500) {
    Write-Host ">>> Running IPC Latency & Throughput Benchmark for [$name]..." -ForegroundColor Yellow
    if ($transportType -eq "WebSocket") {
        $scriptPath = "$PSScriptRoot/bench-ipc.mjs"
        if (-not (Test-Path $scriptPath)) {
            return [PSCustomObject]@{ Status = "SCRIPT_NOT_FOUND" }
        }

        # Run bench-ipc.mjs via node
        try {
            $rawOutput = node $scriptPath
            $json = $rawOutput | ConvertFrom-Json
            if ($json.status -eq "SUCCESS") {
                Write-Host "    [+] IPC Small RPC Median : $($json.latencyMs.median) ms (P95: $($json.latencyMs.p95) ms)" -ForegroundColor Green
                Write-Host "    [+] Streaming 64KB       : $($json.streamingThroughput.'64KB'.throughputMBps) MB/s" -ForegroundColor Green
                Write-Host "    [+] Streaming 1MB        : $($json.streamingThroughput.'1024KB'.throughputMBps) MB/s" -ForegroundColor Green
                return $json
            } else {
                Write-Host "    [!] IPC Benchmark returned: $($json.status) ($($json.reason))" -ForegroundColor Yellow
                return $json
            }
        } catch {
            Write-Host "    [!] Failed to execute IPC benchmark: $_" -ForegroundColor Red
            return [PSCustomObject]@{ Status = "ERROR"; Error = "$_" }
        }
    } else {
        Write-Host "    [!] Tauri IPC transport (Named Pipe / Invoke) is NOT WIRED to Node. ZERO ESTIMATION: Status = NOT_WIRED." -ForegroundColor Red
        return [PSCustomObject]@{
            Status     = "NOT_WIRED_TO_NODE"
            Reason     = "Rust Shell does not supervise Node engine or expose Named Pipe / IPC Channel yet."
            LatencyMs  = $null
            Throughput = $null
        }
    }
}

# =================================================================
# EXECUTE MEASUREMENT SUITE
# =================================================================

$benchmarkData = [ordered]@{
    Metadata = [ordered]@{
        Timestamp    = (Get-Date).ToString("o")
        Platform     = "Windows"
        MachineName  = $env:COMPUTERNAME
        CpuCores     = [System.Environment]::ProcessorCount
        ZeroEstimate = $true
    }
    Electron = [ordered]@{}
    Tauri    = [ordered]@{}
}

# 1. ELECTRON BENCHMARK
if ($Target -eq "All" -or $Target -eq "Electron") {
    Write-Host "`n=================== [1] ELECTRON BENCHMARK ===================" -ForegroundColor Magenta
    $electronExe = "$repoRoot/apps/desktop/release/win-unpacked/Roo Code.exe"
    $electronHealth = "http://127.0.0.1:4500/api/health"
    $electronInstaller = "$repoRoot/apps/desktop/release/Roo Code Setup 1.0.0.exe"
    $electronUnpacked = "$repoRoot/apps/desktop/release/win-unpacked"

    $electronRuntime = Measure-AppExecution "Electron" $electronExe $electronHealth
    $electronStorage = Measure-Storage "Electron" $electronInstaller $electronUnpacked

    # Measure IPC while Electron is up
    $electronIpc = $null
    if ($electronRuntime.Status -eq "VERIFIED") {
        Write-Host "    -> Launching background instance for IPC measurement..." -ForegroundColor Gray
        $procIpc = Start-Process -FilePath $electronExe -PassThru
        for ($i = 0; $i -lt 150; $i++) {
            Start-Sleep -Milliseconds 100
            try {
                $res = Invoke-RestMethod -Uri $electronHealth -TimeoutSec 1 -ErrorAction Stop
                if ($res.status -eq "ok") { break }
            } catch {}
        }
        $electronIpc = Measure-Ipc "Electron" "WebSocket" 4500
        Kill-ProcessTreeByPid $procIpc.Id
    } else {
        $electronIpc = [PSCustomObject]@{ Status = "CANNOT_RUN_APP_UNVERIFIED" }
    }

    $benchmarkData.Electron = [ordered]@{
        Runtime = $electronRuntime
        Storage = $electronStorage
        IPC     = $electronIpc
    }
}

# 2. TAURI BENCHMARK
if ($Target -eq "All" -or $Target -eq "Tauri") {
    Write-Host "`n=================== [2] TAURI 2 BENCHMARK ====================" -ForegroundColor Magenta
    
    # Check debug vs release
    $tauriDebugExe = "$repoRoot/apps/desktop-rust/target/debug/roo-desktop.exe"
    $tauriReleaseExe = "$repoRoot/apps/desktop-rust/target/release/roo-desktop.exe"
    $tauriExe = if (Test-Path $tauriReleaseExe) { $tauriReleaseExe } else { $tauriDebugExe }

    # Installer path
    $tauriInstallerDir = "$repoRoot/apps/desktop-rust/target/release/bundle/nsis"
    $foundInstaller = Get-ChildItem -Path $tauriInstallerDir -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    $tauriInstaller = if ($foundInstaller) { $foundInstaller.FullName } else { "$repoRoot/apps/desktop-rust/target/release/bundle/nsis/Roo Code_1.0.0_x64-setup.exe" }
    $tauriUnpacked = "$repoRoot/apps/desktop-rust/target/release"

    # Tauri healthUrl is null because supervisor / Node backend is not wired yet
    $tauriRuntime = Measure-AppExecution "Tauri" $tauriExe $null
    $tauriStorage = Measure-Storage "Tauri" $tauriInstaller $tauriUnpacked
    $tauriIpc = Measure-Ipc "Tauri" "TauriPipe"

    $benchmarkData.Tauri = [ordered]@{
        Runtime = $tauriRuntime
        Storage = $tauriStorage
        IPC     = $tauriIpc
    }
}

# Save results
$fullOutputPath = [System.IO.Path]::GetFullPath("$repoRoot/$OutputJson")
$outDir = [System.IO.Path]::GetDirectoryName($fullOutputPath)
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}
$jsonStr = $benchmarkData | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($fullOutputPath, $jsonStr)

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host "Benchmark execution complete. Zero-Estimation results saved to:" -ForegroundColor Cyan
Write-Host "  $fullOutputPath" -ForegroundColor White
Write-Host "=================================================================`n" -ForegroundColor Cyan
