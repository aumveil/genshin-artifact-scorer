/* ==========================================================================
   appearance.js —— 外观三态开关（2026-10-12；R7 增「跟随系统」，2026-10-16）

   三种搭配：深色 + 金（默认） / 浅色 + systemBlue / 跟随系统（auto）
   入口 = 顶栏右侧图标按钮（纯图标）：☾ 深色 → ☀ 浅色 → ◐ 跟随系统 → ☾ …
   跟随系统 = 监听 prefers-color-scheme 实时切换 data-appearance（不重写存储）。

   ⚠️ 可整体移除（其余代码零依赖）：删本文件 + index.html 内联引导脚本与按钮 + style.css 对应整节。
   ========================================================================== */
(function () {
  "use strict";
  var ROOT = document.documentElement;
  var KEY = "gys_appearance_v1";           // "dark"（默认）| "light" | "auto"（跟随系统）
  var MODES = ["dark", "light", "auto"];

  function systemLight() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
  }
  function current() {
    try {
      var v = localStorage.getItem(KEY);
      return MODES.indexOf(v) >= 0 ? v : "dark";
    } catch (e) { return "dark"; }
  }
  function apply(mode) {
    var light = mode === "light" || (mode === "auto" && systemLight());
    if (light) ROOT.setAttribute("data-appearance", "light");
    else ROOT.removeAttribute("data-appearance");
    sync(mode);
  }
  function meta(mode) {
    if (mode === "light") return { icon: "i-sun", label: "外观：浅色 + 蓝（点击切换 → 跟随系统）" };
    if (mode === "auto") return { icon: "i-auto", label: "外观：跟随系统（点击切换 → 深色 + 金）" };
    return { icon: "i-moon", label: "外观：深色 + 金（点击切换 → 浅色 + 蓝）" };
  }
  function sync(mode) {
    var btn = document.getElementById("appearanceToggle");
    if (!btn) return;
    var m = meta(mode);
    btn.innerHTML = '<svg class="ico" aria-hidden="true" focusable="false"><use href="#' + m.icon + '"></use></svg>';
    btn.title = m.label;
    btn.setAttribute("aria-label", m.label);
    btn.setAttribute("aria-pressed", mode === "light" ? "true" : "false");
  }
  function init() {
    var btn = document.getElementById("appearanceToggle");
    if (!btn) return;
    var mode = current();
    btn.addEventListener("click", function () {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      try { localStorage.setItem(KEY, mode); } catch (e) { /* 隐私模式忽略 */ }
      apply(mode);
    });
    // 跟随系统：系统配色变化时实时应用（仅 auto 态）
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: light)");
      var onSysChange = function () { if (mode === "auto") apply("auto"); };
      if (mq.addEventListener) mq.addEventListener("change", onSysChange);
      else if (mq.addListener) mq.addListener(onSysChange);
    }
    apply(mode);   // 初始（与首屏内联脚本同一判据，防闪）
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
