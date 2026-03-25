/**
 * 通用回调→Promise 转换工具
 *
 * 针对完美平台常见的回调 API 模式:
 *   someFunc(params, successCallback, errorCallback)
 *
 * 将其转换为:
 *   promisify(someFunc, params) => Promise<result>
 */

/**
 * 将回调式函数转为 Promise
 * @param {Function} fn          - 原始函数
 * @param {Object}   thisArg     - 函数调用的 this 上下文
 * @param {Array}    args        - 除回调外的参数列表
 * @param {number}   successIdx  - 成功回调在原始参数列表中的索引 (从0开始)
 * @param {number}   errorIdx    - 失败回调在原始参数列表中的索引 (从0开始), -1 表示没有
 * @returns {Promise}
 */
const promisifyCall = (fn, thisArg, args, successIdx, errorIdx) => {
    return new Promise((resolve, reject) => {
        const fullArgs = [...args];

        // 确保参数数组有足够的长度
        const maxIdx = Math.max(successIdx, errorIdx);
        while (fullArgs.length <= maxIdx) {
            fullArgs.push(undefined);
        }

        // 插入成功回调
        fullArgs[successIdx] = (...result) => {
            // 如果只有一个返回值，直接返回；多个则返回数组
            resolve(result.length <= 1 ? result[0] : result);
        };

        // 插入失败回调（如果有配置）
        if (errorIdx >= 0) {
            fullArgs[errorIdx] = (...errArgs) => {
                const errMsg = errArgs.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(", ");
                reject(new Error(errMsg));
            };
        }

        try {
            fn.apply(thisArg, fullArgs);
        } catch (err) {
            reject(err);
        }
    });
};

module.exports = { promisifyCall };
