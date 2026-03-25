(() => {
    const SSE_URL = "http://127.0.0.1:28888/api/log/stream";
    const LEVEL_LABELS = { log: "LOG", info: "INFO", warn: "WARN", error: "ERR", debug: "DBG" };
    const MAX_ROWS = 2000; // 最多保留的日志条数，防止内存溢出

    const logList    = document.getElementById("log-list");
    const countInfo  = document.getElementById("count-info");
    const statusBadge = document.getElementById("status-badge");
    const autoScrollChk = document.getElementById("auto-scroll");
    const clearBtn   = document.getElementById("clear-btn");
    const exportBtn  = document.getElementById("export-btn");
    const filterBtns = document.querySelectorAll(".filter-btn");
    const searchInput = document.getElementById("search-input");

    let totalCount = 0;
    let currentFilter = "all";
    let currentSearch = "";
    let es = null;
    let reconnectTimer = null;
    let reconnectDelay = 2000;
    const logBuffer = [];  // 存储格式化后的日志文本，供导出使用

    // ── 更新状态徽章 ──────────────────────────────────────────
    const setStatus = (state) => {
        statusBadge.className = "badge";
        if (state === "ok") {
            statusBadge.className += " badge-ok";
            statusBadge.textContent = "● 已连接";
        } else if (state === "error") {
            statusBadge.className += " badge-error";
            statusBadge.textContent = "✕ 断开";
        } else {
            statusBadge.className += " badge-connecting";
            statusBadge.textContent = "… 连接中";
        }
    };

    // ── 格式化时间 ────────────────────────────────────────────
    const formatTime = (iso) => {
        const d = new Date(iso);
        const pad = (n) => String(n).padStart(2, "0");
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    // ── 渲染一行日志 ──────────────────────────────────────────
    const renderRow = ({ level, time, message }) => {
        // 超出上限时移除最旧的行
        if (logList.children.length >= MAX_ROWS) {
            const first = logList.querySelector(".log-row");
            if (first) first.remove();
        }

        const row = document.createElement("div");
        row.className = `log-row level-${level}`;
        const levelMatch = currentFilter === "all" || level === currentFilter;
        const textMatch = currentSearch === "" || message.toLowerCase().includes(currentSearch);
        if (!(levelMatch && textMatch)) {
            row.classList.add("hidden");
        }
        row.dataset.level = level;

        const timeEl = document.createElement("span");
        timeEl.className = "log-time";
        timeEl.textContent = formatTime(time);

        const levelEl = document.createElement("span");
        levelEl.className = "log-level";
        levelEl.textContent = `[${LEVEL_LABELS[level] || level.toUpperCase()}]`;

        const msgEl = document.createElement("span");
        msgEl.className = "log-msg";
        msgEl.textContent = " " + message;

        row.appendChild(timeEl);
        row.appendChild(levelEl);
        row.appendChild(msgEl);
        logList.appendChild(row);

        totalCount++;
        countInfo.textContent = `${totalCount} 条日志`;

        // 同步写入导出缓冲，避免无限增长导致页面 OOM
        logBuffer.push(`[${formatTime(time)}] [${(LEVEL_LABELS[level] || level.toUpperCase()).padEnd(5)}] ${message}`);
        if (logBuffer.length > MAX_ROWS) {
            logBuffer.shift();
        }

        if (autoScrollChk.checked) {
            row.scrollIntoView({ block: "end", behavior: "auto" });
        }
    };

    // ── 移除空状态占位 ─────────────────────────────────────────
    const removeEmptyState = () => {
        const empty = document.querySelector(".empty-state");
        if (empty) empty.remove();
    };

    // ── 显示空状态占位 ─────────────────────────────────────────
    const showEmptyState = () => {
        if (document.querySelector(".empty-state")) return;
        const div = document.createElement("div");
        div.className = "empty-state";
        div.innerHTML = `
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                <polyline points="9 9 12 12 15 9"></polyline>
                <line x1="12" y1="12" x2="12" y2="17"></line>
            </svg>
            <p>等待日志输出…</p>
        `;
        logList.appendChild(div);
    };

    // ── SSE 连接 ──────────────────────────────────────────────
    const connect = () => {
        if (es) { es.close(); }
        setStatus("connecting");

        es = new EventSource(SSE_URL);

        es.onopen = () => {
            setStatus("ok");
            clearTimeout(reconnectTimer);
            reconnectDelay = 2000; // 连接成功重置退避
            removeEmptyState();
            showEmptyState();
        };

        es.onmessage = (evt) => {
            try {
                const payload = JSON.parse(evt.data);
                removeEmptyState();
                renderRow(payload);
            } catch (_) { /* 忽略心跳等非 JSON 帧 */ }
        };

        es.onerror = () => {
            setStatus("error");
            es.close();
            // 指数退避重连，最大 16 秒
            reconnectTimer = setTimeout(() => {
                reconnectDelay = Math.min(reconnectDelay * 2, 16000);
                connect();
            }, reconnectDelay);
        };
    };

    // ── 过滤器与搜索 ──────────────────────────────────────────
    const applyFilters = () => {
        document.querySelectorAll(".log-row").forEach((row) => {
            const levelMatch = currentFilter === "all" || row.dataset.level === currentFilter;
            const textMatch = currentSearch === "" || row.textContent.toLowerCase().includes(currentSearch);
            row.classList.toggle("hidden", !(levelMatch && textMatch));
        });
    };

    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            currentSearch = e.target.value.toLowerCase();
            applyFilters();
        });
    }

    // ── 过滤器 ────────────────────────────────────────────────
    filterBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            filterBtns.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            currentFilter = btn.dataset.level;
            applyFilters();
        });
    });

    // ── 清空 ──────────────────────────────────────────────────
    clearBtn.addEventListener("click", () => {
        logList.innerHTML = "";
        totalCount = 0;
        logBuffer.length = 0;
        countInfo.textContent = "0 条日志";
        showEmptyState();
    });

    // ── 导出 ──────────────────────────────────────────────────
    exportBtn.addEventListener("click", () => {
        if (logBuffer.length === 0) return;

        const text = logBuffer.join("\n");
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url  = URL.createObjectURL(blob);

        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const filename = `pwhook_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.log`;

        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // ── 启动 ──────────────────────────────────────────────────
    showEmptyState();
    connect();
})();
