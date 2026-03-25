// 核心存储模块：用于保存我们抓取到的完美平台内部函数
global.PW_HOOK_FUNCTIONS = {};

module.exports = {
    /**
     * 提供给内部注入点注册函数的方法
     * @param {string} name 暴露给外部 HTTP 调用的函数名 (如 'encrypt', 'getUserInfo')
     * @param {Function} func 拦截到的真实函数引用
     */
    registerFunction: (name, func) => {
        global.PW_HOOK_FUNCTIONS[name] = func;
        console.log(`[PW_HOOK] 内部函数注入成功: ${name}`);
    },

    /**
     * 获取已注册的函数
     * @param {string} name
     * @returns {Function}
     */
    getFunction: (name) => {
        return global.PW_HOOK_FUNCTIONS[name];
    },
};
