"""Windows-only adapter. No shell commands, clipboard access, or remote URLs."""
from __future__ import annotations

import ctypes
from ctypes import wintypes as W
import io
import multiprocessing
import threading
import time

from folio_companion import Rejected, client_point, scroll_delta

U = ctypes.WinDLL("user32", use_last_error=True)
G = ctypes.WinDLL("gdi32", use_last_error=True)
K = ctypes.WinDLL("kernel32", use_last_error=True)
PTR = ctypes.c_size_t


def signature(library, name, result, *arguments):
    function = getattr(library, name)
    function.restype, function.argtypes = result, arguments
    return function


signature(U, "IsWindow", W.BOOL, W.HWND)
signature(U, "IsWindowVisible", W.BOOL, W.HWND)
signature(U, "IsIconic", W.BOOL, W.HWND)
signature(U, "GetForegroundWindow", W.HWND)
signature(U, "GetAncestor", W.HWND, W.HWND, W.UINT)
signature(U, "GetClientRect", W.BOOL, W.HWND, ctypes.POINTER(W.RECT))
signature(U, "ClientToScreen", W.BOOL, W.HWND, ctypes.POINTER(W.POINT))
signature(U, "GetWindowTextW", ctypes.c_int, W.HWND, W.LPWSTR, ctypes.c_int)
signature(U, "GetClassNameW", ctypes.c_int, W.HWND, W.LPWSTR, ctypes.c_int)
signature(U, "GetWindowThreadProcessId", W.DWORD, W.HWND, ctypes.POINTER(W.DWORD))
signature(U, "SetForegroundWindow", W.BOOL, W.HWND)
signature(U, "ShowWindow", W.BOOL, W.HWND, ctypes.c_int)
signature(U, "GetCursorPos", W.BOOL, ctypes.POINTER(W.POINT))
signature(U, "GetAsyncKeyState", ctypes.c_short, ctypes.c_int)
signature(U, "WindowFromPoint", W.HWND, W.POINT)
signature(U, "GetDC", W.HDC, W.HWND)
signature(U, "ReleaseDC", ctypes.c_int, W.HWND, W.HDC)
signature(U, "PrintWindow", W.BOOL, W.HWND, W.HDC, W.UINT)
signature(G, "CreateCompatibleDC", W.HDC, W.HDC)
signature(G, "DeleteDC", W.BOOL, W.HDC)
signature(G, "DeleteObject", W.BOOL, W.HANDLE)
signature(G, "SelectObject", W.HANDLE, W.HDC, W.HANDLE)
signature(K, "GetConsoleWindow", W.HWND)
signature(U, "RegisterHotKey", W.BOOL, W.HWND, ctypes.c_int, W.UINT, W.UINT)
signature(U, "UnregisterHotKey", W.BOOL, W.HWND, ctypes.c_int)
signature(U, "PeekMessageW", W.BOOL, ctypes.POINTER(W.MSG), W.HWND, W.UINT, W.UINT, W.UINT)


class BitmapHeader(ctypes.Structure):
    _fields_ = [("size", W.DWORD), ("width", W.LONG), ("height", W.LONG), ("planes", W.WORD), ("bits", W.WORD), ("compression", W.DWORD), ("image_size", W.DWORD), ("xppm", W.LONG), ("yppm", W.LONG), ("colors", W.DWORD), ("important", W.DWORD)]


class BitmapInfo(ctypes.Structure):
    _fields_ = [("header", BitmapHeader), ("colors", W.DWORD * 3)]


signature(G, "CreateDIBSection", W.HBITMAP, W.HDC, ctypes.POINTER(BitmapInfo), W.UINT, ctypes.POINTER(ctypes.c_void_p), W.HANDLE, W.DWORD)


class MouseInput(ctypes.Structure):
    _fields_ = [("dx", W.LONG), ("dy", W.LONG), ("data", W.DWORD), ("flags", W.DWORD), ("time", W.DWORD), ("extra", PTR)]


class KeyboardInput(ctypes.Structure):
    _fields_ = [("vk", W.WORD), ("scan", W.WORD), ("flags", W.DWORD), ("time", W.DWORD), ("extra", PTR)]


class HardwareInput(ctypes.Structure):
    _fields_ = [("message", W.DWORD), ("low", W.WORD), ("high", W.WORD)]


class InputUnion(ctypes.Union):
    _fields_ = [("mouse", MouseInput), ("keyboard", KeyboardInput), ("hardware", HardwareInput)]


class Input(ctypes.Structure):
    _fields_ = [("type", W.DWORD), ("value", InputUnion)]


signature(U, "SendInput", W.UINT, W.UINT, ctypes.POINTER(Input), ctypes.c_int)


def keyboard(vk=0, scan=0, flags=0):
    return Input(1, InputUnion(keyboard=KeyboardInput(vk, scan, flags, 0, 0)))


def mouse(flags, data=0):
    return Input(0, InputUnion(mouse=MouseInput(0, 0, data & 0xFFFFFFFF, flags, 0, 0)))


def pointer_move(x, y):
    left, top, width, height = [U.GetSystemMetrics(index) for index in (76, 77, 78, 79)]
    if width < 2 or height < 2 or not left <= x < left + width or not top <= y < top + height:
        raise Rejected("WINDOW_BOUNDS", "화면 범위를 확인하지 못했습니다.")
    dx = round((x - left) * 65535 / (width - 1))
    dy = round((y - top) * 65535 / (height - 1))
    return Input(0, InputUnion(mouse=MouseInput(dx, dy, 0, 0xC001, 0, 0)))


def set_dpi_awareness():
    try:
        function = signature(U, "SetProcessDpiAwarenessContext", W.BOOL, ctypes.c_void_p)
        function(ctypes.c_void_p(-4))
    except (AttributeError, OSError):
        U.SetProcessDPIAware()


def capture_worker(window, bounds, output):
    try:
        set_dpi_awareness()
        png, width, height = capture_surface(int(window), bounds)
        output.send((True, png, width, height))
    except Exception:
        output.send((False,))
    finally:
        output.close()


def capture_surface(window, bounds):
    # Print only the selected application's client surface: never screenshot the desktop.
    from PIL import Image
    _x, _y, width, height, _pid = bounds
    source = U.GetDC(window)
    memory = G.CreateCompatibleDC(source)
    pixels = ctypes.c_void_p()
    info = BitmapInfo()
    info.header = BitmapHeader(ctypes.sizeof(BitmapHeader), width, -height, 1, 32, 0, 0, 0, 0, 0, 0)
    bitmap = G.CreateDIBSection(source, ctypes.byref(info), 0, ctypes.byref(pixels), None, 0)
    previous = None
    try:
        if not source or not memory or not bitmap or not pixels.value:
            raise OSError("capture surface unavailable")
        previous = G.SelectObject(memory, bitmap)
        if not U.PrintWindow(window, memory, 3):  # PW_CLIENTONLY | PW_RENDERFULLCONTENT
            raise OSError("application cannot capture")
        raw = ctypes.string_at(pixels.value, width * height * 4)
        image = Image.frombytes("RGB", (width, height), raw, "raw", "BGRX")
        if all(high == 0 for _low, high in image.getextrema()):
            raise OSError("application returned a black frame")
        image.thumbnail((1920, 1920), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=False)
        return buffer.getvalue(), image.width, image.height
    finally:
        if previous:
            G.SelectObject(memory, previous)
        if bitmap:
            G.DeleteObject(bitmap)
        if memory:
            G.DeleteDC(memory)
        if source:
            U.ReleaseDC(window, source)


class WindowsDesktop:
    def __init__(self):
        set_dpi_awareness()
        import pyautogui
        self.pyautogui = pyautogui
        self.pyautogui.FAILSAFE = True
        self.closing = threading.Event()
        self.stop_callback = None
        self.stop_thread = None

    def _handle(self, window):
        try:
            handle = int(window)
            if handle <= 0 or handle > 2 ** (ctypes.sizeof(W.HWND) * 8) - 1:
                raise ValueError()
        except (ValueError, TypeError):
            raise Rejected("WINDOW_UNAVAILABLE", "선택한 창을 찾을 수 없습니다.")
        return handle

    def _title(self, window):
        buffer = ctypes.create_unicode_buffer(1024)
        U.GetWindowTextW(window, buffer, len(buffer))
        return buffer.value

    def _bounds(self, window):
        if not U.IsWindow(window) or not U.IsWindowVisible(window) or U.IsIconic(window) or U.GetAncestor(window, 2) != window:
            raise Rejected("WINDOW_UNAVAILABLE", "선택한 창을 표시한 뒤 다시 연결하세요.")
        rect, origin, pid = W.RECT(), W.POINT(), W.DWORD()
        if not U.GetClientRect(window, ctypes.byref(rect)) or not U.ClientToScreen(window, ctypes.byref(origin)):
            raise Rejected("WINDOW_UNAVAILABLE", "창의 영역을 확인하지 못했습니다.")
        U.GetWindowThreadProcessId(window, ctypes.byref(pid))
        width, height = rect.right - rect.left, rect.bottom - rect.top
        left, top, screen_width, screen_height = [U.GetSystemMetrics(index) for index in (76, 77, 78, 79)]
        if width < 64 or height < 64 or width > 8192 or height > 8192 or width * height > 20_000_000 or origin.x < left or origin.y < top or origin.x + width > left + screen_width or origin.y + height > top + screen_height:
            raise Rejected("WINDOW_BOUNDS", "창 전체가 화면 안에 보이도록 크기와 위치를 조정하세요.")
        return (origin.x, origin.y, width, height, pid.value)

    def windows(self):
        found = []
        callback_type = ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
        signature(U, "EnumWindows", W.BOOL, callback_type, W.LPARAM)
        console = K.GetConsoleWindow()
        def visit(handle, _param):
            if handle == console or not U.IsWindowVisible(handle):
                return True
            class_name = ctypes.create_unicode_buffer(256)
            U.GetClassNameW(handle, class_name, len(class_name))
            if class_name.value in ("Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"):
                return True
            title = self._title(handle)
            if not title:
                return True
            try:
                self._bounds(handle)
            except Rejected:
                return True
            found.append({"id": str(handle), "title": title})
            return len(found) < 200
        U.EnumWindows(callback_type(visit), 0)
        return found

    def activate(self, window, guard):
        window = self._handle(window)
        self._bounds(window)
        guard.emit(lambda: U.SetForegroundWindow(window))
        # Windows may deny foreground activation to an HTTP/background process.
        # Keep the explicit selection pending so a user's click can complete it;
        # do not simulate Alt, attach input threads, or repeatedly steal focus.
        deadline = time.monotonic() + 8
        while True:
            guard()
            if U.GetForegroundWindow() == window:
                return
            if not U.IsWindow(window):
                raise Rejected("WINDOW_UNAVAILABLE", "선택한 창이 닫혔습니다. 창을 다시 선택하세요.")
            if time.monotonic() >= deadline:
                raise Rejected("FOCUS_REQUIRED", "창 전환을 기다리다 중지했습니다. 다시 시작한 뒤 8초 안에 선택한 프로그램 창을 클릭하세요.")
            time.sleep(0.05)

    def check(self, window, bounds=None):
        window = self._handle(window)
        try:
            self.pyautogui.failSafeCheck()
        except self.pyautogui.FailSafeException:
            if self.stop_callback:
                self.stop_callback()
            raise Rejected("STOPPED", "마우스 모서리 이동으로 조작을 중지했습니다. 창을 다시 선택하세요.")
        current = self._bounds(window)
        if U.GetForegroundWindow() != window:
            raise Rejected("FOCUS_CHANGED", "다른 창으로 이동했습니다. 화면을 다시 확인하세요.")
        if bounds is not None and tuple(bounds) != current:
            raise Rejected("WINDOW_CHANGED", "창 크기나 위치가 바뀌었습니다. 화면을 다시 확인하세요.")
        if any(U.GetAsyncKeyState(key) & 0x8000 for key in (0x10, 0x11, 0x12, 0x5B, 0x5C)):
            raise Rejected("MODIFIER_HELD", "Ctrl·Alt·Shift·Windows 키에서 손을 뗀 뒤 다시 시도하세요.")
        return current

    def capture(self, window, bounds):
        self.check(window, bounds)
        context = multiprocessing.get_context("spawn")
        receiver, sender = context.Pipe(duplex=False)
        process = context.Process(target=capture_worker, args=(window, bounds, sender), daemon=True)
        try:
            process.start()
            sender.close()
            if not receiver.poll(4):
                raise Rejected("CAPTURE_FAILED", "창이 화면 캡처에 응답하지 않습니다. 수동 이미지 가져오기를 이용하세요.")
            try:
                result = receiver.recv()
            except (EOFError, OSError):
                result = (False,)
            if not result[0]:
                raise Rejected("CAPTURE_FAILED", "이 프로그램의 화면 캡처를 지원하지 않습니다. 직접 찍은 이미지를 가져오세요.")
            self.check(window, bounds)
            return (*result[1:], self._title(int(window)))
        finally:
            receiver.close()
            sender.close()
            if process.pid:
                process.join(0.1)
                if process.is_alive():
                    process.terminate()
                    process.join(0.5)

    def _send(self, events, guard, target=None):
        array = (Input * len(events))(*events)
        def emit():
            if target is not None:
                window, px, py = target
                hit = U.WindowFromPoint(W.POINT(px, py))
                if not hit or U.GetAncestor(hit, 2) != int(window):
                    raise Rejected("WINDOW_OBSCURED", "선택한 창 위에 다른 창이 겹쳐 있습니다. 화면을 다시 확인하세요.")
            written = U.SendInput(len(events), array, ctypes.sizeof(Input))
            if written != len(events):
                # Release only keys/buttons this batch may have pressed. This
                # stays inside the same emission lease, before stop can return.
                releases = [event for event in events if (event.type == 1 and event.value.keyboard.flags & 2) or (event.type == 0 and event.value.mouse.flags & 4)]
                if releases:
                    release_array = (Input * len(releases))(*releases)
                    U.SendInput(len(releases), release_array, ctypes.sizeof(Input))
            return written
        if guard.emit(emit) != len(events):
            raise Rejected("INPUT_BLOCKED", "이 프로그램이 입력을 받지 못했습니다. 관리자 권한으로 열린 프로그램은 지원하지 않습니다.")

    def action(self, window, bounds, action, guard):
        kind = action["type"]
        if kind in ("click", "double_click", "scroll"):
            guard()
            # Point is inside the client area, excluding title bar and window controls.
            px, py = client_point(bounds, action["x"], action["y"])
            # Queue absolute movement and all button/wheel events together. A
            # user's intervening mouse movement cannot redirect the click.
            events = [pointer_move(px, py)]
            if kind == "scroll":
                events.append(mouse(0x0800, scroll_delta(action["amount"])))
            else:
                for _ in range(2 if kind == "double_click" else 1):
                    events.extend((mouse(0x0002), mouse(0x0004)))
            self._send(events, guard, target=(window, px, py))
            return
        if kind == "wait":
            for _ in range(6):
                guard()
                time.sleep(0.05)
            return
        if kind == "press_key":
            key = action["key"]
            keys = {"enter": 0x0D, "tab": 0x09, "escape": 0x1B, "backspace": 0x08, "delete": 0x2E, "up": 0x26, "down": 0x28, "left": 0x25, "right": 0x27, "space": 0x20, "f5": 0x74}
            if key.startswith("ctrl+"):
                vk = ord(key[-1].upper())
                events = [keyboard(0x11), keyboard(vk), keyboard(vk, flags=2), keyboard(0x11, flags=2)]
            else:
                vk = keys[key]
                extended = 1 if key in ("delete", "up", "down", "left", "right") else 0
                events = [keyboard(vk, flags=extended), keyboard(vk, flags=extended | 2)]
            self._send(events, guard)
            return
        if kind == "type_text":
            content = action["text"].replace("\r\n", "\n").replace("\r", "\n")
            # Check stop/focus for every character. No clipboard or keyboard-layout dependency.
            for character in content:
                if character in "\n\t":
                    vk = 0x0D if character == "\n" else 0x09
                    events = [keyboard(vk), keyboard(vk, flags=2)]
                else:
                    encoded = character.encode("utf-16-le")
                    events = []
                    for offset in range(0, len(encoded), 2):
                        code = encoded[offset] | (encoded[offset + 1] << 8)
                        events.extend((keyboard(scan=code, flags=4), keyboard(scan=code, flags=6)))
                self._send(events, guard)

    def install_stop(self, callback):
        self.stop_callback = callback
        ready = threading.Event()
        outcome = []
        def hotkeys():
            registered = bool(U.RegisterHotKey(None, 1, 0x4000, 0x77))  # MOD_NOREPEAT, F8
            outcome.append(registered)
            ready.set()
            if not registered:
                return
            message = W.MSG()
            try:
                while not self.closing.is_set():
                    while U.PeekMessageW(ctypes.byref(message), None, 0, 0, 1):
                        if message.message == 0x0312:
                            callback()
                    self.closing.wait(0.02)
            finally:
                U.UnregisterHotKey(None, 1)
        self.stop_thread = threading.Thread(target=hotkeys, daemon=True)
        self.stop_thread.start()
        if not ready.wait(3) or not outcome or not outcome[0]:
            self.close()
            raise RuntimeError("F8 중지 키를 등록하지 못했습니다. F8을 사용하는 다른 프로그램을 종료하고 다시 실행하세요.")

    def close(self):
        self.closing.set()
        if self.stop_thread:
            self.stop_thread.join(1)
