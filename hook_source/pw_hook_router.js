const store = require("./pw_hook_store.js");

// 全局响应等待队列
const waitQueues = {};

// 将外部友好的 API 转换为内部的 IPC Channel 和数组参数
const ROUTE_MAPPING = {
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
    get_match_list: {
        description: "获取比赛列表",
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
    get_current_season: {
        description: "获取当前赛季",
        params: {},
        channel: "COMMON_GET_SEASON_DESC_REQ",
        buildArgs: () => {
            return [{}];
        },
    },
    get_match_calendar: {
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
    create_ladder_room: {
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
    leave_ladder_room: {
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
    get_comment_list: {
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
    send_team_chat: {
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
                    chat_text: String(params.chat_text),
                    chat_type: Number(params.chat_type),
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
    get_season_stats: {
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
    // 约定 API 统一路径前缀: /api/call/函数名
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
                url: `/api/call/${key}`,
            };
        }
        return {
            status: 200,
            data: docs,
        };
    }

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

            // 参数预处理：填充默认值
            const finalParams = { ...parsedBody }; // 复制请求体作为基础
            const routeParamsDef = mappedRoute.params || {};

            for (const [paramKey, paramConfig] of Object.entries(routeParamsDef)) {
                // 如果请求体中没有该参数（undefined或null），则使用默认值
                if (finalParams[paramKey] === undefined || finalParams[paramKey] === null) {
                    finalParams[paramKey] = paramConfig.default;
                }
            }

            // 使用处理后的参数构建 IPC 参数数组
            args = mappedRoute.buildArgs(finalParams);

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

        // 直接提取深层挂载的数据，如 $$data$$，并作为最外层结果直接返回
        let finalPayload = result;
        if (finalPayload && typeof finalPayload === "object" && "$$data$$" in finalPayload) {
            finalPayload = finalPayload.$$data$$;
        }

        // 允许路由自定义响应解析规则 (parseResponse)
        if (ROUTE_MAPPING[reqRouteMatch] && typeof ROUTE_MAPPING[reqRouteMatch].parseResponse === "function") {
            finalPayload = ROUTE_MAPPING[reqRouteMatch].parseResponse(finalPayload);
        }

        return { status: 200, data: finalPayload };
    } catch (err) {
        console.error(`[PW_HOOK] 调用通道 ${targetFuncName} 出现异常:`, err);
        return { status: 500, data: { error: err.message || err.toString() } };
    }
};

module.exports = { handleRequest };
