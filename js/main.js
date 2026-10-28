/**
 * main.js - 启动入口（对应《圣遗物网页实现方案.md》2.3）
 */
(function (global) {
  "use strict";

  function init() {
    global.App.ui.setupIO();
    global.App.ui.render();
    // 数据迁移提示（R6）：本次加载发生过格式升级改写 → 诚实告知（一次性）
    if (global.App.storage.wasMigrated && global.App.storage.wasMigrated()) {
      global.App.feedback.toast("数据已升级至新版格式", "info");
    }

    // 损坏数据提示（2026-10-25 P0）：本次读到无法解析的旧数据 → 原始串已隔离，先提示取回再继续。
    // 隔离失败时改发警告：继续操作会覆盖原内容（storage.save 正常写入），必须让用户先备份。
    const corrupt = global.App.storage.corruptState && global.App.storage.corruptState();
    if (corrupt) {
      const sizeKB = Math.max(1, Math.round(corrupt.size / 1024));
      if (corrupt.saved) {
        global.App.feedback.confirm({
          title: "本地数据无法读取",
          message: "上次保存的数据已损坏，本次以空数据启动。",
          detail: `原始内容（${sizeKB} KB）已隔离保存，不会被本次操作覆盖。建议先下载损坏副本，修复后用「导入」恢复；也可直接导入最近的备份。`,
          confirmText: "下载损坏副本",
          cancelText: "稍后处理"
        }).then(ok => { if (ok) global.App.io.downloadCorruptBackup(); });
      } else {
        global.App.feedback.info({
          title: "本地数据无法读取",
          type: "error",
          message: `<p>上次保存的数据已损坏，且受容量限制<b>未能隔离保存</b>。</p>` +
            `<p>继续录入会覆盖原始内容——请立即「导出」当前数据并改用最近备份，或关闭页面后从浏览器开发者工具备份 localStorage。</p>`
        });
      }
    }

    // 浏览器控制台调试接口
    global.App.debug = {
      core: global.App.core,
      parser: global.App.parser,
      store: global.App.store,
      data: global.App.data,
      parse: text => global.App.parser.parseArtifactText(text),
      score: roleId => {
        const r = global.App.store.getRole(roleId);
        return r ? global.App.core.calcCharacterScore(r) : null;
      }
    };
    console.log("%c圣遗物评分网页已就绪。调试：App.debug（如 App.debug.parse(\"...\")）",
      "color:#d4af37;font-weight:bold");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
