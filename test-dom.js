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
  role.sets = ["炽烈的炎之魔女"];   // 角色套装字段（2026-10-09）：套装类判定读它
  ["flower", "plume", "sands", "goblet", "circlet"].forEach(slot => {
    // 区间法（2026-10-10）：circlet 暴击率 3.3 按 k=1 相容 → 该件 Σk=1+2+3+2=8 → 静态标签「初始3」；
    // 其余 3 件 Σk=2+2+3+2=9 → 静态标签「初始4」；场景2 花（单词条）无判据 → 切换按钮
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
  // 补满其余 4 部位：套装类判定（roleSets）要求 5 部位录全（2026-10-09）。
  // 这 4 件是**纯脚手架**，用三重手段保证它们「完全不可见」：
  //   ① level 0  → 不进重塑候选（候选按 level>=20 收集）
  //   ② substats []  → 不贡献任何评分（calcArtifactScore 只看副词条，角色分与 perfect 均不变）
  //   ③ mainStat 填占位串（非真实词条名）→ 不会与其它角色同部位同主词条「撞车」而凭空充当
  //      重塑宿主（宿主条件只查 部位存在 + 主词条相同，不看等级/副词条）。
  //      若这里填真实主词条（如 死之羽=攻击力），「测试-正常」的死之羽/时之沙会多出转移行动，
  //      默认 RV>0 卡数会从 3 变 5，与「显示无价值件」开关失去区分度。
  role2.sets = ["炽烈的炎之魔女"];
  ["plume", "sands", "goblet", "circlet"].forEach(slot => {
    role2.artifacts[slot] = { id: App.store.genId(), slot, set: "炽烈的炎之魔女", mainStat: "占位", level: 0, substats: [] };
  });
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
  // 同样补满 5 部位（套装类判定的前提），4 件占位件口径同「测试-无散件」
  role3.sets = ["绝缘之旗印"];
  ["plume", "sands", "goblet", "circlet"].forEach(slot => {
    role3.artifacts[slot] = { id: App.store.genId(), slot, set: "绝缘之旗印", mainStat: "占位", level: 0, substats: [] };
  });
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

  // ② 按角色：套装多选（读角色套装字段 role.sets，2026-10-09 起不再按已录入件计数）
  //    场景数据：测试-正常 sets=[魔女]；测试-无散件 sets=[魔女]；测试-导入式 sets=[绝缘之旗印]
  app.querySelector(".set-filter .set-btn").click();   // 打开面板
  await new Promise(r => setTimeout(r, 30));
  const setCheck = name => Array.from(app.querySelectorAll(".set-item")).find(l => l.textContent.trim() === name).querySelector("input");
  setCheck("炽烈的炎之魔女").click();
  await new Promise(r => setTimeout(r, 30));
  names = listNames();
  console.log("路径①[魔女]:", names.join(", "),
    names.length === 2 && names[0] === "测试-正常" && names[1] === "测试-无散件" ? "✓" : "✗");
  // 面板保持打开（局部刷新未重建），追加勾选「绝缘之旗印」→ 3 个角色全部命中（各含所选套装之一）
  setCheck("绝缘之旗印").click();
  await new Promise(r => setTimeout(r, 30));
  names = listNames();
  console.log("路径①[魔女+绝缘]:", names.join(", "),
    names.length === 3 && names[2] === "测试-导入式" ? "✓" : "✗");

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
    if (process.env.DEBUG_REMODEL) {
      Array.from(cards).forEach(c => console.log("   [卡]", c.querySelector(".c-title") ? c.querySelector(".c-title").textContent : c.textContent.slice(0, 80)));
    }
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
    // 3/4 初始自动推断（二态 · 区间法，2026-10-10 口径变更）：
    //   场景1 花/羽/沙：k=2+2+3+2=9 → 静态标签「初始4」
    //   场景1 头：暴击率 3.3 在区间法下按 k=1 相容 → Σk=1+2+3+2=8 → 静态标签「初始3」
    //     （3.3 是游戏不会出现的显示值：旧等值分解当「无判据」→ 出按钮；区间法只要求区间相容，
    //       不再拦「不可能值」，属已知取舍，见 2026-10-10 口径变更记录）
    //   场景2 花（仅 1 条副词条）→ 无判据 → 切换按钮「初始4」（null 回退默认 4）
    const initTags = Array.from(app.querySelectorAll(".remodel-card .rm-init-static")).map(b => b.textContent);
    const initBtns0 = Array.from(app.querySelectorAll(".remodel-card .rm-init"));
    const tags4 = initTags.filter(t => /初始4/.test(t)).length;
    const tags3 = initTags.filter(t => /初始3/.test(t)).length;
    const staticOk = initTags.length === 4 && tags4 === 3 && tags3 === 1;
    const btnOk = initBtns0.length === 1 && /初始4/.test(initBtns0[0].textContent);
    console.log("3/4 初始推断二态:", staticOk && btnOk ? "✓" : "✗",
      `(静态标签 ${initTags.length} 张：${tags4} 张初始4 / ${tags3} 张初始3: ${staticOk ? "✓" : "✗"}; 切换按钮 ${initBtns0.length} 个全初始4: ${btnOk ? "✓" : "✗"})`);
    if (!(staticOk && btnOk)) process.exitCode = 1;
    // 3/4 初始切换（仅两可/无判据件有按钮；会话内 override，重渲染不报错）
    const btnInit = app.querySelector(".remodel-card .rm-init");
    btnInit.click();
    await new Promise(r => setTimeout(r, 30));
    const initTexts = Array.from(app.querySelectorAll(".remodel-card .rm-init, .remodel-card .rm-init-static")).map(b => b.textContent);
    const toggled = initTexts.filter(t => /初始3/.test(t)).length;   // 1 张静态（场景1 头）+ 点按钮切出的 1 张
    console.log("3/4 初始切换:", toggled === 2 ? "✓" : "✗", `(${toggled} 张为 3 初始，共 ${initTexts.length} 卡)`);
    if (toggled !== 2) process.exitCode = 1;
    // 返回列表
    window.App.ui.render();
  }

  // —— 方案 C 冒烟：充能不足不再否决替换（2026-09-29，真实报障场景：七七换新羽）——
  {
    const qiqi = App.store.newRole("测试-七七");
    qiqi.effectiveStats = ["暴击率", "攻击力百分比", "元素充能效率"];
    qiqi.weights = { "暴击率": 1, "攻击力百分比": 1, "元素充能效率": 1 };
    qiqi.looseSlot = null;
    qiqi.erRequirement = 180; qiqi.currentER = 180;
    qiqi.sets = ["千岩牢固"];   // 套装字段：重塑宿主/情况判定读它
    const mainOf = { flower: "生命值", plume: "攻击力", sands: "攻击力百分比", goblet: "攻击力百分比", circlet: "暴击率" };
    const subOf = {
      flower: [{ stat: "暴击率", value: 7.4 }, { stat: "防御力百分比", value: 13.1 }, { stat: "元素充能效率", value: 15.5 }, { stat: "攻击力百分比", value: 4.7 }],
      // 现役羽充能 18.1%；新羽只有 11.0% → 替换后 172.9% < 180%（原口径据此否决）
      plume: [{ stat: "元素精通", value: 21 }, { stat: "元素充能效率", value: 18.1 }, { stat: "攻击力百分比", value: 9.9 }, { stat: "暴击伤害", value: 12.4 }],
      sands: [{ stat: "攻击力", value: 35 }, { stat: "元素精通", value: 21 }, { stat: "防御力", value: 16 }, { stat: "暴击伤害", value: 5.4 }],
      goblet: [{ stat: "生命值", value: 747 }, { stat: "元素充能效率", value: 9.1 }, { stat: "元素精通", value: 19 }, { stat: "攻击力", value: 31 }],
      circlet: [{ stat: "生命值", value: 299 }, { stat: "攻击力", value: 16 }, { stat: "元素精通", value: 19 }, { stat: "防御力", value: 21 }]
    };
    Object.keys(mainOf).forEach(slot => {
      qiqi.artifacts[slot] = {
        id: App.store.genId(), slot, set: "千岩牢固", mainStat: mainOf[slot], level: 20,
        substats: subOf[slot].map(s => ({ stat: s.stat, value: s.value, activated: true }))
      };
    });
    App.store.updateRole(qiqi);

    window.document.getElementById("btnEvaluate").click();
    await new Promise(r => setTimeout(r, 30));
    const btnAddC = Array.from(app.querySelectorAll("button")).find(b => b.textContent.includes("录入新圣遗物"));
    if (!btnAddC) { console.log("方案 C：评估页空态缺录入入口 ✗"); process.exitCode = 1; }
    else {
      btnAddC.click();
      await new Promise(r => setTimeout(r, 30));
      window.document.querySelector(".artifact-text").value =
        "死之羽攻击力311+20 攻击力+14.6%·元素充能效率+11.0%·暴击率+5.8%·元素精通+21千岩牢固：(4)";
      Array.from(window.document.querySelectorAll("button")).find(b => b.textContent === "识别").click();
      await new Promise(r => setTimeout(r, 30));
      Array.from(window.document.querySelectorAll("button")).find(b => b.textContent === "保存并评估").click();
      await new Promise(r => setTimeout(r, 50));

      const rowQiqi = Array.from(app.querySelectorAll(".eval-row"))
        .find(r => { const n = r.querySelector(".row-role"); return n && n.textContent === "测试-七七"; });
      console.log("充能不足仍列有价值:", rowQiqi ? "✓" : "✗", rowQiqi ? "" : "（该角色未出现在有提升列表）");
      if (!rowQiqi) process.exitCode = 1;
      const diffTxt = rowQiqi ? rowQiqi.querySelector(".row-diff").textContent : "";
      const badgeTxt = rowQiqi ? Array.from(rowQiqi.querySelectorAll(".badge")).map(b => b.textContent).join("|") : "";
      const okDiff = /^\+/.test(diffTxt);
      const okBadge = /充能不足/.test(badgeTxt);
      console.log("充能不足提示徽章:", okDiff && okBadge ? "✓" : "✗", `(词条差 ${diffTxt}；徽章 ${badgeTxt || "无"})`);
      if (!(okDiff && okBadge)) process.exitCode = 1;
      // 徽章配色：Δ<0 且替换后不足 → 红
      const tagBadge = rowQiqi.querySelector(".row-tag .badge");
      const okClsRed = !!tagBadge && /badge-red/.test(tagBadge.className);
      console.log("充能徽章配色[lack→红]:", okClsRed ? "✓" : "✗", tagBadge ? `(${tagBadge.className})` : "（无徽章）");
      if (!okClsRed) process.exitCode = 1;

      // —— 替换后面板充能应联动更新（原行为：currentER 不变 → 首页仍显示绿色「达标」）——
      const btnReplace = Array.from(rowQiqi.querySelectorAll(".row-actions button")).find(b => b.textContent === "替换");
      btnReplace.click();
      await new Promise(r => setTimeout(r, 30));
      const okBtn = Array.from(window.document.querySelectorAll("#modalRoot button")).find(b => b.textContent === "确认替换");
      if (!okBtn) { console.log("替换确认弹窗按钮缺失 ✗"); process.exitCode = 1; }
      else {
        okBtn.click();
        await new Promise(r => setTimeout(r, 60));
        const qiqiNow = App.store.getRoles().find(r => r.name === "测试-七七");
        const okLink = Math.abs(qiqiNow.currentER - 172.9) < 1e-6;
        console.log("替换后面板充能联动:", okLink ? "✓" : "✗", `(180 → ${qiqiNow.currentER}，应为 172.9)`);
        if (!okLink) process.exitCode = 1;

        // 首页徽章：绿「充能」（达标）→ 红「充能」（不足）
        window.document.getElementById("logoBtn").click();
        await new Promise(r => setTimeout(r, 40));
        const card = Array.from(app.querySelectorAll(".role-card")).find(c => {
          const n = c.querySelector(".rc-name"); return n && n.textContent === "测试-七七";
        });
        const badge = card ? card.querySelector(".badge") : null;
        const okBadge2 = !!badge && /badge-red/.test(badge.className) && /充能不足/.test(badge.getAttribute("title") || "");
        console.log("首页充能徽章联动:", okBadge2 ? "✓" : "✗",
          badge ? `(${badge.className} | ${badge.getAttribute("title")})` : "（未找到角色卡）");
        if (!okBadge2) process.exitCode = 1;

        // 详情页充能块应显示新的面板充能
        if (card) {
          card.click();
          await new Promise(r => setTimeout(r, 40));
          const erItem = Array.from(app.querySelectorAll(".ov-item")).find(x => {
            const l = x.querySelector(".lbl"); return l && l.textContent === "充能";
          });
          const okDetail = !!erItem && /172\.9/.test(erItem.textContent);
          console.log("详情页面板充能联动:", okDetail ? "✓" : "✗", erItem ? `(${erItem.textContent})` : "（未找到充能块）");
          if (!okDetail) process.exitCode = 1;
        }
        App.ui.render();
        await new Promise(r => setTimeout(r, 30));
      }

      // —— 充能提示配色：再评估一件「充能提升且达标」的羽毛 → 绿「充能满足」（此时面板充能已被联动到 172.9）——
      window.document.getElementById("btnEvaluate").click();
      await new Promise(r => setTimeout(r, 30));
      const addBtn2 = Array.from(app.querySelectorAll("button")).find(b => b.textContent.includes("录入新圣遗物"));
      if (!addBtn2) { console.log("充能徽章配色[met→绿]: ✗ （评估页缺录入入口）"); process.exitCode = 1; }
      else {
        addBtn2.click();
        await new Promise(r => setTimeout(r, 30));
        window.document.querySelector(".artifact-text").value =
          "死之羽攻击力311+20 攻击力+14.6%·元素充能效率+19.5%·暴击率+5.8%·元素精通+21千岩牢固：(4)";
        Array.from(window.document.querySelectorAll("button")).find(b => b.textContent === "识别").click();
        await new Promise(r => setTimeout(r, 30));
        Array.from(window.document.querySelectorAll("button")).find(b => b.textContent === "保存并评估").click();
        await new Promise(r => setTimeout(r, 50));
        const rowMet = Array.from(app.querySelectorAll(".eval-row"))
          .find(r => { const n = r.querySelector(".row-role"); return n && n.textContent === "测试-七七"; });
        const badgeMet = rowMet ? rowMet.querySelector(".row-tag .badge") : null;
        const okGreen = !!badgeMet && /badge-green/.test(badgeMet.className) && /充能满足/.test(badgeMet.textContent);
        console.log("充能徽章配色[met→绿]:", okGreen ? "✓" : "✗",
          badgeMet ? `(${badgeMet.className}|${badgeMet.textContent})` : "（未找到徽章）");
        if (!okGreen) process.exitCode = 1;
        const btnCancel2 = Array.from(app.querySelectorAll("button")).find(b => b.textContent === "放弃");
        if (btnCancel2) { btnCancel2.click(); await new Promise(r => setTimeout(r, 30)); }
      }
    }
  }

  // —— 方案 A 冒烟：无散件（5 件全套装）角色的异套件评估（冗余位自动识别为自由位）——
  {
    role2.looseSlot = null;
    role2.effectiveStats = ["暴击率", "暴击伤害", "攻击力百分比", "元素充能效率"];
    role2.weights = { "暴击率": 1, "暴击伤害": 1, "攻击力百分比": 0.8, "元素充能效率": 0.6 };
    role2.erRequirement = 180; role2.currentER = 180;
    role2.sets = ["炽烈的炎之魔女"];   // 5 件全套装 → 套装字段（套装类判定读它）
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

  // —— 角色套装字段（sets）冒烟：一致性警示条 → 「按实况更新」写回 → 2+2+1 展示 ——
  {
    const rs = App.store.newRole("测试-套装");
    rs.element = "火";
    rs.effectiveStats = ["暴击率", "攻击力百分比"];
    rs.weights = { "暴击率": 1, "攻击力百分比": 1 };
    rs.looseSlot = null;
    // 实况 = 2+2+1：翠绿之影 ×2 + 绝缘之旗印 ×2 + 角斗士的终幕礼 ×1（→ deriveSetsFromArtifacts 应为前两个）
    const SETS_OF = { flower: "翠绿之影", plume: "翠绿之影", sands: "绝缘之旗印", goblet: "绝缘之旗印", circlet: "角斗士的终幕礼" };
    const MAINS_OF = { flower: "生命值", plume: "攻击力", sands: "攻击力百分比", goblet: "火元素伤害加成", circlet: "暴击伤害" };
    Object.keys(MAINS_OF).forEach(slot => {
      rs.artifacts[slot] = {
        id: App.store.genId(), slot, set: SETS_OF[slot], mainStat: MAINS_OF[slot], level: 20,
        substats: [{ stat: "暴击率", value: 3.9, activated: true },
                   { stat: "攻击力百分比", value: 5.8, activated: true },
                   { stat: "元素充能效率", value: 6.5, activated: true }]
      };
    });
    rs.sets = ["翠绿之影"];   // 故意只声明 1 个 → 与实况（2+2+1）不符
    App.store.updateRole(rs);
    window.document.getElementById("logoBtn").click();   // 上一块停在评估视图，先回列表（render 按 view.type 分支）
    await new Promise(r => setTimeout(r, 40));
    const card = Array.from(app.querySelectorAll(".role-card")).find(c => {
      const n = c.querySelector(".rc-name"); return n && n.textContent === "测试-套装";
    });
    if (!card) { console.log("套装字段冒烟: ✗ 未找到「测试-套装」卡片"); process.exitCode = 1; }
    else {
      card.click();
      await new Promise(r => setTimeout(r, 60));
      const setTxt = (app.querySelector("[data-role-sets]") || {}).textContent || "";
      const okDeclared = /翠绿之影/.test(setTxt) && !/绝缘之旗印/.test(setTxt);
      console.log("详情页套装块（字段为准，仅显示声明值）:", okDeclared ? "✓" : "✗", `(${setTxt.trim()})`);
      if (!okDeclared) process.exitCode = 1;

      const warn = app.querySelector(".warn.set-mismatch");
      const okWarn = !!warn && /不一致/.test(warn.textContent) && /绝缘之旗印/.test(warn.textContent);
      console.log("套装不一致警示条:", okWarn ? "✓" : "✗", warn ? `(${warn.textContent.replace(/\s+/g, " ").slice(0, 76)})` : "（未出现）");
      if (!okWarn) process.exitCode = 1;

      const btnSync = warn ? Array.from(warn.querySelectorAll("button")).find(b => b.textContent.includes("按实况更新")) : null;
      if (!btnSync) { console.log("「按实况更新」按钮: ✗"); process.exitCode = 1; }
      else {
        btnSync.click();
        await new Promise(r => setTimeout(r, 90));
        const after = App.store.getRoles().find(x => x.name === "测试-套装");
        const okSync = App.core.sameSetComposition(after.sets, ["翠绿之影", "绝缘之旗印"]);
        console.log("「按实况更新」写回字段:", okSync ? "✓" : "✗", `(sets = ${JSON.stringify(after.sets)})`);
        if (!okSync) process.exitCode = 1;
        const warnGone = !app.querySelector(".warn.set-mismatch");
        const setTxt2 = (app.querySelector("[data-role-sets]") || {}).textContent || "";
        const okTwo = /翠绿之影/.test(setTxt2) && /绝缘之旗印/.test(setTxt2);
        console.log("更新后警示条消失:", warnGone ? "✓" : "✗", "· 2+2+1 两个套装并列展示:", okTwo ? "✓" : "✗", `(${setTxt2.trim()})`);
        if (!warnGone || !okTwo) process.exitCode = 1;
        const persisted = JSON.parse(window.localStorage.getItem("gys_reliquary_v1") || "{}");
        const pR = (persisted.roles || []).find(x => x.name === "测试-套装");
        console.log("更新已落盘 localStorage:", pR && App.core.sameSetComposition(pR.sets, ["翠绿之影", "绝缘之旗印"]) ? "✓" : "✗");
        if (!pR || !App.core.sameSetComposition(pR.sets, ["翠绿之影", "绝缘之旗印"])) process.exitCode = 1;
      }
    }
  }

  // —— 套装筛选特殊项「其他 / 不判套装」（套装字段为空：留空 + 未录全）——
  {
    const rn = App.store.newRole("测试-其他");     // newRole → sets = [] 且 5 部位未录全 ⇒ roleSets = []
    App.store.updateRole(rn);
    window.document.getElementById("logoBtn").click();
    await new Promise(r => setTimeout(r, 40));
    const tabRole = app.querySelector('.filter-tabs .ftab[data-m="role"]');
    if (tabRole && !tabRole.classList.contains("active")) { tabRole.click(); await new Promise(r => setTimeout(r, 40)); }
    app.querySelector(".set-filter .set-btn").click();
    await new Promise(r => setTimeout(r, 40));
    const labNone = Array.from(app.querySelectorAll(".set-item")).find(l => /其他 \/ 不判套装/.test(l.textContent));
    console.log("套装面板含「其他 / 不判套装」项:", labNone ? "✓" : "✗");
    if (!labNone) process.exitCode = 1;
    else {
      // 特殊项应位于滚动列表之外（始终可见）
      const inScroll = !!app.querySelector(".set-list .set-item-none");
      console.log("「其他」项固定在滚动区外:", !inScroll ? "✓" : "✗");
      if (inScroll) process.exitCode = 1;
      labNone.querySelector("input").click();
      await new Promise(r => setTimeout(r, 60));
      let nn = listNames();
      const okNone = nn.length === 1 && nn[0] === "测试-其他";
      console.log("路径①[其他]:", nn.join(", "), okNone ? "✓" : "✗", "（应仅 测试-其他）");
      if (!okNone) process.exitCode = 1;
      const btnTxt = app.querySelector(".set-filter .set-btn").textContent;
      console.log("按钮文案（其他不计入「N套」）:", btnTxt.trim(), /其他/.test(btnTxt) && !/1套/.test(btnTxt) ? "✓" : "✗");
      if (!/其他/.test(btnTxt) || /1套/.test(btnTxt)) process.exitCode = 1;
      // 叠加真实套装「绝缘之旗印」→ 并集（测试-其他 + 测试-导入式 + 测试-套装，后者经「按实况更新」后含绝缘）
      const labIns = Array.from(app.querySelectorAll(".set-item")).find(l => l.textContent.trim() === "绝缘之旗印");
      labIns.querySelector("input").click();
      await new Promise(r => setTimeout(r, 60));
      nn = listNames();
      const okUnion = nn.length === 3
        && ["测试-其他", "测试-导入式", "测试-套装"].every(n => nn.includes(n));
      console.log("路径①[其他+绝缘]:", nn.join(", "), okUnion ? "✓" : "✗");
      if (!okUnion) process.exitCode = 1;
      // 落盘应保留 sentinel，loadFilter 能原样恢复
      const savedRaw = window.localStorage.getItem(window.App.storage.FILTER_KEY);
      const saved = savedRaw ? JSON.parse(savedRaw) : null;
      const restored = window.App.storage.loadFilter();
      const okPersist = !!saved && saved.sets.length === 2 && saved.sets.includes("__no_set__")
        && !!restored && restored.sets.includes("__no_set__");
      console.log("「其他」筛选落盘/恢复:", okPersist ? "✓" : "✗", savedRaw || "（无）");
      if (!okPersist) process.exitCode = 1;
      clearBtn().click();   // 清理
      await new Promise(r => setTimeout(r, 50));
      nn = listNames();
      console.log("清除后恢复全部:", nn.length, nn.length === 6 ? "✓" : "✗", `(${nn.join(", ")})`);
      if (nn.length !== 6) process.exitCode = 1;
    }
  }

  // —— 角色配置弹窗「取消」不得污染内存对象（2026-10-09 修：弹窗入口深拷贝 role）——
  {
    window.document.getElementById("logoBtn").click();
    await new Promise(r => setTimeout(r, 40));
    const c1 = Array.from(app.querySelectorAll(".role-card")).find(c => {
      const n = c.querySelector(".rc-name"); return n && n.textContent === "测试-正常";
    });
    if (!c1) { console.log("配置弹窗取消冒烟: ✗ 未找到「测试-正常」卡片"); process.exitCode = 1; }
    else {
      c1.click();
      await new Promise(r => setTimeout(r, 60));
      const before = JSON.stringify(App.store.getRoles().find(x => x.name === "测试-正常").effectiveStats);
      const btnCfg2 = Array.from(app.querySelectorAll(".detail-head button")).find(b => b.textContent.includes("角色配置"));
      btnCfg2.click();
      await new Promise(r => setTimeout(r, 80));
      const chip = Array.from(window.document.querySelectorAll("#cChips .chip")).find(c => !c.classList.contains("on"));
      if (!chip) { console.log("配置弹窗取消冒烟: ✗ 未找到未选中的词条 chip"); process.exitCode = 1; }
      else {
        chip.click();
        await new Promise(r => setTimeout(r, 50));
        window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await new Promise(r => setTimeout(r, 80));
        const after2 = JSON.stringify(App.store.getRoles().find(x => x.name === "测试-正常").effectiveStats);
        console.log("配置弹窗点 chip 后取消 · 内存未污染:", before === after2 ? "✓" : "✗", `(${before} → ${after2})`);
        if (before !== after2) process.exitCode = 1;
      }
    }
  }

  // —— 藏品库（2026-10-11）：顶栏入口 / 页面渲染 / 藏品视角面板 ——
  {
    const btnColl = window.document.getElementById("btnCollection");
    console.log("顶栏「藏品」按钮存在:", btnColl ? "✓" : "✗");
    if (!btnColl) process.exitCode = 1;

    App.store.getCollection().length = 0;
    App.store.addCollectionItem({
      slot: "goblet", set: "炽烈的炎之魔女", mainStat: "火元素伤害加成", level: 20,
      substats: [
        { stat: "暴击率", value: 11.7, activated: true },
        { stat: "暴击伤害", value: 21.8, activated: true },
        { stat: "攻击力百分比", value: 9.9, activated: true },
        { stat: "元素精通", value: 44, activated: true }
      ]
    });
    btnColl.click();
    await new Promise(r => setTimeout(r, 80));

    const titleEl = app.querySelector(".detail-title");
    const buckets = app.querySelectorAll(".coll-bucket");
    const dimRows = app.querySelectorAll(".coll-slot .coll-row");
    const okTitle = !!titleEl && titleEl.textContent === "圣遗物藏品";
    console.log("藏品页标题:", titleEl ? titleEl.textContent : "(无)", okTitle ? "✓" : "✗");
    if (!okTitle) process.exitCode = 1;
    console.log("藏品页桶卡片数（应 26）:", buckets.length, buckets.length === 26 ? "✓" : "✗");
    if (buckets.length !== 26) process.exitCode = 1;
    console.log("藏品页维度行总数（应 95）:", dimRows.length, dimRows.length === 95 ? "✓" : "✗");
    if (dimRows.length !== 95) process.exitCode = 1;

    // 火伤杯 · 双爆：持有值 = 2×11.7 + 21.8 = 45.2；极限度 = 45.2 / 54.6 = 82.8%
    const critRow = Array.from(app.querySelectorAll('.coll-row[data-bucket="goblet#火元素伤害加成"]'))
      .find(r => { const d = r.querySelector(".coll-dim"); return d && d.textContent === "双爆"; });
    const critVal = critRow ? critRow.querySelector(".coll-val").textContent.trim() : null;
    const critPct = critRow ? critRow.querySelector(".coll-pct").textContent.trim() : null;
    const critHot = critRow ? critRow.querySelectorAll(".coll-hot").length : 0;
    const okCrit = critVal === "45.2" && critPct === "82.8%" && critHot === 2;
    console.log("火伤杯·双爆 持有值/极限度/高亮词条:", critVal, critPct, critHot, okCrit ? "✓" : "✗");
    if (!okCrit) process.exitCode = 1;

    const critHead = app.querySelectorAll('.coll-row[data-bucket="circlet#暴击率"]').length;
    console.log("收藏清单含暴击头:", critHead === 6 ? "✓" : "✗", `(${critHead} 行)`);
    if (critHead !== 6) process.exitCode = 1;

    // 藏品视角面板（评估结果内嵌）：双爆 50.6 > 45.2 → 刷新纪录；充能 5.2 → 新维度
    const panel = App.ui.buildCollectionPanel({
      slot: "goblet", set: "炽烈的炎之魔女", mainStat: "火元素伤害加成", level: 20,
      substats: [
        { stat: "暴击率", value: 11.7, activated: true },
        { stat: "暴击伤害", value: 27.2, activated: true },
        { stat: "元素充能效率", value: 5.2, activated: true },
        { stat: "元素精通", value: 21, activated: true }
      ]
    });
    const okPanel = panel.textContent.includes("藏品视角（火伤杯）") && panel.textContent.includes("可入藏 2 项");
    console.log("藏品视角面板:", okPanel ? "✓" : "✗", "|", panel.textContent.replace(/\s+/g, " ").slice(0, 96));
    if (!okPanel) process.exitCode = 1;

    // 2026-10-13：只显示有可能超过现有藏品的维度（本件：双爆 better + 充能 new → 2 行；其余 4 维隐藏、不提示）
    const visRows = panel.querySelectorAll(".coll-row").length;
    console.log("藏品视角仅显示有机会维度（应 2 行）:", visRows, visRows === 2 ? "✓" : "✗");
    if (visRows !== 2) process.exitCode = 1;

    // 行结构 = 维度|藏品值|新件值|满级最值|止损容错|极限度合并条（六列；合并条列 textContent = 左% + 右% 拼接）
    const cells0 = Array.from(panel.querySelectorAll(".coll-row")[0].children).map(c => c.textContent.trim());
    const cells1 = Array.from(panel.querySelectorAll(".coll-row")[1].children).map(c => c.textContent.trim());
    const okCells0 = cells0.join("|") === "双爆|45.2|50.6|50.6|—|82.8%92.7%";
    const okCells1 = cells1.join("|") === "充能|未收藏|5.2%|5.2%|—|—13.3%";
    console.log("行结构[双爆]:", cells0.join(" | "), okCells0 ? "✓" : "✗");
    console.log("行结构[充能]:", cells1.join(" | "), okCells1 ? "✓" : "✗");
    if (!okCells0 || !okCells1) process.exitCode = 1;
    // 极限度合并条（2026-10-14 五版）：每行 1 条（双爆行 + 充能行 = 2 条）；段 = .seg-cur 金 / .seg-pot 绿（均绝对定位）
    const barCount = panel.querySelectorAll(".coll-bar").length;
    const segCount = panel.querySelectorAll(".coll-pcts .seg-cur, .coll-pcts .seg-pot").length;
    console.log("合并条数（应 2）/ 段数（应 4）:", barCount, segCount,
      barCount === 2 && segCount === 4 ? "✓" : "✗");
    if (barCount !== 2 || segCount !== 4) process.exitCode = 1;
    // 悬停提示（title）：值 / 合并条显示含义
    const tipOf = sel => { const e = panel.querySelector(sel); return e ? (e.getAttribute("title") || "") : ""; };
    const okTips = tipOf(".coll-cur").includes("藏品值")
      && tipOf(".coll-max").includes("满级最值")
      && tipOf(".coll-pcts .coll-bar").includes("极限度")
      && tipOf(".coll-pct-max").includes("极限度");
    console.log("悬停提示（值/合并条）:", okTips ? "✓" : "✗",
      "|", tipOf(".coll-pcts .coll-bar").slice(0, 40));
    if (!okTips) process.exitCode = 1;

    // 暴击头属收藏桶 → 不应出现「不在藏品收藏范围内」
    const panelHead = App.ui.buildCollectionPanel({
      slot: "circlet", set: "X", mainStat: "暴击率", level: 20,
      substats: [{ stat: "暴击伤害", value: 7.8, activated: true }]
    });
    const okHead = !panelHead.textContent.includes("不在藏品收藏范围内");
    console.log("暴击头属收藏桶:", okHead ? "✓" : "✗");
    if (!okHead) process.exitCode = 1;

    // 三档徽章②「满级可期」：当前无位可占、但有维度满级后可超（2026-10-13）
    App.store.addCollectionItem({
      slot: "circlet", set: "X", mainStat: "治疗加成", level: 20,
      substats: [
        { stat: "暴击率", value: 12.4, activated: true },
        { stat: "暴击伤害", value: 15.6, activated: true },
        { stat: "元素精通", value: 79, activated: true },
        { stat: "攻击力百分比", value: 25.7, activated: true }
      ]
    });
    const panelSoon = App.ui.buildCollectionPanel({
      slot: "circlet", set: "千岩牢固", mainStat: "治疗加成", level: 0,
      substats: [
        { stat: "元素精通", value: 19, activated: true },
        { stat: "生命值", value: 239, activated: true },
        { stat: "攻击力", value: 16, activated: true },
        { stat: "暴击率", value: 3.1, activated: false }
      ]
    });
    const okSoon = panelSoon.textContent.includes("满级可期") &&
      !panelSoon.textContent.includes("可入藏") &&
      panelSoon.querySelectorAll(".coll-row").length === 1;
    console.log("徽章[满级可期]:", okSoon ? "✓" : "✗", "|", panelSoon.textContent.replace(/\s+/g, " ").slice(0, 60));
    if (!okSoon) process.exitCode = 1;

    // 止损容错（2026-10-13）：「还可歪 1 次」——精通行 19 + 3×23 = 88 > 79；19 + 2×23 = 65 ≤ 79 → need = 3、rem = 4
    const tolSoon = panelSoon.querySelector(".coll-tol");
    const okTolSoon = !!tolSoon && tolSoon.textContent === "还可歪 1 次";
    console.log("止损容错[还可歪 1 次]:", okTolSoon ? "✓" : "✗", "|", tolSoon ? tolSoon.textContent : "(无)");
    if (!okTolSoon) process.exitCode = 1;

    // 止损容错为 0 → 「不能歪」（与「还可歪」同款样式，仅 .tight 标记类）：花桶守门双爆 46.8，需 5 次全中（14.1 + 4×7.8 = 45.3 ≤ 46.8）
    App.store.addCollectionItem({
      slot: "flower", set: "X", mainStat: "生命值", level: 20,
      substats: [
        { stat: "暴击率", value: 12.5, activated: true },
        { stat: "暴击伤害", value: 21.8, activated: true }
      ]
    });
    const panelTight = App.ui.buildCollectionPanel({
      slot: "flower", set: "炽烈的炎之魔女", mainStat: "生命值", level: 0,
      substats: [
        { stat: "暴击率", value: 3.9, activated: true },
        { stat: "暴击伤害", value: 6.3, activated: true },
        { stat: "防御力", value: 21, activated: true },
        { stat: "生命值", value: 239, activated: true }
      ]
    });
    const tolTight = panelTight.querySelector(".coll-tol");
    const okTolTight = !!tolTight && tolTight.textContent === "不能歪" && tolTight.classList.contains("tight");
    console.log("止损容错[不能歪·tight]:", okTolTight ? "✓" : "✗", "|", tolTight ? tolTight.textContent : "(无)");
    if (!okTolTight) process.exitCode = 1;

    // 三档徽章③「不可入藏」：全面劣势件 → 全部维度隐藏 → 面板仅剩头部（2026-10-13）
    const panelNone = App.ui.buildCollectionPanel({
      slot: "goblet", set: "炽烈的炎之魔女", mainStat: "火元素伤害加成", level: 20,
      substats: [
        { stat: "攻击力百分比", value: 5.8, activated: true },
        { stat: "元素精通", value: 23, activated: true },
        { stat: "防御力", value: 21, activated: true },
        { stat: "生命值", value: 299, activated: true }
      ]
    });
    const okNone = panelNone.querySelectorAll(".coll-row").length === 0 &&
      !panelNone.textContent.includes("不可能超过") &&
      panelNone.textContent.includes("不可入藏");
    console.log("藏品视角空态（全面劣势件，无行无提示）:", okNone ? "✓" : "✗", "|", panelNone.textContent.replace(/\s+/g, " ").slice(0, 60));
    if (!okNone) process.exitCode = 1;

    // 藏品件参与重塑分析（游离件口径：按宿主角色评；无宿主则不列入）
    window.document.getElementById("btnRemodel").click();
    await new Promise(r => setTimeout(r, 200));
    const rmTitle = app.querySelector(".detail-title");
    const okRm = !!rmTitle && rmTitle.textContent === "圣遗物重塑分析";
    const rmSum = app.querySelector(".eval-summary");
    console.log("重塑页渲染（候选含藏品件）:", okRm ? "✓" : "✗", "|",
      rmSum ? rmSum.textContent.replace(/\s+/g, " ").slice(0, 72) : "");
    if (!okRm) process.exitCode = 1;

    window.document.getElementById("logoBtn").click();
    await new Promise(r => setTimeout(r, 40));
    App.store.getCollection().length = 0;
  }

  console.log("捕获错误:", window.__testErrors.length ? window.__testErrors : "无");
  if (window.__testErrors.length) process.exitCode = 1;
  // 退出码 = 累计断言结果。⚠️ 勿写死 process.exit(0)：那会把上面所有 exitCode = 1 全部吞掉，
  //    令 `node test-dom.js; echo $?` 永远为 0、CI/脚本无法感知失败（2026-10-09 修）。
  process.exit(process.exitCode || 0);
})().catch(e => { console.error("脚本异常:", e && e.stack ? e.stack : e); process.exit(1); });
