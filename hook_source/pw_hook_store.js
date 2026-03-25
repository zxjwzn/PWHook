const { EventEmitter } = require("events");

// 核心存储模块：用于保存我们抓取到的完美平台内部函数
global.PW_HOOK_FUNCTIONS = {};
global.PW_HOOK_META = {};

if (!global.PW_HOOK_EVENTS) {
    global.PW_HOOK_EVENTS = new EventEmitter();
    global.PW_HOOK_EVENTS.setMaxListeners(100);
}

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
};
