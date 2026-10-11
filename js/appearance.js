/* ==========================================================================
   appearance.js —— 外观二选一开关（2026-10-12）

   两种固定搭配：
     深色 + 金（默认）  ⇄  浅色 + systemBlue
   入口 = 顶栏右侧的图标按钮（纯图标，无文字）：深色显示 ☾、浅色显示 ☀。

   ⚠️ 这是对比选定用的工具。若要完全移除，删三处即可（其余代码零依赖）：
        1) 本文件 js/appearance.js
        2) index.html：<head> 的内联引导脚本 + 顶栏的 #appearanceToggle 按钮 + </body> 前的 <script>
        3) style.css 末尾「顶栏外观切换按钮」整节
   ========================================================================== */
(function () {
  "use strict";

  var ROOT = document.documentElement;
  var KEY = "gys_appearance_v1";   // dark（深+金，默认） | light（浅+蓝）

  function current() {
    try { return localStorage.getItem(KEY) === "light" ? "light" : "dark"; }
    catch (e) { return "dark"; }
  }

  function apply(mode) {
    if (mode === "light") ROOT.setAttribute("data-appearance", "light");
    else ROOT.removeAttribute("data-appearance");
    try { localStorage.setItem(KEY, mode); } catch (e) { /* 隐私模式忽略 */ }
    sync(mode);
  }

  function sync(mode) {
    var btn = document.getElementById("appearanceToggle");
    if (!btn) return;
    var light = mode === "light";
    var label = light ? "当前：浅色 + 蓝，点击切换到 深色 + 金"
                      : "当前：深色 + 金，点击切换到 浅色 + 蓝";
    btn.textContent = light ? "☀" : "☾";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", light ? "true" : "false");
  }

  function init() {
    var btn = document.getElementById("appearanceToggle");
    if (!btn) return;
    sync(current());
    btn.addEventListener("click", function () {
      apply(current() === "light" ? "dark" : "light");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
