const http = require("http");
const router = require("./pw_hook_router.js");

const PORT = 28888; // HTTP服务器监听的端口

// SSE 客户端列表
const sseClients = [];
const eventClients = [];

/**
 * 向所有 SSE 客户端广播一条日志消息
 * @param {"log"|"info"|"warn"|"error"|"debug"} level
 * @param {any[]} args
 */
const broadcastLog = (level, args) => {
    const payload = JSON.stringify({
        level,
        time: new Date().toISOString(),
        message: args
            .map((a) =>
                typeof a === "object"
                    ? JSON.stringify(a, null, 2)
                    : String(a)
            )
            .join(" "),
    });
    const data = `data: ${payload}\n\n`;
    for (let i = sseClients.length - 1; i >= 0; i--) {
        try {
            sseClients[i].write(data);
        } catch (_) {
            sseClients.splice(i, 1);
        }
    }
};

/**
 * 向所有 Event 客户端广播一条事件消息
 * @param {string} channel
 * @param {any} data
 */
const broadcastEvent = (channel, data) => {
    const payload = JSON.stringify({
        channel,
        time: new Date().toISOString(),
        data: data
    });
    const message = `event: message\ndata: ${payload}\n\n`;
    for (let i = eventClients.length - 1; i >= 0; i--) {
        try {
            eventClients[i].write(message);
        } catch (_) {
            eventClients.splice(i, 1);
        }
    }
};

const startServer = () => {
    const server = http.createServer((req, res) => {
        // 允许跨域（方便浏览器控制台直接发起 fetch 调试）
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        // SSE 事件流端点 (用于长连接接收 Notify 推送)
        if (req.url === "/api/events/stream") {
            res.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            });
            // 握手心跳
            res.write(": connected\n\n");
            eventClients.push(res);

            // 定时心跳防止连接超时
            const heartbeat = setInterval(() => {
                try {
                    res.write(": ping\n\n");
                } catch (_) {
                    clearInterval(heartbeat);
                }
            }, 10000);

            req.on("close", () => {
                clearInterval(heartbeat);
                const idx = eventClients.indexOf(res);
                if (idx !== -1) eventClients.splice(idx, 1);
            });
            return;
        }

        // SSE 日志流端点
        if (req.url === "/api/log/stream") {
            res.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            });
            // 握手心跳
            res.write(": connected\n\n");
            sseClients.push(res);

            // 定时心跳防止连接超时
            const heartbeat = setInterval(() => {
                try {
                    res.write(": ping\n\n");
                } catch (_) {
                    clearInterval(heartbeat);
                }
            }, 15000);

            req.on("close", () => {
                clearInterval(heartbeat);
                const idx = sseClients.indexOf(res);
                if (idx !== -1) sseClients.splice(idx, 1);
            });
            return;
        }

        let body = "";
        let bodySize = 0;
        const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2MB

        req.on("data", (chunk) => {
            bodySize += chunk.length;
            if (bodySize > MAX_BODY_SIZE) {
                console.warn(`[PW_HOOK] 拦截极大恶意 Payload (${bodySize} bytes), 强行截断连接`);
                req.destroy();
                return;
            }
            body += chunk.toString();
        });

        req.on("end", async () => {
            if (req.destroyed) return;
            // 将收集到的纯文本交由 router 处理
            const response = await router.handleRequest(req, res, body);

            // 统一返回 JSON
            res.writeHead(response.status, {
                "Content-Type": "application/json; charset=utf-8",
            });
            res.end(JSON.stringify(response.data));
        });
    });

    server.listen(PORT, "127.0.0.1", () => {
        console.log(`[PW_HOOK] 服务器已启动: http://127.0.0.1:${PORT}`);
    });
};

module.exports = { startServer, broadcastLog, broadcastEvent };
