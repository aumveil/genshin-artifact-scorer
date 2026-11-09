"use strict";
/**
 * e2e_bridge.js - 二-B 端到端验证（真实浏览器 + 真实 HTTP 协议）
 *
 * 验证链：页面在角色详情页 → 服务推送 → ocr-bridge 轮询取到
 *         → ui.receiveOcrArtifact → 弹出录入弹窗（已预填）
 *
 * ⚠ 热键不在本脚本覆盖范围内：本 agent 的进程跑在非交互式会话
 * （GetForegroundWindow 返回 0），keybd_event 发出的按键进的是自己的输入队列，
 * 到不了用户会话的热键。因此这里用 fake_ocr_server.py 复用真实 OcrStore/OcrHandler
 * 产生数据，协议与真服务完全一致，只替换数据来源。
 * 热键本身已在用户会话中实测通过（见二-A 记录）。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "../..");
const PY = path.join(os.homedir(), ".workbuddy/binaries/python/envs/default/Scripts/python.exe");

function findBackup() {
  const dir = path.join(ROOT, "backups");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
  return path.join(dir, files[files.length - 1]);
}

function waitFor(fn, timeoutMs, stepMs = 200) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function tick() {
      if (fn()) return resolve(true);
      if (Date.now() - t0 > timeoutMs) return reject(new Error("timeout"));
      setTimeout(tick, stepMs);
    })();
  });
}

(async () => {
  const results = [];
  const ok = (name, cond, extra) => {
    results.push({ name, pass: !!cond, extra });
    console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? "  (" + extra + ")" : ""}`);
  };

  // ---- 启动假服务（12 秒后推送，留足时间让页面进到详情页）----
  let fakeOut = "";
  const fake = spawn(PY, ["fake_ocr_server.py", "12"], {
    cwd: __dirname, stdio: ["ignore", "pipe", "pipe"],
  });
  fake.stdout.on("data", d => { fakeOut += d.toString(); });
  fake.stderr.on("data", d => { fakeOut += d.toString(); });
  await waitFor(() => /FAKE_READY/.test(fakeOut), 15000);
  const port = (fakeOut.match(/port=(\d+)/) || [])[1];
  console.log("假服务端口:", port);

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const logs = [];
  page.on("console", m => logs.push(m.text()));
  page.on("pageerror", e => logs.push("PAGEERROR: " + e.message));

  try {
    // ⚠ 备份带 UTF-8 BOM，不剥会让 JSON.parse 失败、页面走兜底面板
    const backup = fs.readFileSync(findBackup(), "utf-8").replace(/^\uFEFF/, "");
    await page.goto(pathToFileURL(path.join(ROOT, "index.html")).href);
    await page.evaluate(d => localStorage.setItem("gys_reliquary_v1", d), backup);
    await page.reload();
    await page.waitForSelector(".role-card", { timeout: 10000 });
    console.log("列表已渲染");

    // 等桥接探测完成
    await page.waitForTimeout(2200);
    const st0 = await page.evaluate(() => window.App.ocrBridge && window.App.ocrBridge.status());
    ok("ocr-bridge 已连接服务", st0 && st0.running === true, JSON.stringify(st0));

    // 进入第一个角色详情
    await page.click(".role-card");
    await page.waitForTimeout(700);
    const inDetail = await page.evaluate(() =>
      !!document.querySelector(".detail-head") || !!document.querySelector(".slot-card"));
    ok("已进入角色详情页", inDetail);

    const before = await page.evaluate(() => localStorage.getItem("gys_reliquary_v1"));

    // 等假服务推送 + 桥接轮询（最多 18 秒）
    let dlg = null;
    try {
      await waitFor(() => true, 1);        // noop
      const deadline = Date.now() + 18000;
      while (Date.now() < deadline) {
        dlg = await page.evaluate(() => {
          const d = document.querySelector('[role="dialog"]');
          if (!d) return null;
          return {
            visible: d.getAttribute("aria-hidden") !== "true",
            text: (d.textContent || "").replace(/\s+/g, " ").slice(0, 160),
          };
        });
        if (dlg) break;
        await page.waitForTimeout(300);
      }
    } catch (e) { /* 交给下面的断言 */ }

    ok("弹窗已自动打开", !!(dlg && dlg.visible), dlg ? dlg.text.slice(0, 80) : "(未出现)");
    if (dlg) {
      // 样本是「生之花 / 生命值 / 4 条词条」，弹窗应预填这些
      ok("弹窗含套装信息", /流浪大地的乐团/.test(dlg.text), "");
      ok("弹窗含部位信息", /生之花/.test(dlg.text), "");
    }

    const after = await page.evaluate(() => localStorage.getItem("gys_reliquary_v1"));
    ok("仅打开弹窗，未改动已存数据", before === after);

    const st1 = await page.evaluate(() => window.App.ocrBridge.status());
    ok("已收到推送（lastSeq 推进）", st1 && st1.lastSeq > 0, JSON.stringify(st1));

    // ack 后服务端应清空：再查一次 latest 应为 204
    const cleared = await page.evaluate(async (p) => {
      const r = await fetch(`http://127.0.0.1:${p}/api/ocr/latest?since=${window.App.ocrBridge.status().lastSeq}`);
      return r.status;
    }, port);
    ok("ack 后服务端已清空（204）", cleared === 204, "HTTP " + cleared);

  } catch (e) {
    console.log("测试异常:", e.message);
    logs.slice(-10).forEach(l => console.log("  [log] " + l));
  } finally {
    await browser.close();
    fake.kill();
  }

  const failed = results.filter(r => !r.pass);
  console.log("");
  console.log(`结果：${results.length - failed.length} / ${results.length} 通过`);
  if (failed.length) {
    console.log("失败项：" + failed.map(f => f.name).join(" / "));
    process.exitCode = 1;
  }
})();
