import ctypes
import subprocess
import json
import urllib.request
import asyncio
import websockets

import os

# 配置你的路径
APP_EXE = r"D:\Applications\PerfectWorld\完美世界竞技平台.exe"
HOOK_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hook_source", "pw_hook_index.js")
DEBUG_PORT = 9229
WAIT_FOR_INJECT = 0

CREATE_FLAGS = (
    subprocess.DETACHED_PROCESS
    | subprocess.CREATE_NEW_PROCESS_GROUP
    | getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0)
)


def launch_app_with_inspect() -> bool:
    try:
        subprocess.Popen(
            [APP_EXE, f"--inspect={DEBUG_PORT}"],
            creationflags=CREATE_FLAGS,
            close_fds=True,
        )
        return True
    except OSError as err:
        if getattr(err, "winerror", None) == 740:
            params = f"--inspect={DEBUG_PORT}"
            ret = ctypes.windll.shell32.ShellExecuteW(None, "runas", APP_EXE, params, None, 1)
            if ret <= 32:
                print(f"[-] 提权启动失败，ShellExecuteW 返回码: {ret}")
                return False
            print("[!] 检测到平台需要管理员权限，已触发 UAC 提权启动。")
            return True
        raise

async def inject():
    print("[*] 1. 正在带参数(--inspect)启动完美平台主进程...")

    if not launch_app_with_inspect():
        return
    
    # 给出缓冲时间让应用彻底启动（根据实际电脑性能可能需要调整）
    print(f"[*] 2. 正在等待主程序及其调试 WebSocket 服务唤醒 (等待 {WAIT_FOR_INJECT} 秒)...")
    for i in range(WAIT_FOR_INJECT, 0, -1):
        print(f"  ...还剩 {i} 秒", end="\r")
        await asyncio.sleep(1)
    print("                        ", end="\r")
    
    try:
        # 向平台请求所有的调试页面端点
        req = urllib.request.Request(f"http://127.0.0.1:{DEBUG_PORT}/json/list")
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
    except Exception as e:
        print(f"[-] 失败: 无法连接至 {DEBUG_PORT} 端口。错误: {e}")
        return
        
    if not data:
        print("[-] 没有获取到可供调试的上下文。")
        return
        
    # 我们要寻找 Node.js 主执行上下文 (通常 type 是 "node")
    target = next((t for t in data if t.get("type", "") == "node"), None)
    if not target:
        target = data[0]  # 如果没有明确的 node 类型，就默认使用第一个端点（可能是 Electron 主进程）
        
    ws_url = target.get("webSocketDebuggerUrl")
    if not ws_url:
        print("[-] 目标缺少 WebSocket 调试连接入口。")
        return
        
    print(f"[+] 3. 找到平台主进程端点: {ws_url}")
    print("[*] 4. 正在通过基于 WebSocket 的 CDP 协议发送代码注入指令...")
    
    # 整理 Windows 路径分隔符，防止 JavaScript 字符串转义错误
    js_path = HOOK_SCRIPT.replace("\\", "/")
    
    # 这是我们即将发送给目标主进程执行的 JavaScript (相当于热加载模块)
    expression = f"""
        (async function() {{
            try {{
                const req = typeof require !== 'undefined' ? require : (typeof process !== 'undefined' && process.mainModule && process.mainModule.require ? process.mainModule.require : (typeof global !== 'undefined' && global.require ? global.require : null));
                if (req) {{
                    req('{js_path}');
                    return 'HOOK_SUCCESS';
                }} else {{
                    await import('file:///{js_path}');
                    return 'HOOK_SUCCESS';
                }}
            }} catch(er) {{
                return 'HOOK_ERR: ' + er.stack;
            }}
        }})()
    """
    
    # 构造发给 V8 引擎执行代码的标准请求载荷
    payload = {
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True
        }
    }
    
    try:
        async with websockets.connect(ws_url) as ws:
            await ws.send(json.dumps(payload))
            res = json.loads(await ws.recv())
            val = res.get("result", {}).get("result", {}).get("value")
            
            if val == "HOOK_SUCCESS":
                print("\n==================================")
                print("[+] PWHook 已挂载到内存中。")
                print("==================================\n")
            else:
                print(f"[-] 在远程主进程执行发生异常: {val}")
    except Exception as e:
        print(f"[-] 发送/执行代码时出现网络连接断开等异常: {e}")

if __name__ == "__main__":
    asyncio.run(inject())
