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
