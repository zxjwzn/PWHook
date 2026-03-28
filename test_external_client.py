import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

BASE_URL = "http://127.0.0.1:28888"


def request_json(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{BASE_URL}{path}"
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body)


def pretty(title: str, data: Any) -> None:
    print(f"\n=== {title} ===")
    print(json.dumps(data, ensure_ascii=False, indent=2))


def sse_listener(stop_event: threading.Event) -> None:
    url = f"{BASE_URL}/api/events/stream"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print("[SSE] 已连接 /api/events/stream")
            current_event = "message"
            data_lines: list[str] = []

            while not stop_event.is_set():
                raw_line = resp.readline()
                if not raw_line:
                    print("[SSE] 连接已关闭")
                    return

                line = raw_line.decode("utf-8", errors="ignore").rstrip("\r\n")
                if not line:
                    if data_lines:
                        joined = "\n".join(data_lines)
                        try:
                            payload = json.loads(joined)
                        except json.JSONDecodeError:
                            print(f"[SSE] 非 JSON 数据: {joined}")
                            current_event = "message"
                            data_lines.clear()
                            continue

                        print(f"\n[SSE] event={current_event}")
                        print(json.dumps(payload, ensure_ascii=False, indent=2))

                        if payload.get("type") == "intercept_request":
                            event_id = payload.get("eventId")
                            channel = payload.get("channel")
                            direction = payload.get("direction")
                            original_payload = payload.get("payload")
                            print(f"[SSE] 自动放行拦截事件: {event_id} [{channel}]")
                            try:
                                action_payload = {
                                    "eventId": event_id,
                                    "action": "allow",
                                    "reason": "test client auto allow",
                                }

                                if direction == "upstream" and channel == "COMMON_IM_MT_SEARCH_FRIEND_REQ":
                                    action_payload = {
                                        "eventId": event_id,
                                        "action": "modify",
                                        "payload": {
                                            **(original_payload if isinstance(original_payload, dict) else {}),
                                            "keyword": "ModifiedByExternalClient",
                                        },
                                        "reason": "test client auto modify upstream search keyword",
                                    }

                                result = request_json(
                                    "POST",
                                    "/api/intercepts/respond",
                                    action_payload,
                                )
                                pretty("intercepts/respond", result)
                            except Exception as err:  # noqa: BLE001
                                print(f"[SSE] 自动回应失败: {err}")

                    current_event = "message"
                    data_lines.clear()
                    continue

                if line.startswith(":"):
                    continue

                if line.startswith("event:"):
                    current_event = line[6:].strip() or "message"
                    continue

                if line.startswith("data:"):
                    data_lines.append(line[5:].lstrip())
    except Exception as err:  # noqa: BLE001
        print(f"[SSE] 监听异常: {err}")


def main() -> None:
    stop_event = threading.Event()
    listener = threading.Thread(target=sse_listener, args=(stop_event,), daemon=True)
    listener.start()

    time.sleep(1)

    pretty("GET /api/list", request_json("GET", "/api/list"))
    pretty("GET /api/docs", request_json("GET", "/api/docs"))
    pretty("GET /api/subscriptions", request_json("GET", "/api/subscriptions"))

    subscription_payload = {
        "mode": "set",
        "upstream": {
            "forwardChannels": [
                "COMMON_IM_MT_SEARCH_FRIEND_REQ",
            ],
            "interceptChannels": [
                "COMMON_IM_MT_SEARCH_FRIEND_REQ",
            ],
        },
        "downstream": {
            "forwardChannels": [
                "STEAM_STEAM_UPDATE_NOTIFY",
            ],
            "interceptChannels": [
                "STEAM_STEAM_UPDATE_NOTIFY",
            ],
        },
        "timeoutMs": 1500,
        "onTimeout": "allow",
    }
    pretty(
        "POST /api/subscriptions",
        request_json("POST", "/api/subscriptions", subscription_payload),
    )

    notify_payload = {
        "channel": "STEAM_STEAM_UPDATE_NOTIFY",
        "payload": {
            "id": "76561199239534680",
            "nickname": "测试客户端触发",
            "avatar": "",
            "idfromreg": False,
            "verified": True,
        },
    }
    pretty(
        "POST /api/notify/send",
        request_json("POST", "/api/notify/send", notify_payload),
    )

    pretty(
        "POST /api/call/search_friend",
        request_json(
            "POST",
            "/api/call/search_friend",
            {
                "name": "OriginalKeyword",
                "page": 1,
            },
        ),
    )

    print("\n等待 5 秒以接收 SSE 推送与拦截结果（预期仅看到非主动触发消息）...\n")
    time.sleep(5)

    pretty("POST /api/subscriptions/clear", request_json("POST", "/api/subscriptions/clear", {}))

    stop_event.set()
    time.sleep(1)


if __name__ == "__main__":
    main()
