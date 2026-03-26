const store = require("./pw_hook_store.js");

// 全局响应等待队列
const waitQueues = {};

// 将外部友好的 API 转换为内部的 IPC Channel 和数组参数
const ROUTE_MAPPING = {
    search_friend: {
        channel: "COMMON_IM_MT_SEARCH_FRIEND_REQ",
        buildArgs: (body) => {
            const keyword = body.name || "";
            const page = body.page || 1;
            return [keyword, page];
        },
    },
    get_match_list: {
        channel: "CSGO_OVERVIEW_GET_MATCH_LIST_REQ",
        buildArgs: (body) => {
            return [
                {
                    uid: String(body.uid),
                    page: String(body.page || "1"),
                    page_size: String(body.page_size || "15"),
                    game_types: body.game_types || "10,12,14,16,27,20,33,40,41,44,51",
                    start_time: body.start_time || "",
                    end_time: body.end_time || "",
                    season: body.season || "",
                    ticket_id: body.ticket_id || "",
                },
            ];
        },
    },
    get_season_desc: {
        channel: "GET_SEASON_DESC_REQ",
        buildArgs: (body) => {
            return [{}];
        },
    },
    get_match_calendar: {
        channel: "CSGO_OVERVIEW_GET_DAILY_STATS_REQ",
        buildArgs: (body) => {
            return [
                {
                    uid: String(body.uid),
                    start_time: body.start_time || "",
                    end_time: body.end_time || "",
                },
            ];
        },
    },
    create_ladder_room: {
        channel: "CSGO_LADDER_MT_CREATE_TEAM_REQ",
        buildArgs: (body) => {
            return [
                {
                    map_names: body.map_names || ["de_dust2"],
                    zone_ids: body.zone_ids || [603],
                    bp_modes: body.bp_modes || [0],
                    game_target: body.game_target || 0,
                    specialities: body.specialities || [],
                    role_card_id: body.role_card_id || 0,
                },
            ];
        },
        waitFor: "CSGO_LADDER_MT_CREATE_TEAM_RES",
    },
    leave_ladder_room: {
        channel: "CSGO_LADDER_MT_LEAVE_TEAM_REQ",
        buildArgs: (body) => {
            return [
                {
                    leave_team_reason: body.leave_team_reason || 0,
                },
            ];
        },
        waitFor: "CSGO_LADDER_MT_LEAVE_TEAM_NOTIFY",
    },
    get_match_zone: {
        channel: "CSGO_EMIT_GET_NETWORK_SPEED",
        buildArgs: (body) => {
            const envelope = {
                $$key$$: body.key || Math.random(),
                $$data$$: body.data || {},
                $$name$$: body.name || "hs",
            };
            return [envelope];
        },
    },
    get_comment_list: {
        channel: "CSGO_OVERVIEW_COMMENT_GET_COMMENT_LIST_REQ",
        buildArgs: (body) => {
            const data = body.data || {
                target: body.target || body.uid || "",
            };
            const envelope = {
                $$key$$: body.key || Math.random(),
                $$data$$: data,
                $$name$$: body.name || "hs",
            };
            return [envelope];
        },
    },
    send_team_chat: {
        channel: "CSGO_LADDER_MT_TEAM_CHAT_REQ",
        buildArgs: (body) => {
            return [
                {
                    chat_text: String(body.chat_text || ""),
                    chat_type: Number(body.chat_type || 1),
                },
            ];
        },
        waitFor: "CSGO_LADDER_MT_TEAM_CHAT_RES",
    },
    begin_ladder_match: {
        channel: "CSGO_LADDER_MT_MATCH_REQ",
        buildArgs: (body) => {
            return [
                {
                    leave_team_reason: body.leave_team_reason || 0,
                },
            ];
        },
        waitFor: "CSGO_LADDER_MT_MATCH_RES",
    },
    get_friend_list: {
        channel: "COMMON_IM_MT_GET_FRIEND_LIST_REQ",
        buildArgs: (body) => {
            return [
                {
                    friendType: body.friendType || 1,
                },
            ];
        },
        waitFor: "COMMON_IM_MT_GET_FRIEND_LIST_RES",
    },
    send_friend_msg:{
        channel: "COMMON_IM_MT_CHAT_REQ",
        buildArgs: (body) => {
            return [
                {
                    chatChannel: body.chatChannel || 1,
                    targetId: String(body.targetId || ""),
                    text: String(body.text || ""),
                },
            ];
        },
        waitFor: "COMMON_IM_MT_CHAT_RES",
    }
};

// 处理 HTTP 请求并将参数透传给挂载的系统内部函数
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
    let targetFuncName = reqRouteMatch;
    let args = [];

    try {
        let parsedBody = {};
        if (bodyPayload) {
            parsedBody = JSON.parse(bodyPayload);
        }

        let nowait = false;
        let waitFor = null;

        // 检查是否有对应的路由映射
        if (ROUTE_MAPPING[reqRouteMatch]) {
            const mappedRoute = ROUTE_MAPPING[reqRouteMatch];
            targetFuncName = mappedRoute.channel;
            args = mappedRoute.buildArgs(parsedBody);
            nowait = !!mappedRoute.nowait;
            waitFor = mappedRoute.waitFor;
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

        let result;
        if (waitFor) {
            // 需要等待特定服务端的推送事件再返回结果
            const bus = store.getEventBus();

            const waitPromise = new Promise((resolve) => {
                // 初始化队列并注册全局监听
                if (!waitQueues[waitFor]) {
                    waitQueues[waitFor] = [];
                    bus.on(waitFor, (resData) => {
                        if (waitQueues[waitFor].length > 0) {
                            // 取出最旧的等待者并触发
                            const oldest = waitQueues[waitFor].shift();
                            clearTimeout(oldest.timeoutId);
                            oldest.resolve(resData);
                        }
                    });
                }

                // 超时处理
                const timeoutId = setTimeout(() => {
                    const idx = waitQueues[waitFor].findIndex((item) => item.resolve === resolve);
                    if (idx !== -1) {
                        waitQueues[waitFor].splice(idx, 1);
                        resolve({ error: `等待事件 ${waitFor} 超时（2秒）` });
                    }
                }, 2000);

                // 把自己加入排队
                waitQueues[waitFor].push({ resolve, timeoutId });
            });

            // 触发原函数
            targetFunc(...args);

            // 阻塞当前请求挂起直到推送响应或超时
            result = await waitPromise;
        } else if (nowait) {
            targetFunc(...args);
            result = { fired: true };
        } else {
            result = await targetFunc(...args);
        }

        return { status: 200, data: { success: true, result: result } };
    } catch (err) {
        console.error(`[PW_HOOK] 调用通道 ${targetFuncName} 出现异常:`, err);
        return { status: 500, data: { error: err.message || err.toString() } };
    }
};

module.exports = { handleRequest };
