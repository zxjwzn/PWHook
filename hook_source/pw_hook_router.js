const store = require("./pw_hook_store.js");

const API_BYPASS_SYMBOL = "__pw_hook_api_bypass__";

const createSuccessResponse = (data, status = 200) => {
    return {
        status,
        data: {
            ok: true,
            timestamp: new Date().toISOString(),
            data,
            error: null,
        },
    };
};

const createErrorResponse = (message, status = 400, code = "BAD_REQUEST") => {
    return {
        status,
        data: {
            ok: false,
            timestamp: new Date().toISOString(),
            data: null,
            error: {
                code,
                message,
            },
        },
    };
};

const parseBody = (bodyPayload) => {
    if (!bodyPayload) {
        return {};
    }
    return JSON.parse(bodyPayload);
};

// 全局响应等待队列
const waitQueues = {};

// 将外部友好的 API 转换为内部的 IPC Channel 和数组参数
const ROUTE_MAPPING = {
    login: {
        description: "触发 check-loginFromSteam 登录/登出事件",
        channel: "check-loginFromSteam",
        nowait: true,
        params: {
            type: {
                desc: "事件类型，支持 logined / logout",
                default: "logined",
            },
            token: {
                desc: "登录 token；type=logout 时可为空",
                default: "",
            },
            uid: {
                desc: "用户 steamID；type=logout 时可为空",
                default: "",
            },
            login_method: {
                desc: "登录方式标记，原样透传给目标程序",
                default: 0,
            },
        },
        buildArgs: (params) => {
            if (params.type === "logined") {
                global.user.id = params.uid;//沟槽的完美把登录态放在了全局变量上
                global.user.token = params.token;
                global.user.login_method = params.login_method;
            }
            return [
                {
                    type: params.type,
                    token: params.token,
                    uid: params.uid,
                    login_method: params.login_method,
                },
            ];
        },
    },
    search_friend: {
        description: "搜索好友",
        params: {
            name: {
                desc: "好友昵称",
                default: "",
            },
            page: {
                desc: "页码",
                default: 1,
            },
        },
        channel: "COMMON_IM_MT_SEARCH_FRIEND_REQ",
        buildArgs: (params) => {
            return [
                {
                    keyword: params.name,
                    page: params.page,
                },
            ];
        },
        parseResponse: (res) => {
            // 解析字符串类型的 JSON 返回值
            if (typeof res === "string") {
                try {
                    return JSON.parse(res);
                } catch (e) {
                    return res;
                }
            }
            return res;
        }
    },
    add_friend: {
        description: "添加好友",
        channel: "COMMON_IM_MT_APPLY_FRIEND_REQ",
        params: {
            uid: {
                desc: "要添加的好友steamID",
                default: "",
            },
        },
        buildArgs: (params) => {
            return [
                {
                    targetId: params.uid,
                },
            ];
        },
        waitFor: "COMMON_IM_MT_APPLY_FRIEND_RES",
        //errCode为0添加成功,为10则重复添加
    },
    get_user_match_history: {
        description: "获取比赛历史记录",
        params: {
            uid: {
                desc: "用户steamID",
                default: "",
            },
            page: {
                desc: "页码",
                default: "1",
            },
            page_size: {
                desc: "每页数量",
                default: "15",
            },
            game_types: {
                desc: "比赛类型",
                default: "10,12,14,16,27,20,33,40,41,44,51",
            },
            start_time: {
                desc: "开始时间(YY-MM-DD HH:mm:ss)",
                default: "",
            },
            end_time: {
                desc: "结束时间(YY-MM-DD HH:mm:ss)",
                default: "",
            },
            season: {
                desc: "赛季ID(例如S23)",
                default: "",
            },
            ticket_id: {
                desc: "空值，无意义",
                default: "",
            },
        },
        channel: "CSGO_OVERVIEW_GET_MATCH_LIST_REQ",
        buildArgs: (params) => {
            return [
                {
                    uid: params.uid,
                    page: params.page,
                    page_size: params.page_size,
                    game_types: params.game_types,
                    start_time: params.start_time,
                    end_time: params.end_time,
                    season: params.season,
                    ticket_id: params.ticket_id,
                },
            ];
        },
    },
    get_current_season_info: {
        description: "获取当前赛季",
        params: {},
        channel: "COMMON_GET_SEASON_DESC_REQ",
        buildArgs: () => {
            return [{}];
        },
    },
    get_user_match_calendar: {
        description: "获取比赛日历/每日统计",
        params: {
            uid: {
                desc: "用户steamID",
                default: "",
            },
            start_time: {
                desc: "开始时间(YY-MM-DD)",
                default: "",
            },
            end_time: {
                desc: "结束时间(YY-MM-DD)",
                default: "",
            },
        },
        channel: "CSGO_OVERVIEW_GET_DAILY_STATS_REQ",
        buildArgs: (params) => {
            return [
                {
                    uid: params.uid,
                    start_time: params.start_time,
                    end_time: params.end_time,
                },
            ];
        },
    },
    create_ladder_team: {
        description: "创建天梯房间",
        params: {
            map_names: {
                desc: "地图列表 array,可选de_dust2,de_inferno,de_mirage,de_nuke,de_overpass,de_train,de_vertigo,de_ancient,de_anubis",
                default: ["de_dust2", "de_inferno", "de_mirage", "de_nuke", "de_overpass", "de_train", "de_vertigo", "de_ancient", "de_anubis"],
            },
            zone_ids: {
                desc: "区域ID array,可选612,604,605,603,609,601,611",
                default: [612, 604, 605, 603, 609, 601, 611],
            },
            bp_modes: {
                desc: "BP模式 array,开启填1,开启后map_names失效",
                default: [0],
            },
            game_target: {
                desc: "无意义",
                default: 0,
            },
            specialities: {
                desc: "无意义",
                default: [],
            },
            role_card_id: {
                desc: "无意义",
                default: 0,
            },
        },
        channel: "CSGO_LADDER_MT_CREATE_TEAM_REQ",
        buildArgs: (params) => {
            return [
                {
                    map_names: params.map_names,
                    zone_ids: params.zone_ids,
                    bp_modes: params.bp_modes,
                    game_target: params.game_target,
                    specialities: params.specialities,
                    role_card_id: params.role_card_id,
                },
            ];
        },
        waitFor: "CSGO_LADDER_MT_CREATE_TEAM_RES",
    },
    leave_ladder_team: {
        description: "离开天梯房间/队伍",
        params: {
            leave_team_reason: {
                desc: "离开原因",
                default: 0,
            },
        },
        channel: "CSGO_LADDER_MT_LEAVE_TEAM_REQ",
        buildArgs: (params) => {
            return [
                {
                    leave_team_reason: Number(params.leave_team_reason),
                },
            ];
        },
        waitFor: "CSGO_LADDER_MT_LEAVE_TEAM_NOTIFY",
    },
    get_match_zone: {
        description: "获取匹配区域网络速度等信息",
        params: {},
        channel: "CSGO_EMIT_GET_NETWORK_SPEED",
        buildArgs: (params) => {
            const envelope = {
                $$key$$: Math.random(),
                $$data$$: {},
                $$name$$: "hs",
            };
            return [envelope];
        },
    },
    get_user_comment_list: {
        description: "获取评论列表",
        params: {
            uid: {
                desc: "用户steamID",
                default: "",
            },
        },
        channel: "CSGO_OVERVIEW_COMMENT_GET_COMMENT_LIST_REQ",
        buildArgs: (params) => {
            const data = params.data || {
                target: params.uid,
            };
            const envelope = {
                $$key$$: Math.random(),
                $$data$$: data,
                $$name$$: "hs",
            };
            return [envelope];
        },
    },
    send_team_msg: {
        description: "发送队伍聊天",
        params: {
            text: {
                desc: "消息内容",
                default: "",
            },
            type: {
                desc: "类型,1为普通消息,2为系统消息,3呼出新手引导界面,4发送上一对局赛后总结,5发送表情包。3和4内容与chat_text无关",
                default: 1,
            },
        },
        channel: "CSGO_LADDER_MT_TEAM_CHAT_REQ",
        buildArgs: (params) => {
            return [
                {
                    chat_text: String(params.text),
                    chat_type: Number(params.type),
                },
            ];
        },
        waitFor: "CSGO_LADDER_MT_TEAM_CHAT_RES",
    },
    get_friend_list: {
        description: "获取好友列表",
        params: {
            friendType: {
                desc: "好友类型",
                default: 1,
            },
        },
        channel: "COMMON_IM_MT_GET_FRIEND_LIST_REQ",
        buildArgs: (params) => {
            return [
                {
                    friendType: params.friendType,
                },
            ];
        },
        waitFor: "COMMON_IM_MT_GET_FRIEND_LIST_RES",
    },
    send_friend_msg: {
        description: "发送好友私信",
        params: {
            chatChannel: {
                desc: "聊天频道",
                default: 1,
            },
            uid: {
                desc: "用户steamid",
                default: "",
            },
            text: {
                desc: "消息内容",
                default: "",
            },
        },
        channel: "COMMON_IM_MT_CHAT_REQ",
        buildArgs: (params) => {
            return [
                {
                    chatChannel: Number(params.chatChannel),
                    targetId: params.uid,
                    text: params.text,
                },
            ];
        },
        waitFor: "COMMON_IM_MT_CHAT_RES",
    },
    save_reaction_result: {
        description: "保存反应测试结果",
        channel: "REACTION_TESTSAVE_USER_RESULT_REQ",
        params: {
            avgReactMs: {
                desc: "平均反应时间(毫秒)",
                default: 160,
            },
            bstReactMs: {
                desc: "最佳反应时间(毫秒)",
                default: 140,
            },
            hitCnt: {
                desc: "命中次数(<=165ms为命中)",
                default: 4,
            },
            lv: {
                desc: "测试难度等级(如1, 4等)",
                default: 4,
            }
        },
        buildArgs: (params) => {
            return [
                {
                    avgReactMs: Number(params.avgReactMs),
                    bstReactMs: Number(params.bstReactMs),
                    hitCnt: Number(params.hitCnt),
                    lv: Number(params.lv),
                },
            ];
        },
    },
    get_user_season_stats: {
        description: "获取赛季统计数据(雷达图/武器/地图)",
        channel: "CSGO_OVERVIEW_GET_SEASON_STATS_REQ",
        params: {
            uid: {
                desc: "用户steamID",
                default: "",
            },
            season: {
                desc: "要查询的赛季ID",
                default: "",
            },
            current_season: {
                desc: "当前赛季ID",
                default: "",
            },
        },
        buildArgs: (params) => {
            const envelope = {
                $$key$$: Math.random(),
                $$data$$: {
                    uid: params.uid,
                    season: params.season,
                    stats_list: "ladder,map,weapon",
                    need_max_score: 1,
                    current_season: params.current_season,
                },
                $$name$$: "hs",
            };
            return [envelope];
        },
    },
    get_current_user_info: {
        description: "获取当前用户信息",
        params: {},
        handler: () => {
            return global.user;
        }
    },
    get_match_detail: {
        description: "获取赛后战绩详情",
        channel: "CSGO_GET_REPORT_DETAIL_REQ",
        params: {
            match_id: {
                desc: "比赛对局ID",
                default: "",
            },
        },
        buildArgs: (params) => {
            const envelope = {
                $$key$$: Math.random(),
                $$data$$: {
                    match_id: params.match_id,
                },
                $$name$$: "hs",
            };
            return [envelope];
        },
        parseResponse: (res) => {
            if (typeof res === "string") {
                try {
                    return JSON.parse(res);
                } catch (e) {
                    return res;
                }
            }
            return res;
        }
    },
};

// 处理 HTTP 请求并将参数透传给挂载的系统内部函数
const handleRequest = async (req, res, bodyPayload) => {
    // 约定 API 统一路径前缀: /api/call/已定义路由名
    const urlPath = req.url.split("?")[0];
    const routePrefix = "/api/call/";

    if (urlPath === "/api/docs") {
        const docs = {};
        for (const [key, route] of Object.entries(ROUTE_MAPPING)) {
            // 对 params 进行简化描述，方便阅读
            const paramsDesc = {};
            for (const [pKey, pVal] of Object.entries(route.params || {})) {
                paramsDesc[pKey] = {
                    desc: pVal.desc,
                    default: pVal.default,
                };
            }

            docs[key] = {
                description: route.description || "暂无描述",
                channel: route.channel,
                params: paramsDesc,
                waitFor: route.waitFor || null,
                mode: route.waitFor ? "wait_event" : route.nowait ? "fire_and_forget" : "request_response",
                timeoutMs: route.waitFor ? 2000 : null,
                url: `/api/call/${key}`,
            };
        }
        return createSuccessResponse({
            routes: docs,
            subscriptions: {
                schema: {
                    upstream: {
                        forwardChannels: ["CHANNEL_NAME"],
                        interceptChannels: ["CHANNEL_NAME"],
                    },
                    downstream: {
                        forwardChannels: ["CHANNEL_NAME"],
                        interceptChannels: ["CHANNEL_NAME"],
                    },
                    timeoutMs: 1000,
                    onTimeout: "allow",
                },
            },
        });
    }

    if (urlPath === "/api/list") {
        return createSuccessResponse({
                mappedRoutes: Object.keys(ROUTE_MAPPING),
        });
    }

    if (urlPath === "/api/subscriptions" && req.method === "GET") {
        return createSuccessResponse(store.getSubscriptions());
    }

    if (urlPath === "/api/subscriptions" && req.method === "POST") {
        try {
            const parsedBody = parseBody(bodyPayload);
            const mode = parsedBody.mode === "patch" ? "patch" : "set";
            const subscriptions = store.updateSubscriptions(parsedBody, mode);
            return createSuccessResponse(subscriptions);
        } catch (err) {
            return createErrorResponse(err.message || String(err), 400, "INVALID_SUBSCRIPTIONS");
        }
    }

    if (urlPath === "/api/subscriptions/clear" && req.method === "POST") {
        const subscriptions = store.clearSubscriptions();
        return createSuccessResponse(subscriptions);
    }

    if (urlPath === "/api/intercepts/respond" && req.method === "POST") {
        try {
            const parsedBody = parseBody(bodyPayload);
            if (typeof parsedBody.eventId !== "string" || parsedBody.eventId.length === 0) {
                return createErrorResponse("缺少 eventId", 400, "MISSING_EVENT_ID");
            }
            if (!["allow", "block", "modify"].includes(parsedBody.action)) {
                return createErrorResponse("action 仅支持 allow/block/modify", 400, "INVALID_ACTION");
            }

            const resolved = store.resolvePendingIntercept({
                eventId: parsedBody.eventId,
                action: parsedBody.action,
                payload: parsedBody.payload,
                reason: parsedBody.reason,
            });

            if (!resolved) {
                return createErrorResponse(`未找到待处理拦截事件: ${parsedBody.eventId}`, 404, "INTERCEPT_NOT_FOUND");
            }

            return createSuccessResponse({
                resolved: true,
                eventId: parsedBody.eventId,
                action: parsedBody.action,
            });
        } catch (err) {
            return createErrorResponse(err.message || String(err), 400, "INVALID_INTERCEPT_RESPONSE");
        }
    }

    if (urlPath === "/api/notify/send" && req.method === "POST") {
        try {
            const parsedBody = parseBody(bodyPayload);
            if (typeof parsedBody.channel !== "string" || parsedBody.channel.trim().length === 0) {
                return createErrorResponse("缺少 channel", 400, "MISSING_CHANNEL");
            }

            const electron = require("electron");
            const allWebContents = typeof electron.webContents?.getAllWebContents === "function"
                ? electron.webContents.getAllWebContents()
                : [];
            const candidates = allWebContents.filter((wc) => {
                try {
                    return wc && !String(wc.getTitle?.() || "").includes("PW Hook Console");
                } catch (_) {
                    return !!wc;
                }
            });
            const target = candidates[0] || allWebContents[0];

            if (!target) {
                return createErrorResponse("未找到可用的 webContents 目标", 404, "TARGET_NOT_FOUND");
            }

            if (parsedBody && typeof parsedBody.payload === "object" && parsedBody.payload !== null) {
                parsedBody.payload[API_BYPASS_SYMBOL] = true;
            }

            target.send(parsedBody.channel.trim(), parsedBody.payload);
            return createSuccessResponse({
                sent: true,
                channel: parsedBody.channel.trim(),
                targetId: target.id,
                bypassInterception: true,
            });
        } catch (err) {
            return createErrorResponse(err.message || String(err), 500, "NOTIFY_SEND_FAILED");
        }
    }

    if (!urlPath.startsWith(routePrefix)) {
        return createErrorResponse("未找到 Hook 路由，请访问 /api/call/<route> 或 /api/list", 404, "ROUTE_NOT_FOUND");
    }

    const reqRouteMatch = urlPath.replace(routePrefix, "");
    let targetFuncName = reqRouteMatch;
    let args = [];

    try {
        const parsedBody = parseBody(bodyPayload);

        let nowait = false;
        let waitFor = null;

        const mappedRoute = ROUTE_MAPPING[reqRouteMatch];
        if (!mappedRoute) {
            return createErrorResponse(`未定义的 route: ${reqRouteMatch}`, 404, "ROUTE_NOT_DEFINED");
        }

        if (typeof mappedRoute.handler === "function") {
            return createSuccessResponse(mappedRoute.handler());
        }

        targetFuncName = mappedRoute.channel;

        // 参数预处理：填充默认值
        const finalParams = { ...parsedBody };
        const routeParamsDef = mappedRoute.params || {};

        for (const [paramKey, paramConfig] of Object.entries(routeParamsDef)) {
            if (finalParams[paramKey] === undefined || finalParams[paramKey] === null) {
                finalParams[paramKey] = paramConfig.default;
            }
        }

        args = mappedRoute.buildArgs(finalParams);
        if (args.length > 0 && args[0] && typeof args[0] === "object") {
            args[0][API_BYPASS_SYMBOL] = true;
        }
        nowait = !!mappedRoute.nowait;
        waitFor = mappedRoute.waitFor;

        const targetFunc = store.getFunction(targetFuncName);

        if (!targetFunc) {
            return createErrorResponse(`函数/通道 '${targetFuncName}' 尚未被挂载到 Hook Store，请检查注入并确保平台注册了该通道。`, 404, "TARGET_NOT_REGISTERED");
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

        // 直接提取深层挂载的数据，如 $$data$$，并作为最外层结果直接返回
        let finalPayload = result;
        if (finalPayload && typeof finalPayload === "object" && "$$data$$" in finalPayload) {
            finalPayload = finalPayload.$$data$$;
        }

        // 允许路由自定义响应解析规则 (parseResponse)
        if (typeof mappedRoute.parseResponse === "function") {
            finalPayload = mappedRoute.parseResponse(finalPayload);
        }

        return createSuccessResponse(finalPayload);
    } catch (err) {
        console.error(`[PW_HOOK] 调用通道 ${targetFuncName} 出现异常:`, err);
        return createErrorResponse(err.message || err.toString(), 500, "CALL_FAILED");
    }
};

module.exports = { handleRequest };
