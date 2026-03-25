(() => {
    const SSE_URL = "http://127.0.0.1:28888/api/log/stream";
    const LEVEL_LABELS = { log: "LOG", info: "INFO", warn: "WARN", error: "ERR", debug: "DBG" };
    const MAX_ROWS = 2000; // 最多保留的日志条数，防止内存溢出

    const logList    = document.getElementById("log-list");
    const countInfo  = document.getElementById("count-info");
    const statusBadge = document.getElementById("status-badge");
    const autoScrollChk = document.getElementById("auto-scroll");
    const clearBtn   = document.getElementById("clear-btn");
    const filterBtns = document.querySelectorAll(".filter-btn");

    let totalCount = 0;
    let currentFilter = "all";
    let es = null;
    let reconnectTimer = null;

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
        if (currentFilter !== "all" && currentFilter !== level) {
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
            // 2 秒后自动重连
            reconnectTimer = setTimeout(connect, 2000);
        };
    };

    // ── 过滤器 ────────────────────────────────────────────────
    filterBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            filterBtns.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            currentFilter = btn.dataset.level;

            document.querySelectorAll(".log-row").forEach((row) => {
                const matches = currentFilter === "all" || row.dataset.level === currentFilter;
                row.classList.toggle("hidden", !matches);
            });
        });
    });

    // ── 清空 ──────────────────────────────────────────────────
    clearBtn.addEventListener("click", () => {
        logList.innerHTML = "";
        totalCount = 0;
        countInfo.textContent = "0 条日志";
        showEmptyState();
    });

    // ── 启动 ──────────────────────────────────────────────────
    showEmptyState();
    connect();
})();
