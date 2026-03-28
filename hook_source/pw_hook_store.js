const { EventEmitter } = require("events");

// 核心存储模块：用于保存我们抓取到的完美平台内部函数
global.PW_HOOK_FUNCTIONS = {};
global.PW_HOOK_META = {};
global.PW_HOOK_EVENT_SEQ = 0;
global.PW_HOOK_SUBSCRIPTIONS = {
    upstream: {
        forwardChannels: [],
        interceptChannels: [],
    },
    downstream: {
        forwardChannels: [],
        interceptChannels: [],
    },
    timeoutMs: 1000,
    onTimeout: "allow",
};
global.PW_HOOK_PENDING_INTERCEPTS = {};

if (!global.PW_HOOK_EVENTS) {
    global.PW_HOOK_EVENTS = new EventEmitter();
    global.PW_HOOK_EVENTS.setMaxListeners(100);
}

const normalizeStringArray = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item) => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim());
};

const clampTimeout = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return 1000;
    }
    return Math.max(100, Math.min(10000, Math.trunc(num)));
};

const normalizeAction = (value) => {
    return value === "block" || value === "modify" ? value : "allow";
};

const getSubscriptionsSnapshot = () => {
    return {
        upstream: {
            forwardChannels: [...global.PW_HOOK_SUBSCRIPTIONS.upstream.forwardChannels],
            interceptChannels: [...global.PW_HOOK_SUBSCRIPTIONS.upstream.interceptChannels],
        },
        downstream: {
            forwardChannels: [...global.PW_HOOK_SUBSCRIPTIONS.downstream.forwardChannels],
            interceptChannels: [...global.PW_HOOK_SUBSCRIPTIONS.downstream.interceptChannels],
        },
        timeoutMs: global.PW_HOOK_SUBSCRIPTIONS.timeoutMs,
        onTimeout: global.PW_HOOK_SUBSCRIPTIONS.onTimeout,
    };
};

const normalizeDirectionConfig = (value, fallback = {}) => {
    const source = value && typeof value === "object" ? value : fallback;
    return {
        forwardChannels: normalizeStringArray(source.forwardChannels),
        interceptChannels: normalizeStringArray(source.interceptChannels),
    };
};

const updateSubscriptions = (payload = {}, mode = "set") => {
    const current = getSubscriptionsSnapshot();
    const next = mode === "patch"
        ? {
            ...current,
            ...payload,
        }
        : {
            upstream: {
                forwardChannels: [],
                interceptChannels: [],
            },
            downstream: {
                forwardChannels: [],
                interceptChannels: [],
            },
            timeoutMs: 1000,
            onTimeout: "allow",
            ...payload,
        };

    const upstreamFallback = {
        forwardChannels: next.upstreamForwardChannels,
        interceptChannels: next.upstreamInterceptChannels,
    };
    const downstreamFallback = {
        forwardChannels: next.downstreamForwardChannels ?? next.forwardChannels,
        interceptChannels: next.downstreamInterceptChannels ?? next.interceptChannels,
    };

    global.PW_HOOK_SUBSCRIPTIONS = {
        upstream: normalizeDirectionConfig(next.upstream, upstreamFallback),
        downstream: normalizeDirectionConfig(next.downstream, downstreamFallback),
        timeoutMs: clampTimeout(next.timeoutMs),
        onTimeout: normalizeAction(next.onTimeout),
    };

    return getSubscriptionsSnapshot();
};

const clearSubscriptions = () => {
    return updateSubscriptions({}, "set");
};

const createEventId = () => {
    global.PW_HOOK_EVENT_SEQ += 1;
    return `evt_${Date.now()}_${global.PW_HOOK_EVENT_SEQ}`;
};

const createHookEvent = ({
    type,
    channel,
    direction,
    payload,
    rawArgs,
    meta = {},
    eventId,
}) => {
    return {
        eventId: eventId || createEventId(),
        type,
        channel,
        direction,
        timestamp: new Date().toISOString(),
        payload,
        rawArgs,
        meta,
    };
};

const getDirectionSubscriptions = (direction) => {
    if (direction === "upstream") {
        return global.PW_HOOK_SUBSCRIPTIONS.upstream;
    }
    return global.PW_HOOK_SUBSCRIPTIONS.downstream;
};

const shouldForwardChannel = (direction, channel) => {
    return getDirectionSubscriptions(direction).forwardChannels.includes(channel);
};

const shouldInterceptChannel = (direction, channel) => {
    return getDirectionSubscriptions(direction).interceptChannels.includes(channel);
};

const createPendingIntercept = ({ channel, direction, payload, rawArgs, meta = {} }) => {
    const eventId = createEventId();
    const timeoutMs = global.PW_HOOK_SUBSCRIPTIONS.timeoutMs;
    const defaultAction = global.PW_HOOK_SUBSCRIPTIONS.onTimeout;

    let timeoutId = null;

    const decisionPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
            delete global.PW_HOOK_PENDING_INTERCEPTS[eventId];
            resolve({
                action: defaultAction,
                payload,
                reason: "timeout",
                resultSource: "timeout_default",
            });
        }, timeoutMs);

        global.PW_HOOK_PENDING_INTERCEPTS[eventId] = {
            channel,
            direction,
            originalPayload: payload,
            rawArgs,
            createdAt: Date.now(),
            timeoutId,
            resolve: (decision) => {
                clearTimeout(timeoutId);
                delete global.PW_HOOK_PENDING_INTERCEPTS[eventId];
                resolve({
                    action: normalizeAction(decision.action),
                    payload: decision.payload,
                    reason: decision.reason || "",
                    resultSource: "external_program",
                });
            },
            meta: {
                ...meta,
                timeoutMs,
                defaultAction,
            },
        };
    });

    return {
        eventId,
        timeoutMs,
        defaultAction,
        decisionPromise,
    };
};

const resolvePendingIntercept = ({ eventId, action, payload, reason }) => {
    const pending = global.PW_HOOK_PENDING_INTERCEPTS[eventId];
    if (!pending) {
        return false;
    }

    pending.resolve({
        action,
        payload: action === "modify" ? payload : pending.originalPayload,
        reason,
    });
    return true;
};

const getPendingIntercept = (eventId) => {
    return global.PW_HOOK_PENDING_INTERCEPTS[eventId] || null;
};

module.exports = {
    /**
     * 注册函数
     * @param {string} name 函数名/通道名
     * @param {Function} func 拦截到的函数引用
     * @param {Object} [meta] 元信息，如 { fireAndForget: true }
     */
    registerFunction: (name, func, meta = {}) => {
        global.PW_HOOK_FUNCTIONS[name] = func;
        global.PW_HOOK_META[name] = meta;
        console.log(`[PW_HOOK] 内部函数注入成功: ${name}${meta.fireAndForget ? " [F&F]" : ""}`);
    },

    getFunction: (name) => {
        return global.PW_HOOK_FUNCTIONS[name];
    },

    getMeta: (name) => {
        return global.PW_HOOK_META[name] || {};
    },

    getEventBus: () => {
        return global.PW_HOOK_EVENTS;
    },

    getSubscriptions: () => {
        return getSubscriptionsSnapshot();
    },

    updateSubscriptions,

    clearSubscriptions,

    shouldForwardChannel,

    shouldInterceptChannel,

    createHookEvent,

    createPendingIntercept,

    resolvePendingIntercept,

    getPendingIntercept,
};
