const server = require("./pw_hook_server.js");
const store = require("./pw_hook_store.js");
const electron = require("electron");
const path = require("path");

const init = () => {
    // ─────────────────────────────────────────────────────────────
    // 0. 在任何应用代码将 console 替换为空函数之前，先抢救原生 console
    // ─────────────────────────────────────────────────────────────
    const nativeConsole = {
        log: Function.prototype.bind.call(console.log, console),
        info: Function.prototype.bind.call(console.info, console),
        warn: Function.prototype.bind.call(console.warn, console),
        error: Function.prototype.bind.call(console.error, console),
        debug: Function.prototype.bind.call(console.debug, console),
    };
    global.__pw_console__ = nativeConsole;

    // 劫持 console：将输出同时发往 SSE 广播队列（前端）和原生控制台
    const levels = ["log", "info", "warn", "error", "debug"];
    levels.forEach((level) => {
        const hooked = (...args) => {
            nativeConsole[level](...args);
            server.broadcastLog(level, args);
        };
        try {
            Object.defineProperty(console, level, {
                get: () => hooked,     // 始终返回我们的劫持函数
                set: () => { },         // 静默吞掉赋值，不抛错
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
    // 2.5 补救：获取注入前已经被程序挂载的原生事件处理函数
    // ─────────────────────────────────────────────────────────────
    // 如果我们的注入时机较晚，平台已经先执行了 ipcMain.on 或 ipcMain.handle，
    // 这里将其回溯注册进我们的 store
    const existingOnChannels = electron.ipcMain.eventNames();
    existingOnChannels.forEach((channel) => {
        if (typeof channel !== "string") return;
        const listeners = electron.ipcMain.listeners(channel);
        if (listeners.length > 0) {
            console.log(`[PW_HOOK] 发现已挂载的原生 IPC On 通道: ${channel}`);
            store.registerFunction(channel, (...args) => {
                return new Promise((resolve, reject) => {
                    const fakeEvent = {
                        reply: (resType, data) => resolve(data),
                        sender: { send: (resType, data) => resolve(data) },
                    };
                    try {
                        listeners[0](fakeEvent, ...args);
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        }
    });

    if (electron.ipcMain._invokeHandlers) {
        electron.ipcMain._invokeHandlers.forEach((listener, channel) => {
            console.log(`[PW_HOOK] 发现已挂载的原生 IPC Handle 通道: ${channel}`);
            store.registerFunction(channel, async (...args) => {
                const fakeEvent = { sender: { send: () => {} } };
                return await listener(fakeEvent, ...args);
            });
        });
    }

    // ─────────────────────────────────────────────────────────────
    // 3. 劫持 Electron 的 IPC 通信 (主进程)
    // ─────────────────────────────────────────────────────────────
    const originalIpcHandle = electron.ipcMain.handle;
    electron.ipcMain.handle = function (channel, listener) {
        console.log(`[PW_HOOK] 捕获到平台注册 IPC Handle 通道: ${channel}`);

        store.registerFunction(channel, async (...args) => {
            const fakeEvent = { sender: { send: () => { } } };
            return await listener(fakeEvent, ...args);
        });

        const wrappedListener = async function (event, ...args) {
            if (channel.startsWith("CSGO_") || channel.startsWith("CS2_") || channel.startsWith("MT_") || channel.startsWith("COMMON_")) {
                console.log(`[PW_HOOK] 捕获前端请求 ↑ [${channel}]`);
                if (args.length > 0) {
                    console.log(`[PW_HOOK] 请求传参 Payload:`, JSON.stringify(args[0], null, 2));
                }
            }
            return await listener.apply(this, arguments);
        };

        const newArgs = [channel, wrappedListener];
        return originalIpcHandle.apply(this, newArgs);
    };

    // 拦截 ipcMain.on
    const originalIpcOn = electron.ipcMain.on;
    electron.ipcMain.on = function (channel, listener) {
        console.log(`[PW_HOOK] 捕获到平台注册 IPC On 通道: ${channel}`);

        store.registerFunction(channel, (...args) => {
            return new Promise((resolve, reject) => {
                const fakeEvent = {
                    reply: (resType, data) => {
                        console.log(`[PW_HOOK] 拦截到返回值，通道: ${resType}`);
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

        const wrappedListener = function (event, ...args) {
            // 当玩家在完美平台真实界面点击按钮触发 IPC 通信时，拦截并打印它的上行报文
            console.log(`[PW_HOOK] 捕获前端请求 ↑ [${channel}]`);
            if (args.length > 0) {
                console.log(`[PW_HOOK] 请求传参 Payload:`, JSON.stringify(args[0], null, 2));
            }
            return listener.apply(this, arguments);
        };

        const newArgs = [channel, wrappedListener];
        return originalIpcOn.apply(this, newArgs);
    };

    // ─────────────────────────────────────────────────────────────
    // 4. 拦截服务端 WebSocket 向前端推送 (webContents.send)
    // 根据 handle_response 分析，解密反序列化后的所有 Res/Notify 
    // 都会通过 webContents.send(channel, data) 分发给渲染进程。
    // ─────────────────────────────────────────────────────────────
    const hookWebContents = (wc) => {
        if (wc.__pw_hook_injected__) return; // 避免重复注入
        wc.__pw_hook_injected__ = true;

        const originalSend = wc.send;
        wc.send = function (channel, ...args) {
            console.log(`[PW_HOOK] 捕获服务端推送 ↓ [${channel}]`);
            if (args.length > 0) {
                console.log(`[PW_HOOK] 推送数据 Payload:`, JSON.stringify(args[0], null, 2));
            }

            // 将服务端推给前端的事件通过 EventBus 广播出来，供 Router 等机制挂起等待
            try {
                const store = require("./pw_hook_store.js");
                store.getEventBus().emit(channel, args[0]);
            } catch (err) { }

            return originalSend.apply(this, [channel, ...args]);
        };
    };

    // 1. 监听未来创建的 webContents
    electron.app.on("web-contents-created", (event, wc) => {
        hookWebContents(wc);
    });

    // 2. 兜底：处理在 Hook 代码执行前就已经创建好的早期 webContents (比如主界面)
    if (electron.webContents && typeof electron.webContents.getAllWebContents === "function") {
        electron.webContents.getAllWebContents().forEach(wc => hookWebContents(wc));
    }
};

init();
