# -*- coding: utf-8 -*-
"""原神窗口采集器（Phase 0 取样用）。

单张:   python collect.py <输出路径>
连续:   python collect.py --burst 8 --interval 2 <输出前缀>
        （每 interval 秒抓一张，与上一张差异不足则跳过，避免存重复帧）

技术要点（均为实测得出）：
  1. 必须声明 Per-Monitor DPI Aware，否则 GetClientRect 返回虚拟化尺寸，
     只抓到画面左上 80%。
  2. PrintWindow（flag 0 / 2）对本游戏一律返回失败、得到全黑图，
     唯一可用路径是 BitBlt 窗口 DC。
  3. BitBlt 读的是屏幕合成结果，窗口被其他窗口覆盖时会抓到遮挡物，
     因此调用前应确保游戏窗口未被遮挡（不要求它有焦点）。
"""
import ctypes
import subprocess
import sys
import time
from ctypes import wintypes

from PIL import Image, ImageChops

user32 = ctypes.WinDLL("user32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass

wintypes.HWND = ctypes.c_void_p
SRCCOPY = 0x00CC0020
BI_RGB = 0
PROC_NAME = "YuanShen.exe"


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG),
        ("biHeight", wintypes.LONG), ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
        ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 3)]


def get_pid(name=PROC_NAME):
    out = subprocess.run(
        ["tasklist", "/FI", f"IMAGENAME eq {name}", "/FO", "CSV", "/NH"],
        capture_output=True, text=True, encoding="gbk", errors="replace").stdout
    for line in out.splitlines():
        parts = [p.strip('"') for p in line.split('","')]
        if len(parts) >= 2 and parts[0].lower() == name.lower():
            return int(parts[1])
    return None


def find_window(pid):
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(hwnd, _):
        wp = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wp))
        if wp.value == pid and user32.IsWindowVisible(hwnd):
            r = wintypes.RECT()
            user32.GetClientRect(hwnd, ctypes.byref(r))
            a = (r.right - r.left) * (r.bottom - r.top)
            if a > 0:
                found.append((a, hwnd))
        return True

    user32.EnumWindows(cb, 0)
    found.sort(reverse=True)
    return found[0][1] if found else None


def grab_client(hwnd):
    wr = wintypes.RECT(); user32.GetWindowRect(hwnd, ctypes.byref(wr))
    ww, wh = wr.right - wr.left, wr.bottom - wr.top
    cr = wintypes.RECT(); user32.GetClientRect(hwnd, ctypes.byref(cr))
    cw, ch = cr.right - cr.left, cr.bottom - cr.top
    o = wintypes.POINT(0, 0); user32.ClientToScreen(hwnd, ctypes.byref(o))
    ox, oy = o.x - wr.left, o.y - wr.top

    hdc_wnd = user32.GetWindowDC(hwnd)
    hdc_mem = gdi32.CreateCompatibleDC(hdc_wnd)

    bi = BITMAPINFO()
    bi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bi.bmiHeader.biWidth = ww
    bi.bmiHeader.biHeight = -wh
    bi.bmiHeader.biPlanes = 1
    bi.bmiHeader.biBitCount = 32
    bi.bmiHeader.biCompression = BI_RGB

    bits = ctypes.c_void_p()
    hbmp = gdi32.CreateDIBSection(hdc_wnd, ctypes.byref(bi), 0, ctypes.byref(bits), None, 0)
    gdi32.SelectObject(hdc_mem, hbmp)
    ok = gdi32.BitBlt(hdc_mem, 0, 0, ww, wh, hdc_wnd, 0, 0, SRCCOPY)

    buf = ctypes.string_at(bits, ww * wh * 4)
    img = Image.frombuffer("RGBA", (ww, wh), buf, "raw", "BGRA", 0, 1).convert("RGB")
    img = img.crop((ox, oy, ox + cw, oy + ch))

    gdi32.DeleteObject(hbmp)
    gdi32.DeleteDC(hdc_mem)
    user32.ReleaseDC(hwnd, hdc_wnd)
    if not ok:
        raise OSError("BitBlt failed")
    return img


def is_blank(img):
    small = img.resize((64, 36))
    px = list(small.get_flattened_data() if hasattr(small, "get_flattened_data")
              else small.getdata())
    dark = sum(1 for r, g, b in px if r < 12 and g < 12 and b < 12)
    return dark / len(px) > 0.9


def differs(a, b, thresh=2.0):
    if a.size != b.size:
        return True
    d = ImageChops.difference(a, b).resize((32, 18))
    vals = list(d.get_flattened_data() if hasattr(d, "get_flattened_data")
                else d.getdata())
    mean = sum(sum(v) / 3 for v in vals) / len(vals)
    return mean > thresh


def main():
    args = sys.argv[1:]
    burst = None
    interval = 2.0
    rest = []
    i = 0
    while i < len(args):
        if args[i] == "--burst":
            burst = int(args[i + 1]); i += 2
        elif args[i] == "--interval":
            interval = float(args[i + 1]); i += 2
        else:
            rest.append(args[i]); i += 1
    if not rest:
        print("usage: collect.py [--burst N --interval S] <out.png|prefix>")
        return 2

    pid = get_pid()
    if not pid:
        print("PROC_NOT_FOUND  (游戏没在运行？)")
        return 1
    hwnd = find_window(pid)
    if not hwnd:
        print("WINDOW_NOT_FOUND")
        return 1

    if burst is None:
        img = grab_client(hwnd)
        if is_blank(img):
            print("BLANK  (窗口被遮挡或最小化)")
            return 3
        img.save(rest[0], "PNG")
        print(f"saved={rest[0]} size={img.size[0]}x{img.size[1]}")
        return 0

    prev, saved, skipped = None, 0, 0
    for n in range(burst):
        try:
            img = grab_client(hwnd)
        except OSError as e:
            print(f"  [{n}] grab failed: {e}"); time.sleep(interval); continue
        if is_blank(img):
            print(f"  [{n}] blank, skip"); skipped += 1
        elif prev is not None and not differs(prev, img):
            print(f"  [{n}] identical, skip"); skipped += 1
        else:
            p = f"{rest[0]}-{saved:02d}.png"
            img.save(p, "PNG")
            print(f"  [{n}] saved {p}")
            saved += 1
            prev = img
        if n < burst - 1:
            time.sleep(interval)
    print(f"done: saved={saved} skipped={skipped} size={img.size[0]}x{img.size[1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
