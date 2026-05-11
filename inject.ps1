param (
    [string]$AppExe = "D:\Applications\PerfectWorld\完美世界竞技平台.exe",
    [string]$HookScript = "$PSScriptRoot\hook_source\pw_hook_index.js",
    [int]$DebugPort = 9229
)

$ErrorActionPreference = "Stop"

# 检查管理员权限并自动提权
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[!] No Admin Privileges. Requesting UAC elevation..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Write-Host "[*] 1. Starting Perfect World platform..."
try {
    $proc = Start-Process -FilePath $AppExe -PassThru
} catch {
    Write-Host "[-] Failed to start application." -ForegroundColor Red
    exit 1
}

$pidId = $proc.Id
Write-Host "[*] 2. Started successfully (PID: $pidId)"
Start-Sleep -Seconds 1

Write-Host "[*] 3. Waking up debug interface via process._debugProcess..."
try {
    # 强制给目标 PID 发唤醒信号
    node -e "process._debugProcess($pidId)"
    Start-Sleep -Seconds 1.5
} catch {
    Write-Host "[-] Failed to send signal. Make sure Node.js is installed." -ForegroundColor Red
    exit 1
}

try {
    $endpoints = Invoke-RestMethod -Uri "http://127.0.0.1:$($DebugPort)/json/list"
} catch {
    Write-Host "[-] Failed: Cannot connect to port $DebugPort." -ForegroundColor Red
    exit 1
}

if (-not $endpoints) {
    Write-Host "[-] No debug context found." -ForegroundColor Red
    exit 1
}

# 寻找 Node.js 主执行上下文
$target = $null
foreach ($ep in $endpoints) {
    if ($ep.type -eq "node") {
        $target = $ep
        break
    }
}
if (-not $target) {
    $target = $endpoints[0]
}

$wsUrl = $target.webSocketDebuggerUrl
if (-not $wsUrl) {
    Write-Host "[-] Target lacks WebSocket connection entry." -ForegroundColor Red
    exit 1
}

Write-Host "[+] 4. Found WebSocket target: $wsUrl"
Write-Host "[*] 5. Sending injection payload via WebSocket CDP..."

$jsPath = $HookScript.Replace("\", "/")
$expression = @"
(async function() {
    try {
        const req = typeof require !== 'undefined' ? require : (typeof process !== 'undefined' && process.mainModule && process.mainModule.require ? process.mainModule.require : (typeof global !== 'undefined' && global.require ? global.require : null));
        if (req) {
            req('$jsPath');
            return 'HOOK_SUCCESS';
        } else {
            await import('file:///$jsPath');
            return 'HOOK_SUCCESS';
        }
    } catch(er) {
        return 'HOOK_ERR: ' + er.stack;
    }
})()
"@

$payloadObj = @{
    id = 1
    method = "Runtime.evaluate"
    params = @{
        expression = $expression
        returnByValue = $true
        awaitPromise = $true
    }
}

$payloadJson = $payloadObj | ConvertTo-Json -Depth 5 -Compress

try {
    # 在非 .NET Core / 旧版 Windows PowerShell 中，ClientWebSocket 属于 System.dll
    Add-Type -AssemblyName System
    
    # 手动实例化 ClientWebSocket (通过完整的系统路径)
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $uri = New-Object System.Uri($wsUrl)
    $cancellationToken = [System.Threading.CancellationToken]::None
    
    $connectTask = $ws.ConnectAsync($uri, $cancellationToken)
    $connectTask.Wait()
    
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payloadJson)
    # 使用 ::new() 静态方法避免 PowerShell 错误地展平(unroll)数组导致参数数量爆炸
    $segment = [System.ArraySegment[byte]]::new($bytes)
    $sendTask = $ws.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cancellationToken)
    $sendTask.Wait()
    
    $buffer = New-Object byte[] 8192
    $receiveSegment = [System.ArraySegment[byte]]::new($buffer)
    $receiveTask = $ws.ReceiveAsync($receiveSegment, $cancellationToken)
    $receiveTask.Wait()
    
    $resultText = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $receiveTask.Result.Count)
    $resObj = $resultText | ConvertFrom-Json
    
    $val = $resObj.result.result.value
    
    if ($val -eq "HOOK_SUCCESS") {
        Write-Host "`n==================================" -ForegroundColor Green
        Write-Host "[+] PWHook successfully injected in memory." -ForegroundColor Green
        Write-Host "==================================`n" -ForegroundColor Green
    } else {
        Write-Host "[-] Remote script execution exception: $val" -ForegroundColor Red
    }
    
    $closeTask = $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Done", $cancellationToken)
    $closeTask.Wait()

} catch {
    Write-Host "[-] Network disconnect or execution error: $_" -ForegroundColor Red
}
