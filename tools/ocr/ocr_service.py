# -*- coding: utf-8 -*-
"""ocr_service.py - 圣遗物截图识别服务（二-A 期：服务端骨架）

阶段目标（二-A）：验证「热键 → 抓图 → 裁剪 → OCR → 文本」这条链稳定可用。
本阶段**不碰网页、不发 HTTP**，结果输出到控制台 + `debug/` 存盘，供人工核对。

用法：
    python ocr_service.py --once        # 立即执行一次（供自动化验证 / 手动测试）
    python ocr_service.py               # 常驻，监听热键
    python ocr_service.py --no-ocr      # 只抓图裁剪，跳过 OCR（快速验证抓图）

热键：Ctrl+Alt+S 识别一次；Ctrl+Alt+Q 退出。

设计约束（均来自实测，改动前先看 README.md）：
  1. 进程必须在任何尺寸查询前声明 Per-Monitor DPI Aware，否则 125% 缩放下
     GetClientRect 返回虚拟化尺寸，BitBlt 只会抓到画面左上 80%。
  2. 只能用 BitBlt 窗口 DC；PrintWindow 的 flag 0 与 2 对本游戏均返回失败、纯黑。
  3. 裁剪下界取 0.52（实测扫描出的最优值）：0.49 及以下会把详情栏底部的套装名整行切掉；
     更宽松的 0.56 则要多做 2 行无用识别。套装名在面板内约 92% 高度处，余量很薄。
     （而那才是套装名，顶部大字是单件圣遗物的名字）。
  4. OCR 结果不要按 y 重排：RapidOCR 输出顺序即阅读顺序，按 y 排会把
     「生命值 / 7.0%」颠倒成「7.0% / 生命值」，主属性解析随即失败。
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import re
import subprocess
import sys
import threading
import time
from ctypes import wintypes
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from PIL import Image, ImageChops

# --------------------------------------------------------------------------
# 常量与配置
# --------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEBUG_DIR = os.path.join(BASE_DIR, "debug")
CONFIG_PATH = os.path.join(BASE_DIR, "service_config.json")

DEFAULT_CONFIG = {
    "process_name": "YuanShen.exe",
    # 详情栏裁剪比例（左, 上, 右, 下），依据 2130x1191 实测标定。
    # 下界 0.52 是实测扫描出来的：0.56→OCR 14 行/1794ms，0.52→12 行/1175ms（省 35%），
    # 而 0.49 会把底部的套装名整行切掉（套装名在面板内约 92% 高度处，余量很小）。
    # 收紧的意义：套装效果正文（2件套/4件套的描述）对下游毫无用处，识别它是纯浪费。
    "crop_ratio": [0.725, 0.055, 1.0, 0.52],
    # 热键默认值。⚠ 改这里才算"改默认"——只改 service_config.json 是改本机实例，
    # 换目录/删配置后会退回到这里的值（曾因此把用户的 Alt+S 变回 Ctrl+Alt+S）。
    "hotkey": {"modifiers": ["alt"], "key": "s"},
    "quit_hotkey": {"modifiers": ["alt"], "key": "q"},
    # 只抓图不识别（调试用）
    "skip_ocr": False,
    # 是否保存每次识别的整窗图 + 裁剪图（排查用）
    "save_frames": True,
    # 保留最近多少组图。⚠ 必须有限制：整窗 JPEG 约 250KB，不清理的话一天能堆几百 MB
    # （实测 PNG 单张 2.7MB，144 张就占了 205MB）。
    "keep_frames": 20,
    # 双路（原尺寸 + 2x）一致性检查。
    # 默认关闭：实测 1x≈1.3s、2x≈1.8s，双路共约 3.1s，超出「单次 ≤2s」的目标；
    # 且双路只能报警不能纠错（理之冠那条两路都读错，真值靠人确认）。
    # 需要更强校验时再手动打开。
    "multi_scale_check": False,
    # 窗口高度低于此值告警：字号会小到影响识别
    "min_window_height": 900,
}

# Win32 常量
MOD_ALT = 0x0001
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_WIN = 0x0008
MOD_NOREPEAT = 0x4000
WM_HOTKEY = 0x0312
SRCCOPY = 0x00CC0020
BI_RGB = 0

MOD_MAP = {"alt": MOD_ALT, "ctrl": MOD_CONTROL, "shift": MOD_SHIFT, "win": MOD_WIN}

user32 = ctypes.WinDLL("user32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)

# 必须在任何 GetWindowRect / GetClientRect 之前执行
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)   # PROCESS_PER_MONITOR_DPI_AWARE
except Exception:
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass

wintypes.HWND = ctypes.c_void_p


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


# --------------------------------------------------------------------------
# 日志
# --------------------------------------------------------------------------

_log_lines: list[str] = []


def log(msg: str, level: str = "info") -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    mark = {"info": "·", "ok": "✓", "warn": "!", "err": "✗"}.get(level, "·")
    line = f"[{ts}] {mark} {msg}"
    # 日志一律走 stderr：stdout 留给 --json 的结构化输出，避免两者混在一起
    print(line, file=sys.stderr, flush=True)
    _log_lines.append(line)


def flush_log(tag: str, keep: int | None = None) -> str | None:
    if not _log_lines:
        return None
    os.makedirs(DEBUG_DIR, exist_ok=True)
    path = os.path.join(DEBUG_DIR, f"{tag}.log")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(_log_lines))
    _log_lines.clear()
    if keep is not None:
        prune_debug(keep)
    return path


_TAG_SUFFIX_RE = re.compile(r"-(client|panel)\.(jpg|png)$", re.IGNORECASE)


def prune_debug(keep: int) -> int:
    """只保留最近 keep 组调试产物（同一 tag 的 client/panel/log 算一组）。

    ⚠ 必须有这个：不识别的图会一直堆在 debug/ 里。实测 PNG 单张 2.7MB，
    正常使用几十分钟就能堆出 200MB+。文件名以时间戳开头，字典序即时间序。
    """
    if keep <= 0:
        keep = 1
    try:
        names = sorted(os.listdir(DEBUG_DIR))
    except OSError:
        return 0

    tags: list[str] = []
    for f in names:
        m = _TAG_SUFFIX_RE.search(f)
        tag = f[:m.start()] if m else os.path.splitext(f)[0]
        if tag not in tags:
            tags.append(tag)

    if len(tags) <= keep:
        return 0

    dead = set(tags[:len(tags) - keep])
    removed = 0
    for f in names:
        m = _TAG_SUFFIX_RE.search(f)
        tag = f[:m.start()] if m else os.path.splitext(f)[0]
        if tag in dead:
            try:
                os.remove(os.path.join(DEBUG_DIR, f))
                removed += 1
            except OSError:
                pass
    return removed


# --------------------------------------------------------------------------
# 配置
# --------------------------------------------------------------------------

def load_config() -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, encoding="utf-8") as f:
                user = json.load(f)
            for k, v in user.items():
                if k in cfg:
                    cfg[k] = v
        except Exception as e:
            log(f"配置文件读取失败，改用默认值：{e}", "warn")
    else:
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
            log(f"已生成默认配置：{os.path.basename(CONFIG_PATH)}")
        except Exception as e:
            log(f"配置文件写入失败：{e}", "warn")
    return cfg


# --------------------------------------------------------------------------
# 窗口定位与抓图
# --------------------------------------------------------------------------

def get_pid(name: str) -> int | None:
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {name}", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, encoding="gbk", errors="replace",
            timeout=10,
        ).stdout
    except Exception:
        return None
    for line in out.splitlines():
        parts = [p.strip('"') for p in line.split('","')]
        if len(parts) >= 2 and parts[0].lower() == name.lower():
            try:
                return int(parts[1])
            except ValueError:
                return None
    return None


def find_window(pid: int) -> int | None:
    """取该进程下客户区面积最大的可见顶层窗口。"""
    found: list[tuple[int, int]] = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(hwnd, _):
        wp = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wp))
        if wp.value == pid and user32.IsWindowVisible(hwnd):
            r = wintypes.RECT()
            user32.GetClientRect(hwnd, ctypes.byref(r))
            area = (r.right - r.left) * (r.bottom - r.top)
            if area > 0:
                found.append((area, hwnd))
        return True

    user32.EnumWindows(cb, 0)
    if not found:
        return None
    found.sort(key=lambda t: t[0], reverse=True)
    return found[0][1]


class GrabError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# 进程/窗口句柄缓存：tasklist 是子进程调用，实测固定耗时约 180ms，
# 而常驻进程在整局游戏里 pid 与 hwnd 都不变，没必要每次热键都查一次。
_target_cache: dict = {"pid": None, "hwnd": None}


def resolve_target(cfg: dict) -> tuple[int | None, int | None]:
    """返回 (pid, hwnd)，带缓存；句柄失效时自动重查。"""
    hwnd = _target_cache.get("hwnd")
    if hwnd and user32.IsWindow(hwnd):
        return _target_cache.get("pid"), hwnd

    _target_cache["hwnd"] = None
    _target_cache["pid"] = None

    pid = get_pid(cfg["process_name"])
    if not pid:
        return None, None
    hwnd = find_window(pid)
    if not hwnd:
        return pid, None
    _target_cache["pid"] = pid
    _target_cache["hwnd"] = hwnd
    return pid, hwnd


def grab_client(hwnd: int) -> tuple[Image.Image, tuple[int, int]]:
    """抓客户区（物理像素）。返回 (图, (宽, 高))。"""
    wr = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(wr))
    ww, wh = wr.right - wr.left, wr.bottom - wr.top
    cr = wintypes.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(cr))
    cw, ch = cr.right - cr.left, cr.bottom - cr.top
    if ww <= 0 or wh <= 0 or cw <= 0 or ch <= 0:
        raise GrabError("NO_WINDOW", "窗口尺寸异常（可能已最小化）")

    origin = wintypes.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(origin))
    ox, oy = origin.x - wr.left, origin.y - wr.top

    hdc_wnd = user32.GetWindowDC(hwnd)
    hdc_mem = gdi32.CreateCompatibleDC(hdc_wnd)

    bi = BITMAPINFO()
    bi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bi.bmiHeader.biWidth = ww
    bi.bmiHeader.biHeight = -wh          # 负 = top-down，省掉翻转
    bi.bmiHeader.biPlanes = 1
    bi.bmiHeader.biBitCount = 32
    bi.bmiHeader.biCompression = BI_RGB

    bits = ctypes.c_void_p()
    hbmp = gdi32.CreateDIBSection(hdc_wnd, ctypes.byref(bi), 0, ctypes.byref(bits), None, 0)
    if not hbmp:
        gdi32.DeleteDC(hdc_mem)
        user32.ReleaseDC(hwnd, hdc_wnd)
        raise GrabError("ENGINE_ERROR", "CreateDIBSection 失败")

    gdi32.SelectObject(hdc_mem, hbmp)
    ok = gdi32.BitBlt(hdc_mem, 0, 0, ww, wh, hdc_wnd, 0, 0, SRCCOPY)

    buf = ctypes.string_at(bits, ww * wh * 4)
    img = Image.frombuffer("RGBA", (ww, wh), buf, "raw", "BGRA", 0, 1).convert("RGB")
    img = img.crop((ox, oy, ox + cw, oy + ch))

    gdi32.DeleteObject(hbmp)
    gdi32.DeleteDC(hdc_mem)
    user32.ReleaseDC(hwnd, hdc_wnd)

    if not ok:
        raise GrabError("ENGINE_ERROR", "BitBlt 失败")
    return img, (cw, ch)


def is_blank(img: Image.Image) -> bool:
    """黑图检测：窗口最小化或抓取失败时 BitBlt 会给出全黑。"""
    small = img.resize((64, 36))
    px = list(small.get_flattened_data() if hasattr(small, "get_flattened_data")
              else small.getdata())
    dark = sum(1 for r, g, b in px if r < 12 and g < 12 and b < 12)
    buckets = len({(r // 8, g // 8, b // 8) for r, g, b in px})
    return dark / len(px) > 0.9 or buckets < 12


def crop_panel(img: Image.Image, ratio) -> Image.Image:
    w, h = img.size
    box = (int(w * ratio[0]), int(h * ratio[1]), int(w * ratio[2]), int(h * ratio[3]))
    return img.crop(box)


# --------------------------------------------------------------------------
# OCR
# --------------------------------------------------------------------------

_engine = None


def _missing_dep_exit() -> None:
    """依赖缺失时给出可操作提示，而不是抛一串 traceback。"""
    venv_py = os.path.join(
        os.environ.get("USERPROFILE", r"C:\Users\Default"),
        ".workbuddy", "binaries", "python", "envs", "default", "Scripts", "python.exe",
    )
    print("", file=sys.stderr)
    print("缺少 OCR 依赖 rapidocr-onnxruntime（装在项目专用环境里，不是系统 Python）。", file=sys.stderr)
    print("", file=sys.stderr)
    print(f"当前解释器：{sys.executable}", file=sys.stderr)
    print("", file=sys.stderr)
    print("两种解决办法（任选其一）：", file=sys.stderr)
    print("  1) 用项目专用环境运行（推荐，依赖已装好）：", file=sys.stderr)
    print(f'     "{venv_py}" ocr_service.py', file=sys.stderr)
    print("     或者直接双击本目录下的 run.bat", file=sys.stderr)
    print("", file=sys.stderr)
    print("  2) 给当前解释器装依赖：", file=sys.stderr)
    print("     pip install rapidocr-onnxruntime --proxy http://127.0.0.1:7890", file=sys.stderr)
    print("", file=sys.stderr)
    sys.exit(2)


def get_engine():
    global _engine
    if _engine is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
        except ImportError:
            try:
                from rapidocr import RapidOCR      # 新版包名
            except ImportError:
                _missing_dep_exit()
                raise
        _engine = RapidOCR()
    return _engine


def ocr_rows(img: Image.Image) -> list[dict]:
    """对 PIL 图跑 OCR，返回 [{text, score, y, x}]，保持引擎原始顺序。"""
    import numpy as np
    arr = np.array(img.convert("RGB"))[:, :, ::-1]   # RGB → BGR（引擎吃 OpenCV 风格）
    out = get_engine()(arr)
    res = out[0] if isinstance(out, tuple) else None
    rows = []
    for item in (res or []):
        box, text, score = item[0], item[1], item[2]
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        rows.append({
            "text": str(text),
            "score": round(float(score), 3),
            "y": int(min(ys)),
            "x": int(min(xs)),
        })
    return rows


def warmup(panel_image: Image.Image | None = None) -> None:
    """空跑一次识别，让 ONNX 模型完成算子预热与内存分配。

    实测明细（586×601 详情栏、12 核）：det≈0.18s、cls≈0.02s、**rec≈1.0s**，
    即耗时 85% 在文字识别阶段。

    ⚠ 因此预热图**必须含真实文字**。曾用纯色/噪声图预热，det 检测不到文字 → rec 根本没跑
    → 只有 det 被预热，首次真实识别仍需 2.5s。改用真实详情栏图后 rec 才真正热起来。
    """
    if panel_image is not None:
        ocr_rows(panel_image)
        return
    # 没有窗口可用时，画一张带中文的图，至少让 rec 跑一遍
    img = Image.new("RGB", (586, 601), (28, 38, 58))
    try:
        from PIL import ImageDraw
        d = ImageDraw.Draw(img)
        d.text((40, 60), "攻击力+5.8% 暴击率+7.0%", fill=(240, 240, 245))
        d.text((40, 120), "绝缘之旗印：（0）", fill=(240, 240, 245))
    except Exception:
        pass
    ocr_rows(img)


# --------------------------------------------------------------------------
# 行过滤与文本拼接
# --------------------------------------------------------------------------

# 界面噪声：按钮文字、套装效果正文、纯星级。
# ⚠ 切勿过滤「套装名：（N）」形态的行——那是套装名的唯一来源。
# ⚠ 顶部大字是「这一件圣遗物的名字」，不是套装名；它位于部位行之前，parser 会自然忽略。
NOISE_PATTERNS = [
    re.compile(r"圣遗物推荐"),
    re.compile(r"^对\s*比$"),
    re.compile(r"^强\s*化$"),
    re.compile(r"^装\s*备$"),
    re.compile(r"^重\s*塑$"),
    re.compile(r"件套"),                 # 「2件套：…」「4件套：…」
    # 星级行：**只要含 ★/☆ 就整行丢弃**。
    # 不能写成 ^[★☆]+$——实测出现过「6★」这种「数字+星」的形态，会漏网。
    # 星级对本项目毫无用处（只处理 5 星圣遗物，星级固定），且数字残留会被 parser 误当数值。
    # 物品名与套装名都不含星号，故此规则安全。
    re.compile(r"[★☆]"),
]

# 套装名行：「套装名：（N）」，括号内是已装备件数。
# 它既是套装名的唯一来源（必须保留），也是文本的截断点（其后为套装效果正文）。
#
# ⚠ 判定条件**只看「冒号 + 左括号」结构，不校验括号内内容**。
#   实测括号内会被读成 (0) / （0） / (O) / (O0) 等多种形态（O 是数字 0 的误识），
#   早期要求「括号内必须全为数字」导致 (O0) 匹配失败、套装效果正文整段漏进结果。
#   括号内容由 normalize_set_line() 单独规范化。
SET_LINE_RE = re.compile(r"^[^：:]{1,20}[：:]\s*[（(]")

# 一份完整详情栏至少应有的有效行数（物品名/部位/主属性名+值/等级/4 词条/套装名 = 10）
MIN_VALID_LINES = 8


def is_noise(text: str) -> bool:
    t = text.strip()
    return (not t) or any(p.search(t) for p in NOISE_PATTERNS)


_DIGIT_FIX = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "|": "1"})
_SET_LINE_FULL = re.compile(r"^(.+?)[：:]\s*[（(]\s*([0-9OoIl|]{0,3})\s*[）)]\s*$")


def normalize_set_line(t: str) -> str:
    """把套装名行规范成「套装名：（N）」——parser 的未知套装启发式要求括号内是 (\\d+)。

    实测括号内出现过 (0) / （0） / (O) / (O0)：O 是数字 0 的误识，O0 则是把一个 0 读成了两个字符。
    处理：字母型数字修正 → 只留数字 → 取最后一位（件数取值 0~5，单字符足够）。
    """
    m = _SET_LINE_FULL.match(t)
    if not m:
        return t
    name, cnt = m.group(1), m.group(2)
    cnt = re.sub(r"\D", "", cnt.translate(_DIGIT_FIX))
    cnt = cnt[-1] if cnt else "0"
    return f"{name}：（{cnt}）"


def normalize_line(text: str) -> str:
    """修正实测到的偶发误识。"""
    t = text.strip()
    # 行首项目符号：RapidOCR 把词条前的圆点识别成 · ・ . - ： 等各种形态（实测都出现过）。
    # 行首的冒号必然不是语义内容（套装名的冒号在中间），可安全剥离。
    t = re.sub(r"^[·・\.\-：:]\s*", "", t)
    # 行尾孤立引号：物品名「指挥的礼帽」实测被读成「指挥的礼帽”」。
    # 圣遗物名与套装名都不会以引号结尾，可安全剥离。
    t = re.sub(r"[\"'”’」』]+$", "", t)
    # 套装名行规范化（含括号内的 O→0）
    t = normalize_set_line(t)
    return t.strip()


def build_text(rows: list[dict]) -> tuple[str, list[str]]:
    """过滤噪声行并拼成 parser 能吃的文本（换行分隔）。返回 (文本, 保留的行)。

    截断规则：**遇到套装名行即停止**。详情栏里套装名之后全是套装效果正文
    （2 件套 / 4 件套的说明，可能占 2~3 行），单靠「件套」关键字只能过滤第一行，
    后续行（如「法器、弓箭角色时，角色重击造成的」）会漏进结果。
    按位置截断比堆关键字可靠。
    """
    kept = []
    for r in rows:
        t = normalize_line(r["text"])
        if is_noise(t):
            continue
        kept.append(t)
        if SET_LINE_RE.match(t):
            break
    return "\n".join(kept), kept


# --------------------------------------------------------------------------
# 双路一致性检查
# --------------------------------------------------------------------------

NUM_RE = re.compile(r"\d+(?:\.\d+)?")


def numeric_signature(kept: list[str]) -> list[str]:
    """从保留行里抽出全部数值，作为可比对的指纹。"""
    sig = []
    for line in kept:
        for n in NUM_RE.findall(line):
            sig.append(n)
    return sig


def compare_scales(kept1: list[str], kept2: list[str]) -> list[dict]:
    """比对 1x 与 2x 两路结果，返回不一致项。

    实测依据：理之冠首条词条被光效遮盖，1x 读作「攻击力+39」、2x 读作「攻击力+3°」，
    真值 33 —— 两路不一致可用于报警（但两路都不等于真值时无法纠错）。
    """
    issues = []
    sig1, sig2 = numeric_signature(kept1), numeric_signature(kept2)
    if len(sig1) != len(sig2):
        issues.append({
            "field": "numbers",
            "reason": f"两路数值个数不同（1x={len(sig1)} / 2x={len(sig2)}）",
        })
        return issues
    for i, (a, b) in enumerate(zip(sig1, sig2)):
        if a != b:
            issues.append({
                "field": f"numbers[{i}]",
                "reason": f"两路数值不一致：1x={a} / 2x={b}",
            })
    return issues


def check_integrity(kept: list[str]) -> list[dict]:
    """行级完整性检查：带「+」却不含任何数字的行 = 数值整个丢失。

    实测同一件圣遗物连打 5 次，其中一次读成「防御力+」（21 完全没读出来）。
    这类残行会被 parser 当成无效词条静默丢弃，导致少一条词条而用户无感，
    所以必须在结果里显式标出来。

    （物品名缺字如「花之壶」不做检查：物品名不参与解析，属无害波动。）
    """
    issues = []
    for line in kept:
        if "+" in line and not re.search(r"\d", line):
            issues.append({
                "field": line,
                "reason": f"「{line}」缺少数值，可能被光效遮挡或识别失败",
            })
    return issues


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------

def run_once(cfg: dict, save_debug: bool = True) -> dict:
    """执行一次完整识别。返回结果字典；失败时 ok=False。"""
    started = time.time()
    result: dict = {"ok": False, "ts": int(started * 1000)}

    pid, hwnd = resolve_target(cfg)
    if not pid:
        log(f"未找到进程 {cfg['process_name']}，游戏没在运行？", "err")
        result.update(error="NO_WINDOW", message="未找到游戏窗口")
        return result
    if not hwnd:
        log("未找到可见窗口", "err")
        result.update(error="NO_WINDOW", message="未找到游戏窗口")
        return result

    try:
        client, (cw, ch) = grab_client(hwnd)
    except GrabError as e:
        log(e.message, "err")
        result.update(error=e.code, message=e.message)
        return result

    if is_blank(client):
        log("抓到黑图：窗口被遮挡或已最小化", "err")
        result.update(error="BLANK_FRAME", message="窗口被遮挡或已最小化")
        return result

    log(f"抓图 {cw}x{ch}")
    if ch < cfg["min_window_height"]:
        log(f"窗口高度 {ch} < {cfg['min_window_height']}，字号偏小，识别可能不准", "warn")

    panel = crop_panel(client, cfg["crop_ratio"])

    tag = datetime.now().strftime("%Y%m%d-%H%M%S")
    paths = {}
    if save_debug and cfg.get("save_frames", True):
        os.makedirs(DEBUG_DIR, exist_ok=True)
        # 存 JPEG 而非 PNG：整窗图 PNG 单张 2.7MB，JPEG(q85) 约 250KB，差一个数量级
        p_client = os.path.join(DEBUG_DIR, f"{tag}-client.jpg")
        p_panel = os.path.join(DEBUG_DIR, f"{tag}-panel.jpg")
        client.save(p_client, "JPEG", quality=85)
        panel.save(p_panel, "JPEG", quality=85)
        paths = {"client": p_client, "panel": p_panel}

    if cfg["skip_ocr"]:
        log("已跳过 OCR（--no-ocr / skip_ocr）", "ok")
        flush_log(tag, cfg.get("keep_frames", 20))
        result.update(ok=True, skipped_ocr=True, size=[cw, ch], paths=paths)
        return result

    rows = ocr_rows(panel)
    if not rows:
        log("OCR 未识别到任何文字", "err")
        flush_log(tag, cfg.get("keep_frames", 20))
        result.update(error="OCR_EMPTY", message="OCR 未识别到任何文字")
        return result

    text, kept = build_text(rows)
    log(f"识别 {len(rows)} 行 → 保留 {len(kept)} 行")

    # 完整性检查：正常详情栏至少 10 行有效内容（物品名/部位/主属性名+值/等级/4 词条/套装名）。
    # 实测有一次在画面过渡瞬间只识别到 2 行（「摔的礼帽」「31.1%」），这不是识别率问题而是
    # 抓到了切换动画中的一帧，必须判失败让用户重按，否则会给出一份残缺数据误导下游。
    if len(kept) < MIN_VALID_LINES:
        log(f"仅识别到 {len(kept)} 行，明显不完整（可能抓到了画面过渡帧），请重试", "err")
        flush_log(tag, cfg.get("keep_frames", 20))
        result.update(error="OCR_INCOMPLETE",
                      message=f"识别结果不完整（{len(kept)} 行），请重试")
        return result

    suspicious = check_integrity(kept)

    if cfg["multi_scale_check"]:
        # 2x 放大重识别，仅用于交叉校验（实测 2x 不提升准确率，故不作为主结果）
        w2, h2 = panel.size
        big = panel.resize((w2 * 2, h2 * 2), Image.LANCZOS)
        rows2 = ocr_rows(big)
        _, kept2 = build_text(rows2)
        scale_issues = compare_scales(kept, kept2)
        suspicious.extend(scale_issues)
        if scale_issues:
            log(f"双路比对发现 {len(scale_issues)} 处不一致", "warn")

    if suspicious:
        for it in suspicious:
            log(f"可疑：{it['reason']}", "warn")

    elapsed = int((time.time() - started) * 1000)
    log(f"耗时 {elapsed}ms", "ok" if elapsed <= 2000 else "warn")

    print("-" * 60, file=sys.stderr)
    print(text, file=sys.stderr)
    print("-" * 60, file=sys.stderr)

    flush_log(tag, cfg.get("keep_frames", 20))
    result.update(ok=True, text=text, lines=kept, suspicious=suspicious,
                  elapsed_ms=elapsed, size=[cw, ch], paths=paths)
    return result


# --------------------------------------------------------------------------
# HTTP 服务（二-B）
# --------------------------------------------------------------------------

# 端口候选：首个能绑定成功的就用它。前端按同样顺序探测，两边无需共享配置。
PORT_CANDIDATES = [18080, 18081, 18082]


class OcrStore:
    """只保存「最近一次」识别结果，用自增 seq 让前端判断是否为新件。

    - 前端轮询带 since，等于当前 seq 时返回 204，避免重复解析
    - 前端 ack 后清空，防止刷新页面又弹一次
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._seq = 0
        self._latest: dict | None = None

    def publish(self, payload: dict) -> int:
        with self._lock:
            self._seq += 1
            payload = dict(payload)
            payload["seq"] = self._seq
            payload["ts"] = int(time.time() * 1000)
            self._latest = payload
            return self._seq

    def get(self, since: int) -> dict | None:
        with self._lock:
            if self._latest is None or self._latest["seq"] <= since:
                return None
            return self._latest

    def clear(self, seq: int) -> bool:
        with self._lock:
            if self._latest is not None and self._latest["seq"] == seq:
                self._latest = None
                return True
            return False


class OcrHandler(BaseHTTPRequestHandler):
    store: OcrStore = None          # 由 start_http 注入

    def _cors(self) -> None:
        # file:// 页面的 origin 是 "null"，因此必须用 *；PNA 预检还需要下面那个额外头
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")

    def _json(self, obj, code: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _empty(self, code: int) -> None:
        self.send_response(code)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_OPTIONS(self):
        self._empty(204)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/ocr/health":
            self._json({"ok": True, "service": "gys-ocr", "version": "0.2"})
            return

        if path == "/api/ocr/latest":
            qs = parse_qs(parsed.query)
            try:
                since = int(qs.get("since", ["0"])[0])
            except ValueError:
                since = 0
            item = self.store.get(since)
            if item is None:
                self._empty(204)
            else:
                self._json(item)
            return

        self._empty(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/ocr/ack":
            self._empty(404)
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n).decode("utf-8") if n else "{}"
            seq = int(json.loads(raw).get("seq", 0))
        except Exception:
            self._json({"ok": False, "error": "BAD_REQUEST"}, 400)
            return
        self._json({"ok": self.store.clear(seq)})

    def log_message(self, *args):
        pass          # 静默，避免污染服务端日志


def start_http(store: OcrStore, candidates=None) -> tuple[ThreadingHTTPServer | None, int | None]:
    """按候选端口依次尝试绑定。返回 (server, port)，全失败时 (None, None)。"""
    OcrHandler.store = store
    for port in (candidates or PORT_CANDIDATES):
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", port), OcrHandler)
        except OSError:
            continue
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return srv, port
    return None, None


# --------------------------------------------------------------------------
# 热键循环
# --------------------------------------------------------------------------

def register_hotkey(hwnd, hid: int, spec: dict) -> bool:
    mods = MOD_NOREPEAT
    for m in spec.get("modifiers", []):
        mods |= MOD_MAP.get(m.lower(), 0)
    key = spec.get("key", "")
    if len(key) != 1:
        log(f"热键键位非法：{key}", "err")
        return False
    vk = ord(key.upper())
    return bool(user32.RegisterHotKey(hwnd, hid, mods, vk))


def hotkey_label(spec: dict) -> str:
    names = {"ctrl": "Ctrl", "alt": "Alt", "shift": "Shift", "win": "Win"}
    parts = [names.get(m.lower(), m) for m in spec.get("modifiers", [])]
    parts.append(str(spec.get("key", "")).upper())
    return "+".join(parts)


def main_loop(cfg: dict) -> int:
    HID_SCAN, HID_QUIT = 1, 2
    if not register_hotkey(None, HID_SCAN, cfg["hotkey"]):
        err = ctypes.get_last_error()
        log(f"热键 {hotkey_label(cfg['hotkey'])} 注册失败（错误码 {err}），"
            f"可能已被其他程序占用。请改 service_config.json 后重试。", "err")
        return 1
    quit_ok = register_hotkey(None, HID_QUIT, cfg["quit_hotkey"])
    if not quit_ok:
        log(f"退出热键 {hotkey_label(cfg['quit_hotkey'])} 注册失败，"
            f"可用 Ctrl+C 结束进程", "warn")

    log(f"已就绪：{hotkey_label(cfg['hotkey'])} 识别一次"
        + (f"，{hotkey_label(cfg['quit_hotkey'])} 退出" if quit_ok else ""), "ok")

    # HTTP 是可选增强：起不来也不影响本地识别，只是网页联动不可用
    store: OcrStore | None = None
    srv = None
    try:
        store = OcrStore()
        srv, port = start_http(store)
        if srv:
            log(f"HTTP 已监听 http://127.0.0.1:{port}", "ok")
        else:
            log(f"端口 {PORT_CANDIDATES} 均被占用，网页联动不可用（识别仍正常）", "warn")
            store = None
    except Exception as e:
        log(f"HTTP 启动失败：{e}（识别仍正常）", "warn")
        store = None
    log("预加载 OCR 引擎…")
    get_engine()

    # 预热：优先用真实详情栏图（rec 阶段占 85%，必须让它真跑一次）
    warm_img = None
    try:
        _pid, _hwnd = resolve_target(cfg)
        if _hwnd:
            _client, _ = grab_client(_hwnd)
            warm_img = crop_panel(_client, cfg["crop_ratio"])
            log(f"预热用实际详情栏 {warm_img.size[0]}x{warm_img.size[1]}")
        else:
            log("游戏未运行，预热用合成文字图", "warn")
    except Exception as e:
        log(f"抓取预热图失败（{e}），改用合成文字图", "warn")

    log("预热中…")
    warmup(warm_img)
    log("预热完成", "ok")

    msg = wintypes.MSG()
    running = True
    try:
        while running:
            # 用 PeekMessage 轮询而非 GetMessage 阻塞，便于响应 Ctrl+C
            if user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 1):  # PM_REMOVE
                if msg.message == WM_HOTKEY:
                    if msg.wParam == HID_SCAN:
                        log("触发热键")
                        try:
                            r = run_once(cfg)
                            if store is not None:
                                # 失败也推送：网页需要知道「按了但没成功」，而不是毫无反应
                                store.publish({
                                    "ok": bool(r.get("ok")),
                                    "error": r.get("error"),
                                    "message": r.get("message"),
                                    "text": r.get("text"),
                                    "lines": r.get("lines", []),
                                    "suspicious": r.get("suspicious", []),
                                    "elapsed_ms": r.get("elapsed_ms"),
                                })
                        except Exception as e:
                            log(f"识别异常：{e}", "err")
                            if store is not None:
                                store.publish({"ok": False,
                                               "error": "ENGINE_ERROR",
                                               "message": f"识别异常：{e}"})
                    elif msg.wParam == HID_QUIT:
                        log("收到退出热键")
                        running = False
                continue
            time.sleep(0.05)
    except KeyboardInterrupt:
        log("收到中断信号")
    finally:
        user32.UnregisterHotKey(None, HID_SCAN)
        if quit_ok:
            user32.UnregisterHotKey(None, HID_QUIT)
        if srv is not None:
            try:
                srv.shutdown()
            except Exception:
                pass
        log("已退出")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="圣遗物截图识别服务（二-A 骨架）")
    ap.add_argument("--once", action="store_true", help="执行一次后退出")
    ap.add_argument("--no-ocr", action="store_true", help="只抓图裁剪，跳过 OCR")
    ap.add_argument("--no-debug", action="store_true", help="不保存调试图")
    ap.add_argument("--json", action="store_true", help="以 JSON 输出结果（便于自动化）")
    args = ap.parse_args()

    cfg = load_config()
    if args.no_ocr:
        cfg["skip_ocr"] = True

    if args.once:
        r = run_once(cfg, save_debug=not args.no_debug)
        if args.json:
            print(json.dumps(r, ensure_ascii=False, indent=2))
        return 0 if r.get("ok") else 1

    return main_loop(cfg)


if __name__ == "__main__":
    sys.exit(main())
