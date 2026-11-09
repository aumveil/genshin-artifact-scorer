# -*- coding: utf-8 -*-
"""fake_ocr_server.py - 测试用假 OCR 服务

用途：验证 ocr-bridge 的「轮询 → 取件 → ack → 弹窗」整条链路，
不必依赖真实热键（热键无法在非交互式会话里模拟，见二-B 记录）。

复用 ocr_service 里真实的 OcrStore / OcrHandler，协议完全一致，只在数据来源上作假：
启动后延迟若干秒 publish 一条固定样本。

用法: python fake_ocr_server.py [延迟秒数]
"""
import sys
import time

import ocr_service as S

# 真实识别产出的一条样本（生之花 +0，带一条待激活）
SAMPLE = {
    "ok": True,
    "error": None,
    "message": None,
    "text": (
        "乐团的晨光\n生之花\n生命值\n717\n+0\n"
        "暴击率+3.1%\n防御力+21\n元素精通+23\n攻击力+14（待激活）\n"
        "流浪大地的乐团：（0）"
    ),
    "lines": [
        "乐团的晨光", "生之花", "生命值", "717", "+0",
        "暴击率+3.1%", "防御力+21", "元素精通+23", "攻击力+14（待激活）",
        "流浪大地的乐团：（0）",
    ],
    "suspicious": [],
    "elapsed_ms": 1234,
}


def main():
    delay = float(sys.argv[1]) if len(sys.argv) > 1 else 4.0
    store = S.OcrStore()
    srv, port = S.start_http(store)
    if not srv:
        print("FAKE_FAIL: 端口全占用", flush=True)
        return 1
    print(f"FAKE_READY port={port} delay={delay}s", flush=True)

    time.sleep(delay)
    seq = store.publish(SAMPLE)
    print(f"FAKE_PUBLISHED seq={seq}", flush=True)

    # 保持存活，让前端完成轮询与 ack
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
