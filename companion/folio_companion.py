"""Folio Windows companion. Runs locally; never accepts shell or network commands."""
from __future__ import annotations

import argparse
import base64
import hmac
import json
import math
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

VERSION = 1
PORT = 8765
SITE_ORIGIN = "https://folio-book-studio.goofycamel128.chatgpt.site"
MAX_BODY = 32_768
FRAME_TTL = 120
KEYS = frozenset(("enter", "tab", "escape", "backspace", "delete", "up", "down", "left", "right", "space", "ctrl+a", "ctrl+c", "ctrl+z", "ctrl+y", "ctrl+s", "f5"))


class Rejected(Exception):
    def __init__(self, code, message, status=409):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


def title_text(value):
    return "".join(c for c in str(value) if c.isprintable())[:200]


def client_point(bounds, x, y):
    left, top, width, height, _pid = bounds
    return left + round(x * (width - 1) / 1000), top + round(y * (height - 1) / 1000)


def scroll_delta(amount):
    # Protocol positive means down; native wheel positive means up.
    return -amount * 120


def object_fields(value, allowed, required=()):
    if type(value) is not dict or set(value) - set(allowed) or not set(required) <= set(value):
        raise Rejected("INVALID_INPUT", "요청 형식을 확인하세요.", 400)


def validate_action(value):
    object_fields(value, ("type", "x", "y", "text", "key", "amount"), ("type",))
    kind = value["type"]
    if kind not in ("click", "double_click", "type_text", "press_key", "scroll", "wait"):
        raise Rejected("ACTION_NOT_ALLOWED", "지원하지 않는 조작입니다.", 400)
    action = {"type": kind, "x": 0, "y": 0, "text": "", "key": "", "amount": 0, **value}
    for field in ("x", "y"):
        number = action[field]
        if type(number) not in (int, float) or not math.isfinite(number) or not 0 <= number <= 1000:
            raise Rejected("INVALID_INPUT", "화면 좌표가 범위를 벗어났습니다.", 400)
    if type(action["text"]) is not str or len(action["text"]) > 4000 or any(ord(c) < 32 and c not in "\t\r\n" for c in action["text"]) or any(0xD800 <= ord(c) <= 0xDFFF for c in action["text"]):
        raise Rejected("INVALID_INPUT", "입력할 글은 4,000자 이내여야 합니다.", 400)
    if type(action["key"]) is not str or len(action["key"]) > 20:
        raise Rejected("INVALID_INPUT", "허용된 키를 선택하세요.", 400)
    action["key"] = action["key"].lower()
    if type(action["amount"]) is not int or not -5 <= action["amount"] <= 5:
        raise Rejected("INVALID_INPUT", "스크롤 범위를 확인하세요.", 400)
    required = {"click": ("x", "y"), "double_click": ("x", "y"), "scroll": ("x", "y", "amount"), "type_text": ("text",), "press_key": ("key",)}.get(kind, ())
    if any(key not in value for key in required):
        raise Rejected("INVALID_INPUT", "조작에 필요한 값이 없습니다.", 400)
    if kind == "press_key" and action["key"] not in KEYS:
        raise Rejected("ACTION_NOT_ALLOWED", "이 키 조합은 사용할 수 없습니다.", 400)
    return action


class Bridge:
    def __init__(self, desktop, clock=time.monotonic):
        self.desktop, self.clock = desktop, clock
        self.lock = threading.RLock()
        self.operation_lock = threading.Lock()
        self.selected = None
        self.session = None
        self.frame = None
        self.generation = 0
        self.stopped = False

    def stop(self):
        with self.lock:
            self.selected = self.session = self.frame = None
            self.generation += 1
            self.stopped = True

    def _session(self, session):
        if not self.session or type(session) is not str or not session.isascii() or not hmac.compare_digest(session, self.session):
            raise Rejected("SESSION_EXPIRED", "조작이 중지되었습니다. 창을 다시 선택하세요.")

    def _guard(self, generation, window, bounds):
        with self.lock:
            if generation != self.generation or self.selected != window or self.stopped:
                raise Rejected("STOPPED", "조작을 중지했습니다.")
        self.desktop.check(window, bounds)

    def dispatch(self, method, path, data):
        if method == "GET" and path == "/v1/status":
            return {"version": VERSION, "platform": "windows"}
        if method == "GET" and path == "/v1/windows":
            return {"windows": [{"id": str(w["id"]), "title": title_text(w["title"])} for w in self.desktop.windows()[:200]]}
        if method == "POST" and path == "/v1/stop":
            object_fields(data, ())
            self.stop()
            return {"ok": True}
        if method != "POST" or path not in ("/v1/select", "/v1/observe", "/v1/action"):
            raise Rejected("NOT_FOUND", "지원하지 않는 요청입니다.", 404)
        if not self.operation_lock.acquire(blocking=False):
            raise Rejected("BUSY", "이전 조작이 끝난 뒤 다시 시도하세요.")
        try:
            return self._operate(path, data)
        finally:
            self.operation_lock.release()

    def _operate(self, path, data):
        if path == "/v1/select":
            object_fields(data, ("windowId",), ("windowId",))
            window = data["windowId"]
            if type(window) is not str or len(window) > 32 or not window.isascii() or not window.isdecimal():
                raise Rejected("INVALID_INPUT", "창을 목록에서 선택하세요.", 400)
            if not any(str(w["id"]) == window for w in self.desktop.windows()):
                raise Rejected("WINDOW_UNAVAILABLE", "선택한 창을 찾을 수 없습니다.")
            with self.lock:
                self.generation += 1
                generation = self.generation
                self.selected = self.session = self.frame = None
                self.stopped = False
            def activation_guard():
                with self.lock:
                    if generation != self.generation or self.stopped:
                        raise Rejected("STOPPED", "조작을 중지했습니다.")
            def activate_emit(operation):
                with self.lock:
                    activation_guard()
                    return operation()
            activation_guard.emit = activate_emit
            # Waiting for a user's manual focus must never hold the stop lock.
            self.desktop.activate(window, activation_guard)
            self.desktop.check(window)
            with self.lock:
                activation_guard()
                self.selected, self.session = window, secrets.token_hex(24)
                return {"sessionId": self.session}
        if path == "/v1/observe":
            object_fields(data, ("sessionId",), ("sessionId",))
            with self.lock:
                self._session(data["sessionId"])
                window, generation = self.selected, self.generation
                self.frame = None
            # Only explicit selection may activate a window; observing never steals focus.
            bounds = self.desktop.check(window)
            self._guard(generation, window, bounds)
            png, width, height, title = self.desktop.capture(window, bounds)
            self._guard(generation, window, bounds)
            if not png or len(png) > 8_000_000 or not 1 <= width <= 1920 or not 1 <= height <= 1920:
                raise Rejected("CAPTURE_FAILED", "이 창의 화면을 가져오지 못했습니다.")
            frame_id = secrets.token_hex(24)
            with self.lock:
                if generation != self.generation:
                    raise Rejected("STOPPED", "조작을 중지했습니다.")
                self.frame = {"id": frame_id, "bounds": bounds, "time": self.clock(), "generation": generation}
                return {"sessionId": self.session, "frameId": frame_id, "window": {"id": window, "title": title_text(title)}, "image": {"src": "data:image/png;base64," + base64.b64encode(png).decode("ascii"), "width": width, "height": height}}
        object_fields(data, ("sessionId", "frameId", "action"), ("sessionId", "frameId", "action"))
        action = validate_action(data["action"])
        with self.lock:
            self._session(data["sessionId"])
            frame = self.frame
            if not frame or type(data["frameId"]) is not str or not data["frameId"].isascii() or not hmac.compare_digest(data["frameId"], frame["id"]) or self.clock() - frame["time"] > FRAME_TTL:
                raise Rejected("FRAME_EXPIRED", "화면을 다시 확인한 뒤 조작하세요.")
            self.frame = None  # Consume before any input; failed actions cannot be replayed.
            window, generation = self.selected, self.generation
        guard = lambda: self._guard(generation, window, frame["bounds"])
        def emit(operation):
            # Acknowledging stop and emitting native input share this lock. Once
            # stop returns, no later input batch from this generation can start.
            with self.lock:
                guard()
                return operation()
        guard.emit = emit
        guard()
        self.desktop.action(window, frame["bounds"], action, guard)
        return {"ok": True}


def allowed_developer_origin(value):
    parsed = urlsplit(value)
    if parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1") or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise argparse.ArgumentTypeError("개발 출처는 명시적인 http://localhost:포트 또는 http://127.0.0.1:포트만 허용됩니다.")
    try:
        if not parsed.port:
            raise ValueError()
    except ValueError as exc:
        raise argparse.ArgumentTypeError("개발 출처의 포트를 확인하세요.") from exc
    return value


class CompanionServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, desktop, token, origin=SITE_ORIGIN, port=PORT):
        self.bridge = Bridge(desktop)
        self.token, self.origin = token, origin
        super().__init__(("127.0.0.1", port), Handler)
        self.expected_host = "127.0.0.1:" + str(self.server_port)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "FolioLocal/1"

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_args):
        pass  # Never log tokens, window titles, text, or screenshots.

    def _reply(self, status, body, cors=False):
        encoded = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        if cors:
            self.send_header("Access-Control-Allow-Origin", self.server.origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "0")
        self.end_headers()
        self.wfile.write(encoded)
        self.close_connection = True

    def _handle(self):
        cors = False
        try:
            if self.client_address[0] != "127.0.0.1" or self.headers.get_all("Host") != [self.server.expected_host]:
                raise Rejected("FORBIDDEN", "로컬 연결만 허용됩니다.", 403)
            if self.headers.get_all("Origin") != [self.server.origin]:
                raise Rejected("FORBIDDEN", "허용된 Folio 화면에서 연결하세요.", 403)
            cors = True
            if self.command == "OPTIONS":
                requested = self.headers.get("Access-Control-Request-Method", "")
                headers = {h.strip().lower() for h in self.headers.get("Access-Control-Request-Headers", "").split(",") if h.strip()}
                if requested not in ("GET", "POST") or headers - {"authorization", "content-type"}:
                    raise Rejected("FORBIDDEN", "허용되지 않은 요청입니다.", 403)
                self._reply(200, {"ok": True}, cors=True)
                return
            auth = self.headers.get_all("Authorization")
            if not auth or len(auth) != 1 or not hmac.compare_digest(auth[0].encode("utf-8"), ("Bearer " + self.server.token).encode("ascii")):
                raise Rejected("UNAUTHORIZED", "연결 코드를 확인하세요.", 401)
            if self.headers.get_all("Transfer-Encoding"):
                raise Rejected("INVALID_INPUT", "지원하지 않는 요청 형식입니다.", 400)
            data = None
            lengths = self.headers.get_all("Content-Length") or []
            if len(lengths) > 1 or (lengths and (not lengths[0].isascii() or not lengths[0].isdecimal())):
                raise Rejected("INVALID_INPUT", "요청 크기를 확인하세요.", 400)
            length = int(lengths[0]) if lengths else 0
            if length > MAX_BODY:
                raise Rejected("TOO_LARGE", "요청 내용이 너무 큽니다.", 413)
            if self.command == "POST":
                if self.headers.get_content_type() != "application/json" or not length:
                    raise Rejected("INVALID_INPUT", "JSON 요청이 필요합니다.", 400)
                payload = self.rfile.read(length)
                if len(payload) != length:
                    raise Rejected("INVALID_INPUT", "요청이 완성되지 않았습니다.", 400)
                def unique_pairs(pairs):
                    result = {}
                    for key, value in pairs:
                        if key in result:
                            raise ValueError("duplicate key")
                        result[key] = value
                    return result
                try:
                    data = json.loads(payload.decode("utf-8"), object_pairs_hook=unique_pairs, parse_constant=lambda _value: (_ for _ in ()).throw(ValueError("nonfinite")))
                except (ValueError, UnicodeError, RecursionError):
                    raise Rejected("INVALID_INPUT", "JSON 내용을 확인하세요.", 400)
            elif length:
                raise Rejected("INVALID_INPUT", "GET 요청에 내용을 넣을 수 없습니다.", 400)
            result = self.server.bridge.dispatch(self.command, self.path, data)
            self._reply(200, result, cors=True)
        except Rejected as exc:
            self._reply(exc.status, {"error": {"code": exc.code, "message": exc.message}}, cors=cors)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True
        except Exception:
            self.server.bridge.stop()
            self._reply(500, {"error": {"code": "LOCAL_FAILURE", "message": "로컬 조작을 중지했습니다. 창과 연결 프로그램을 확인하세요."}}, cors=cors)

    do_GET = do_POST = do_OPTIONS = _handle


def main():
    parser = argparse.ArgumentParser(description="Folio Windows 화면 연결")
    parser.add_argument("--dev-origin", type=allowed_developer_origin, help="개발 전용 localhost 출처")
    args = parser.parse_args()
    import sys
    if sys.platform != "win32":
        parser.error("이 연결 프로그램은 Windows 10/11에서 실행합니다.")
    # Running this file directly must share Rejected with the adapter's import.
    # Otherwise expected focus/stop errors become unrelated exception classes.
    sys.modules["folio_companion"] = sys.modules[__name__]
    from windows_desktop import WindowsDesktop
    desktop = WindowsDesktop()
    token = secrets.token_hex(32)
    server = CompanionServer(desktop, token, args.dev_origin or SITE_ORIGIN)
    desktop.install_stop(server.bridge.stop)
    print("\nFolio 컴퓨터 연결 · 이 창을 열어 두세요.")
    print("연결할 사이트:", server.origin)
    print("연결 코드 (Folio에만 입력):", token, flush=True)
    print("F8: 즉시 조작 중지 · 마우스를 화면 모서리로 이동: 조작 차단")
    print("프로그램을 다시 실행하면 연결 코드가 바뀝니다. Ctrl+C: 종료\n", flush=True)
    try:
        server.serve_forever(poll_interval=0.1)
    except KeyboardInterrupt:
        pass
    finally:
        server.bridge.stop()
        server.server_close()
        desktop.close()


if __name__ == "__main__":
    main()
