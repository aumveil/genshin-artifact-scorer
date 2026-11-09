/**
 * ocr-bridge.js - 与本地 OCR 服务通信（可选增强）
 *
 * 设计原则：**服务不在时，网页必须是完全正常的**。
 * 探测不到服务就静默禁用自身，不报错、不提示、不影响任何现有功能。
 *
 * 通信：
 *   GET  /api/ocr/health          探测（启动时一次）
 *   GET  /api/ocr/latest?since=N  轮询，204 表示没有新件
 *   POST /api/ocr/ack             确认已消费，服务端清空
 *
 * 端口按 18080 → 18081 → 18082 依次探测，与服务端 PORT_CANDIDATES 保持一致，
 * 因此两边不需要共享任何配置文件。
 */
(function (global) {
  "use strict";

  var PORTS = [18080, 18081, 18082];
  var POLL_MS = 1000;
  var HEALTH_TIMEOUT_MS = 1500;
  var START_DELAY_MS = 600;      // 让首屏先渲染完，别抢资源
  var RETRY_MS = 10000;          // 探测失败后的重试间隔（服务可能比网页后启动）

  var base = null;               // 探测成功后的基地址，如 http://127.0.0.1:18080
  var lastSeq = 0;
  var timer = null;
  var running = false;

  /**
   * 用 console.info 而不是 debug：Chrome 控制台默认隐藏 Verbose 级输出，
   * 用 debug 会导致用户出问题时看不到任何线索。
   */
  function log(msg) {
    if (global.console && console.info) console.info("[ocr-bridge] " + msg);
  }

  /** 环境是否具备条件：jsdom / 老浏览器没有 fetch，直接不启用 */
  function canRun() {
    return typeof global.fetch === "function"
      && global.App && global.App.ui
      && typeof global.App.ui.receiveOcrArtifact === "function";
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error("timeout")); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); },
                   function (e) { clearTimeout(t); reject(e); });
    });
  }

  function probe() {
    var i = 0;
    function next() {
      if (i >= PORTS.length) return Promise.resolve(null);
      var url = "http://127.0.0.1:" + PORTS[i++];
      return withTimeout(global.fetch(url + "/api/ocr/health", { cache: "no-store" }), HEALTH_TIMEOUT_MS)
        .then(function (res) {
          if (!res.ok) return next();
          return res.json().then(function (j) {
            if (j && j.ok && j.service === "gys-ocr") return url;
            return next();
          });
        })
        .catch(function () { return next(); });
    }
    return next();
  }

  function ack(seq) {
    if (!base) return;
    try {
      global.fetch(base + "/api/ocr/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seq: seq })
      }).catch(function () {});
    } catch (e) { /* 静默 */ }
  }

  function handle(payload) {
    var fb = global.App.feedback;

    if (!payload.ok) {
      // 失败也要让用户知道「按了但没成功」，否则会以为工具没反应
      if (fb && fb.toast) fb.toast(payload.message || "识别失败", "error");
      ack(payload.seq);
      return;
    }

    var accepted = false;
    try {
      accepted = global.App.ui.receiveOcrArtifact(payload) !== false;
    } catch (e) {
      log("接收失败：" + e.message);
    }
    if (!accepted && fb && fb.toast) {
      // receiveOcrArtifact 内部已给出具体原因（如「请先打开角色详情页」），此处不重复提示
    }
    ack(payload.seq);
  }

  function tick() {
    if (!running || !base) return;
    if (global.document && global.document.hidden) {
      schedule();
      return;
    }
    global.fetch(base + "/api/ocr/latest?since=" + lastSeq, { cache: "no-store" })
      .then(function (res) {
        if (res.status !== 200) return null;
        return res.json();
      })
      .then(function (payload) {
        if (payload && typeof payload.seq === "number" && payload.seq > lastSeq) {
          lastSeq = payload.seq;
          handle(payload);
        }
      })
      .catch(function () {
        // 服务可能已退出：不弹窗，只是本轮失败，下一轮继续试
      })
      .then(schedule, schedule);
  }

  function schedule() {
    if (!running) return;
    clearTimeout(timer);
    timer = setTimeout(tick, POLL_MS);
  }

  var retryBound = false;

  function start() {
    if (!canRun()) {
      log("环境不支持或缺少 receiveOcrArtifact（可能是页面缓存了旧版 js），已禁用");
      return;
    }
    probe().then(function (url) {
      if (!url) {
        // ⚠ 关键：不能探测一次就放弃。用户常见操作顺序是「先开网页、再启动服务」，
        // 若此处 return 则桥接永久禁用，之后按热键毫无反应且没有任何提示。
        log("未发现本地 OCR 服务，将在 " + Math.round(RETRY_MS / 1000) + " 秒后重试");
        setTimeout(start, RETRY_MS);
        return;
      }
      base = url;
      running = true;
      lastSeq = 0;
      log("已连接 " + url);
      schedule();
    }).catch(function () {
      setTimeout(start, RETRY_MS);
    });

    // 页面从后台切回时立即补一次，不必等下一个轮询周期。
    // 只注册一次，避免重试时重复叠加监听。
    if (!retryBound && global.document && global.document.addEventListener) {
      retryBound = true;
      global.document.addEventListener("visibilitychange", function () {
        if (!global.document.hidden && running) {
          clearTimeout(timer);
          tick();
        }
      });
    }
  }

  global.App = global.App || {};
  global.App.ocrBridge = {
    start: start,
    /** 供调试：当前连接状态 */
    status: function () { return { base: base, lastSeq: lastSeq, running: running }; }
  };

  if (typeof global.addEventListener === "function") {
    global.addEventListener("load", function () {
      setTimeout(start, START_DELAY_MS);
    });
  } else {
    setTimeout(start, START_DELAY_MS);
  }
})(window);
