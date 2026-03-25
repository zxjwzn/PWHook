const store = require("./pw_hook_store.js");
const { promisifyCall } = require("./pw_hook_promisify.js");

// 路由参数映射表：将外部友好的 API 转换为内部的 IPC Channel 和数组参数
const ROUTE_MAPPING = {
    search_friend: {
        channel: "COMMON_IM_MT_SEARCH_FRIEND_REQ",
        buildArgs: (body) => {
            // 解析 { "name": "name", "page": 1 } 变成 ["name", 1]
            const keyword = body.name || "";
            const page = body.page || 1;
            return [keyword, page];
        },
    },
    get_match_list: {
        channel: "CSGO_OVERVIEW_GET_MATCH_LIST_REQ",
        buildArgs: (body) => {
            // 根据抓包参数构建内部调用的载荷
            // 注: 平台代码自带逻辑: let s = { access_token: y, ...e };
            // 所以我们并不需要在请求中补全 access_token，底层会自动补全。
            // 只需要传抓包里的其他业务字段。
            return [
                {
                    uid: String(body.uid),
                    page: String(body.page || "1"),
                    page_size: String(body.page_size || "15"),
                    game_types: body.game_types || "10,12,14,16,27,20,33,40,41,44,51",
                    start_time: body.start_time || "",
                    end_time: body.end_time || "",
                    season: body.season || "S23",
                    ticket_id: body.ticket_id || "",
                },
            ];
        },
    },
    get_season_desc: {
        channel: "GET_SEASON_DESC_REQ",
        buildArgs: (body) => {
            // 给它一个空的字典 {} 作为第一个参数（业务参数 t），避免 undefined 异常
            return [{}];
        },
    },
};

// Hook 元数据：声明哪些函数需要回调→Promise 转换
// 这与 hooks.json 中的配置保持一致
const HOOK_META = {
    searchFriend: { callbackStyle: "node", successIndex: 1, errorIndex: 2 },
    // 新增 hook 时在此添加元数据：
    // encrypt: { callbackStyle: 'none' },
};

// 路由分发中心：处理 HTTP 请求并将参数透传给挂载的系统内部函数
const handleRequest = async (req, res, bodyPayload) => {
    // 约定 API 统一路径前缀: /api/call/函数名
    const urlPath = req.url.split("?")[0];
    const routePrefix = "/api/call/";

    if (urlPath === "/api/list") {
        // 列出所有已注册的函数
        const names = Object.keys(global.PW_HOOK_FUNCTIONS);
        return {
            status: 200,
            data: {
                functions: names,
                mapped_routes: Object.keys(ROUTE_MAPPING),
            },
        };
    }

    if (!urlPath.startsWith(routePrefix)) {
        return {
            status: 404,
            data: {
                error: "未找到 Hook 路由，请访问 /api/call/<函数名> 或 /api/list",
            },
        };
    }

    const reqRouteMatch = urlPath.replace(routePrefix, "");
    let targetFuncName = reqRouteMatch; // 默认为外部传进来的原样字符串
    let args = [];

    try {
        let parsedBody = {};
        if (bodyPayload) {
            parsedBody = JSON.parse(bodyPayload);
        }

        // 检查是否有对应的路由映射
        if (ROUTE_MAPPING[reqRouteMatch]) {
            const mappedRoute = ROUTE_MAPPING[reqRouteMatch];
            targetFuncName = mappedRoute.channel;
            args = mappedRoute.buildArgs(parsedBody);
        } else {
            // 未匹配映射时，兼容原始方式，直接读取 json 中的 args 数组
            args = parsedBody.args || [];
        }

        const targetFunc = store.getFunction(targetFuncName);

        if (!targetFunc) {
            return {
                status: 404,
                data: {
                    error: `函数/通道 '${targetFuncName}' 尚未被挂载到 Hook Store，请检查注入并确保平台注册了该通道。`,
                },
            };
        }

        const meta = HOOK_META[targetFuncName];

        let result;
        if (meta && meta.callbackStyle === "node") {
            // 回调式函数：使用 promisify 包装
            result = await promisifyCall(targetFunc, null, args, meta.successIndex, meta.errorIndex);
        } else {
            // 普通函数或 Promise 函数：直接调用
            result = await targetFunc(...args);
        }

        return { status: 200, data: { success: true, result: result } };
    } catch (err) {
        console.error(`[PW_HOOK] 调用通道 ${targetFuncName} 出现异常:`, err);
        return { status: 500, data: { error: err.message || err.toString() } };
    }
};

module.exports = { handleRequest };
