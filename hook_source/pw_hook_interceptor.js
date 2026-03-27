// 拦截器配置
// 用于拦截并修改 前端<->后端 的通信数据
const FIXED_VERSION = "1.0.26032612";

const patchUpdatePayload = (payload) => {
    if (!payload || typeof payload !== "object") {
        return payload;
    }
    const nextPayload = { ...payload, version: FIXED_VERSION };
    return nextPayload;
};

module.exports = {
    /**
     * 上行拦截 (Frontend -> Backend)
     * 在这里修改请求参数
     */
    upstream: {
        // 示例：拦截搜索好友请求，强制修改搜索关键词
        // "COMMON_IM_MT_SEARCH_FRIEND_REQ": (eventType, ...args) => {
        //     console.log("拦截到搜索好友请求，正在修改参数...");
        //     // args[0] 是 ipcMain event 对象，通常不修改
        //     // args[1] 是前端传来的 payload
        //     if (args[1] && args[1].keyword) {
        //         args[1].keyword = "ModifiedKeyword";
        //     }
        //     return args;
        // }

    },

    /**
     * 下行拦截 (Backend -> Frontend)
     * 在这里修改推送数据
     */
    downstream: {
        "autoUpdater-available": (eventType, args) => {
            const modifiedArgs = Array.isArray(args) ? [...args] : [];
            modifiedArgs[0] = patchUpdatePayload(modifiedArgs[0]);
            return {
                channel: "update-not-available",
                args: modifiedArgs,
            };
        },
        "STEAM_LOCAL_ACCOUNT_CHANGED": (eventType, args) => {
            const modifiedArgs = Array.isArray(args) ? [...args] : [];
            // 如果原本传的就是数组结构 (例如 args[0] 是 payload 数组)
            if (Array.isArray(modifiedArgs[0]) && modifiedArgs[0][0]) {
                modifiedArgs[0][0].isSteamLogined = false;
                modifiedArgs[0][0].isSteamIdMatch = true;
            } else if (modifiedArgs[0]) {
                modifiedArgs[0].isSteamLogined = false;
                modifiedArgs[0].isSteamIdMatch = true;
            }
            return modifiedArgs;
        },
        "STEAM_STEAM_UPDATE_NOTIFY": (eventType, args) => {
            const modifiedArgs = Array.isArray(args) ? [...args] : [];
            
            const overrideData = {
                "id": "76561199239534680",
                "nickname": "用户9534680",
                "avatar": "https://img.wmpvp.com/pvp/c3/c5/c3c5641ec7eb764c0360a9f30a7d457a1761551660.png",
                "idfromreg": false,
                "verified": true
            };

            // 如果原本就是对象，直接合并 (args[0] 就是 payload)
            if (modifiedArgs[0] && typeof modifiedArgs[0] === 'object' && !Array.isArray(modifiedArgs[0])) {
                modifiedArgs[0] = { ...modifiedArgs[0], ...overrideData };
            } else if (Array.isArray(modifiedArgs[0])) {
                // 如果是数组包裹对象的情况
                modifiedArgs[0][0] = { ...modifiedArgs[0][0], ...overrideData };
            }
            
            return modifiedArgs;
        },
        // 示例：拦截好友列表推送，修改数据
        // "COMMON_IM_MT_GET_FRIEND_LIST_RES": (args) => {
        //    if (args[0] && args[0].friends) {
        //        args[0].friends.forEach(f => f.name = "[Hooked] " + f.name);
        //    }
        //    return args;
        // }
    }
};