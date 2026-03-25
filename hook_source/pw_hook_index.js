const server = require("./pw_hook_server.js");
const store = require("./pw_hook_store.js");
const electron = require("electron");
const path = require("path");

const init = () => {
    // ─────────────────────────────────────────────────────────────
    // 0. 在任何应用代码将 console 替换为空函数之前，先抢救原生 console
    // ─────────────────────────────────────────────────────────────
    const nativeConsole = {
        log:   Function.prototype.bind.call(console.log,   console),
        info:  Function.prototype.bind.call(console.info,  console),
        warn:  Function.prototype.bind.call(console.warn,  console),
        error: Function.prototype.bind.call(console.error, console),
        debug: Function.prototype.bind.call(console.debug, console),
    };
    global.__pw_console__ = nativeConsole;

    // 劫持 console：将输出同时发往 SSE 广播队列（前端）和原生控制台
    // 使用 getter/setter 拦截：getter 始终返回我们的劫持函数，setter 静默忽略，
    // 这样 background.js 的 console.log = noop 赋值既不报错也不生效。
    const levels = ["log", "info", "warn", "error", "debug"];
    levels.forEach((level) => {
        const hooked = (...args) => {
            nativeConsole[level](...args);
            server.broadcastLog(level, args);
        };
        try {
            Object.defineProperty(console, level, {
                get: () => hooked,     // 始终返回我们的劫持函数
                set: () => {},         // 静默吞掉赋值，不抛错
                configurable: false,   // 禁止再次 defineProperty
                enumerable: true,
            });
        } catch (_) {
            // 万全后备：定义失败时直接赋值
            console[level] = hooked;
        }
    });

    // ─────────────────────────────────────────────────────────────
    // 1. 启动基于 HTTP 的 RPC 通信服务器（含 SSE 日志端点）
    // ─────────────────────────────────────────────────────────────
    server.startServer();

    console.log("[PW_HOOK] 正在初始化 God Mode Hook 系统...");

    // ─────────────────────────────────────────────────────────────
    // 2. 打开前端控制台窗口
    // ─────────────────────────────────────────────────────────────
    const openConsoleWindow = () => {
        const win = new electron.BrowserWindow({
            width: 1000,
            height: 680,
            title: "PW Hook Console",
            backgroundColor: "#0d1117",
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
            },
            // 不显示在任务栏菜单（可按需注释掉）
            // skipTaskbar: true,
        });

        const frontendPath = path.join(__dirname, "frontend", "index.html");
        win.loadFile(frontendPath);

        // 移除默认菜单栏
        win.setMenuBarVisibility(false);
    };

    if (electron.app.isReady()) {
        openConsoleWindow();
    } else {
        electron.app.once("ready", openConsoleWindow);
    }

    // ─────────────────────────────────────────────────────────────
    // 3. 劫持 Electron 的 IPC 通信 (主进程)
    // ─────────────────────────────────────────────────────────────
    const originalIpcHandle = electron.ipcMain.handle;
    electron.ipcMain.handle = function (channel, listener) {
        console.log(`[PW_HOOK] 捕获到平台注册 IPC Handle 通道: ${channel}`);

        store.registerFunction(channel, async (...args) => {
            const fakeEvent = { sender: { send: () => {} } };
            return await listener(fakeEvent, ...args);
        });

        return originalIpcHandle.apply(this, arguments);
    };

    // 拦截 ipcMain.on
    const originalIpcOn = electron.ipcMain.on;
    electron.ipcMain.on = function (channel, listener) {
        console.log(`[PW_HOOK] 捕获到平台注册 IPC On 通道: ${channel}`);

        store.registerFunction(channel, (...args) => {
            return new Promise((resolve, reject) => {
                const fakeEvent = {
                    reply: (resType, data) => {
                        console.log(`[PW_HOOK] 拦截到返回值，原通道响应用类型: ${resType}`);
                        resolve(data);
                    },
                    sender: {
                        send: (resType, data) => {
                            resolve(data);
                        },
                    },
                };

                try {
                    listener(fakeEvent, ...args);
                } catch (err) {
                    reject(err);
                }
            });
        });

        return originalIpcOn.apply(this, arguments);
    };
};

init();
