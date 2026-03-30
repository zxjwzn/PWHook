# PWHook API 文档

## 概述

`PWHook` 提供一套本地 HTTP + SSE 接口，用于：

- 主动调用平台内部 IPC 能力
- 接收上行/下行事件推送
- 对上行/下行消息进行外部拦截、放行、阻断、修改
- 主动向前端发送下行通知

> 说明：通过 API 主动发起的请求与通知，默认不会进入订阅/拦截链。

默认服务地址：`http://127.0.0.1:28888`

---

## 统一响应格式

所有 HTTP 接口返回 JSON：

### 成功

```json
{
  "ok": true,
  "timestamp": "2026-03-28T12:00:00.000Z",
  "data": {},
  "error": null
}
```

### 失败

```json
{
  "ok": false,
  "timestamp": "2026-03-28T12:00:00.000Z",
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误说明"
  }
}
```

---

## 事件流模型

事件流接口：`GET /api/events/stream`

服务端通过 SSE 推送统一事件对象：

```json
{
  "eventId": "evt_1743150000000_1",
  "type": "notify",
  "channel": "COMMON_IM_MT_SEARCH_FRIEND_REQ",
  "direction": "upstream",
  "timestamp": "2026-03-28T12:00:00.000Z",
  "payload": {},
  "rawArgs": [],
  "meta": {}
}
```

### 字段说明

- `eventId`: 事件唯一 ID
- `type`: 事件类型
- `channel`: 平台内部通道名
- `direction`: `upstream` / `downstream` / `internal`
- `timestamp`: ISO 时间
- `payload`: 主消息体
- `rawArgs`: 原始参数数组
- `meta`: 补充元数据

### 事件类型

#### `system`
用于连接建立、系统状态同步。

#### `notify`
普通订阅通知，不要求客户端返回处理结果。

#### `intercept_request`
可拦截事件，外部程序需调用 `/api/intercepts/respond` 返回决策。

#### `intercept_result`
拦截结果事件，表示最终被 `allow` / `block` / `modify` / `timeout default`。

---

## 订阅配置

接口：`POST /api/subscriptions`

### 请求体

```json
{
  "mode": "set",
  "upstream": {
    "forwardChannels": ["COMMON_IM_MT_SEARCH_FRIEND_REQ"],
    "interceptChannels": ["COMMON_IM_MT_SEARCH_FRIEND_REQ"]
  },
  "downstream": {
    "forwardChannels": ["STEAM_STEAM_UPDATE_NOTIFY"],
    "interceptChannels": ["STEAM_STEAM_UPDATE_NOTIFY"]
  },
  "timeoutMs": 1500,
  "onTimeout": "allow"
}
```

### 字段说明

- `mode`: `set` 或 `patch`
- `upstream.forwardChannels`: 仅订阅上行消息
- `upstream.interceptChannels`: 拦截上行消息
- `downstream.forwardChannels`: 仅订阅下行消息
- `downstream.interceptChannels`: 拦截下行消息
- `timeoutMs`: 拦截等待超时，范围 $100 \sim 10000$ ms
- `onTimeout`: 超时默认行为，支持 `allow` / `block` / `modify`，当前建议使用 `allow` 或 `block`

### 说明

- 当某通道在 `interceptChannels` 中时，会进入拦截模式。
- 当某通道仅在 `forwardChannels` 中时，只推送 `notify`，不等待外部响应。
- `interceptChannels` 优先于 `forwardChannels`。
- 仅平台自然产生的上行/下行消息会进入订阅或拦截。
- 通过 `POST /api/call/<route>` 与 `POST /api/notify/send` 主动发起的消息不会进入 SSE 订阅/拦截链。

---

## HTTP 接口清单

## 1. 查询可用路由

### `GET /api/list`

返回所有可调用的映射路由名。

#### 返回示例

```json
{
  "ok": true,
  "timestamp": "2026-03-28T12:00:00.000Z",
  "data": {
    "mappedRoutes": [
      "search_friend",
      "get_user_match_history"
    ]
  },
  "error": null
}
```

---

## 2. 获取接口文档

### `GET /api/docs`

返回完整路由说明及订阅结构。

---

## 3. 获取当前订阅配置

### `GET /api/subscriptions`

---

## 4. 设置订阅配置

### `POST /api/subscriptions`

见上文“订阅配置”。

---

## 5. 清空订阅配置

### `POST /api/subscriptions/clear`

#### 请求体

```json
{}
```

---

## 6. 响应拦截事件

### `POST /api/intercepts/respond`

#### 请求体

##### 放行

```json
{
  "eventId": "evt_xxx",
  "action": "allow",
  "reason": "allow by client"
}
```

##### 阻断

```json
{
  "eventId": "evt_xxx",
  "action": "block",
  "reason": "blocked by client"
}
```

##### 修改

```json
{
  "eventId": "evt_xxx",
  "action": "modify",
  "payload": {
    "keyword": "ModifiedByClient"
  },
  "reason": "modified by client"
}
```

### 行为说明

- `allow`: 原样继续
- `block`: 终止消息处理
- `modify`: 用 `payload` 替换当前主消息体

对于当前实现：

- 上行：替换 `args[0]`
- 下行：替换 `webContents.send(channel, payload)` 中的第一个 payload 参数

---

## 7. 主动发送下行通知

### `POST /api/notify/send`

用于主动向目标前端发送一个下行通知。

> 该接口发送的消息不会触发订阅/拦截事件。

#### 请求体

```json
{
  "channel": "STEAM_STEAM_UPDATE_NOTIFY",
  "payload": {
    "id": "7656119...",
    "nickname": "test",
    "avatar": "",
    "idfromreg": false,
    "verified": true
  }
}
```

---

## 8. 调用业务路由

统一格式：`POST /api/call/<route>`

> 注意：现在**只允许调用已定义映射路由**，不再支持直接传原始 `args` 调未知通道。
>
> 该接口触发的上行请求不会进入订阅/拦截事件链。

---

## 业务路由清单

### `POST /api/call/login`
- 通道：`check-loginFromSteam`
- 说明：伪触发 check-loginFromSteam 登录/登出事件

请求体：

```json
{
  "type": "logined", //或者logout,token和uid可在登录后获取到
  "token": "",
  "uid": "",
  "login_method": 0
}
```

---

### `POST /api/call/search_friend`
- 通道：`COMMON_IM_MT_SEARCH_FRIEND_REQ`
- 说明：搜索好友

请求体：

```json
{
  "name": "玩家昵称",
  "page": 1
}
```

---

### `POST /api/call/add_friend`
- 通道：`COMMON_IM_MT_APPLY_FRIEND_REQ`
- 说明：添加好友
- 返回模式：等待 `COMMON_IM_MT_APPLY_FRIEND_RES`

请求体：

```json
{
  "uid": ""
}
```
注:errCode为0添加成功,为10则重复添加
---

### `POST /api/call/get_user_match_history`
- 通道：`CSGO_OVERVIEW_GET_MATCH_LIST_REQ`
- 说明：获取比赛列表

请求体：

```json
{
  "uid": "7656119...",
  "page": "1",
  "page_size": "15",
  "game_types": "10,12,14,16,27,20,33,40,41,44,51",
  "start_time": "",
  "end_time": "",
  "season": "",
  "ticket_id": ""
}
```

---

### `POST /api/call/get_current_season_info`
- 通道：`COMMON_GET_SEASON_DESC_REQ`
- 说明：获取当前赛季

请求体：

```json
{}
```

---

### `POST /api/call/get_user_match_calendar`
- 通道：`CSGO_OVERVIEW_GET_DAILY_STATS_REQ`
- 说明：获取比赛日历/每日统计

请求体：

```json
{
  "uid": "7656119...",
  "start_time": "2026-03-01",
  "end_time": "2026-03-28"
}
```

---

### `POST /api/call/create_ladder_team`
- 通道：`CSGO_LADDER_MT_CREATE_TEAM_REQ`
- 说明：创建天梯房间
- 返回模式：等待 `CSGO_LADDER_MT_CREATE_TEAM_RES`

请求体：

```json
{
  "map_names": ["de_dust2", "de_mirage"],
  "zone_ids": [612, 604],
  "bp_modes": [0],
  "game_target": 0,
  "specialities": [],
  "role_card_id": 0
}
```

---

### `POST /api/call/leave_ladder_team`
- 通道：`CSGO_LADDER_MT_LEAVE_TEAM_REQ`
- 说明：离开天梯房间/队伍
- 返回模式：等待 `CSGO_LADDER_MT_LEAVE_TEAM_NOTIFY`

请求体：

```json
{
  "leave_team_reason": 0
}
```

---

### `POST /api/call/get_match_zone`
- 通道：`CSGO_EMIT_GET_NETWORK_SPEED`
- 说明：获取匹配区域网络速度信息

请求体：

```json
{}
```

> 内部会自动封装 `$$data$$` 外壳。

---

### `POST /api/call/get_user_comment_list`
- 通道：`CSGO_OVERVIEW_COMMENT_GET_COMMENT_LIST_REQ`
- 说明：获取评论列表

请求体：

```json
{
  "uid": "7656119..."
}
```

---

### `POST /api/call/send_team_msg`
- 通道：`CSGO_LADDER_MT_TEAM_CHAT_REQ`
- 说明：发送队伍聊天
- 返回模式：等待 `CSGO_LADDER_MT_TEAM_CHAT_RES`

请求体：

```json
{
  "text": "hello",
  "type": 1
}
```

---

### `POST /api/call/get_friend_list`
- 通道：`COMMON_IM_MT_GET_FRIEND_LIST_REQ`
- 说明：获取好友列表
- 返回模式：等待 `COMMON_IM_MT_GET_FRIEND_LIST_RES`

请求体：

```json
{
  "friendType": 1
}
```

---

### `POST /api/call/send_friend_msg`
- 通道：`COMMON_IM_MT_CHAT_REQ`
- 说明：发送好友私信
- 返回模式：等待 `COMMON_IM_MT_CHAT_RES`

请求体：

```json
{
  "chatChannel": 1,
  "uid": "7656119...",
  "text": "hello"
}
```

---

### `POST /api/call/save_reaction_result`
- 通道：`REACTION_TESTSAVE_USER_RESULT_REQ`
- 说明：保存反应测试结果

请求体：

```json
{
  "avgReactMs": 160,
  "bstReactMs": 140,
  "hitCnt": 4,
  "lv": 4
}
```

---

### `POST /api/call/get_user_season_stats`
- 通道：`CSGO_OVERVIEW_GET_SEASON_STATS_REQ`
- 说明：获取赛季统计数据

请求体：

```json
{
  "uid": "7656119...",
  "season": "S23",
  "current_season": "S23"
}
```

---

### `POST /api/call/get_match_detail`
- 通道：`CSGO_GET_REPORT_DETAIL_REQ`
- 说明：获取赛后战绩详情

请求体：

```json
{
  "match_id": "match_xxx"
}
```

---

### `POST /api/call/get_current_user_info`
- 通道：无（内部直接返回内存状态）
- 说明：获取当前登录用户信息

请求体：

```json
{}
```
---

## SSE 使用说明

### 事件流连接

```text
GET /api/events/stream
```

建立后会先收到一条 `system` 事件，包含当前订阅状态。

### 日志流连接

```text
GET /api/log/stream
```

用于接收 Hook 控制台日志。

---

## 推荐交互流程

### 仅订阅不上拦截

1. `POST /api/subscriptions`
2. 配置 `forwardChannels`
3. 连接 `GET /api/events/stream`
4. 接收 `notify`

### 订阅并可修改

1. `POST /api/subscriptions`
2. 配置 `interceptChannels`
3. 连接 `GET /api/events/stream`
4. 收到 `intercept_request`
5. 调用 `POST /api/intercepts/respond`
6. 返回 `allow` / `block` / `modify`

### 主动调用 + 被动接收

1. 先连接 `GET /api/events/stream`
2. 设置上下行订阅
3. 通过 `POST /api/call/<route>` 发起调用
4. 在 SSE 中接收上行/下行事件
5. 如需修改则回调 `/api/intercepts/respond`

---

## 重要说明

- 当前只支持**单事件流客户端**，新的 `/api/events/stream` 连接会替换旧连接。
- `interceptChannels` 会导致对应通道进入等待外部决策流程。
- 若外部程序超时未响应，将按 `onTimeout` 处理。
- 当前 API 已彻底去除旧兼容调用方式，不再支持任意原始通道透传调用。
