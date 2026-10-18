import base64
import ctypes
import http.client
import importlib.util
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch

from folio_companion import Bridge, CompanionServer, FRAME_TTL, KEYS, Rejected, SITE_ORIGIN, allowed_developer_origin, validate_action, client_point, scroll_delta


class FakeDesktop:
    def __init__(self):
        self.foreground = None
        self.bounds = (10, 20, 800, 600, 9)
        self.calls = []
        self.on_capture = None
        self.on_action = None

    def windows(self):
        return [{"id": "123", "title": "예제\x00 창\n"}]

    def activate(self, window, guard):
        def activate():
            self.calls.append(("activate", window))
            self.foreground = window
        guard.emit(activate)

    def check(self, window, bounds=None):
        if self.foreground != window:
            raise Rejected("FOCUS_CHANGED", "focus")
        if bounds is not None and bounds != self.bounds:
            raise Rejected("WINDOW_CHANGED", "bounds")
        return self.bounds

    def capture(self, window, bounds):
        if self.on_capture:
            self.on_capture()
        return b"fake-png", 800, 600, "예제 창"

    def action(self, window, bounds, action, guard):
        if self.on_action:
            self.on_action()
        guard()
        self.calls.append(("input", action))


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.desktop = FakeDesktop()
        self.now = 1000
        self.bridge = Bridge(self.desktop, lambda: self.now)

    def select(self):
        return self.bridge.dispatch("POST", "/v1/select", {"windowId": "123"})["sessionId"]

    def observe(self, session):
        return self.bridge.dispatch("POST", "/v1/observe", {"sessionId": session})

    def act(self, session, frame, action=None):
        return self.bridge.dispatch("POST", "/v1/action", {"sessionId": session, "frameId": frame, "action": action or {"type": "click", "x": 500, "y": 500}})

    def assert_code(self, code, function):
        with self.assertRaises(Rejected) as result:
            function()
        self.assertEqual(result.exception.code, code)

    def test_status_and_window_title_are_bounded(self):
        self.assertEqual(self.bridge.dispatch("GET", "/v1/status", None), {"version": 1, "platform": "windows"})
        self.assertEqual(self.bridge.dispatch("GET", "/v1/windows", None), {"windows": [{"id": "123", "title": "예제 창"}]})

    def test_unknown_window_cannot_be_selected(self):
        self.assert_code("WINDOW_UNAVAILABLE", lambda: self.bridge.dispatch("POST", "/v1/select", {"windowId": "999"}))
        self.assertEqual(self.desktop.calls, [])

    def test_frame_is_single_use_even_after_failed_action(self):
        session = self.select()
        frame = self.observe(session)
        self.desktop.foreground = "other"
        self.assert_code("FOCUS_CHANGED", lambda: self.act(session, frame["frameId"]))
        self.desktop.foreground = "123"
        self.assert_code("FRAME_EXPIRED", lambda: self.act(session, frame["frameId"]))
        self.assertFalse(any(call[0] == "input" for call in self.desktop.calls))

    def test_observe_does_not_restore_focus(self):
        session = self.select()
        self.desktop.foreground = "other"
        self.assert_code("FOCUS_CHANGED", lambda: self.observe(session))
        self.assertEqual(self.desktop.foreground, "other")
        self.assertEqual(self.desktop.calls, [("activate", "123")])

    def test_expired_frame_never_sends_input(self):
        session = self.select()
        frame = self.observe(session)
        self.now += FRAME_TTL + 0.01
        self.assert_code("FRAME_EXPIRED", lambda: self.act(session, frame["frameId"]))
        self.assertEqual(len(self.desktop.calls), 1)

    def test_action_replay_and_changed_geometry_are_rejected(self):
        session = self.select()
        frame = self.observe(session)
        self.assertEqual(self.act(session, frame["frameId"]), {"ok": True})
        self.assert_code("FRAME_EXPIRED", lambda: self.act(session, frame["frameId"]))
        frame = self.observe(session)
        self.desktop.bounds = (0, 0, 800, 600, 9)
        self.assert_code("WINDOW_CHANGED", lambda: self.act(session, frame["frameId"]))

    def test_stop_revokes_session_and_frame(self):
        session = self.select()
        frame = self.observe(session)
        self.bridge.dispatch("POST", "/v1/stop", {})
        self.assert_code("SESSION_EXPIRED", lambda: self.act(session, frame["frameId"]))
        self.assert_code("SESSION_EXPIRED", lambda: self.observe(session))
        self.assertNotEqual(self.select(), session)

    def test_stop_during_capture_cannot_restore_session(self):
        session = self.select()
        self.desktop.on_capture = self.bridge.stop
        self.assert_code("STOPPED", lambda: self.observe(session))
        self.assertIsNone(self.bridge.frame)
        self.assertIsNone(self.bridge.session)

    def test_stop_immediately_before_input_blocks_action(self):
        session = self.select()
        frame = self.observe(session)
        self.desktop.on_action = self.bridge.stop
        self.assert_code("STOPPED", lambda: self.act(session, frame["frameId"]))
        self.assertFalse(any(call[0] == "input" for call in self.desktop.calls))

    def test_new_observation_invalidates_previous_frame(self):
        session = self.select()
        old = self.observe(session)
        new = self.observe(session)
        self.assert_code("FRAME_EXPIRED", lambda: self.act(session, old["frameId"]))
        self.assertEqual(self.act(session, new["frameId"]), {"ok": True})

    def test_reselect_revokes_old_session(self):
        old = self.select()
        new = self.select()
        self.assertNotEqual(new, old)
        self.assert_code("SESSION_EXPIRED", lambda: self.observe(old))
        self.assert_code("SESSION_EXPIRED", lambda: self.observe("한글"))

    def test_capture_response_is_exact_protocol(self):
        session = self.select()
        frame = self.observe(session)
        self.assertEqual(set(frame), {"sessionId", "frameId", "window", "image"})
        self.assertEqual(frame["sessionId"], session)
        self.assertEqual(frame["image"], {"src": "data:image/png;base64," + base64.b64encode(b"fake-png").decode(), "width": 800, "height": 600})

    def test_unknown_paths_and_extra_fields_cannot_execute(self):
        for path, data in [("/v1/shell", {"command": "cmd"}), ("/v1/select", {"windowId": "123", "shell": "cmd"}), ("/v1/stop", {"command": "cmd"})]:
            with self.subTest(path=path), self.assertRaises(Rejected):
                self.bridge.dispatch("POST", path, data)

    def test_parallel_operation_is_busy_but_stop_remains_available(self):
        session = self.select()
        with self.bridge.operation_lock:
            self.assert_code("BUSY", lambda: self.observe(session))
            self.assertEqual(self.bridge.dispatch("POST", "/v1/stop", {}), {"ok": True})

    def test_native_emission_lease_finishes_before_stop_acknowledges(self):
        session = self.select()
        frame = self.observe(session)
        emitting, release, stopped = threading.Event(), threading.Event(), threading.Event()
        errors = []
        def desktop_action(window, bounds, action, guard):
            def native_input():
                emitting.set()
                self.assertTrue(release.wait(2))
                self.desktop.calls.append(("input", action))
            guard.emit(native_input)
            # Wait until stop has acknowledged, then attempt another batch.
            self.assertTrue(stopped.wait(2))
            self.assert_code("STOPPED", lambda: guard.emit(native_input))
        self.desktop.action = desktop_action
        def run_action():
            try:
                self.act(session, frame["frameId"])
            except Exception as exc:
                errors.append(exc)
        worker = threading.Thread(target=run_action)
        worker.start()
        self.assertTrue(emitting.wait(2))
        def stop():
            self.bridge.stop()
            stopped.set()
        stopper = threading.Thread(target=stop)
        stopper.start()
        self.assertFalse(stopped.wait(0.05))
        release.set()
        worker.join(3)
        stopper.join(3)
        self.assertFalse(worker.is_alive())
        self.assertFalse(stopper.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(sum(call[0] == "input" for call in self.desktop.calls), 1)

    def test_waiting_for_manual_window_focus_does_not_delay_stop(self):
        waiting, release, stopped = threading.Event(), threading.Event(), threading.Event()
        errors = []
        def activate(window, guard):
            waiting.set()
            self.assertTrue(release.wait(2))
            guard()
            self.desktop.foreground = window
        self.desktop.activate = activate
        def select():
            try:
                self.select()
            except Rejected as exc:
                errors.append(exc.code)
        worker = threading.Thread(target=select)
        worker.start()
        self.assertTrue(waiting.wait(2))
        def stop():
            self.bridge.stop()
            stopped.set()
        stopper = threading.Thread(target=stop)
        stopper.start()
        self.assertTrue(stopped.wait(0.2), "stop must not wait for manual focus")
        release.set()
        worker.join(2)
        stopper.join(2)
        self.assertEqual(errors, ["STOPPED"])
        self.assertIsNone(self.bridge.session)

    def test_strict_action_validation(self):
        rejected = [
            {"type": "click", "x": -1, "y": 20}, {"type": "click", "x": True, "y": 0},
            {"type": "click", "x": float("nan"), "y": 0}, {"type": "click", "x": 1001, "y": 0},
            {"type": "press_key", "key": "win+r"}, {"type": "press_key", "key": "ctrl+v"},
            {"type": "type_text", "text": "x" * 4001}, {"type": "type_text", "text": "\x00"},
            {"type": "type_text", "text": "\ud800"}, {"type": "scroll", "x": 0, "y": 0, "amount": 6},
            {"type": "scroll", "x": 0, "y": 0, "amount": True}, {"type": "click"},
            {"type": "shell", "text": "cmd"}, {"type": "wait", "duration": 100000},
        ]
        for action in rejected:
            with self.subTest(action=action), self.assertRaises(Rejected):
                validate_action(action)

    def test_canonical_defaults_korean_and_allowlisted_keys(self):
        canonical = {"type": "type_text", "x": 0, "y": 0, "text": "한글\n예제 🎮", "key": "", "amount": 0}
        self.assertEqual(validate_action(canonical), canonical)
        for key in KEYS:
            self.assertEqual(validate_action({"type": "press_key", "key": key.upper()})["key"], key)

    def test_normalized_coordinates_never_reach_titlebar_or_outside_client(self):
        bounds = (-1000, 50, 3000, 2000, 9)
        self.assertEqual(client_point(bounds, 0, 0), (-1000, 50))
        self.assertEqual(client_point(bounds, 1000, 1000), (1999, 2049))
        self.assertEqual(client_point(bounds, 500, 500), (500, 1050))

    def test_scroll_protocol_down_and_up_match_windows_wheel_direction(self):
        self.assertLess(scroll_delta(1), 0)
        self.assertGreater(scroll_delta(-1), 0)
        self.assertEqual(abs(scroll_delta(5)), 5 * 120)


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = CompanionServer(FakeDesktop(), "a" * 64, port=0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(2)

    def request(self, method="GET", path="/v1/status", body=None, changes=None):
        headers = {"Origin": SITE_ORIGIN, "Authorization": "Bearer " + "a" * 64}
        if changes:
            for key, value in changes.items():
                if value is None:
                    headers.pop(key, None)
                else:
                    headers[key] = value
        if body is not None:
            headers.setdefault("Content-Type", "application/json")
            if not isinstance(body, str):
                body = json.dumps(body)
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), json.loads(response.read())
        finally:
            connection.close()

    def test_authenticated_status_no_store(self):
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(body, {"version": 1, "platform": "windows"})

    def test_token_required_for_all_endpoints(self):
        for method, path, body in [("GET", "/v1/status", None), ("GET", "/v1/windows", None), ("POST", "/v1/select", {"windowId": "123"}), ("POST", "/v1/observe", {}), ("POST", "/v1/action", {}), ("POST", "/v1/stop", {})]:
            with self.subTest(path=path):
                self.assertEqual(self.request(method, path, body, {"Authorization": None})[0], 401)
        self.assertEqual(self.request(changes={"Authorization": "Bearer wrong"})[0], 401)
        self.assertEqual(self.request(changes={"Authorization": "Bearer é"})[0], 401)

    def test_exact_origin_and_host_defeat_cross_origin_and_dns_rebinding(self):
        for origin in (None, "null", "https://evil.test", SITE_ORIGIN + ".evil.test", SITE_ORIGIN + "/"):
            status, headers, _ = self.request(changes={"Origin": origin})
            self.assertEqual(status, 403)
            self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(self.request(changes={"Host": "evil.test"})[0], 403)
        self.assertEqual(self.request(changes={"Host": "localhost:" + str(self.server.server_port)})[0], 403)

    def test_anonymous_preflight_is_exact_and_allows_private_network(self):
        status, headers, _ = self.request("OPTIONS", changes={"Authorization": None, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type", "Access-Control-Request-Private-Network": "true"})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], SITE_ORIGIN)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        self.assertEqual(self.request("OPTIONS", changes={"Access-Control-Request-Method": "DELETE"})[0], 403)
        self.assertEqual(self.request("OPTIONS", changes={"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-command"})[0], 403)

    def test_duplicate_json_keys_nonfinite_wrong_mime_and_body_limit(self):
        for body in ('{"windowId":"123","windowId":"999"}', '{"windowId":NaN}', '{'):
            self.assertEqual(self.request("POST", "/v1/select", body)[0], 400)
        self.assertEqual(self.request("POST", "/v1/stop", {}, {"Content-Type": "text/plain"})[0], 400)
        self.assertEqual(self.request("POST", "/v1/stop", " " * 32769)[0], 413)

    def test_end_to_end_select_observe_action_stop(self):
        status, _, selected = self.request("POST", "/v1/select", {"windowId": "123"})
        self.assertEqual(status, 200)
        status, _, frame = self.request("POST", "/v1/observe", selected)
        self.assertEqual(status, 200)
        status, _, body = self.request("POST", "/v1/action", {**selected, "frameId": frame["frameId"], "action": {"type": "type_text", "text": "예제 코드"}})
        self.assertEqual((status, body), (200, {"ok": True}))
        self.assertEqual(self.request("POST", "/v1/stop", {})[0], 200)
        self.assertEqual(self.request("POST", "/v1/observe", selected)[0], 409)

    def test_development_origin_requires_explicit_localhost_port(self):
        self.assertEqual(allowed_developer_origin("http://localhost:3000"), "http://localhost:3000")
        for origin in ("https://evil.test", "http://localhost", "http://localhost:3000/", "http://127.0.0.1:8765?q=1", "http://user@localhost:3000"):
            with self.subTest(origin=origin), self.assertRaises(Exception):
                allowed_developer_origin(origin)


class NativeStubTests(unittest.TestCase):
    """Tests Win32 calls against stubs; no real desktop APIs are executed."""
    def setUp(self):
        self.sent = []
        self.metrics = {76: -1000, 77: 0, 78: 4000, 79: 2000}
        self.native_count = None
        self.hit_window = 123
        class Function:
            def __init__(self, callback=lambda *args: 1):
                self.callback = callback
            def __call__(self, *args):
                return self.callback(*args)
        class Library:
            def __getattr__(self, name):
                value = Function()
                setattr(self, name, value)
                return value
        self.native = Library()
        self.native.GetSystemMetrics = Function(lambda index: self.metrics[index])
        self.native.WindowFromPoint = Function(lambda point: self.hit_window)
        self.native.GetAncestor = Function(lambda window, mode: window)
        def send(count, events, size):
            rows = []
            for index in range(count):
                event = events[index]
                part = event.value.mouse if event.type == 0 else event.value.keyboard
                rows.append({"type": event.type, **{name: getattr(part, name) for name, _ in type(part)._fields_}})
            self.sent.append(rows)
            return count if self.native_count is None else self.native_count
        self.native.SendInput = Function(send)
        spec = importlib.util.spec_from_file_location("folio_windows_test_adapter", Path(__file__).with_name("windows_desktop.py"))
        self.module = importlib.util.module_from_spec(spec)
        with patch.object(ctypes, "WinDLL", create=True, return_value=self.native):
            spec.loader.exec_module(self.module)
        self.desktop = object.__new__(self.module.WindowsDesktop)
        self.guard = lambda: None
        self.guard.emit = lambda operation: operation()
        self.bounds = (-500, 100, 1000, 600, 9)

    def act(self, action):
        self.desktop.action("123", self.bounds, validate_action(action), self.guard)

    def test_mouse_move_and_click_share_single_native_batch(self):
        self.act({"type": "click", "x": 500, "y": 500})
        self.assertEqual(len(self.sent), 1)
        self.assertEqual([event["flags"] for event in self.sent[0]], [0xC001, 2, 4])
        self.assertGreater(self.sent[0][0]["dx"], 0)
        self.assertGreater(self.sent[0][0]["dy"], 0)

    def test_double_click_and_scroll_remain_anchored_to_one_batch(self):
        self.act({"type": "double_click", "x": 500, "y": 500})
        self.assertEqual([event["flags"] for event in self.sent[0]], [0xC001, 2, 4, 2, 4])
        self.act({"type": "scroll", "x": 500, "y": 500, "amount": 1})
        self.assertEqual([event["flags"] for event in self.sent[1]], [0xC001, 0x800])
        self.assertEqual(self.sent[1][1]["data"], (-120) & 0xFFFFFFFF)

    def test_occluding_window_and_stopped_lease_send_no_input(self):
        self.hit_window = 999
        with self.assertRaises(Rejected):
            self.act({"type": "click", "x": 500, "y": 500})
        self.assertEqual(self.sent, [])
        def stopped(operation):
            raise Rejected("STOPPED", "stop")
        self.guard.emit = stopped
        with self.assertRaises(Rejected):
            self.act({"type": "type_text", "text": "한글"})
        self.assertEqual(self.sent, [])

    def test_korean_and_non_bmp_text_use_unicode_packets_without_clipboard(self):
        self.act({"type": "type_text", "text": "한🎮"})
        self.assertEqual(len(self.sent), 2)
        self.assertEqual([event["scan"] for event in self.sent[0]], [0xD55C, 0xD55C])
        self.assertEqual([event["scan"] for event in self.sent[1]], [0xD83C, 0xD83C, 0xDFAE, 0xDFAE])
        self.assertTrue(all(event["vk"] == 0 and event["flags"] in (4, 6) for batch in self.sent for event in batch))

    def test_partial_input_failure_releases_pressed_keys_inside_batch_lease(self):
        self.native_count = 1
        with self.assertRaises(Rejected) as error:
            self.act({"type": "press_key", "key": "ctrl+s"})
        self.assertEqual(error.exception.code, "INPUT_BLOCKED")
        self.assertEqual(len(self.sent), 2)
        self.assertEqual([event["vk"] for event in self.sent[1]], [ord("S"), 0x11])
        self.assertTrue(all(event["flags"] & 2 for event in self.sent[1]))

    def focus_environment(self):
        self.now = 0
        self.foreground = 999
        self.activation_attempts = []
        self.desktop._bounds = lambda window: self.bounds
        self.native.GetForegroundWindow.callback = lambda: self.foreground
        self.native.SetForegroundWindow.callback = lambda window: self.activation_attempts.append(window) or 0
        self.native.IsWindow.callback = lambda window: 1
        def sleep(delay):
            self.now += delay
        return sleep

    def test_manual_focus_completes_original_selection_without_refocus_retry(self):
        advance = self.focus_environment()
        def user_click(delay):
            advance(delay)
            if self.now >= 0.15:
                self.foreground = 123
        with patch.object(self.module.time, "monotonic", lambda: self.now), patch.object(self.module.time, "sleep", user_click):
            self.desktop.activate("123", self.guard)
        self.assertEqual(self.activation_attempts, [123])
        self.assertLess(self.now, 8)

    def test_manual_focus_wait_expires_at_eight_seconds(self):
        advance = self.focus_environment()
        with patch.object(self.module.time, "monotonic", lambda: self.now), patch.object(self.module.time, "sleep", advance), self.assertRaises(Rejected) as error:
            self.desktop.activate("123", self.guard)
        self.assertEqual(error.exception.code, "FOCUS_REQUIRED")
        self.assertGreaterEqual(self.now, 8)
        self.assertLess(self.now, 8.1)
        self.assertEqual(self.activation_attempts, [123])

    def test_manual_focus_wait_checks_stop_on_each_poll(self):
        advance = self.focus_environment()
        def guard():
            if self.now >= 0.1:
                raise Rejected("STOPPED", "stop")
        guard.emit = lambda operation: operation()
        with patch.object(self.module.time, "monotonic", lambda: self.now), patch.object(self.module.time, "sleep", advance), self.assertRaises(Rejected) as error:
            self.desktop.activate("123", guard)
        self.assertEqual(error.exception.code, "STOPPED")
        self.assertLessEqual(self.now, 0.15)
        self.assertEqual(self.activation_attempts, [123])


if __name__ == "__main__":
    unittest.main()
