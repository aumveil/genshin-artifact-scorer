/**
 * test-dom.js - 用 jsdom 无头加载页面，模拟「创建角色 → 点击进入详情」，捕获真实运行时错误
 * 运行：node test-dom.js （需先安装 jsdom：npm i jsdom；也可通过 NODE_PATH 提供全局模块路径）
 */
const { JSDOM } = require("jsdom");
const path = require("path");

(async () => {
  const dom = await JSDOM.fromFile(path.join(__dirname, "index.html"), {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.__testErrors = [];
      window.addEventListener("error", e => window.__testErrors.push("error: " + e.message));
      // file:// 下 localStorage 不可用：先遮蔽原型 getter，再注入内存实现（不预先读取，避免触发 SecurityError）
      const mem = {};
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
          getItem: k => (k in mem ? mem[k] : null),
          setItem: (k, v) => { mem[k] = String(v); },
          removeItem: k => { delete mem[k]; },
          clear: () => { for (const k in mem) delete mem[k]; },
          key: i => Object.keys(mem)[i] || null,
          get length() { return Object.keys(mem).length; }
        }
      });
    }
  });
  const { window } = dom;
  window.addEventListener("unhandledrejection", e => window.__testErrors.push("rejection: " + e.reason));

  await new Promise(res => {
    if (window.document.readyState === "complete") res();
    else window.addEventListener("load", res);
  });
  await new Promise(res => setTimeout(res, 300));

  const App = window.App;
  console.log("App 加载:", !!App, "| ui:", !!(App && App.ui), "| store:", !!(App && App.store));
  if (!App || !App.ui || !App.store) { console.log("模块加载失败"); process.exit(1); }

  // —— 场景 1：正常角色（散件杯 + 5 部位齐全）——
  const role = App.store.newRole("测试-正常");
  role.effectiveStats = ["暴击率", "暴击伤害", "攻击力百分比"];
  role.weights = { "暴击率": 1, "暴击伤害": 1, "攻击力百分比": 0.8 };
  role.looseSlot = "goblet";
  ["flower", "plume", "sands", "goblet", "circlet"].forEach(slot => {
    // circlet 暴击率 3.3 无法档位分解 → 推断 null（无判据）→ 出切换按钮；其余 4 件 Σk=9 刚性 4 初始（静态标签）
    role.artifacts[slot] = {
      id: App.store.genId(), slot, set: "炽烈的炎之魔女",
      mainStat: slot === "flower" ? "生命值" : slot === "plume" ? "攻击力" : slot === "sands" ? "攻击力百分比" : slot === "goblet" ? "火元素伤害加成" : "暴击伤害",
      level: 20,
      substats: [
        { stat: "暴击率", value: slot === "circlet" ? 3.3 : 7.4, activated: true },
        { stat: "暴击伤害", value: 15.6, activated: true },
        { stat: "攻击力百分比", value: 12.9, activated: true },   // 档位分解 Σk=2+2+3+2=9 → 刚性 4 初始（原 11.6 为 Σk=8 会推断成 3）
        { stat: "元素充能效率", value: 13.0, activated: true }
      ]
    };
  });
  App.store.updateRole(role);

  // —— 场景 2：无散件角色（looseSlot = null）——
  const role2 = App.store.newRole("测试-无散件");
  role2.effectiveStats = ["暴击率"];
  role2.weights = { "暴击率": 1 };
  role2.looseSlot = null;
  role2.artifacts.flower = {
    id: App.store.genId(), slot: "flower", set: "炽烈的炎之魔女", mainStat: "生命值",
    level: 20, substats: [{ stat: "暴击率", value: 7.4, activated: true }]
  };
  App.store.updateRole(role2);

  // —— 场景 3：莫娜式角色（effectiveStats 空数组、部分部位空）——
  const role3 = App.store.newRole("测试-导入式");
  role3.effectiveStats = [];
  role3.weights = {};
  role3.looseSlot = "goblet";
  role3.element = "冰";   // 元素字段：验证角色名左侧图标渲染
  role3.artifacts.flower = {
    id: App.store.genId(), slot: "flower", set: "绝缘之旗印", mainStat: "生命值",
    level: 20, substats: [{ stat: "暴击率", value: 3.9, activated: true }]
  };
  App.store.updateRole(role3);

  App.ui.render();
  const app = window.document.getElementById("app");
  console.log("列表渲染长度:", app.innerHTML.length);

  // —— 元素图标断言（场景 3 角色设了 element=冰）——
  {
    const iconImgs = Array.from(app.querySelectorAll(".role-card .ele-icon")).map(i => i.getAttribute("src"));
    const hasIce = iconImgs.includes("assets/elements/冰.png");
    console.log("首页元素图标:", hasIce ? "✓ " + iconImgs.join(", ") : "✗ 未找到（实际: " + iconImgs.join(", ") + "）");
    if (!hasIce) process.exitCode = 1;
  }

  // 依次点击每个角色卡
  const cards = app.querySelectorAll(".role-card");
  console.log("角色卡数量:", cards.length);
  for (let i = 0; i < cards.length; i++) {
    cards[i].click();
    await new Promise(res => setTimeout(res, 50));
    const len = app.innerHTML.length;
    const hasHead = app.querySelector(".detail-head") != null;
    console.log(`点击第 ${i + 1} 张卡 → 详情长度: ${len}, 有头部: ${hasHead}`);
    if (len === 0 || !hasHead) {
      console.log("  ⚠ 该角色详情为空！片段:", app.innerHTML.slice(0, 150));
    }
    App.ui.render(); // 回到列表
    await new Promise(res => setTimeout(res, 20));
    // 重新获取卡片（render 后 DOM 重建）
  }

  // —— 排序验证：分数降序 ——
  // 确保回到列表视图（当前可能在详情页）
  if (!app.querySelector(".filter-bar")) {
    const backBtn = Array.from(app.querySelectorAll(".detail-head .btn")).find(b => b.textContent.includes("返回"));
    if (backBtn) { backBtn.click(); await new Promise(r => setTimeout(r, 30)); }
  }
  App.ui.render();
  let names = Array.from(app.querySelectorAll(".role-card .rc-name")).map(n => n.textContent);
  const scoreOf = name => App.core.calcCharacterScore(App.store.getRoles().find(x => x.name === name)).percent;
  const scores = names.map(scoreOf);
  const sortedOk = scores.every((s, i) => i === 0 || scores[i - 1] >= s);
  console.log("排序后:", names.join(" > "));
  console.log("分数降序:", sortedOk ? "✓" : "✗", scores.map(s => s.toFixed(1)).join(" >= "));

  // —— 筛选验证（两条互斥路径：①按角色=套装 ②按散件=部位+主词条；切换即清空另一路）——
  const tabBtn = key => app.querySelector('.filter-bar .filter-tabs .ftab[data-m="' + key + '"]');
  const filterSelects = () => app.querySelectorAll(".filter-bar select");
  const listNames = () => Array.from(app.querySelectorAll(".role-card .rc-name")).map(n => n.textContent);
  // 清除按钮按文本定位（套装面板内有「清空」按钮，避免误匹配）
  const clearBtn = () => Array.from(app.querySelectorAll(".filter-bar .btn")).find(b => b.textContent.includes("清除"));

  // ① 默认路径「按角色」：只渲染套装控件（无部位/主词条下拉），无条件下列出全部 3 个角色
  console.log("路径①[按角色]默认:", tabBtn("role").classList.contains("active") ? "✓" : "✗",
    "· 件级下拉数:", filterSelects().length, filterSelects().length === 0 ? "✓" : "✗",
    "· 列表数:", listNames().length, listNames().length === 3 ? "✓" : "✗");

  // ② 按角色：套装多选（≥2 件视为套装；面板内逐个勾选）
  //    场景数据：测试-正常 5 件魔女；测试-无散件 1 件花魔女；测试-导入式 1 件花绝缘
  app.querySelector(".set-filter .set-btn").click();   // 打开面板
  await new Promise(r => setTimeout(r, 30));
  const setCheck = name => Array.from(app.querySelectorAll(".set-item")).find(l => l.textContent.trim() === name).querySelector("input");
  setCheck("炽烈的炎之魔女").click();
  await new Promise(r => setTimeout(r, 30));
  names = listNames();
  console.log("路径①[魔女≥2件]:", names.join(", "), names.length === 1 && names[0] === "测试-正常" ? "✓" : "✗");
  // 面板保持打开（局部刷新未重建），追加勾选「绝缘之旗印」→ 仍仅测试-正常（导入式仅 1 件绝缘，不满足 ≥2）
  setCheck("绝缘之旗印").click();
  await new Promise(r => setTimeout(r, 30));
  names = listNames();
  console.log("路径①[魔女+绝缘 ≥2件]:", names.join(", "), names.length === 1 && names[0] === "测试-正常" ? "✓" : "✗");

  // ③ 切换到「按散件」：套装条件被清空（两条路不同时生效），该路出现部位/主词条下拉
  tabBtn("loose").click();
  await new Promise(r => setTimeout(r, 30));
  console.log("路径切换[套装条件清空]:", tabBtn("loose").classList.contains("active") ? "✓ 切至按散件" : "✗",
    "· 件级下拉数:", filterSelects().length, filterSelects().length === 2 ? "✓" : "✗",
    "· 列表数:", listNames().length, listNames().length === 3 ? "✓（套装条件未生效）" : "✗");

  // ④ 按散件·部位单独筛选：杯（「测试-正常」与「测试-导入式」的散件部位均为杯；按分数降序）
  let fSlot = filterSelects()[0];
  fSlot.value = "goblet";
  fSlot.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  names = listNames();
  console.log("路径②[杯]:", names.join(", "), names.length === 2 && names[0] === "测试-正常" ? "✓" : "✗");

  // ⑤ 按散件·部位 + 主词条 AND 叠加：杯 + 火元素伤害加成 → 仅测试-正常
  let fStat = filterSelects()[1];
  fStat.value = "火元素伤害加成";
  fStat.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  names = listNames();
  console.log("路径②[杯+火伤]:", names.join(", "), names.length === 1 && names[0] === "测试-正常" ? "✓" : "✗");

  // ⑥ 清除当前路条件（保留所在路径）→ 恢复全部
  clearBtn().click();
  await new Promise(r => setTimeout(r, 30));
  console.log("路径②清除后(应3):", listNames().length, listNames().length === 3 ? "✓" : "✗",
    tabBtn("loose").classList.contains("active") ? "· 仍在按散件路径 ✓" : "· ✗");

  // ⑦ 按散件·主词条可脱离部位单独筛选：生命值（3 个角色花都是生命值）
  fStat = filterSelects()[1];
  fStat.value = "生命值";
  fStat.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  names = listNames();
  console.log("路径②[主词条=生命值]:", names.join(", "), names.length === 3 ? "✓" : "✗");

  // ⑧ 切回「按角色」：件级条件被清空（互斥）
  tabBtn("role").click();
  await new Promise(r => setTimeout(r, 30));
  console.log("路径切换[件级条件清空]:", filterSelects().length === 0 && listNames().length === 3 ? "✓" : "✗");

  // —— 自定义套装置顶回归：添加的自定义套装必须出现在筛选面板列表最前（2026-08-23 修复）——
  App.store.addCustomSet("炉火融炼之心");
  App.ui.render();
  await new Promise(r => setTimeout(r, 30));
  const firstSet = app.querySelector(".set-filter .set-list .set-item span");
  console.log("自定义套装置顶:", firstSet ? firstSet.textContent : "（无）", firstSet && firstSet.textContent === "炉火融炼之心" ? "✓" : "✗");

  // —— 按散件路径：跨视图保持 + 持久化（落盘只含当前路条件）——
  {
    tabBtn("loose").click();
    await new Promise(r => setTimeout(r, 30));
    filterSelects()[0].value = "goblet";
    filterSelects()[0].dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    const preNames = listNames();
    console.log("筛选[杯]前置:", preNames.join(", "), preNames.length === 2 ? "✓" : "✗");

    const savedRaw = window.localStorage.getItem(window.App.storage.FILTER_KEY);
    const saved = savedRaw ? JSON.parse(savedRaw) : null;
    console.log("散件筛选落盘:", saved && saved.mode === "loose" && saved.slot === "goblet"
      && Array.isArray(saved.sets) && saved.sets.length === 0 ? "✓（套装字段互斥清空）" : "✗", savedRaw || "（无）");
    const restored = window.App.storage.loadFilter();
    console.log("loadFilter 恢复:", restored && restored.mode === "loose" && restored.slot === "goblet" ? "✓" : "✗");

    app.querySelector(".role-card").click();   // 进入第一个角色详情
    await new Promise(r => setTimeout(r, 30));
    const backBtn = Array.from(app.querySelectorAll(".detail-head .btn")).find(b => b.textContent.includes("返回"));
    if (backBtn) { backBtn.click(); await new Promise(r => setTimeout(r, 30)); }
    const keptSlot = filterSelects()[0] && filterSelects()[0].value;
    const afterNames = listNames();
    console.log("返回后筛选保留:", `slot=${keptSlot}`,
      keptSlot === "goblet" && afterNames.length === 2 && afterNames.includes("测试-正常") ? "✓" : "✗");
    clearBtn().click();   // 清理
    await new Promise(r => setTimeout(r, 30));
  }

  // —— 按角色路径：套装条件落盘（mode=role，件级字段为空）——
  {
    tabBtn("role").click();
    await new Promise(r => setTimeout(r, 30));
    app.querySelector(".set-filter .set-btn").click();
    await new Promise(r => setTimeout(r, 30));
    Array.from(app.querySelectorAll(".set-item")).find(l => l.textContent.trim() === "炽烈的炎之魔女").querySelector("input").click();
    await new Promise(r => setTimeout(r, 30));
    const savedRaw2 = window.localStorage.getItem(window.App.storage.FILTER_KEY);
    const saved2 = savedRaw2 ? JSON.parse(savedRaw2) : null;
    console.log("套装筛选落盘:", saved2 && saved2.mode === "role" && saved2.sets.length === 1
      && saved2.sets[0] === "炽烈的炎之魔女" && saved2.slot === "" && saved2.mainStat === "" ? "✓" : "✗",
      savedRaw2 || "（无）");
    clearBtn().click();   // 清理
    await new Promise(r => setTimeout(r, 30));
  }

  // —— 重塑分析视图冒烟（算法四三情况归属：顶栏入口 → 视图渲染 → 归属 → 档位切换）——
  {
    const btnRemodel = window.document.getElementById("btnRemodel");
    btnRemodel.click();
    await new Promise(r => setTimeout(r, 30));
    const title = app.querySelector(".detail-title");
    const cards = app.querySelectorAll(".remodel-card");
    const badges = Array.from(app.querySelectorAll(".remodel-card .c-head .badge")).map(b => b.textContent);
    console.log("重塑视图标题:", title ? title.textContent : "（无）", title && title.textContent === "圣遗物重塑分析" ? "✓" : "✗");
    // 默认仅显示 RV>0：场景1头(circlet 暴击率3.3 → baseline 低 → RV+0.84) + 场景1花/场景2花（同一转移行动对，各 RV+0.11）；
    // 场景1 羽/沙（原地 RV<0）不显示，场景1 杯（散件无宿主）与场景3 花（无有效词条、无同套宿主）无行动被排除
    console.log("重塑卡片数(默认 RV>0):", cards.length, cards.length === 3 ? "✓" : "✗");
    console.log("RV 徽章示例:", badges.slice(0, 2).join(" | "));
    if (!title || title.textContent !== "圣遗物重塑分析" || cards.length !== 3) process.exitCode = 1;
    // 三情况标签：场景1花的散件位是杯（花本身是套装件）→ 转移行动 kind = transfer，标签「同套转移」
    const caseTags = Array.from(app.querySelectorAll(".remodel-card .rm-case")).map(i => i.textContent);
    console.log("评估对象标签:", caseTags.slice(0, 4).join(" | "));
    // 展开行 kind 标签：「全部可评估对象」行用三情况标签（与评估对象行同口径，取代旧的 自己·/宿主·）
    const allKindTags = Array.from(app.querySelectorAll(".remodel-card .rm-all-row .rm-case")).map(i => i.textContent);
    const kindOk = allKindTags.length >= 2 && allKindTags.every(t => /原地强化|同套转移|晋升套装件/.test(t));
    console.log("展开行kind标签:", allKindTags.length, kindOk ? "✓" : "✗", "|", allKindTags.join("|"));
    if (!kindOk) process.exitCode = 1;
    // 勾选显示无价值件 → 5 卡（+ 场景1 羽/沙/头原地强化 RV<0）
    const showAll = app.querySelector(".rm-showall input");
    showAll.click();
    await new Promise(r => setTimeout(r, 30));
    const cardsAll = app.querySelectorAll(".remodel-card");
    console.log("显示无价值件后:", cardsAll.length, cardsAll.length === 5 ? "✓" : "✗");
    if (cardsAll.length !== 5) process.exitCode = 1;
    app.querySelector(".rm-showall input").click();   // 还原（render 已重建 DOM，必须重新查询；游离节点 click 不触发 change）
    await new Promise(r => setTimeout(r, 30));
    const cardsBack = app.querySelectorAll(".remodel-card");
    console.log("还原显示无价值件后(应3):", cardsBack.length, cardsBack.length === 3 ? "✓" : "✗");
    if (cardsBack.length !== 3) process.exitCode = 1;
    // 三情况开关：渲染 3 个开关；关闭「原地强化」→ 场景2花/羽/沙/头（唯一行动为原地）落榜，仅剩场景1花（同套转移）
    const kindInput = idx => app.querySelectorAll(".filter-bar .rm-kind input")[idx];
    console.log("三情况开关数量:", kindInput ? app.querySelectorAll(".filter-bar .rm-kind").length : 0,
      app.querySelectorAll(".filter-bar .rm-kind").length === 3 ? "✓" : "✗");
    if (app.querySelectorAll(".filter-bar .rm-kind").length !== 3) process.exitCode = 1;
    kindInput(0).click();   // 关闭原地强化
    await new Promise(r => setTimeout(r, 30));
    const cardsNoSelf = app.querySelectorAll(".remodel-card");
    // 评估对象行的标签（详情展开行带三情况标签「·」前缀，过滤掉）
    const tagsNoSelf = Array.from(app.querySelectorAll(".remodel-card .rm-case"))
      .map(i => i.textContent).filter(t => !/·/.test(t));
    const noSelfOk = cardsNoSelf.length >= 1 && !tagsNoSelf.some(t => /原地强化/.test(t))
      && tagsNoSelf.every(t => /同套转移|晋升套装件/.test(t));
    console.log("关闭原地强化后:", cardsNoSelf.length, noSelfOk ? "✓（无原地强化标签）" : "✗",
      "| 标签:", tagsNoSelf.join("|"));
    if (!noSelfOk) process.exitCode = 1;
    // 三种情况全部关闭 → 无行动可评估，列表为空且汇总行提示
    kindInput(1).click(); kindInput(2).click();
    await new Promise(r => setTimeout(r, 30));
    const sumAllOff = app.querySelector(".eval-summary");
    const cardsAllOff = app.querySelectorAll(".remodel-card");
    const allOffOk = cardsAllOff.length === 0 && sumAllOff && /均已关闭/.test(sumAllOff.textContent);
    console.log("全部关闭后:", cardsAllOff.length, allOffOk ? "✓（汇总行提示已出现）" : "✗");
    if (!allOffOk) process.exitCode = 1;
    // 还原三种情况 → 回到默认 3 卡
    kindInput(0).click(); kindInput(1).click(); kindInput(2).click();
    await new Promise(r => setTimeout(r, 30));
    const cardsRestore = app.querySelectorAll(".remodel-card");
    console.log("还原三开关后:", cardsRestore.length, cardsRestore.length === 3 ? "✓" : "✗");
    if (cardsRestore.length !== 3) process.exitCode = 1;
    // 录入弹窗：等级默认 20（重塑评估域；切换到手动输入 tab 后可见 #mLevel）
    const btnNewArt = Array.from(app.querySelectorAll(".filter-bar button")).find(b => b.textContent.includes("录入新圣遗物"));
    btnNewArt.click();
    await new Promise(r => setTimeout(r, 30));
    const tabManual = window.document.querySelector(".mode-tabs .tab[data-m='manual']");
    if (tabManual) tabManual.click();
    await new Promise(r => setTimeout(r, 20));
    const mLevel = window.document.getElementById("mLevel");
    const lvOk = !!mLevel && mLevel.value === "20";
    console.log("录入弹窗默认等级(应20):", mLevel ? mLevel.value : "（mLevel 不存在）", lvOk ? "✓" : "✗");
    if (!lvOk) process.exitCode = 1;
    window.App.feedback.closeModal();
    await new Promise(r => setTimeout(r, 20));
    // 档位切换到谕告（重渲染不报错；谕告档下 5 件可评估件 RV 全部 > 0）
    const kSel = app.querySelector(".filter-bar select");
    kSel.value = "4";
    kSel.dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    const cardsK4 = app.querySelectorAll(".remodel-card");
    console.log("谕告档重渲染:", cardsK4.length === 5 ? "✓" : "✗", `(${cardsK4.length} 卡)`);
    if (cardsK4.length !== 5) process.exitCode = 1;
    // 3/4 初始自动推断（二态）：场景1 花/羽/沙（Σk=9）→ 静态标签「初始4」（无按钮）；
    // 场景1 头（暴击率3.3 无判据）+ 场景2 花（单词条）→ 切换按钮「初始4」（null 回退默认 4）
    const initTags = Array.from(app.querySelectorAll(".remodel-card .rm-init-static")).map(b => b.textContent);
    const initBtns0 = Array.from(app.querySelectorAll(".remodel-card .rm-init"));
    const staticOk = initTags.length === 3 && initTags.every(t => /初始4/.test(t));
    const btnOk = initBtns0.length === 2 && initBtns0.every(b => /初始4/.test(b.textContent));
    console.log("3/4 初始推断二态:", staticOk && btnOk ? "✓" : "✗",
      `(静态标签 ${initTags.length} 张全初始4: ${staticOk ? "✓" : "✗"}; 切换按钮 ${initBtns0.length} 个全初始4: ${btnOk ? "✓" : "✗"})`);
    if (!(staticOk && btnOk)) process.exitCode = 1;
    // 3/4 初始切换（仅两可/无判据件有按钮；会话内 override，重渲染不报错）
    const btnInit = app.querySelector(".remodel-card .rm-init");
    btnInit.click();
    await new Promise(r => setTimeout(r, 30));
    const initTexts = Array.from(app.querySelectorAll(".remodel-card .rm-init, .remodel-card .rm-init-static")).map(b => b.textContent);
    const toggled = initTexts.filter(t => /初始3/.test(t)).length;   // 切换后按钮文案「初始3」（静态标签不受影响，仍全为初始4）
    console.log("3/4 初始切换:", toggled === 1 ? "✓" : "✗", `(${toggled} 张切为 3 初始，共 ${initTexts.length} 卡)`);
    if (toggled !== 1) process.exitCode = 1;
    // 返回列表
    window.App.ui.render();
  }

  // —— 方案 A 冒烟：无散件（5 件全套装）角色的异套件评估（冗余位自动识别为自由位）——
  {
    role2.looseSlot = null;
    role2.effectiveStats = ["暴击率", "暴击伤害", "攻击力百分比", "元素充能效率"];
    role2.weights = { "暴击率": 1, "暴击伤害": 1, "攻击力百分比": 0.8, "元素充能效率": 0.6 };
    role2.erRequirement = 180; role2.currentER = 180;
    const MAIN2 = { flower: "生命值", plume: "攻击力", sands: "攻击力百分比", goblet: "火元素伤害加成", circlet: "暴击伤害" };
    Object.keys(MAIN2).forEach(slot => {
      role2.artifacts[slot] = {
        id: App.store.genId(), slot, set: "炽烈的炎之魔女", mainStat: MAIN2[slot], level: 20,
        substats: [{ stat: "暴击率", value: 3.9, activated: true }, { stat: "暴击伤害", value: 7.8, activated: true },
                   { stat: "攻击力百分比", value: 5.8, activated: true }, { stat: "元素充能效率", value: 6.5, activated: true }]
      };
    });
    App.store.updateRole(role2);
    const freeSlots = App.core.freeSlots(role2);
    console.log("五件套自由位:", freeSlots.length === 5 ? "✓" : "✗", `(${freeSlots.join(",") || "无"})`);
    if (freeSlots.length !== 5) process.exitCode = 1;

    window.document.getElementById("btnEvaluate").click();
    await new Promise(r => setTimeout(r, 30));
    const btnAdd = Array.from(app.querySelectorAll("button")).find(b => b.textContent.includes("录入新圣遗物"));
    if (!btnAdd) { console.log("价值评估空态缺录入入口 ✗"); process.exitCode = 1; }
    else {
      btnAdd.click();
      await new Promise(r => setTimeout(r, 30));
      // 异套件（角斗士火伤杯，词条远高于五件套角色现有杯）
      window.document.querySelector(".artifact-text").value =
        "空之杯火元素伤害加成46.6%+20·暴击率+10.5%·暴击伤害+21.0%·攻击力百分比+13.5%·元素充能效率+16.5% 角斗士的终幕礼:(20)";
      Array.from(window.document.querySelectorAll("button")).find(b => b.textContent === "识别").click();
      await new Promise(r => setTimeout(r, 30));
      Array.from(window.document.querySelectorAll("button")).find(b => b.textContent === "保存并评估").click();
      await new Promise(r => setTimeout(r, 50));
      // 自由件结果应落在 case-1（散件 / 自由件）优先级组内
      const group1 = app.querySelector(".eval-case.case-1");
      const names = group1 ? Array.from(group1.querySelectorAll(".row-role")).map(x => x.textContent) : [];
      const okFree = names.includes("测试-无散件");
      console.log("价值评估[五件套·异套件]:", okFree ? "✓" : "✗", `(case-1 组: ${names.join(", ") || "无"})`);
      if (!okFree) process.exitCode = 1;
      const legendTxt = app.querySelector(".legend") ? app.querySelector(".legend").textContent : "";
      const okLg = /自由件/.test(legendTxt);
      console.log("图例含自由件:", okLg ? "✓" : "✗", `(${legendTxt})`);
      if (!okLg) process.exitCode = 1;
    }
  }

  console.log("捕获错误:", window.__testErrors.length ? window.__testErrors : "无");
  process.exit(0);
})().catch(e => { console.error("脚本异常:", e && e.stack ? e.stack : e); process.exit(1); });
