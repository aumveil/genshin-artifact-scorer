/**
 * ui.js - 视图层（对应《圣遗物网页实现方案.md》三、网页设计）
 * 五个视图：角色列表 / 角色详情 / 双模式录入弹窗 / 价值评估 / 重塑分析；导入导出。
 * 全局命名空间：App.ui
 */
(function (global) {
  "use strict";
  const C = global.App.constants;
  const store = global.App.store;
  const core = global.App.core;
  const data = global.App.data;
  const feedback = global.App.feedback;   // 反馈层：toast / confirm / prompt / info
  const charts = global.App.charts;       // 图形语言（R2）：计量条 / 构成条

  let view = { type: "list" };            // {type:'list'} | {type:'detail', roleId} | {type:'evaluate'} | {type:'remodel'}
  let lastViewType = null;                // 上一次渲染的视图类型（批次 5：视图切换方向感动效用；null = 尚未渲染过）
  // 首页筛选状态：独立于 view（切视图不丢失），并持久化到 localStorage（刷新/重开恢复上次筛选）
  // 结构 { mode: "role" | "loose", slot, mainStat, sets } —— 两条互斥路径（①按角色②按散件），仅当前路条件生效
  let listFilter = (typeof global.App.storage.loadFilter === "function" && global.App.storage.loadFilter())
    || { mode: "role", slot: "", mainStat: "", sets: [], q: "" };
  const persistFilter = () => { try { global.App.storage.saveFilter(listFilter); } catch (e) { /* 静默 */ } };
  // 套装筛选的**特殊项** sentinel：代表「套装字段为空」——即 core.roleSets(role) 为 [] 的角色，
  // 含两类：① 字段留空（＝「其他」）② 5 部位未录全（当这个角色不存在）。两者在详情页都显示为「其他 / 不判套装」。
  // 用一个内部 token 而非空串，避免与真实套装名/空值混淆；loadFilter 只校验「是字符串」，故可随筛选一起持久化。
  const SET_FILTER_EMPTY = "__no_set__";
  const setLabel = s => s === SET_FILTER_EMPTY ? "其他 / 不判套装" : s;
  let setPanelOutsideHandler = null;      // 套装下拉「点击面板外关闭」的全局监听（复用同一 handler，避免重复渲染累积）
  let pendingArtifact = null;             // 新圣遗物临时对象（评估用）
  let evalHidden = new Set();             // 评估会话内被手动移除的有提升角色 id（重新录入/放弃时清空）
  let listEnterAnim = false;              // 列表进入 stagger（R4）：仅视图切入列表时挂类，同视图重渲染不动画
  let lastRefreshAt = 0;                  // 列表刷新淡入防抖时间戳（R4：连打输入 250ms 内不重播）
  let heroRollState = { roleId: null, value: 0 };   // hero 数字滚动基线（R4：换角色从 0 起滚、同角色从旧值）
  const collRecordBuckets = new Set();   // 新纪录（R7）：本会话刷新过纪录的桶（入藏时标记；会话内存，刷新即清）

  // —— 重塑分析（算法四）会话内状态（零数据模型改动，均不落盘）——
  let remodelK = C.REMODEL_K.basic;       // 当前保底档位（主排序默认基础档 k=2）
  let remodelTempList = [];               // 会话内录入的新圣遗物（临时对象，放弃/替换入口见卡片）
  const remodelInitOverride = new Map();  // signature → 3|4（3/4 初始会话内切换；默认 4 初始）
  let remodelShowAll = false;             // 是否显示无价值件（默认仅显示 RV>0）
  let remodelKinds = { self: true, transfer: true, promote: true };  // 三情况开关（开启的行动类型，任意组合）
  const REMODEL_KINDS = [                 // 三情况定义（开关顺序即控制栏顺序）
    { key: "self", label: "原地强化" },
    { key: "transfer", label: "同套转移" },
    { key: "promote", label: "晋升套装件" }
  ];

  const $ = sel => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = n => (Number.isFinite(n) ? (Math.round(n * 100) / 100).toString() : "-");
  // SVG 图标（2026-10-15 批次 2）：引用 index.html 内联 sprite（#i-xxx）；图标旁均有文字或 aria-label，故对辅助技术隐藏
  const ico = (name, cls) => `<svg class="ico${cls ? " " + cls : ""}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;

  /** 让元素可键盘触发（2026-10-15 批次 3）：tabindex + role=button + Enter/Space → 与点击同径 */
  function makeActivatable(node, fn, ariaLabel) {
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    if (ariaLabel) node.setAttribute("aria-label", ariaLabel);
    node.addEventListener("click", fn);
    node.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
    });
  }

  // 角色元素图标 HTML（优先级：role.element > 角色名映射；未配置返回空串）
  function elementIconHtml(role, extraCls) {
    const ele = (role && (role.element || C.CHARACTER_ELEMENT_HINTS[role.name])) || "";
    if (!ele || !C.ELEMENTS[ele]) return "";
    return `<span class="ele-icon ele-${C.ELEMENT_SLUG[ele]}${extraCls ? " " + extraCls : ""}" role="img" aria-label="${ele}" title="${ele}"></span>`;
  }

  // 角色是否配置充能：有效词条含「元素充能效率」。不含充能时——充能需求/面板充能不适用（配置禁用），
  // 首页充能徽章与详情页充能信息块均隐藏（充能对评分无影响，避免误导）。
  // 2026-10-17：改为复用 core.erApplies —— 展示与算法必须同源，否则又会出现「首页写无充、评估页发充能提示」的分裂。
  function hasER(role) {
    return core.erApplies(role);
  }

  // ============ 渲染入口 ============
  function render() {
    const app = $("#app");
    app.innerHTML = "";
    const roles = store.getRoles();
    // —— 视图切换方向感（2026-10-15 批次 5）：进入详情 = 前进（右滑入）、详情→列表 = 后退（左滑入）、
    //    其余视图间切换 = 原地淡入；同一视图内的重渲染不动画（无类不播）。
    //    动画实际施加在视图**子节点**上（每次渲染重建 → 类存在即从头播）；位移落在 .app 的 20px 内边距内，
    //    任何宽度下都不会把内容推出视口产生横滚（2026-10-15 终审修正——曾施加于 .app 本体导致窄屏动画期可横滚）。 ——
    if (view.type === "detail" && !store.getRole(view.roleId)) view = { type: "list" };   // 角色不存在 → 回退列表
    const curType = view.type;
    let dirCls = "";
    if (curType === "detail" && lastViewType !== "detail") dirCls = "v-fwd";
    else if (lastViewType === "detail" && curType === "list") dirCls = "v-back";
    else if (lastViewType !== null && curType !== lastViewType) dirCls = "v-lat";
    listEnterAnim = (curType === "list" && lastViewType !== "list");   // R4：列表进入 stagger 仅「切入列表」时播
    lastViewType = curType;
    app.classList.remove("v-fwd", "v-back", "v-lat");
    if (dirCls) app.classList.add(dirCls);

    // 底部 Tab（R5）：按当前视图同步高亮（详情归「首页」）
    const tabbarEl = document.getElementById("tabbar");
    if (tabbarEl) {
      const tabKey = curType === "detail" ? "list" : curType;
      tabbarEl.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.view === tabKey));
    }

    // hash 路由（R6）：视图 → 地址栏（赋值即历史记录项，浏览器后退 = 视图后退；自写触发由监听端等价判定拦截）
    const wantHash = viewToHash();
    if ((location.hash || "#/") !== wantHash) location.hash = wantHash;
    if (view.type === "detail") {
      const rDetail = store.getRole(view.roleId);
      if (rDetail) pushRecent(rDetail.name);   // ⌘K 最近访问（R7）
      app.appendChild(renderDetail(rDetail));
      return;
    }
    if (view.type === "evaluate") {
      app.appendChild(renderEvaluateView());
      return;
    }
    if (view.type === "remodel") {
      app.appendChild(renderRemodelView());
      return;
    }
    if (view.type === "collection") {
      app.appendChild(renderCollectionView());
      return;
    }
    if (roles.length === 0) {
      const empty = el("div", "empty",
        '<div class="icon" aria-hidden="true">' + ico("users") + '</div>' +
        '<div class="empty-title">还没有角色数据</div>' +
        '<div class="empty-desc">创建你的第一个角色，录入圣遗物后即可查看评分；也可以从备份文件导入已有数据。</div>');
      const btnNew = el("button", "btn btn-primary", ico("plus") + "新建角色");
      btnNew.addEventListener("click", createRoleFlow);
      empty.appendChild(btnNew);
      app.appendChild(empty);
      return;
    }
    app.appendChild(renderRoleList(roles));
  }

  /** 新建角色流程（顶栏 / 空状态 / 评估页共用） */
  function createRoleFlow() {
    feedback.prompt({
      title: "新建角色",
      label: "角色名",
      placeholder: "例如：胡桃、雷电将军…",
      defaultValue: "新角色",
      confirmText: "创建"
    }).then(name => {
      if (name == null) return;              // 取消 / Esc
      const role = store.newRole(name.trim() || "新角色");
      view = { type: "detail", roleId: role.id };
      render();
      openRoleConfigModal(store.getRole(role.id));
    });
  }

  // ============ 视图 1：角色列表（筛选 + 分数降序 + 单行信息总览卡片）============
  /** 生成单张角色卡片（筛选排序共用） */
  function buildRoleCard(role) {
    const card = el("div", "role-card");
    const score = core.calcCharacterScore(role);
    const miss = data.missingSlots(role).length;
    // 状态徽章（最右侧，纵向对齐）：缺位黄 > 充能不足红 > 充能达标绿 > 未配置充能灰「无充」——
    // 始终显示 2 字徽章保证跨角色列对齐；灰色「无充」为中性占位（未配置充能 = 不追求充能，不误导达标/不足）
    let badgeHtml = "";
    if (miss > 0) badgeHtml = `<span class="badge badge-yellow" title="未录入 ${miss} 个部位">缺位</span>`;
    else if (hasER(role)) {
      if (score.tags.length) badgeHtml = `<span class="badge badge-red" title="${esc(score.tags[0])}">充能</span>`;
      else badgeHtml = '<span class="badge badge-green" title="充能达标">充能</span>';
    } else {
      badgeHtml = '<span class="badge badge-gray" title="未配置充能（有效词条不含元素充能效率），评分不涉及充能">无充</span>';
    }

    // 有效词条 + 权值（词条简称 + 金色权值；无「有效」标签）
    const effArr = role.effectiveStats || [];
    const weights = role.weights || {};
    const effHtml = effArr.length
      ? effArr.map(s => `<b>${esc(C.MAIN_SHORT[s] || s)}<i>${fmt(weights[s] || 0)}</i></b>`).join("")
      : '<span class="eff-none">未配置</span>';

    // 5 部位徽章：主词条简称 · 单件词条数（两位小数；顺序固定为花羽沙杯头；散件部位金色强调）
    let partsHtml = "";
    C.SLOT_KEYS.forEach(slot => {
      const art = role.artifacts[slot];
      const isLoose = role.looseSlot === slot;
      const looseCls = isLoose ? " loose" : "";
      const tip = isLoose ? "" : ` title="${C.SLOTS[slot].name} · 未录入"`;
      if (!art) {
        partsHtml += `<span class="part empty${looseCls}"${tip}>未录</span>`;
        return;
      }
      const sScore = core.calcArtifactScore(art, role);
      const short = C.MAIN_SHORT[art.mainStat] || art.mainStat;
      const tip2 = isLoose ? "" : ` title="${C.SLOTS[slot].name} · ${esc(art.mainStat)} · ${sScore.toFixed(2)} 词条"`;
      partsHtml += `<span class="part${looseCls}"${tip2}>` +
        `${esc(short)} ${sScore.toFixed(2)}</span>`;
    });

    card.innerHTML =
      `<div class="rc-line">` +
      `<span class="rc-name">${elementIconHtml(role)}${esc(role.name)}</span>` +
      `<span class="rc-score">${score.percent.toFixed(1)}<em>分</em></span>` +
      `<span class="rc-sep"></span>` +
      `<span class="rc-eff">${effHtml}</span>` +
      `<span class="rc-sep"></span>` +
      `<span class="rc-parts">${partsHtml}</span>` +
      `<span class="rc-badge">${badgeHtml}</span>` +
      `</div>`;

    // 删除角色入口仅保留在角色详情页（首页卡片整卡可点击进入详情，不再挂删除按钮）
    // 2026-10-15 批次 3：整卡键盘可达（tabindex + Enter/Space）
    makeActivatable(card, () => {
      view = { type: "detail", roleId: role.id };
      render();
    }, `${role.name} · 查看详情`);
    return card;
  }

  function renderRoleList(roles) {
    const wrap = el("div");
    // 筛选分两条互斥路径（标签页切换，切换即清空另一路；状态存模块级 listFilter，独立于 view）：
    //   ① 按角色 mode="role" ：只筛套装（读角色套装字段 role.sets，2026-10-09 起不再按已录入件计数）
    //   ② 按散件 mode="loose"：只筛散件部位（role.looseSlot）与主词条（该部位已录入件的 mainStat）
    const f = listFilter;
    if (!Array.isArray(f.sets)) f.sets = [];
    if (typeof f.q !== "string") f.q = "";
    if (f.mode !== "role" && f.mode !== "loose") f.mode = "role";
    const allMain = [...new Set(C.SLOT_KEYS.flatMap(s => C.MAIN_STATS_BY_SLOT[s] || []))];
    // 语义校验（持久化恢复的旧数据 / 套装列表变化后）：非法部位连主属性一起清；主属性不在候选则清
    if (f.slot && !C.SLOT_KEYS.includes(f.slot)) { f.slot = ""; f.mainStat = ""; }
    if (f.mainStat) {
      const cands = f.slot ? (C.MAIN_STATS_BY_SLOT[f.slot] || []) : allMain;
      if (!cands.includes(f.mainStat)) f.mainStat = "";
    }
    // 套装候选 = 自定义套装（置顶，便于查找）+ 内置套装（去重）
    const allSets = [];
    (store.getCustomSets() || []).forEach(s => { if (!allSets.includes(s)) allSets.push(s); });
    C.SETS.forEach(s => { if (!allSets.includes(s)) allSets.push(s); });

    // —— 筛选计算（按 mode 走单一路径；两条路不同时生效）——
    function computeFiltered() {
      const q = (f.q || "").trim().toLowerCase();
      return roles.filter(role => {
        if (q && !role.name.toLowerCase().includes(q)) return false;   // 搜索：与路径条件 AND 叠加（2026-10-15 批次 3）
        if (f.mode === "role") {
          if (!f.sets.length) return true;                      // 未选套装 → 不筛
          // 套装判定（2026-10-09）：读角色套装字段 —— 命中 ⟺ roleSets(role) 与所选集合有交集。
          // 不再按「已录入件中该套装 ≥ 2 件」计数。
          // 特殊项 SET_FILTER_EMPTY = 「套装字段为空」（roleSets 为 []，含留空与未录全）→ 单独命中。
          const rs = core.roleSets(role);
          const wantEmpty = f.sets.includes(SET_FILTER_EMPTY);
          return (wantEmpty && rs.length === 0) || rs.some(s => f.sets.includes(s));
        }
        // 按散件：散件部位 + 主词条（AND 叠加；两者均可单独使用）
        if (f.slot && role.looseSlot !== f.slot) return false;
        if (f.mainStat) {
          if (f.slot) {
            const art = role.artifacts && role.artifacts[f.slot];
            return !!(art && art.mainStat === f.mainStat);
          }
          return C.SLOT_KEYS.some(s => role.artifacts[s] && role.artifacts[s].mainStat === f.mainStat);
        }
        return true;
      });
    }
    /** 当前路是否设置了条件（决定 info 提示条显示） */
    const isActive = () => !!(f.q || "").trim() || (f.mode === "role" ? f.sets.length > 0 : !!(f.slot || f.mainStat));

    // —— 筛选栏：路径标签页（按角色 / 按散件）+ 当前路条件 + 清除 ——
    const fBar = el("div", "filter-bar");
    const tabs = el("div", "filter-tabs");
    [{ key: "role", label: "按角色", tip: "按套装筛选角色：角色所穿套装（角色配置中的套装字段）包含所选套装；也可单独勾选「其他 / 不判套装」筛出未声明套装的角色" },
     { key: "loose", label: "按散件", tip: "按散件筛选角色：散件部位 + 该部位的主词条" }].forEach(p => {
      const tab = el("button", "ftab" + (f.mode === p.key ? " active" : ""), p.label);
      tab.type = "button";
      tab.dataset.m = p.key;      // 路径标识（role / loose），便于测试与调试定位
      tab.title = p.tip;
      tab.addEventListener("click", () => {
        if (listFilter.mode === p.key) return;
        // 切换即清空另一路条件（两条路不同时生效）
        listFilter = { mode: p.key, slot: "", mainStat: "", sets: [], q: listFilter.q || "" };   // 路径切换保留搜索（2026-10-15 批次 3）
        persistFilter();
        render();
      });
      tabs.appendChild(tab);
    });

    const condBox = el("div", "filter-cond");
    const btnClear = el("button", "btn btn-sm btn-clear", ico("close") + "清除");   // R10：安静变体（32px 等高、透明底）

    if (f.mode === "role") {
      // —— ① 按角色：套装多选（下拉 checkbox 面板；判定读角色套装字段 role.sets，不数件数）——
      const setBox = el("div", "set-filter");
      // 按钮文案：真实套装数 + 特殊项「其他」（分列，避免把「其他」算成一套）
      const setBtnText = () => {
        if (!f.sets.length) return "套装";
        const n = f.sets.filter(s => s !== SET_FILTER_EMPTY).length;
        const parts = [];
        if (n) parts.push(`${n}套`);
        if (f.sets.includes(SET_FILTER_EMPTY)) parts.push("其他");
        return `套装 ${parts.join("+")}`;
      };
      const setBtn = el("button", "btn btn-sm set-btn");
      const refreshSetBtn = () => { setBtn.innerHTML = esc(setBtnText()) + ico("chevron-down"); };
      refreshSetBtn();
      const panel = el("div", "set-dropdown hidden");
      const list = el("div", "set-list");
      // 勾选/取消的公共处理（真实套装项与「其他」特殊项共用）
      const bindSetItem = (lab, value) => {
        lab.querySelector("input").addEventListener("change", e => {
          if (e.target.checked) { if (!f.sets.includes(value)) f.sets.push(value); }
          else f.sets = f.sets.filter(s => s !== value);
          refreshSetBtn();
          persistFilter();   // 持久化筛选（刷新/重开恢复）
          updateResults();   // 局部刷新，面板保持打开可连续勾选
        });
      };
      allSets.forEach(name => {
        const lab = el("label", "set-item");
        lab.innerHTML = `<input type="checkbox" ${f.sets.includes(name) ? "checked" : ""}><span>${esc(name)}</span>`;
        bindSetItem(lab, name);
        list.appendChild(lab);
      });
      panel.appendChild(list);
      // 特殊项固定放在滚动区**之外**（套装列表很长，避免被滚走）：套装字段为空（其他 / 不判套装）
      panel.appendChild(el("div", "set-sep"));
      const labNone = el("label", "set-item set-item-none");
      labNone.innerHTML = `<input type="checkbox" ${f.sets.includes(SET_FILTER_EMPTY) ? "checked" : ""}>` +
        `<span title="套装字段为空：含「留空（其他）」与「5 部位未录全（当这个角色不存在）」两类">其他 / 不判套装</span>`;
      bindSetItem(labNone, SET_FILTER_EMPTY);
      panel.appendChild(labNone);
      setBox.append(setBtn, panel);
      setBtn.addEventListener("click", e => {
        e.stopPropagation();
        panel.classList.toggle("hidden");
      });
      // 点击面板外关闭（复用同一 handler，避免重复渲染累积监听器）
      if (setPanelOutsideHandler) document.removeEventListener("click", setPanelOutsideHandler);
      setPanelOutsideHandler = e => { if (!setBox.contains(e.target)) panel.classList.add("hidden"); };
      document.addEventListener("click", setPanelOutsideHandler);
      condBox.appendChild(setBox);
    } else {
      // —— ② 按散件：散件部位 + 主词条（主词条候选随部位联动；两者均可单独使用）——
      if (setPanelOutsideHandler) { document.removeEventListener("click", setPanelOutsideHandler); setPanelOutsideHandler = null; }
      const lblSlot = el("span", "filter-lbl", "散件部位");
      const slotSel = el("select");
      slotSel.innerHTML = '<option value="">全部</option>' + C.SLOT_KEYS.map(k =>
        `<option value="${k}" ${f.slot === k ? "selected" : ""}>${C.SLOTS[k].name}</option>`).join("");
      const lblStat = el("span", "filter-lbl", "主属性");
      const statSel = el("select");
      const statCandidates = f.slot ? (C.MAIN_STATS_BY_SLOT[f.slot] || []) : allMain;
      statSel.innerHTML = '<option value="">全部</option>' + statCandidates.map(s =>
        `<option value="${esc(s)}" ${f.mainStat === s ? "selected" : ""}>${esc(s)}</option>`).join("");
      slotSel.addEventListener("change", e => {
        listFilter.slot = e.target.value;
        // 部位变更 → 主词条候选联动；原主词条不在新候选内则清空
        const cands = listFilter.slot ? (C.MAIN_STATS_BY_SLOT[listFilter.slot] || []) : allMain;
        if (listFilter.mainStat && !cands.includes(listFilter.mainStat)) listFilter.mainStat = "";
        persistFilter();   // 持久化筛选（刷新/重开恢复）
        render();
      });
      statSel.addEventListener("change", e => {
        listFilter.mainStat = e.target.value;
        persistFilter();   // 持久化筛选（刷新/重开恢复）
        render();
      });
      condBox.append(lblSlot, slotSel, lblStat, statSel);
    }

    btnClear.addEventListener("click", () => {
      // 清除当前路径的条件与搜索（保留所在路径），刷新后保持无条件
      listFilter = { mode: listFilter.mode, slot: "", mainStat: "", sets: [], q: "", sort: listFilter.sort };
      persistFilter();
      render();
    });
    // 排序（R6）：分数降序 / 按名字 / 按元素——随筛选一并持久化；清除筛选不清排序
    const sortSel = el("select", "sort-select");
    sortSel.title = "排序方式";
    sortSel.setAttribute("aria-label", "排序方式");
    sortSel.innerHTML =
      `<option value="score" ${f.sort === "score" ? "selected" : ""}>分数降序</option>` +
      `<option value="name" ${f.sort === "name" ? "selected" : ""}>按名字</option>` +
      `<option value="element" ${f.sort === "element" ? "selected" : ""}>按元素</option>`;
    sortSel.addEventListener("change", e => {
      listFilter.sort = e.target.value;
      persistFilter();
      render();
    });
    // 注意：btnClear 此刻尚未挂入 DOM（过滤栏由下方 fBar.append 统一组装）——排序下拉在组装行插入

    // 搜索框（2026-10-15 批次 3）：按角色名过滤，与双路径筛选 AND 叠加；贴行右（margin-left:auto）
    const searchBox = el("div", "search-box");
    searchBox.innerHTML = ico("search") +
      `<input type="search" placeholder="搜索角色名" value="${esc(f.q || "")}" aria-label="搜索角色名">`;
    const searchInput = searchBox.querySelector("input");
    searchInput.addEventListener("input", () => {
      listFilter.q = searchInput.value;
      persistFilter();
      updateResults();   // 局部刷新：不重建输入框，保持焦点
    });
    fBar.append(tabs, condBox, btnClear, sortSel, searchBox);
    wrap.appendChild(fBar);

    // —— 结果区（信息 + 列表/空态），套装勾选时局部刷新 ——
    const infoEl = el("div", "filter-info");
    // 备份提醒（R6）：距上次导出 ≥14 天且有变更（或从未导出）→ 低调提示条，可延后 7 天
    const br = global.App.io.backupReminderDue(store.getStore());
    if (br) {
      const note = el("div", "backup-note");
      note.appendChild(el("span", "bn-text",
        br.never ? "还没有导出过数据备份——数据目前只存在本机浏览器里。" : `数据已 ${br.days} 天未备份（上次导出后又有改动）。`));
      const btnGo = el("button", "btn btn-sm", ico("export") + "立即导出");
      btnGo.addEventListener("click", () => { $("#btnExport").click(); render(); });
      const btnLater = el("button", "btn btn-sm bn-later", "稍后");
      btnLater.addEventListener("click", () => { global.App.io.snoozeBackupReminder(); note.remove(); });
      note.append(btnGo, btnLater);
      wrap.appendChild(note);
    }
    wrap.appendChild(infoEl);
    const listWrap = el("div");
    wrap.appendChild(listWrap);

    function updateResults() {
      const filtered = computeFiltered();
      // 排序（R6）：分数降序（默认）/ 按名字（zh 拼音）/ 按元素（元素序内分数降序）
      const byScore = (a, b) => core.calcCharacterScore(b).percent - core.calcCharacterScore(a).percent;
      const eleOrd = r => {
        const ele = r.element || C.CHARACTER_ELEMENT_HINTS[r.name] || "";
        const i = C.ELEMENT_KEYS.indexOf(ele);
        return i < 0 ? 99 : i;
      };
      const sorted = [...filtered].sort(
        f.sort === "name" ? (a, b) => a.name.localeCompare(b.name, "zh")
          : f.sort === "element" ? (a, b) => (eleOrd(a) - eleOrd(b)) || byScore(a, b)
            : byScore);
      if (isActive()) {
        const qq = (f.q || "").trim();
        const segs = [];
        if (f.mode === "role") { if (f.sets.length) segs.push(`套装 ${f.sets.map(setLabel).join("、")}`); }
        else { if (f.slot) segs.push(`散件·${C.SLOTS[f.slot].name}`); if (f.mainStat) segs.push(f.mainStat); }
        if (qq) segs.push(`搜索「${qq}」`);
        infoEl.textContent = `筛选 ${filtered.length}/${roles.length} 个角色` +
          (segs.length ? ` · ${segs.join(" · ")}` : "") +
          (f.sort === "name" ? "，按名字排序" : f.sort === "element" ? "，按元素排序" : "，按分数降序");
        infoEl.style.display = "";
      } else {
        infoEl.style.display = "none";
      }
      listWrap.innerHTML = "";
      if (sorted.length === 0) {
        const empty = el("div", "empty",
          '<div class="icon" aria-hidden="true">' + ico("search") + '</div>' +
          '<div class="empty-title">没有符合筛选条件的角色</div>' +
          '<div class="empty-desc">试试调整筛选条件，或清除筛选查看全部角色。</div>');
        const btnC = el("button", "btn", ico("close") + "清除筛选");
        btnC.addEventListener("click", () => {
          listFilter = { mode: listFilter.mode, slot: "", mainStat: "", sets: [], q: "", sort: listFilter.sort };
          persistFilter();   // 清除同样落盘，刷新后保持无条件
          render();
        });
        empty.appendChild(btnC);
        listWrap.appendChild(empty);
      } else {
        const list = el("div", "role-list");
        const animateIn = listEnterAnim;   // 视图切入列表才 stagger（R4）；同视图重渲染不动画
        listEnterAnim = false;
        sorted.forEach(role => list.appendChild(buildRoleCard(role)));
        // 刷新过渡（R4）：同视图结果更新柔和淡入（连打输入 250ms 内不重播，保手感）
        const now = Date.now();
        if (!animateIn && now - lastRefreshAt > 250) { lastRefreshAt = now; list.classList.add("list-refresh"); }
        listWrap.appendChild(list);
        // 列表进入 stagger（R4）：挂载后按「首屏可见」测量挂类（≤14，屏外不播）——
        // 固定张数在长首屏下会留「空洞」（2026-10-16 实拍修正）
        if (animateIn) {
          const vh = window.innerHeight || 900;
          let k = 0;
          for (const c of list.children) {
            if (k >= 14 || c.getBoundingClientRect().top > vh) break;
            c.classList.add("card-in");
            c.style.setProperty("--i", k);
            k++;
          }
        }
      }
    }
    updateResults();
    return wrap;
  }

  // 数字滚动（R4）：rAF 内插 500ms ease-out；reduced-motion / 微小差值直落终值
  function rollNumber(node, from, to) {
    if (!node) return;
    let reduce = false;
    try { reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { /* 无 matchMedia 环境（如 jsdom） */ }
    if (reduce || Math.abs(to - from) < 0.05) { node.textContent = to.toFixed(1); return; }
    node.textContent = from.toFixed(1);   // 先落基线，再滚动（避免首帧闪现终值）
    const dur = 500;
    const t0 = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = (from + (to - from) * eased).toFixed(1);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ============ 视图 2：角色详情 ============
  function renderDetail(role) {
    const wrap = el("div");
    const score = core.calcCharacterScore(role);
    const miss = data.missingSlots(role).length;

    // 头部：导航（返回）| 主操作（配置 / 编辑 / 录入）| 危险操作（删除），分组降低认知负担
    const head = el("div", "detail-head");
    const title = el("div", "detail-title");
    title.innerHTML = elementIconHtml(role) + esc(role.name);   // 角色名左侧显示元素图标
    const actions = el("div", "detail-actions");
    const grpNav = el("div", "btn-group");
    const grpMain = el("div", "btn-group");
    const grpDanger = el("div", "btn-group");
    const btnBack = el("button", "btn", ico("back") + "返回");   // 2026-10-15 用户反馈：幽灵样式与同排按钮不和谐 → 统一为次按钮
    const btnEditCfg = el("button", "btn", ico("config") + "角色配置");
    const btnNew = el("button", "btn", ico("plus") + "录入新圣遗物");   // 2026-10-15 用户反馈：与同排按钮统一（去主按钮金色）
    // （R10 删除「编辑」按钮：与部位卡点击编辑完全重复，用户反馈多余）
    const btnDelRole = el("button", "btn btn-danger", ico("trash") + "删除");
    btnBack.title = "返回角色列表";
    btnDelRole.title = "删除该角色（不可恢复）";
    btnBack.addEventListener("click", () => { view = { type: "list" }; render(); });
    btnEditCfg.addEventListener("click", () => openRoleConfigModal(role));
    btnNew.addEventListener("click", () => openArtifactModal(role, null, "new"));
    btnDelRole.addEventListener("click", () => {
      feedback.confirm({
        title: "删除角色",
        message: `确定删除角色「${role.name}」吗？`,
        detail: "该操作不可恢复，删除后该角色的全部圣遗物配置将被移除。",
        confirmText: "删除",
        cancelText: "取消",
        danger: true
      }).then(ok => {
        if (ok) {
          store.deleteRole(role.id);
          view = { type: "list" };
          render();
        }
      });
    });
    grpNav.append(btnBack);
    grpMain.append(btnEditCfg, btnNew);
    grpDanger.append(btnDelRole);
    actions.append(grpNav, grpMain, grpDanger);
    head.append(title, actions);
    wrap.appendChild(head);

    // 评分总览（左 = 大分数；右 = 达成度进度条 + 横向信息小块）
    const ov = el("div", "score-overview");
    const effArr = role.effectiveStats || [];
    const weights = role.weights || {};
    const effHtml = effArr.length
      ? effArr.map(s => `<b>${esc(C.MAIN_SHORT[s] || s)}<i>${fmt(weights[s] || 0)}</i></b>`).join("")
      : '<span class="eff-none">未配置</span>';
    // 充能不足提示：以黄色小字并入充能块（分数下方不放徽章）；仅配置了充能（有效词条含充能）的角色显示充能块
    const erWarn = hasER(role) && score.tags.length
      ? `<i class="warn">${esc(score.tags[0].replace(/^充能不足，缺 /, "缺 "))}</i>` : "";
    const erBlock = hasER(role)
      ? `<div class="ov-item"><span class="lbl">充能</span>` +
        `<span class="val">${isFinite(role.currentER) ? role.currentER : 0}%<i>需求 ${isFinite(role.erRequirement) ? role.erRequirement : 0}%</i>${erWarn}</span></div>`
      : "";
    const pctClamped = Math.min(100, Math.max(0, score.percent));
    // 角色所穿套装（2026-10-09 起为角色级固有字段，不再从圣遗物实时推导）
    const cSets = core.roleSets(role);
    const setsHtml = cSets.length
      ? cSets.map(s => `<b>${esc(s)}</b>`).join("")
      : '<span class="eff-none">其他 / 不判套装</span>';
    // 分数构成圆环（R8，取代原构成条与 5 部位 mini 条）：置于 hero 卡片最右侧
    const compItems = core.scoreComposition(role).filter(x => x.value > 0);
    const ringHtml = compItems.length
      ? `<div class="ov-ring" role="group" aria-label="分数构成">${charts.donut(compItems)}</div>` : "";
    ov.innerHTML =
      `<div class="big"><span class="big-num">${score.percent.toFixed(1)}</span><em>分</em></div>` +
      `<div class="ov-main">` +
      `<div class="ov-progress" role="progressbar" aria-valuenow="${pctClamped.toFixed(1)}" aria-valuemin="0" aria-valuemax="100" aria-label="角色评分达成度">` +
      `<i style="width:${pctClamped.toFixed(1)}%"></i></div>` +
      `<div class="ov-stats">` +
      `<div class="ov-item"><span class="lbl">词条数</span>` +
      `<span class="val">${score.words.toFixed(2)}<i>修正 ${score.adjustedWords.toFixed(2)}</i></span></div>` +
      `<div class="ov-item"><span class="lbl">完美基准</span>` +
      `<span class="val">${score.perfect.toFixed(2)}</span></div>` +
      `<div class="ov-item"><span class="lbl">有效词条</span>` +
      `<span class="val ov-eff">${effHtml}</span></div>` +
      `<div class="ov-item"><span class="lbl">套装</span>` +
      `<span class="val ov-eff" data-role-sets>${setsHtml}</span></div>` +
      erBlock +
      `</div></div>` +
      ringHtml;
    wrap.appendChild(ov);

    // 数字滚动（R4）：换角色从 0 起滚、同角色重渲染从旧值滚（reduced-motion 直落）
    const rollFrom = heroRollState.roleId === role.id ? heroRollState.value : 0;
    heroRollState = { roleId: role.id, value: score.percent };
    rollNumber(ov.querySelector(".big-num"), rollFrom, score.percent);

    // 套装字段 vs 圣遗物实况不一致 → 黄字警告 + 一键「按实况更新」（策略 b：字段为准，不自动同步）
    // 仅在「5 部位录全 且 字段非空」时检查（未录全＝当这个角色不存在；留空＝「其他」，无可比对）
    const cons = core.checkSetConsistency(role);
    if (cons.checked && cons.mismatch) {
      const warn = el("div", "warn set-mismatch");
      warn.innerHTML = `<span>${ico("warn")}角色套装字段与圣遗物实况不一致：字段为「${esc(cSets.join(" + "))}」，` +
        `实况为「${cons.actual.length ? esc(cons.actual.join(" + ")) : "其他（无法归入四件套 / 两个两件套）"}」。</span>`;
      const btnSync = el("button", "btn btn-sm", "按实况更新");
      btnSync.title = "把圣遗物的实际套装构成写回角色套装字段";
      btnSync.addEventListener("click", () => {
        role.sets = cons.actual.slice();
        const r = store.updateRole(role);
        if (r && r.error) { feedback.toast(r.error, "error"); return; }
        feedback.toast(`已按实况更新套装：${cons.actual.length ? cons.actual.join(" + ") : "留空（其他）"}`, "success");
        render();
      });
      warn.appendChild(btnSync);
      wrap.appendChild(warn);
    }

    // 5 部位卡
    const grid = el("div", "artifact-grid");
    C.SLOT_KEYS.forEach(slot => {
      const art = role.artifacts[slot];
      grid.appendChild(renderArtifactCard(role, slot, art));
    });
    wrap.appendChild(grid);
    return wrap;
  }

  /** 达成度五档取级（R2 统一入口；阈值延续批次 4 决策 4A） */
  function gradeCls(pct) {
    return pct > 80 ? "score-gold" : pct > 70 ? "score-orange" : pct > 60 ? "score-purple" : pct > 50 ? "score-blue" : "score-gray";
  }

  function renderArtifactCard(role, slot, art) {
    const isLoose = role.looseSlot === slot;   // 散件部位：金色「散」角标视觉引导（不文字说明）
    if (!art) {
      const card = el("div", "artifact-card empty-art" + (isLoose ? " loose" : ""),
        `<div class="ea-inner">${ico("slot-" + slot, "ea-ico")}<div>${C.SLOTS[slot].name}</div></div>`);
      card.addEventListener("click", () => openArtifactModal(role, slot, "new"));
      return card;
    }
    const card = el("div", "artifact-card");
    const sScore = core.calcArtifactScore(art, role);
    const eff = role.effectiveStats || [];
    // 部位达成度百分比 = 单件词条数 / 该部位完美词条数；按得分给整卡着色边框
    const perfect = core.calcPerfect(slot, role);
    const pct = perfect > 0 ? (sScore / perfect) * 100 : 0;
    // 达成度五档（2026-10-15 批次 4，决策 4A）：金 > 橙 > 紫 > 蓝 > 灰——红还给警示、绿还给有效
    const rankCls = gradeCls(pct);
    card.classList.add(rankCls);

    let subsHtml = "";
    (art.substats || []).forEach(s => {
      const rolls = C.UMAX[s.stat] ? (s.value / C.UMAX[s.stat]) : 0;
      const cls = eff.includes(s.stat) ? "effective" : "ineffective";
      const pendTag = s.activated === false ? '<span class="pending-tag">待激活</span>' : "";
      // 三列对齐：副属性 | 数值 | 词条数（当量两位小数）
      subsHtml += `<li class="${cls} ${s.activated === false ? "pending" : ""}">` +
        `<span class="stat">${esc(s.stat)}</span>` +
        `<span class="val">${s.value}${C.STAT_TYPE[s.stat] === "percent" ? "%" : ""}</span>` +
        `<span class="rolls">×${rolls.toFixed(2)}</span> ${pendTag}</li>`;
    });

    card.innerHTML =
      `<div class="a-head">` +
      `<span class="a-slot">${ico("slot-" + slot)}${C.SLOTS[slot].name}${isLoose ? ' <i class="a-loose-tag">散</i>' : ""}</span>` +
      `<span class="a-level">Lv.${art.level}</span></div>` +
      `<div class="a-set">${esc(art.set)}</div>` +
      `<div class="a-main">${esc(art.mainStat)}</div>` +
      `<ul>${subsHtml}</ul>` +
      `<div class="a-foot">` +
      `<span class="a-score">${sScore.toFixed(2)} 词条</span>` +
      `<span class="a-pct ${rankCls}">${pct.toFixed(1)}%</span>` +
      `</div>`;

    // 2026-10-15 批次 5：点已有卡 = 打开该部位编辑弹窗（与空卡「点击录入」对称；键盘可达）
    makeActivatable(card, () => openArtifactModal(role, slot, "edit"), `编辑 ${C.SLOTS[slot].name}`);

    return card;
  }

  // ============ 弹窗基础（委托反馈层：动画 / Esc 关闭 / 遮罩关闭 / 焦点管理）============
  function openModal(titleHtml, bodyNode, footNode, opts) {
    return feedback.openModal(titleHtml, bodyNode, footNode, opts);
  }
  function closeModal() {
    feedback.closeModal();
  }

  // ============ 圣遗物录入弹窗（双模式）============
  function openArtifactModal(role, slot, mode, prefill) {
    // mode: 'edit' 编辑已穿戴件（slot 锁定） | 'new' 录入新圣遗物（临时对象 → 评估）
    //     | 'remodel' 录入重塑分析新件（临时对象 → 重塑分析）
    //     | 'collection' 录入藏品件 | 'collectionEdit' 编辑藏品件（两者都写藏品库）
    const isEdit = mode === "edit";
    const isColl = mode === "collection" || mode === "collectionEdit";
    const isCollEdit = mode === "collectionEdit";
    const isNew = mode === "new" || mode === "remodel";
    const isRemodel = mode === "remodel";
    let formState = {
      slot: slot || "flower",
      set: "",
      mainStat: "",
      level: isRemodel ? 20 : 0,    // 重塑分析录入：默认满级（算法四评估域，仍可改，保存时硬校验）
      substats: [
        { stat: "", value: "", activated: true },
        { stat: "", value: "", activated: true },
        { stat: "", value: "", activated: true },
        { stat: "", value: "", activated: true }
      ]
    };

    if (isEdit && role.artifacts[slot]) {
      const a = role.artifacts[slot];
      formState = {
        slot: a.slot, set: a.set, mainStat: a.mainStat, level: a.level,
        substats: (a.substats || []).map(s => ({ stat: s.stat, value: s.value, activated: s.activated }))
      };
      // 补齐 4 行
      while (formState.substats.length < 4) formState.substats.push({ stat: "", value: "", activated: true });
    } else if (isCollEdit && prefill) {
      // 编辑藏品件：从藏品对象回填
      const a = prefill;
      formState = {
        slot: a.slot, set: a.set, mainStat: a.mainStat, level: a.level,
        substats: (a.substats || []).map(s => ({ stat: s.stat, value: s.value, activated: s.activated }))
      };
      while (formState.substats.length < 4) formState.substats.push({ stat: "", value: "", activated: true });
    } else if (isNew && prefill) {
      // prefill 支持：true（取角色该部位已穿戴件）或圣遗物对象（如评估中的临时对象，修改时回填）
      const a = (typeof prefill === "object" && prefill) ? prefill : (role.artifacts && role.artifacts[slot]);
      if (a) {
        formState = {
          slot: a.slot, set: a.set, mainStat: a.mainStat, level: a.level,
          substats: (a.substats || []).map(s => ({ stat: s.stat, value: s.value, activated: s.activated }))
        };
        while (formState.substats.length < 4) formState.substats.push({ stat: "", value: "", activated: true });
      }
    }

    let currentMode = "text"; // 'text' | 'manual'
    const body = el("div");
    const title = isEdit ? `编辑 ${C.SLOTS[slot].name}`
      : (isCollEdit ? "编辑藏品"
        : (isColl ? "录入藏品"
          : (isRemodel ? "录入要分析的新圣遗物（满级）" : "录入新圣遗物")));

    // 模式切换 tabs
    const tabs = el("div", "mode-tabs",
      `<div class="tab active" data-m="text">文本识别</div><div class="tab" data-m="manual">手动输入</div>`);
    tabs.querySelector('[data-m="text"]').addEventListener("click", () => switchMode("text"));
    tabs.querySelector('[data-m="manual"]').addEventListener("click", () => switchMode("manual"));

    const textPanel = el("div");
    const textarea = el("textarea", "artifact-text", "");
    textarea.placeholder = "粘贴圣遗物文本，例如：\n空之杯雷元素伤害加成7.0%+0·攻击力+4.1%·生命值+4.7%·元素充能效率+6.5%·防御力+19（待激活）角斗士的终幕礼：(0)";
    const btnParse = el("button", "btn btn-primary", "识别");
    const parseResult = el("div");
    parseResult.style.marginTop = "12px";
    textPanel.append(textarea, btnParse, parseResult);

    const manualPanel = el("div");
    manualPanel.classList.add("hidden");

    function switchMode(m) {
      currentMode = m;
      tabs.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.m === m));
      textPanel.classList.toggle("hidden", m !== "text");
      manualPanel.classList.toggle("hidden", m !== "manual");
      if (m === "manual") renderManual();
    }

    // —— 手动表单渲染 ——
    function renderManual() {
      manualPanel.innerHTML = "";
      const slotF = el("div", "field");
      let slotOpts = C.SLOT_KEYS.map(k =>
        `<option value="${k}" ${formState.slot === k ? "selected" : ""}>${C.SLOTS[k].name}${isEdit ? "" : ""}</option>`).join("");
      slotF.innerHTML = `<label>部位</label><select id="mSlot">${slotOpts}</select>`;
      const setF = el("div", "field");
      // 套装下拉 = 内置套装 + 自定义套装 + 当前表单值（保证已填的自定义套装可回显）
      const allSets = [];
      const pushSet = s => { if (s && !allSets.includes(s)) allSets.push(s); };
      C.SETS.forEach(pushSet);
      (store.getCustomSets() || []).forEach(pushSet);
      pushSet(formState.set);
      let setOpts = '<option value="">（选择套装）</option>' + allSets.map(s =>
        `<option value="${esc(s)}" ${formState.set === s ? "selected" : ""}>${esc(s)}</option>`).join("");
      setF.innerHTML = `<label>套装</label><select id="mSet">${setOpts}</select><input id="mSetCustom" style="margin-top:6px" placeholder="自定义套装名（可选）" value="${esc(formState.set && !C.SETS.includes(formState.set) ? formState.set : "")}">`;

      const mainF = el("div", "field");
      const lvF = el("div", "field", `<label>等级</label><input id="mLevel" type="number" min="0" max="20" value="${formState.level}">`);

      const mainSel = el("select");
      mainSel.id = "mMain";
      manualPanel.append(slotF, setF, mainF, lvF);

      function refreshMainOptions() {
        const candidates = C.MAIN_STATS_BY_SLOT[formState.slot] || [];
        mainSel.innerHTML = '<option value="">（选择主词条）</option>' +
          candidates.map(s => `<option value="${esc(s)}" ${formState.mainStat === s ? "selected" : ""}>${esc(s)}</option>`).join("");
      }
      mainF.innerHTML = `<label>主词条</label>`;
      mainF.appendChild(mainSel);
      refreshMainOptions();

      slotF.querySelector("#mSlot").addEventListener("change", e => {
        formState.slot = e.target.value;
        refreshMainOptions();
      });
      setF.querySelector("#mSet").addEventListener("change", e => {
        formState.set = e.target.value;
      });
      setF.querySelector("#mSetCustom").addEventListener("input", e => {
        if (e.target.value.trim()) formState.set = e.target.value.trim();
      });
      lvF.querySelector("#mLevel").addEventListener("input", e => {
        formState.level = parseInt(e.target.value, 10) || 0;
        renderSubRows();
      });
      mainSel.addEventListener("change", e => {
        formState.mainStat = e.target.value;
        renderSubRows();   // 主词条变化 → 刷新副词条互斥（不重复原则）
      });

      const subTitle = el("div", "field", "<label>副词条（词条 / 数值 / 激活）</label>");
      const subRows = el("div");
      manualPanel.append(subTitle, subRows);

      function renderSubRows() {
        subRows.innerHTML = "";
        const useTiers = formState.level === 0;   // 0 级可直接选档位（单次 roll 四档）
        // 互斥（不重复原则）：副词条之间互不重复，且与主词条不重复（主词条若在副属性中则占用）
        const taken = new Set();
        if (formState.mainStat && C.SUB_STATS.includes(formState.mainStat)) taken.add(formState.mainStat);
        formState.substats.forEach(s => { if (s.stat) taken.add(s.stat); });
        formState.substats.forEach((s, i) => {
          const row = el("div", "sub-row");
          // 本行可选 = 全集 − 已占用（主词条 + 其他行）；本行自身已选词条放行（除非它与主词条重复）
          const blocked = new Set(taken);
          if (s.stat && s.stat !== formState.mainStat) blocked.delete(s.stat);
          let opts = '<option value="">词条…</option>' + C.SUB_STATS.filter(st => !blocked.has(st)).map(st =>
            `<option value="${esc(st)}" ${s.stat === st ? "selected" : ""}>${esc(st)}</option>`).join("");
          const actDisabled = formState.level >= 4 ? "disabled" : "";
          const checked = s.activated ? "checked" : "";
          const actLabel = s.activated ? "激活" : "待激活";
          // 数值控件：0 级 → 档位下拉；>0 级 → 数字输入（强化后为多次 roll 之和）
          let valueCtrl;
          if (useTiers) {
            const tiers = C.ROLL_TIERS[s.stat] || [];
            valueCtrl = `<select class="tier" ${tiers.length ? "" : "disabled"}><option value="">档位…</option>${tiers.map(v =>
              `<option value="${v}" ${Number(s.value) === v ? "selected" : ""}>${v}${C.STAT_TYPE[s.stat] === "percent" ? "%" : ""}</option>`).join("")}</select>`;
          } else {
            valueCtrl = `<input type="number" step="0.1" min="0.1" value="${s.value}" placeholder="数值">`;
          }
          row.innerHTML =
            `<select class="stat">${opts}</select>` +
            valueCtrl +
            `<span class="act"><input type="checkbox" ${checked} ${actDisabled}>${actLabel}</span>` +
            `<button class="rm" title="删除行">${ico("close")}</button>`;
          if (formState.level >= 4) row.querySelector(".act").title = "4 级以上无待激活词条";
          row.querySelector(".stat").addEventListener("change", e => {
            s.stat = e.target.value;
            renderSubRows();   // 词条变化 → 刷新全部行的可选词条（互斥）
          });
          if (useTiers) {
            row.querySelector(".tier").addEventListener("change", e => {
              s.value = e.target.value === "" ? "" : parseFloat(e.target.value);
            });
          } else {
            row.querySelector("input[type=number]").addEventListener("input", e => {
              s.value = e.target.value === "" ? "" : parseFloat(e.target.value);
            });
          }
          row.querySelector("input[type=checkbox]").addEventListener("change", e => { s.activated = e.target.checked; });
          row.querySelector(".rm").addEventListener("click", () => {
            formState.substats.splice(i, 1);
            if (formState.substats.length < 3) formState.substats.push({ stat: "", value: "", activated: true });
            renderSubRows();
          });
          subRows.appendChild(row);
        });
        const addBtn = el("button", "btn btn-sm", ico("plus") + "添加副词条");
        addBtn.addEventListener("click", () => {
          if (formState.substats.length < 4) {
            formState.substats.push({ stat: "", value: "", activated: true });
            renderSubRows();
          }
        });
        subRows.appendChild(addBtn);
      }
      renderSubRows();
    }

    // —— 文本识别 ——
    btnParse.addEventListener("click", () => {
      // 传入自定义套装：已确认加入的套装直接命中，不再视为新套装
      const res = global.App.parser.parseArtifactText(textarea.value, { customSets: store.getCustomSets() });
      parseResult.innerHTML = "";
      // 警告
      res.warnings.forEach(w => parseResult.appendChild(el("div", "warn", esc(w))));

      const preview = el("div", "eval-case");
      const rows = [
        ["部位", res.result.slot ? C.SLOTS[res.result.slot].name : "（未识别）"],
        ["套装", res.result.set || "（未识别）"],
        ["等级", res.result.level == null ? "（未识别）" : res.result.level],
        ["主属性", res.result.mainStat || "（未识别）"]
      ];
      let html = `<div class="c-head"><span class="c-title">识别结果预览</span></div><table>`;
      rows.forEach(r => html += `<tr><td>${r[0]}</td><td>${esc(r[1])}</td></tr>`);
      res.result.substats.forEach((s, i) => {
        html += `<tr><td>副词条${i + 1}</td><td>${esc(s.stat)} +${s.value}${C.STAT_TYPE[s.stat] === "percent" ? "%" : ""} ${s.activated ? "" : "（待激活）"}</td></tr>`;
      });
      html += "</table>";
      preview.innerHTML = html;
      parseResult.appendChild(preview);

      // 将识别结果填入表单（可继续手动修正）
      if (res.result.slot) formState.slot = res.result.slot;
      if (res.result.set) {
        formState.set = res.result.set;
        // 第一次遇见新套装（启发式识别、不在内置/自定义列表）：弹窗确认是否加入自定义套装
        if (res.result.setUnknown) {
          const newSet = res.result.set;
          feedback.confirm({
            title: "识别到新套装",
            message: `检测到套装「${esc(newSet)}」不在当前套装列表中。`,
            detail: "是否将其加入自定义套装？加入后下次识别同类文本可直接识别该套装，无需再次确认。",
            confirmText: "加入",
            cancelText: "不加入"
          }).then(ok => {
            if (ok) {
              store.addCustomSet(newSet);
              feedback.toast(`已加入自定义套装：「${newSet}」`, "success");
            }
          });
        }
      }
      if (res.result.mainStat) formState.mainStat = res.result.mainStat;
      if (res.result.level != null) formState.level = res.result.level;
      if (res.result.substats.length) {
        formState.substats = res.result.substats.slice(0, 4).map(s => ({ stat: s.stat, value: s.value, activated: s.activated }));
        while (formState.substats.length < 4) formState.substats.push({ stat: "", value: "", activated: true });
      }
    });

    // —— 提交 ——
    function collectArtifact() {
      if (currentMode === "manual") {
        // 从 DOM 收集
        const mMain = manualPanel.querySelector("#mMain");
        formState.mainStat = mMain ? mMain.value : formState.mainStat;
      }
      const artifact = {
        id: store.genId(),
        slot: formState.slot,
        set: formState.set,
        mainStat: formState.mainStat,
        level: formState.level,
        substats: formState.substats
          .filter(s => s.stat && s.value !== "" && s.value > 0)
          .map(s => ({ stat: s.stat, value: Number(s.value), activated: s.activated }))
      };
      return artifact;
    }

    // —— 一键清空：重置表单为空白（文本区与手动表单同步清空）——
    function resetForm() {
      formState = {
        slot: slot || "flower",
        set: "",
        mainStat: "",
        level: 0,
        substats: [
          { stat: "", value: "", activated: true },
          { stat: "", value: "", activated: true },
          { stat: "", value: "", activated: true },
          { stat: "", value: "", activated: true }
        ]
      };
      textarea.value = "";
      parseResult.innerHTML = "";
      if (currentMode === "manual") renderManual();
    }

    const foot = el("div");
    const btnClear = el("button", "btn", "清空");
    const btnCancel = el("button", "btn", "取消");
    const btnSave = el("button", "btn btn-primary", isEdit ? "保存"
      : (isColl ? "存入藏品库" : (isRemodel ? "保存并分析" : "保存并评估")));
    btnClear.addEventListener("click", resetForm);
    btnCancel.addEventListener("click", closeModal);
    btnSave.addEventListener("click", () => {
      const artifact = collectArtifact();
      const errors = data.validateArtifact(artifact);
      const hard = errors.filter(e => e.level === "hard");
      if (hard.length > 0) {
        feedback.info({
          title: "无法保存",
          type: "error",
          message: `<div class="err-box">请修正以下问题后重试：<ul>` +
            hard.map(e => `<li>${esc(e.msg)}</li>`).join("") + `</ul></div>`,
          confirmText: "知道了"
        });
        return;
      }
      if (isColl) {
        // 藏品件：写入藏品库（store 内自动清理「被完全取代」的旧件）
        if (isCollEdit && prefill && prefill.id) artifact.id = prefill.id;
        const rec = collRecordWon(artifact);   // 新纪录（R7）：入藏前判定刷新了哪些位
        const r = isCollEdit ? store.updateCollectionItem(artifact) : store.addCollectionItem(artifact);
        const removed = ((r && r.removed) || []).length;
        closeModal();
        if (view.type !== "collection") view = { type: "collection" };
        render();
        feedback.toast((isCollEdit ? "已更新藏品" : "已存入藏品库") +
          (removed ? `；${removed} 件旧藏品被完全取代，已移除` : "") +
          (rec ? `；刷新 ${rec.n} 项纪录` : ""), "success");
      } else if (isRemodel) {
        // 重塑分析新件：仅满级（算法四评估域）→ 会话内临时列表（不落盘）
        if (artifact.level < C.MAX_LEVEL) {
          feedback.info({
            title: "无法分析",
            type: "warn",
            message: `<div class="err-box">重塑分析仅支持满级（Lv.20）圣遗物。<br>当前等级 Lv.${artifact.level}，请将等级改为 20（游戏重塑界面仅对满级件开放）。</div>`,
            confirmText: "知道了"
          });
          return;
        }
        remodelTempList.push(artifact);
        closeModal();
        if (view.type !== "remodel") view = { type: "remodel" };
        render();
        feedback.toast("已加入重塑分析列表（会话内有效）", "success");
      } else if (isEdit) {
        // 编辑已穿戴件：直接保存到角色（store 内按副词条充能差联动更新面板充能）
        const linkRes = store.replaceArtifact(role.id, artifact.slot, artifact);
        closeModal();
        render();
        const note = erLinkNote(linkRes);
        if (note) feedback.toast(`面板充能已联动更新：${note}`, "success");
        else if (linkRes && linkRes.erMainStatTouched) {
          feedback.toast("主词条已变更且涉及充能：主词条充能不计入自动联动，请手动更新面板充能", "warn", 4200);
        }
      } else {
        // 新圣遗物：临时对象 → 价值评估（弹窗 or 独立评估页）
        pendingArtifact = artifact;
        evalHidden.clear();      // 新评估对象，重置手动移除记录
        closeModal();
        if (view.type === "evaluate") {
          render();              // 评估页直接展示结果
        } else {
          openEvaluateModal(role);
        }
      }
    });
    foot.append(btnClear, btnCancel);
    // 编辑藏品时提供「删除藏品」入口（删除仅在此处开放）
    if (isCollEdit && prefill && prefill.id) {
      const btnDel = el("button", "btn", "删除藏品");
      btnDel.addEventListener("click", () => {
        feedback.confirm({
          title: "删除藏品",
          message: "确定从藏品库删除这件圣遗物吗？",
          detail: "删除后不可恢复；它占据的维度位将由库中次优件接替。",
          confirmText: "删除",
          danger: true
        }).then(ok => {
          if (!ok) return;
          store.removeCollectionItem(prefill.id);
          closeModal();
          render();
          feedback.toast("已删除藏品", "success");
        });
      });
      foot.appendChild(btnDel);
    }
    foot.appendChild(btnSave);

    const open = openModal(title, (function () {
      const w = el("div");
      w.append(tabs, textPanel, manualPanel);
      return w;
    })(), foot);
    // 编辑已穿戴件 / 有预填数据时默认进入手动模式（直接显示已有内容便于修改）；否则默认文本识别
    if (isEdit || (isNew && prefill)) switchMode("manual");
    else switchMode("text");
  }

  // ============ 价值评估（独立视图 + 弹窗共用渲染）============

  /** 情况优先级：情况三（套装件替换散件）> 情况二（套装件替换）> 情况一（散件/自由件替换） */
  function caseRank(r) {
    return r.isSetSwap ? 3 : (r.case === "套装替换" ? 2 : 1);
  }
  /** 情况类别短词（弹窗用，无「情况 X」编号） */
  function caseLabel(r) {
    if (r.case === "套装替换") return "套装件替换";
    if (r.isSetSwap) return "套装件替换散件";
    return r.case === "自由件" ? "自由件替换" : "散件替换";
  }

  /**
   * 止损容错显示（2026-10-17）：文案 / tooltip / 类名——弹窗情况卡「止损：…」段与独立评估页
   * 「止损容错」列共用（r = evaluateAgainst 结果）。态：还可歪 N 次 / 不能歪（二者完全同款，
   * .tight 仅作标记类）/ 已满级（满级件，黄同款——2026-10-17 用户要求，原为灰「—」）/ —（灰：
   * 未满级且不适用，按 tooltip 区分成因）。
   */
  function stopLossDisplay(r) {
    const cur = fmt(r.currentScore);
    if (r.stopTolerance == null) {
      // 满级件（remaining === 0 ⟺ level ≥ 20）：无剩余强化次数 → 「已满级」，样式与「还可歪/不能歪」同款
      if (r.remaining === 0) {
        return { txt: "已满级", tip: "止损容错：该件已满级（无剩余强化次数），不涉及止损追赶", cls: "" };
      }
      const tip = r.diffToCurrent < 0
        ? `止损容错：剩余强化全中满值也无法追平现有件（${cur}）`
        : `止损容错：当前已追平或超过现有件（${cur}），不涉及追赶`;
      return { txt: "—", tip, cls: " none" };
    }
    const baseTip = `止损容错：还需命中 ${r.stopNeed} 次才能追平现有件（${cur}）`;
    if (r.stopTolerance > 0) {
      return {
        txt: `还可歪 ${r.stopTolerance} 次`,
        tip: `${baseTip} · 最多还能歪 ${r.stopTolerance} 次；歪满 ${r.stopTolerance + 1} 次后即无望（剩余全中满值也追不上）`,
        cls: ""
      };
    }
    return {
      txt: "不能歪",
      tip: `${baseTip} · 一次都不能歪；再歪 1 次即无望（剩余全中满值也追不上）`,
      cls: " tight"
    };
  }

  /**
   * 达成度对照条（2026-10-17 用户要求）：[当前% 48px][条][替换后% 48px]——评估弹窗卡与独立页行共用。
   * 左 = 角色当前（替换前）达成度、右 = 替换后达成度；金段 = 目前、绿段 = 替换带来的增量
   * （与藏品视角极限度合并条同一视觉语言）。cur/new 为百分比数值（如 75.1），clamp 0~100 展示。
   * newPct 为 null（未满级件无替换后分）→ 返回空 `.row-pcts` 占位（保证独立页网格列轨道对齐）。
   */
  function pctCompareHtml(curPct, newPct) {
    if (newPct == null) return `<span class="row-pcts"></span>`;
    const clamp = x => Math.max(0, Math.min(100, isFinite(x) ? x : 0));
    const cur = clamp(curPct), nw = clamp(newPct);
    const curTxt = cur.toFixed(1) + "%", newTxt = nw.toFixed(1) + "%";
    const segA = cur, segB = Math.max(0, nw - cur);
    return `<span class="row-pcts">` +
      `<span class="row-pct-cur" title="当前达成度 ${curTxt} · 角色当前总分 ÷ 完美基准">${curTxt}</span>` +
      `<span class="row-bar" title="达成度对照：当前 ${curTxt} → 替换后 ${newTxt}（金色段 = 目前、绿色段 = 替换带来的增量）">` +
      `<i class="seg-cur" style="left:0;width:${segA.toFixed(1)}%"></i>` +
      `<i class="seg-delta" style="left:${segA.toFixed(1)}%;width:${segB.toFixed(1)}%"></i>` +
      `</span>` +
      `<span class="row-pct-new" title="替换后达成度 ${newTxt} · 换上这件后的角色总分 ÷ 完美基准">${newTxt}</span>` +
      `</span>`;
  }

  /** 待评估新圣遗物摘要卡（独立页与弹窗共用）：**单行紧凑卡**（2026-10-14 用户要求精简）——
   *  [待] 小徽章（替代「待评估新圣遗物」字样）+ 件信息 · 副词条 · [修改][放弃]（右贴）；窄容器自动换行。
   *  操作按钮（可选）：修改（onEdit，两处都传）；放弃（onAbandon，仅独立评估页传——弹窗的「放弃」在 footer）。
   *  注意：函数名区别于「部位卡」renderArtifactCard(role, slot, art)，避免闭包内函数覆盖 */
  function renderPendingCard(art, onEdit, onAbandon) {
    const box = el("div", "eval-case pend-card");
    const btns =
      (onEdit ? `<button class="btn btn-sm" id="reEdit">修改</button>` : "") +
      (onAbandon ? `<button class="btn btn-sm" id="reAbandon">放弃</button>` : "");
    box.innerHTML =
      `<span class="pend-mark" title="待评估新圣遗物" aria-label="待评估新圣遗物">待</span>` +
      `<span class="art-summary">${C.SLOTS[art.slot].name} · ${esc(art.set)} · Lv.${art.level} · ${esc(art.mainStat)}</span>` +
      ((art.substats || []).length
        ? `<span class="art-substats">${(art.substats || []).map(s =>
            `${esc(s.stat)} ${s.value}${C.STAT_TYPE[s.stat] === "percent" ? "%" : ""}${s.activated ? "" : "（待激活）"}`).join(" · ")}</span>`
        : "") +
      (btns ? `<span class="pend-actions">${btns}</span>` : "");
    if (onEdit) box.querySelector("#reEdit").addEventListener("click", onEdit);
    if (onAbandon) box.querySelector("#reAbandon").addEventListener("click", onAbandon);
    return box;
  }

  /** 渲染评估内容（新件信息卡 + 汇总 + 各情况结果卡），供弹窗与独立页复用 */
  function buildEvalContent(role, art, onEdit) {
    const box = el("div");

    // 新件信息
    box.appendChild(renderPendingCard(art, onEdit));

    // 评估结果
    const res = core.evaluateArtifact(art, role);
    const sum = el("div", "eval-summary " +
      (res.valuable ? "valuable" : (res.results.length === 0 ? "no-case" : "no-value")));
    sum.innerHTML = res.valuable ? ico("check") + "有价值"
      : (res.results.length === 0 ? ico("warn") + "无适用场景（该部位不是散件/自由位，且无同套装同主词条的已穿戴件）" : ico("close") + "无价值");
    box.appendChild(sum);

    if (res.results.length === 0) {
      box.appendChild(el("div", "info", "可将其录入到对应部位后重新评估，或修改新圣遗物信息。"));
    }

    res.results.forEach(r => {
      const card = el("div", "eval-case case-" + caseRank(r));
      const verdictCls = r.worthy ? "badge-green" : "badge-gray";
      const diffCls = r.diffToCurrent >= 0 ? "diff-pos" : "diff-neg";
      const setSwapWarn = r.isSetSwap
        ? `<div class="warn" style="margin-top:8px">${ico("warn")}替换后该部位将变为「${esc(art.set)}」套装件，角色将失去散件（散件部位将置空）</div>`
        : "";
      const tol = stopLossDisplay(r);   // 止损容错（2026-10-17）：紧跟「当前」段（原潜力段位——潜力展示已删，见 8.30）
      card.innerHTML =
        `<div class="c-head"><span class="c-title">${caseLabel(r)}</span>` +
        `<span class="badge ${verdictCls}">${esc(r.verdict)}</span></div>` +
        setSwapWarn +
        `<div class="eval-row">` +
        `<span>当前 ${fmt(r.currentScore)}</span>` +
        `<span class="row-tol${tol.cls}" title="${esc(tol.tip)}">止损：${tol.txt}</span>` +
        `<span class="${diffCls}">${r.diffToCurrent >= 0 ? "+" : ""}${fmt(r.diffToCurrent)} 词条</span>` +
        pctCompareHtml(r.curPercent, r.newPercent) +
        // 充能段仅对「看充能」的角色显示（2026-10-17）：无充角色显示「充能 185.8%」毫无意义（首页还写着「无充」），
        // 且 tags 现已由 core 按 erApplies 门禁为空，若不加这段会留下一串无标签的裸数字。
        (hasER(role)
          ? `<span>充能 ${fmt(r.newER)}%${r.tags.length ? ` <span class="badge ${erTagCls(r.erTagLevel)}">${esc(r.tags[0])}</span>` : ""}</span>`
          : "") +
        `</div>`;
      box.appendChild(card);
    });

    // 藏品视角：未装备件收藏比对（入藏判定 / 极限程度 / 潜力）
    box.appendChild(buildCollectionPanel(art));

    return { box, res };
  }

  /** 执行替换：写入角色该部位（store 内按副词条充能差联动更新 currentER）；情况三时散件部位置空
   *  @returns {Object|false} store.replaceArtifact 的结果（含 erFrom/erTo/erDelta） */
  function applyReplace(role, art, isSetSwap) {
    const slot = art.slot;
    // 撤销窗口（R5）：替换前快照（旧件 / 面板充能 / 散件位），随结果返回给 toast
    const oldArt = role.artifacts[slot] ? JSON.parse(JSON.stringify(role.artifacts[slot])) : null;
    const oldER = role.currentER;
    const oldLooseSlot = role.looseSlot;
    const res = store.replaceArtifact(role.id, art.slot, art);
    if (isSetSwap) {
      role.looseSlot = null;   // 替换后无散件（5 件全套装）
      store.updateRole(role);
    }
    if (res && res.ok) {
      res.undo = { slot, oldArt, oldER, oldLooseSlot, newId: role.artifacts[slot] ? role.artifacts[slot].id : null };
    }
    return res;
  }

  /** 撤销替换（R5）：恢复旧件 / 面板充能 / 散件位；该部位已被后续修改覆盖时不动并提示 */
  function undoReplace(roleId, u) {
    const role = store.getRole(roleId);
    if (!role || !u) return;
    const cur = role.artifacts[u.slot];
    if (!cur || (u.newId && cur.id !== u.newId)) {
      feedback.toast("该替换已被后续修改覆盖，无法撤销", "warn");
      return;
    }
    if (u.oldArt) role.artifacts[u.slot] = u.oldArt;
    else delete role.artifacts[u.slot];
    role.looseSlot = u.oldLooseSlot;
    role.currentER = u.oldER;
    store.updateRole(role);
    render();
    feedback.toast("已撤销替换", "success");
  }

  /** 充能提示文案片段（未联动/无变化时返回空串），如「面板充能 180% → 172.9%」 */
  function erLinkNote(res) {
    if (!res || res.erFrom == null || res.erTo == null) return "";
    return `面板充能 ${fmt(res.erFrom)}% → ${fmt(res.erTo)}%`;
  }

  /** 充能提示徽章配色（2026-09-29）：不足红 / 补足黄 / 满足绿 */
  function erTagCls(level) {
    if (level === "lack") return "badge-red";
    if (level === "met") return "badge-green";
    return "badge-yellow";
  }

  /** 价值评估弹窗（角色详情「评估替换」入口） */
  function openEvaluateModal(role) {
    if (!pendingArtifact) return;
    const body = el("div");
    const { box } = buildEvalContent(role, pendingArtifact, () => {
      closeModal();
      openArtifactModal(role, pendingArtifact.slot, "new", pendingArtifact);
    });
    body.appendChild(box);

    const foot = el("div");
    const btnCancel = el("button", "btn", "放弃");
    btnCancel.addEventListener("click", () => { pendingArtifact = null; evalHidden.clear(); closeModal(); render(); });
    // 仅满级圣遗物可替换；未满级只评估强化价值，不提供替换入口
    const canReplace = pendingArtifact.level >= C.MAX_LEVEL;
    if (!canReplace) {
      foot.appendChild(btnCancel);
    } else {
      const btnReplace = el("button", "btn btn-primary", "确认替换");
      btnReplace.addEventListener("click", () => {
        const res = core.evaluateArtifact(pendingArtifact, role);
        const setSwap = res.results.some(r => r.isSetSwap);
        const doReplace = () => {
          const linkRes = applyReplace(role, pendingArtifact, setSwap);
          pendingArtifact = null;
          evalHidden.clear();
          closeModal();
          render();
          const note = erLinkNote(linkRes);
          feedback.toast(`已替换，「${role.name}」` + (note || ""), "success", 6000, { label: "撤销", fn: () => undoReplace(role.id, linkRes.undo) });
        };
        if (setSwap) {
          feedback.confirm({
            title: "确认替换",
            message: "该替换会使该部位变为套装件，角色将失去散件（散件部位将置空）。确定替换？",
            confirmText: "确认替换",
            danger: true
          }).then(ok => { if (ok) doReplace(); });
        } else if (!res.valuable) {
          feedback.confirm({
            title: "确认替换",
            message: "评估显示该圣遗物没有价值，确定仍要替换？",
            confirmText: "仍要替换",
            danger: true
          }).then(ok => { if (ok) doReplace(); });
        } else {
          doReplace();
        }
      });
      foot.append(btnCancel, btnReplace);
    }
    openModal("价值评估", body, foot);
  }

  /** 独立视图：圣遗物价值评估页（顶栏「价值评估」入口）—— 对全部角色评估 */
  function renderEvaluateView() {
    const wrap = el("div");
    const roles = store.getRoles();
    if (roles.length === 0) {
      const empty = el("div", "empty",
        '<div class="icon" aria-hidden="true">' + ico("eval") + '</div>' +
        '<div class="empty-title">还没有角色数据</div>' +
        '<div class="empty-desc">请先创建角色或导入数据，再对新的圣遗物进行价值评估。</div>');
      const btn = el("button", "btn btn-primary", ico("plus") + "新建角色");
      btn.addEventListener("click", createRoleFlow);
      empty.appendChild(btn);
      wrap.appendChild(empty);
      return wrap;
    }

    // 头部：标题 + 说明；录入入口统一置于标题最右（R12）
    const head = el("div", "detail-head");
    head.appendChild(el("div", "detail-title", "圣遗物价值评估"));
    const btnEvalNew = el("button", "btn btn-primary", ico("plus") + "录入新圣遗物");
    btnEvalNew.title = "录入要评估的新圣遗物";
    btnEvalNew.addEventListener("click", () => openArtifactModal(roles[0], null, "new"));
    head.appendChild(btnEvalNew);
    wrap.appendChild(head);
    wrap.appendChild(el("div", "info page-info",
      "录入一件新圣遗物后，将自动对全部角色评估，按使用方式优先级列出所有「有提升」的情况。" +
      "「有效词条」列显示角色当前所穿那件上的有效副词条实测值，悬停可看「现役件 → 新件」逐条对照。"));

    if (!pendingArtifact) return wrap;   // 空态：仅标题 + 说明 + 右上角录入入口（R13 删除引导卡）

    // —— 评估全部角色 ——
    const art = pendingArtifact;
    const all = roles.map(r => ({ role: r, res: core.evaluateArtifact(art, r) }));
    const hiddenCount = evalHidden.size;
    const valuable = all.filter(x => x.res.valuable && !evalHidden.has(x.role.id));

    // 新件摘要（一行主信息 + 一行副词条）；操作 = 修改 / 放弃（2026-10-14 用户要求：「放弃」在「修改」右侧）
    wrap.appendChild(renderPendingCard(art,
      () => openArtifactModal(roles[0], art.slot, "new", pendingArtifact),
      () => { pendingArtifact = null; evalHidden.clear(); render(); }));

    // 藏品视角（未装备件收藏比对，与角色结论并列的另一套口径）
    wrap.appendChild(buildCollectionPanel(art));

    // 汇总
    const sum = el("div", "eval-summary " + (valuable.length ? "valuable" : "no-value"));
    if (valuable.length) {
      sum.innerHTML = ico("check") + `评估 ${roles.length} 个角色：${valuable.length} 个角色有提升` +
        (hiddenCount > 0 ? `（已手动移除 ${hiddenCount} 个）` : "");
    } else if (hiddenCount > 0) {
      sum.textContent = `已手动移除全部有提升角色，暂无更多提升项（共评估 ${roles.length} 个角色）`;
    } else {
      sum.innerHTML = ico("close") + `评估 ${roles.length} 个角色：均无提升（词条不足或无适用场景）`;
    }
    wrap.appendChild(sum);

    // 图例：颜色 = 使用方式（优先级 三 > 二 > 一）
    wrap.appendChild(el("div", "legend",
      `<span class="lg"><i class="sw s3"></i>套装件替换散件 · 最高优先</span>` +
      `<span class="lg"><i class="sw s2"></i>套装件替换</span>` +
      `<span class="lg"><i class="sw s1"></i>散件 / 自由件替换</span>`));

    // 按情况分组（优先级：情况三 > 二 > 一），组内每角色一行紧凑显示
    const groups = { 3: [], 2: [], 1: [] };
    valuable.forEach(({ role, res }) => {
      res.results.filter(r => r.worthy).forEach(r => {
        groups[caseRank(r)].push({ role, r });
      });
    });

    // 组内排序（2026-10-18 用户要求）：按「加的词条」（行上的 +X 词条 = diffToCurrent）降序——
    // 同一种使用方式里提升越大的角色越靠前，跨组仍按情况三 > 二 > 一。
    // ⚠️ 不能改成按角色列表顺序/评分排序：曾按 roles 原序输出，用户看到「+0.10 在 +2.60 上面」判为回归。
    // diff 相同保持角色列表原序（Array.prototype.sort 稳定）。
    [3, 2, 1].forEach(rank => {
      const items = groups[rank].slice().sort((a, b) => b.r.diffToCurrent - a.r.diffToCurrent);
      if (!items.length) return;
      const groupBox = el("div", "eval-case case-" + rank);
      items.forEach(({ role, r }) => {
        const diffCls = r.diffToCurrent >= 0 ? "diff-pos" : "diff-neg";
        // 「有效词条」列（2026-10-17 口径变更，用户要求）：不再展示角色的配置画像（词条 × 权值——
        // 同一角色看任何新件都长一样），改为展示**角色当前所穿同部位件**上、属于该角色有效词条的
        // 副词条**实测值**；悬停给出「现役件 → 新件」逐条对照（含新件新增 / 丢失的条目），
        // 因为只列旧件看不出换过去会丢什么、也看不出新件补了什么。
        const effArr = role.effectiveStats || [];
        const oldArt = (role.artifacts || {})[art.slot] || null;
        const subRank = st => { const i = C.SUB_STATS.indexOf(st); return i < 0 ? 99 : i; };
        const fmtSubVal = s => `${C.MAIN_SHORT[s.stat] || s.stat} ${s.value}${C.STAT_TYPE[s.stat] === "percent" ? "%" : ""}`;
        const pickEff = list => (list || []).filter(s => effArr.includes(s.stat))
          .sort((a, b) => subRank(a.stat) - subRank(b.stat));
        const oldEffSubs = pickEff(oldArt && oldArt.substats)
          // 按权值降序（该角色越看重的越靠前），同权值回落固定词条序——截断时优先保留重点词条
          .sort((a, b) => ((role.weights || {})[b.stat] || 0) - ((role.weights || {})[a.stat] || 0)
            || subRank(a.stat) - subRank(b.stat));
        const newEffSubs = pickEff(art.substats);
        // 列宽（2026-10-17 第三版）：未满级 **334px** / 满级 **280px**（操作列 auto 让出的空间），字号 13px
        // —— 4 项最宽 290px（瓦雷莎·花）：未满级全放得下，满级仅瓦雷莎/芙宁娜 2 例裁 3~10px（title 兜底）。
        // 折叠逻辑仅作防御保留（副词条上限 4 条，正常不会触发）。
        const MAX_EFF_SHOWN = 4;
        const shownEffSubs = oldEffSubs.slice(0, MAX_EFF_SHOWN);
        const restEffSubs = oldEffSubs.slice(MAX_EFF_SHOWN);
        // 悬停口径（2026-10-17 用户要求）：**逐词条**独立提示——悬停哪个词条就只显示它自己的
        // 【旧】/【新】对照，不再一悬停就把整行条目全列出来；被折叠的「+N」提示那几项。
        const valOf = (list, st) => {
          const x = list.find(s => s.stat === st);
          return x ? `${x.value}${C.STAT_TYPE[st] === "percent" ? "%" : ""}` : "0";
        };
        const subTitleOf = st => {
          const name = C.MAIN_SHORT[st] || st;
          return `【旧】${name} ${valOf(oldEffSubs, st)}【新】${name} ${valOf(newEffSubs, st)}`;
        };
        const effHtml = oldEffSubs.length
          ? shownEffSubs.map((s, i) =>
              (i ? '<span class="eff-sep"> · </span>' : "") +
              `<span class="eff-sub num" title="${esc(subTitleOf(s.stat))}">${esc(fmtSubVal(s))}</span>`
            ).join("") +
            (restEffSubs.length
              ? `<span class="eff-more" title="${esc(restEffSubs.map(s => subTitleOf(s.stat)).join(" · "))}">+${restEffSubs.length}</span>`
              : "")
          : '<span class="eff-none">无有效副词条</span>';
        // grid 固定列（eval-row-grid）：角色名 | 词条差 | 止损容错 | 有效词条 | 达成度对照条 | 状态标签 | 操作按钮
        // 条件列（对照条/状态标签）以空占位，保证所有行各列起始位置一致（纵向对齐）
        const tol = stopLossDisplay(r);   // 止损容错（2026-10-17）：追平口径四态（与藏品 coll-tol 同语言；满级「已满级」见 8.30）
        const row = el("div", "eval-row eval-row-grid");
        row.innerHTML =
          `<span class="row-role" title="点击查看角色详情">${esc(role.name)}</span>` +
          `<span class="row-diff ${diffCls}">${r.diffToCurrent >= 0 ? "+" : ""}${fmt(r.diffToCurrent)} 词条</span>` +
          `<span class="row-tol${tol.cls}" title="${esc(tol.tip)}">${tol.txt}</span>` +
          `<span class="row-eff">${effHtml}</span>` +
          pctCompareHtml(r.curPercent, r.newPercent) +
          // 状态标签：替换后失去散件（情况三）/ 充能提示（2026-09-29：按替换对充能的影响分级配色——不足红 / 补足黄 / 满足绿）
          `<span class="row-tag">` +
            (r.isSetSwap ? `<span class="badge badge-yellow">替换后无散件</span>` : "") +
            (r.tags.length ? `<span class="badge ${erTagCls(r.erTagLevel)}">${esc(r.tags[0])}</span>` : "") +
          `</span>`;
        // 点击角色名 → 跳转该角色详情页（评估临时对象保留，返回评估页结果仍在）
        makeActivatable(row.querySelector(".row-role"), () => {
          view = { type: "detail", roleId: role.id };
          render();
        }, `查看 ${role.name} 详情`);
        // 操作区（最右列，两端对齐）：手动移除 + 替换（仅满级圣遗物）
        const actions = el("div", "row-actions");
        const btnHide = el("button", "btn btn-sm btn-hide", ico("close"));
        btnHide.title = "从有提升列表移除";
        btnHide.addEventListener("click", () => {
          evalHidden.add(role.id);
          render();
        });
        actions.appendChild(btnHide);
        // 仅满级圣遗物可替换（未满级无替换按钮，也不提示）
        if (art.level >= C.MAX_LEVEL) {
          const btn = el("button", "btn btn-primary btn-sm", "替换");
          btn.addEventListener("click", () => {
            const slotName = C.SLOTS[art.slot].name;
            const doReplace = () => {
              const linkRes = applyReplace(role, art, r.isSetSwap);
              pendingArtifact = null;
              evalHidden.clear();
              const note = erLinkNote(linkRes);
              feedback.toast(`已替换到「${role.name}」的${slotName}` + (note ? `（${note}）` : ""), "success", 6000, { label: "撤销", fn: () => undoReplace(role.id, linkRes.undo) });
              render();
            };
            if (r.isSetSwap) {
              feedback.confirm({
                title: "确认替换",
                message: `确定将新圣遗物替换到「${role.name}」的${slotName}吗？`,
                detail: `该部位将变为「${art.set}」套装件，角色将失去散件（散件部位置空）。`,
                confirmText: "确认替换",
                danger: true
              }).then(ok => { if (ok) doReplace(); });
            } else {
              feedback.confirm({
                title: "确认替换",
                message: `确定将新圣遗物替换到「${role.name}」的${slotName}吗？`,
                detail: "当前该部位的圣遗物将被丢弃。",
                confirmText: "确认替换",
                danger: true
              }).then(ok => { if (ok) doReplace(); });
            }
          });
          actions.appendChild(btn);
        }
        row.appendChild(actions);
        groupBox.appendChild(row);
      });
      wrap.appendChild(groupBox);
    });

    // 无提升角色提示
    const noVal = roles.length - valuable.length;
    if (noVal > 0) {
      const hiddenNote = hiddenCount > 0 ? `（含手动移除 ${hiddenCount} 个）` : "";
      wrap.appendChild(el("div", "info", `其余 ${noVal} 个角色无提升（词条不足或无适用场景），未列出${hiddenNote}。`));
    }

    return wrap;
  }

  // ============ 重塑分析（独立视图，算法四：安全网期望 + 三情况归属 + RV 排序）============

  /** 三情况标签与偏差提示（按行动的 kind 映射；偏差方向固定：情况二高估 / 情况三低估，仅提示不进公式） */
  function remodelCaseInfo(t) {
    if (t.kind === "transfer") {
      return { label: "同套转移", note: "未计打破原持有者套装的代价，实际收益略低" };
    }
    if (t.kind === "promote") {
      return { label: "晋升套装件", note: "未计宿主凑套后再优化的收益，实际收益略高" };
    }
    return { label: "原地强化", note: "" };
  }

  /** 单件重塑分析卡（三层信息架构）：头行（来源+初始+RV）→ 副词条 → 主行（行动→对象 + 现状→期望）→ 操作行 → 短提示 → 折叠详情 */
  function buildRemodelCard(row) {
    const art = row.artifact;
    const r = row.best.r;
    const worth = r.rv > 0;
    const card = el("div", "eval-case remodel-card" + (worth ? "" : " remodel-none"));

    // 头：部位 · 套装 · 主词条（+来源）| 初始切换 + RV 徽章
    const head = el("div", "c-head");
    const srcTag = row.sourceRole
      ? ` <i class="rm-src" title="录入自该角色的已穿戴件">来自 ${esc(row.sourceRole.name)}</i>`
      : ` <i class="rm-src" title="会话内新录入件（游离件）：评估对象为装备其所属套装且有同部位同主属性件的角色">（新录入）</i>`;
    head.innerHTML =
      `<span class="c-title">${C.SLOTS[art.slot].name} · ${esc(art.set)} · ${esc(C.MAIN_SHORT[art.mainStat] || art.mainStat)}${srcTag}</span>`;
    const headRight = el("span", "rm-head-right");
    const inferred = core.inferInitialCount(art);
    let initEl;
    if (inferred != null) {
      // 发数守恒唯一判定 → 初始数确定，仅静态展示（不提供切换，防误切）
      initEl = el("span", "rm-init-static", `初始${inferred}`);
      initEl.title = `由词条档位自动推断：总发数唯一判定为 ${inferred} 初始（= 可重掷强化 ${inferred === 3 ? 4 : 5} 次），确定值无需切换`;
    } else {
      initEl = el("button", "btn btn-sm rm-init", `初始${row.initialCount}`);
      initEl.title = `档位两可/无判据，无法自动判定；点击切换 3/4 初始（游戏重塑界面直接标注）；当前 ${row.initialCount} 初始 = 可重掷强化 ${row.initialCount === 3 ? 4 : 5} 次`;
      initEl.addEventListener("click", () => {
        remodelInitOverride.set(row.signature, row.initialCount === 3 ? 4 : 3);
        render();
      });
    }
    const rvBadge = el("span", "badge " + (worth ? "badge-green" : "badge-gray"),
      `RV ${r.rv >= 0 ? "+" : ""}${r.rv.toFixed(2)}`);
    rvBadge.title = "RV = 重塑后期望分 − 功能位现状分（期望 ≠ 保证，重塑结果可预览后选择保留）";
    headRight.append(initEl, rvBadge);
    head.appendChild(headRight);
    card.appendChild(head);

    // 副词条行（展示用，弱化）
    card.appendChild(el("div", "art-substats",
      (art.substats || []).map(s =>
        `${esc(C.MAIN_SHORT[s.stat] || s.stat)} ${s.value}${C.STAT_TYPE[s.stat] === "percent" ? "%" : ""}`).join(" · ")));

    // 主行：行动 → 评估对象 ＋ 现状 → 期望（核心对比，视觉重心）
    const best = row.best;
    const ci = remodelCaseInfo(best);
    const main = el("div", "rm-main");
    main.innerHTML =
      `<span class="rm-action"><i class="rm-case">${ci.label}</i><b class="rm-role" title="点击查看该角色详情">${esc(best.role.name)}</b></span>` +
      `<span class="rm-flow">现状 ${r.currentScore.toFixed(2)} <i class="rm-arrow">→</i> 期望 <b>${r.eRemodel.toFixed(2)}</b></span>`;
    card.appendChild(main);
    makeActivatable(main.querySelector(".rm-role"), () => {
      view = { type: "detail", roleId: best.role.id };
      render();
    }, `查看 ${best.role.name} 详情`);

    // 操作行：建议指定 + 尘耗/效率（重塑时的操作指引）
    const op = el("div", "rm-op");
    op.innerHTML =
      `<span>建议指定 <b class="rm-sug">${r.suggest.length ? r.suggest.map(esc).join(" + ") : "—"}</b></span>` +
      `<span class="rm-dim">尘 ${r.dust} 枚 · ${r.rv >= 0 ? "+" : ""}${r.efficiency.toFixed(2)}/枚</span>`;
    card.appendChild(op);

    // 偏差提示（仅转移/晋升显示，短句）
    if (ci.note) card.appendChild(el("div", "rm-note", ico("info") + ci.note));

    // 折叠详情：保底线 / 组合上限 / 期望达成度 + 全部可评估对象
    const det = el("details", "rm-detail");
    det.innerHTML = `<summary>${row.all.length > 1 ? `详情 · 全部对象（${row.all.length}）` : "详情"}</summary>`;
    det.appendChild(el("div", "rm-meta",
      `<span>保底线 基础 <b>${r.floors.basic.toFixed(2)}</b> · 高阶 <b>${r.floors.advanced.toFixed(2)}</b> · 谕告 <b>${r.floors.oracle.toFixed(2)}</b></span>` +
      `<span>组合上限 <b>${r.ceiling.toFixed(2)}</b></span>` +
      `<span>期望达成度 <b>${(r.achieve * 100).toFixed(1)}%</b></span>`));
    if (row.all.length > 1) {
      row.all.slice(0, 8).forEach(t => {
        const kindLabel = (REMODEL_KINDS.find(kd => kd.key === t.kind) || {}).label || "宿主";
        const line = el("div", "rm-all-row");
        line.innerHTML =
          `<span class="ra-name"><i class="rm-case">${kindLabel}·</i>${esc(t.role.name)}</span>` +
          `<span class="ra-rv ${t.r.rv >= 0 ? "diff-pos" : "diff-neg"}">${t.r.rv >= 0 ? "+" : ""}${t.r.rv.toFixed(2)}</span>` +
          `<span class="ra-flow">${t.r.currentScore.toFixed(2)} → ${t.r.eRemodel.toFixed(2)}</span>`;
        makeActivatable(line.querySelector(".ra-name"), () => {
          view = { type: "detail", roleId: t.role.id };
          render();
        }, `查看 ${t.role.name} 详情`);
        det.appendChild(line);
      });
      if (row.all.length > 8) {
        det.appendChild(el("div", "rm-all-row rm-more",
          `<span class="ra-name"></span><span>…其余 ${row.all.length - 8} 个对象 RV 更低</span>`));
      }
    }
    det.title = "保底线 = 最坏分配下的确定性下限；组合上限由词条组合唯一决定，重塑无法突破（托底不抬天花板）";
    card.appendChild(det);

    // 会话内移除（仅新录入件）
    if (!row.sourceRole) {
      const rm = el("button", "btn btn-sm rm-del", ico("close") + "移除");
      rm.title = "从重塑分析列表移除该新录入件";
      rm.addEventListener("click", () => {
        remodelTempList = remodelTempList.filter(a => a.id !== art.id);
        render();
      });
      card.appendChild(rm);
    }
    return card;
  }

  /** 独立视图：圣遗物重塑分析（顶栏「重塑分析」入口）—— 扫描全部角色满级件 + 会话内新录入件 */
  function renderRemodelView() {
    const wrap = el("div");
    const roles = store.getRoles();
    const head = el("div", "detail-head");
    head.appendChild(el("div", "detail-title", "圣遗物重塑分析"));
    const btnRmNew = el("button", "btn btn-primary", ico("plus") + "录入新圣遗物");   // R12：统一置于标题最右
    btnRmNew.title = "录入满级新圣遗物加入本次分析（会话内有效，不写入角色）";
    btnRmNew.addEventListener("click", () => openArtifactModal(null, null, "remodel"));
    head.appendChild(btnRmNew);
    wrap.appendChild(head);
    // 说明置于标题下（R13：与评估/藏品两页一致）
    wrap.appendChild(el("div", "info page-info",
      "RV = 重塑后期望分 − 功能位现状分，> 0 表示值得花尘尝试（期望 ≠ 保证，结果可预览）。三情况开关任意组合，关闭的类型不参与评估；散件不评自身，新录入件按游离件评估。"));

    if (roles.length === 0) {
      const empty = el("div", "empty",
        '<div class="icon" aria-hidden="true">' + ico("remodel") + '</div>' +
        '<div class="empty-title">还没有角色数据</div>' +
        '<div class="empty-desc">重塑分析基于角色配置（有效词条与权值）判断哪些满级圣遗物值得消耗启圣之尘重塑。请先创建角色或导入数据。</div>');
      const btn = el("button", "btn btn-primary", ico("plus") + "新建角色");
      btn.addEventListener("click", createRoleFlow);
      empty.appendChild(btn);
      wrap.appendChild(empty);
      return wrap;
    }

    // 控制栏：保底档位切换 + 录入新件 + 三情况开关（原地强化/同套转移/晋升套装件） + 显示无价值件
    const ctrl = el("div", "filter-bar");
    const lblK = el("span", "filter-lbl", "保底档位");
    const kSel = el("select");
    kSel.title = "主排序用基础档（保守，不依赖账号圣言解明进度）；高阶/谕告档为攒满进度后的保底视角";
    kSel.innerHTML =
      `<option value="2">基础（保底 2 次）</option>` +
      `<option value="3">高阶（保底 3 次）</option>` +
      `<option value="4">谕告（保底 4 次）</option>`;
    kSel.value = String(remodelK);
    kSel.addEventListener("change", e => { remodelK = parseInt(e.target.value, 10) || 2; render(); });
    // 三情况开关：关闭的类型不参与评估，每件在开启范围内重新取 RV 最优行动（会话内状态，不落盘）
    const kindLbl = el("span", "filter-lbl", "情况");
    const kindToggles = REMODEL_KINDS.map(kd => {
      const lbl = el("label", "rm-kind",
        `<input type="checkbox" ${remodelKinds[kd.key] ? "checked" : ""}> ${kd.label}`);
      lbl.title = kd.key === "self"
        ? "套装件评自己：原地强化（现状分 = 自身评分）"
        : kd.key === "transfer"
          ? "套装件顶替「装备同套装且有同部位同主属性件」宿主的现有件"
          : "散件（含新录入游离件）转移给装备其所属套装的宿主，凑更高件数套装";
      lbl.querySelector("input").addEventListener("change", e => {
        remodelKinds[kd.key] = e.target.checked; render();
      });
      return lbl;
    });
    const showAllLbl = el("label", "rm-showall",
      `<input type="checkbox" ${remodelShowAll ? "checked" : ""}> 显示无价值件`);
    showAllLbl.querySelector("input").addEventListener("change", e => {
      remodelShowAll = e.target.checked; render();
    });
    ctrl.append(lblK, kSel, kindLbl, ...kindToggles, showAllLbl);
    wrap.appendChild(ctrl);

    // 候选 = 会话内新录入件（优先）+ 藏品件 + 全角色已穿戴满级件（按签名去重）
    // 藏品件按「游离件」（sourceRole = null）参与：只能作为套装件转移给宿主（情况三 promote），
    // 权值取宿主角色 —— 与「新录入游离件」完全同口径（详见《圣遗物网页实现方案.md》§七）。
    const allCands = [];
    const seenSig = new Set();
    let collCandCount = 0;
    remodelTempList.forEach(a => {
      const sig = core.remodelSignature(a);
      if (!seenSig.has(sig)) { seenSig.add(sig); allCands.push({ artifact: a, sourceRole: null, signature: sig }); }
    });
    store.getCollection().forEach(a => {
      const sig = core.remodelSignature(a);
      if (!seenSig.has(sig)) { seenSig.add(sig); allCands.push({ artifact: a, sourceRole: null, signature: sig }); collCandCount++; }
    });
    core.collectRemodelCandidates(roles).forEach(c => {
      if (!seenSig.has(c.signature)) { seenSig.add(c.signature); allCands.push(c); }
    });

    const kindsOn = REMODEL_KINDS.filter(kd => remodelKinds[kd.key]).map(kd => kd.key);
    const rows = kindsOn.length
      ? core.analyzeRemodel(allCands, roles, remodelK,
          c => { const inf = core.inferInitialCount(c.artifact); return inf ?? remodelInitOverride.get(c.signature) ?? 4; }, kindsOn)
      : [];
    const worth = rows.filter(x => x.best.r.rv > 0);
    const excluded = kindsOn.length ? allCands.length - rows.length : 0;

    const sum = el("div", "eval-summary " + (worth.length ? "valuable" : "no-case"));
    sum.innerHTML = kindsOn.length
      ? ico("check") + `扫描 ${allCands.length} 件满级圣遗物（含新录入 ${remodelTempList.length} 件${collCandCount ? ` · 藏品 ${collCandCount} 件` : ""}）：${worth.length} 件有重塑价值（RV > 0）` +
        (excluded ? `；${excluded} 件无可评估对象未列入（散件/藏品无宿主等）` : "")
      : ico("warn") + "三种情况类型均已关闭：无行动可评估，请至少开启一种（原地强化 / 同套转移 / 晋升套装件）。";
    wrap.appendChild(sum);

    const shown = remodelShowAll ? rows : worth;
    if (!shown.length) {
      wrap.appendChild(el("div", "empty",
        '<div class="icon" aria-hidden="true">' + ico("sparkles") + '</div>' +
        '<div class="empty-title">暂无有重塑价值的圣遗物</div>' +
        '<div class="empty-desc">RV ≤ 0 表示当前分配已接近该组合的重塑期望（托底不抬天花板）。可勾选「显示无价值件」查看全部，或录入新圣遗物。</div>'));
    } else {
      shown.forEach(row => wrap.appendChild(buildRemodelCard(row)));
    }
    return wrap;
  }

  // ============ 藏品库（未装备圣遗物的极限单件收藏，2026-10-11）============
  // 详见《圣遗物网页实现方案.md》§七「藏品库」。桶 = 部位+主词条（26 个）；维度 6 个；一件藏品可同时占多个位。

  /** 维度值格式化：百分比维补 %；保留 1 位小数 */
  function collVal(v, unit) {
    if (!Number.isFinite(v)) return "-";
    return (Math.round(v * 10) / 10).toString() + (unit || "");
  }

  /**
   * 极限程度（当前值 ÷ 理论满值）→ 进度条 + 百分比（条与数字均带悬停提示）。
   * @param ratio 0~1（越界自动截断）；@param tip 可选自定义提示，缺省「占理论满值 X%」（藏品页沿用缺省）
   */
  function collRatioBar(ratio, tip) {
    const pct = Math.max(0, Math.min(1, ratio || 0)) * 100;
    const title = esc(tip || `占理论满值 ${pct.toFixed(1)}%`);
    return `<span class="coll-bar" title="${title}"><i style="width:${pct.toFixed(1)}%"></i></span>` +
      `<span class="coll-pct" title="${title}">${pct.toFixed(1)}%</span>`;
  }

  /**
   * 藏品件摘要：套装 · Lv · 副词条（一行）。主词条由表格首列（rowspan 合并单元格）承担。
   * @param dimKey 该行对应的维度 —— 命中该维度的副词条高亮，一眼看出「这件靠什么成为极限」。
   */
  function collItemSummary(art, dimKey) {
    if (!art) return "";
    const hot = (C.COLLECTION_DIM_BY_KEY[dimKey] || {}).stats || [];
    // 副词条按固定词条序排列（SUB_STATS）——各行同一位置是同种词条，跨行可横向对照
    const rank = st => { const i = C.SUB_STATS.indexOf(st); return i < 0 ? 99 : i; };
    const plain = [];
    const subs = (art.substats || []).slice()
      .sort((a, b) => rank(a.stat) - rank(b.stat))
      .map(s => {
        const txt = `${C.MAIN_SHORT[s.stat] || s.stat} ${s.value}${C.STAT_TYPE[s.stat] === "percent" ? "%" : ""}${s.activated === false ? "(待激活)" : ""}`;
        plain.push(txt);
        return hot.includes(s.stat)
          ? `<b class="coll-hot">${esc(txt)}</b>`
          : `<span class="coll-cold">${esc(txt)}</span>`;
      }).join("");
    return `<span class="coll-set" title="${esc(art.set || "")}">${esc(art.set || "（未填套装）")}</span>` +
      `<span class="coll-lv">Lv.${art.level}</span>` +
      `<span class="coll-subs" title="${esc(plain.join(" · "))}">${subs}</span>`;
  }

  /**
   * 藏品视角面板（评估弹窗 / 独立评估页共用）：功能 (a) 入藏判定 / (c) 极限程度 / (d) 潜力。
   * 功能 (b) 择优 = 入库后由 store 自动删除「被完全取代」的旧件。
   */
  function buildCollectionPanel(art) {
    const box = el("div", "eval-case coll-panel");
    const res = core.analyzeCollection(art, store.getCollection());
    if (!res.inScope) {
      box.innerHTML = `<div class="c-head"><span class="c-title">藏品视角</span></div>` +
        `<div class="info">该件（${esc(C.SLOTS[art.slot].name)} · ${esc(art.mainStat || "主词条未填")}）不在藏品收藏范围内` +
        `（未列入 26 个收藏桶），故不参与藏品比对。</div>`;
      return box;
    }
    const hit = res.rows.filter(r => r.verdict === "better" || r.verdict === "new").length;
    // 2026-10-13（用户要求）：只显示「有可能超过现有藏品」的维度——当前可入藏（new/better）或潜力可超（canExceed），
    // 其余隐藏且不提示。行 = 维度 | 藏品值 | 新件值 | 满级最值 | 止损容错 | 极限度合并条
    //（止损列可能整列不存在——见下方 hasTol；其余值 3 项 + 容错 + 合并条，2026-10-13 用户要求）。
    const visible = res.rows.filter(r => r.verdict === "new" || r.verdict === "better" || r.canExceed);
    // 止损容错列整列显隐（2026-10-17 B，用户要求）：该列只为「未超过、但满级可超」的维度提供信息
    //（tolerance 仅 worse && canExceed 行非 null）。满级件 rem = 0 → potential ≡ value → canExceed
    // 恒 false → 整列 100% 是「—」（无信息量，用户反馈「横线没什么意义」）；未满级件若可见行全是
    // new / better（已可入藏，不涉及追赶）同样整列为空，一并隐藏。
    // ⚠ 必须**整列**显隐、不能按行隐藏：每行是独立 flex + space-between、不共享轨道，
    //   缺一格会让后面的合并条起点逐行漂移（同 §8.30「auto 列致对照条漂移」的坑）。
    //   列存在时，new / better 行的「—」保留作对齐占位。
    const hasTol = visible.some(r => r.tolerance != null);
    // 头部徽章三档（2026-10-13 用户要求）：可入藏 N 项（当前有位可占）/ 满级可期（当前无位、但有维度满级后可超）/ 不可入藏（完全无机会）
    const badgeHtml = hit
      ? `<span class="badge badge-green">可入藏 ${hit} 项</span>`
      : (visible.length
        ? `<span class="badge badge-yellow">满级可期</span>`
        : `<span class="badge badge-gray">不可入藏</span>`);
    const listHtml = visible.length
      ? `<div class="coll-rows">` + visible.map(r => {
        // 值组带单位（量纲随词条）；每格 title 悬停显示含义（2026-10-13）
        // 止损容错列（2026-10-13 用户要求）位于值组与极限度合并条之间：
        //   「还可歪 N 次」= 再有 N 次「没加到该维度」仍可在满级时追上；歪满 (N+1) 次即无望（剩余全中满值也超不了）。
        //   「不能歪」= 必须全中；better / new 行（该维度已可直接入藏）不涉及追赶 → 该格「—」。
        //   整列无值时不渲染（hasTol，见上），此时行少一格、合并条随 space-between 前移。
        const L = r.label;
        const curTxt = r.cur == null ? '<span class="coll-empty">未收藏</span>' : collVal(r.cur, r.unit);
        const curTip = r.cur == null
          ? `藏品库「${L}」位未收藏`
          : `藏品值 ${collVal(r.cur, r.unit)} · 藏品库「${L}」位当前持有值`;
        const newTip = `新件值 ${collVal(r.value, r.unit)} · 该件当前的「${L}」值`;
        const maxTip = `满级最值 ${collVal(r.potential, r.unit)} · 该件强化满级后的上限值（乐观）`;
        // 极限度合并条（2026-10-14 五版，用户设计）：一根条、两段色——金段 = 目前（藏品极限度）、
        // 绿段 = 满级预期增量；条左右分别为「藏品%」「满级最值%」数字（固定 48px 右/左对齐 → 跨行严格对齐）。
        // 均 ÷ 理论满值、clamp 0~100；visible 行（worse&&canExceed / better）恒有 potential > cur → 绿段 > 0。
        const pctClamp = x => Math.max(0, Math.min(1, isFinite(x) ? x : 0)) * 100;
        const curPct = r.cur == null ? null : pctClamp(r.cur / r.full);
        const maxPct = pctClamp(r.potential / r.full);
        const curPctTxt = curPct == null ? "—" : curPct.toFixed(1) + "%";
        const maxPctTxt = maxPct.toFixed(1) + "%";
        const curPctTip = r.cur == null
          ? `藏品库「${L}」位未收藏，无极限度`
          : `藏品极限度 ${curPctTxt} · 藏品值 ${collVal(r.cur, "")} ÷ 理论满值 ${collVal(r.full, "")}`;
        const maxPctTip = `满级最值极限度 ${maxPctTxt} · 满级最值 ${collVal(r.potential, "")} ÷ 理论满值 ${collVal(r.full, "")}`;
        const barTip = `极限度对照：藏品 ${curPctTxt} → 满级最值 ${maxPctTxt}（均 ÷ 理论满值 ${collVal(r.full, "")}；金色段 = 目前、绿色段 = 满级预期的增量）`;
        const segA = curPct == null ? 0 : curPct;             // 金段宽（目前）
        const segB = Math.max(0, maxPct - segA);              // 绿段宽（满级预期增量）
        const pctsHtml =
          `<span class="coll-pcts">` +
          `<span class="coll-pct coll-pct-cur" title="${esc(curPctTip)}">${curPctTxt}</span>` +
          `<span class="coll-bar" title="${esc(barTip)}">` +
          `<i class="seg-cur" style="left:0;width:${segA.toFixed(1)}%"></i>` +
          `<i class="seg-pot" style="left:${segA.toFixed(1)}%;width:${segB.toFixed(1)}%"></i>` +
          `</span>` +
          `<span class="coll-pct coll-pct-max" title="${esc(maxPctTip)}">${maxPctTxt}</span>` +
          `</span>`;
        let tolHtml = "";
        if (hasTol) {
          const tolTxt = r.tolerance == null
            ? "—"
            : (r.tolerance > 0 ? `还可歪 ${r.tolerance} 次` : "不能歪");
          const tolTip = r.tolerance == null
            ? "该维度已可直接入藏，不涉及止损追赶"
            : (r.tolerance > 0
              ? `止损容错：还需命中 ${r.need} 次才能超过藏品（${collVal(r.cur, "")}）· 最多还能歪 ${r.tolerance} 次；歪满 ${r.tolerance + 1} 次后即无望（剩余全中满值也追不上）`
              : `止损容错：还需命中 ${r.need} 次才能超过藏品（${collVal(r.cur, "")}）· 一次都不能歪；再歪 1 次即无望（剩余全中满值也追不上）`);
          const tolCls = r.tolerance == null ? " none" : (r.tolerance === 0 ? " tight" : "");   // 三态：常规（黄）/ tight（仅标记类，与常规完全同款）/ none（灰）
          tolHtml = `<span class="coll-tol${tolCls}" title="${esc(tolTip)}">${tolTxt}</span>`;
        }
        return `<div class="coll-row">` +
          `<span class="coll-dim">${esc(L)}</span>` +
          `<span class="coll-cur" title="${esc(curTip)}">${curTxt}</span>` +
          `<span class="coll-new ${r.verdict === "worse" ? "diff-neg" : "diff-pos"}" title="${esc(newTip)}">${collVal(r.value, r.unit)}</span>` +
          `<span class="coll-max" title="${esc(maxTip)}">${collVal(r.potential, r.unit)}</span>` +
          tolHtml +
          pctsHtml +
          `</div>`;
      }).join("") + `</div>`
      : "";
    // 头部结构（2026-10-17 A，用户要求）：标题 | [徽章 + 存入按钮] 一组靠右。
    // 按钮原为 appendChild 到面板末尾的下一个块级子节点（仅 margin-top:10px）→ 独占一行、
    // 左对齐、下方空无一物，用户反馈「突兀和浪费」（实测占 34px / 面板高 137 → 103）。
    // 头部空间充裕（1440 独立页余 914px、640 弹窗余 352px，按钮 87+8），零溢出风险。
    const btnHtml = hit
      ? `<button type="button" class="btn btn-primary btn-sm coll-add">存入藏品库</button>`
      : "";
    box.innerHTML =
      `<div class="c-head"><span class="c-title">藏品视角（${esc(res.bucket.name)}）</span>` +
      `<span class="coll-head-right">${badgeHtml}${btnHtml}</span>` +
      `</div>` +
      listHtml;

    const addBtn = box.querySelector(".coll-add");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        const rec = collRecordWon(art);   // 新纪录（R7）：入藏前判定刷新了哪些位
        const r = store.addCollectionItem(art);
        const removed = ((r && r.removed) || []).length;
        pendingArtifact = null;
        closeModal();
        if (view.type === "evaluate") render();
        else { view = { type: "collection" }; render(); }
        feedback.toast("已存入藏品库" + (removed ? `；${removed} 件旧藏品被完全取代，已移除` : "") +
          (rec ? `；刷新 ${rec.n} 项纪录` : ""), "success");
      });
    }
    return box;
  }

  /** 藏品页：按部位 → 桶 → 维度，展示每位「当前持有件」与极限程度（严格四列对齐） */
  function renderCollectionView() {
    const wrap = el("div");
    const collection = store.getCollection();
    const { holders } = core.collectionIndex(collection);
    const head = el("div", "detail-head");
    head.appendChild(el("div", "detail-title", "圣遗物藏品"));
    const btnCollNew = el("button", "btn btn-primary", ico("plus") + "录入藏品");   // R12：统一置于标题最右
    btnCollNew.addEventListener("click", () => openArtifactModal(null, null, "collection"));
    head.appendChild(btnCollNew);
    wrap.appendChild(head);
    // （R8 移除：藏品进度读数条——按用户反馈删除）
    wrap.appendChild(el("div", "info page-info",
      "藏品库保存未装备给任何角色的圣遗物：按「部位 + 主词条」分桶，每个桶内按 6 个维度各收藏一件最大值。" +
      "藏品件不参与角色评分，但会参与价值评估的「藏品视角」与重塑分析。"));

    // （R13 移除：部位跳转按钮组——矩阵已带部位列头，且矩阵格子可点击跳转对应桶）

    // （collection / holders 已在上方计算，进度条与矩阵共用）

    // 藏品版图矩阵（R3）：26 桶 × 95 位总览——色深 = 极限度、描边 = 未收藏；点击跳转对应桶
    const mWrap = el("div", "coll-matrix");
    {
      let totalPos = 0;
      C.COLLECTION_BUCKETS.forEach(b => { totalPos += C.collectionBucketDims(b).length; });
      const groups = C.SLOT_KEYS.map(slot => ({
        label: C.SLOTS[slot].short,   // 列头（R13）：花/羽/沙/杯/头，与左侧维度行构成二维表
        cols: C.COLLECTION_BUCKETS.filter(b => b.slot === slot).map(b => {
          const dims = C.collectionBucketDims(b);
          return C.COLLECTION_DIMS.map(dim => {
            if (!dims.includes(dim.key)) return null;   // 该桶无此维度（void 格）
            const h = holders.get(b.key + "|" + dim.key) || null;
            const full = C.collectionFull(dim.key, b.mainStat);
            const pct = h ? Math.min(100, h.value / full * 100) : 0;
            return {
              key: b.key, hold: !!h, fill: pct,
              tip: `${b.name} · ${dim.label}：` + (h ? `${collVal(h.value, dim.unit)}（极限度 ${pct.toFixed(1)}%）` : "未收藏") + " · 点击跳转"
            };
          });
        })
      })).filter(g => g.cols.length);
      mWrap.innerHTML = `<div class="cm-title">藏品版图 · ${C.COLLECTION_BUCKETS.length} 桶 / ${totalPos} 位（色深 = 极限度；描边 = 未收藏，点击跳转）</div>` +
        `<div class="cm-body">${charts.heatGrid(C.COLLECTION_DIMS.map(d => d.label), groups)}</div>`;
      mWrap.addEventListener("click", e => {
        const cell = e.target.closest(".cm-cell[data-bucket]");
        if (!cell) return;
        const row = document.querySelector(`.coll-row[data-bucket="${cell.dataset.bucket}"]`);
        const target = row && (row.closest(".coll-bucket") || row);
        if (target) { target.scrollIntoView({ block: "start" }); window.scrollBy(0, -72); }
      });
      wrap.appendChild(mWrap);
    }

    C.SLOT_KEYS.forEach(slot => {
      const buckets = C.COLLECTION_BUCKETS.filter(b => b.slot === slot);
      if (!buckets.length) return;
      const sec = el("div", "coll-slot");
      sec.dataset.slot = slot;
      sec.appendChild(el("div", "coll-slot-title", ico("slot-" + slot) + C.SLOTS[slot].name));
      // 桶卡片 + 四列行（维度 | 值 | 极限度 | 持有件）——回退合并单元格方案
      buckets.forEach(b => {
        const dims = C.collectionBucketDims(b);
        const card = el("div", "coll-bucket");
        const bTitle = el("div", "coll-bucket-title", esc(b.name));
        if (collRecordBuckets.has(b.key)) bTitle.appendChild(el("span", "badge badge-record", "新纪录"));
        card.appendChild(bTitle);
        const rows = el("div", "coll-rows");
        dims.forEach(dimKey => {
          const dim = C.COLLECTION_DIM_BY_KEY[dimKey];
          const h = holders.get(b.key + "|" + dimKey) || null;
          const full = C.collectionFull(dimKey, b.mainStat);
          const row = el("div", "coll-row" + (h ? "" : " empty"));
          row.dataset.bucket = b.key;   // 供测试 / 调试定位该行属于哪个桶
          row.innerHTML =
            `<span class="coll-dim">${esc(dim.label)}</span>` +
            `<span class="coll-val">${h ? collVal(h.value, dim.unit) : "—"}</span>` +
            `<span class="coll-ex">${h ? collRatioBar(h.value / full) : ""}</span>` +
            `<span class="coll-item">${h ? collItemSummary(h.arts[0], dimKey) : '<span class="coll-empty">未收藏</span>'}</span>`;
          if (h) {
            row.dataset.cid = h.arts[0].id;
            row.title = "点击编辑这件藏品";
            row.tabIndex = 0;                       // 键盘可达（2026-10-15 批次 3）
            row.setAttribute("role", "button");
            row.setAttribute("aria-label", "编辑该件藏品");
          }
          rows.appendChild(row);
        });
        card.appendChild(rows);
        sec.appendChild(card);
      });
      // 事件委托：每个部位区块只挂 1 组监听（click + keydown），避免 95×4 个监听器
      const openCollRow = row => {
        if (!row) return;
        const item = store.getCollection().find(i => i.id === row.dataset.cid);
        if (item) openArtifactModal(null, null, "collectionEdit", item);
      };
      sec.addEventListener("click", e => openCollRow(e.target.closest("[data-cid]")));
      sec.addEventListener("keydown", e => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const row = e.target.closest("[data-cid]");
        if (row) { e.preventDefault(); openCollRow(row); }
      });
      wrap.appendChild(sec);
    });
    return wrap;
  }

  // ============ 角色配置弹窗 ============
  function openRoleConfigModal(role) {
    // 深拷贝：弹窗内的编辑（有效词条 chip 点击、权值输入即时写；名称/套装/充能保存时才读）
    // 一律作用在副本上，只有「保存」才经 store.updateRole 写回。否则点过 chip 再「取消」，
    // 内存中的角色对象已被改动（localStorage 尚未变），并在之后任意一次 save() 时被静默落盘（2026-10-09 修）。
    role = JSON.parse(JSON.stringify(role));
    const body = el("div");
    const fName = el("div", "field", `<label>角色名</label><input id="cName" value="${esc(role.name)}">`);
    const fEle = el("div", "field");
    // 元素下拉：默认选中 role.element；为空时按角色名映射自动预选（保存后落盘）
    const eleCur = role.element || C.CHARACTER_ELEMENT_HINTS[role.name] || "";
    fEle.innerHTML = `<label>元素（显示在角色名左侧）</label><select id="cEle">` +
      `<option value="" ${!eleCur ? "selected" : ""}>（未选择）</option>` +
      C.ELEMENT_KEYS.map(k => `<option value="${k}" ${eleCur === k ? "selected" : ""}>${k}</option>`).join("") +
      `</select>`;
    const fLoose = el("div", "field");
    let looseOpts = `<option value="" ${!role.looseSlot ? "selected" : ""}>（无散件 / 全套装）</option>` +
      C.SLOT_KEYS.map(k =>
        `<option value="${k}" ${role.looseSlot === k ? "selected" : ""}>${C.SLOTS[k].name}</option>`).join("");
    fLoose.innerHTML = `<label>散件部位（5 件全套装可选「无散件」，此时按自由位自动评估）</label><select id="cLoose">${looseOpts}</select>`;

    // 角色所穿套装（2026-10-09）：两个下拉 —— 恰填 1 个＝四件套（4+1）；填 2 个＝两个两件套（2+2+1）；
    // 都留空＝其他（不判套装：不做套装类评估结论，首页「按角色」筛选也不命中）
    const curSets = Array.isArray(role.sets) ? role.sets.filter(s => typeof s === "string" && s) : [];
    const setCandidates = [];
    (store.getCustomSets() || []).forEach(s => { if (s && !setCandidates.includes(s)) setCandidates.push(s); });
    C.SETS.forEach(s => { if (!setCandidates.includes(s)) setCandidates.push(s); });
    curSets.forEach(s => { if (!setCandidates.includes(s)) setCandidates.push(s); });   // 已填的自定义套装保证可回显
    const setOpts = sel => '<option value="">（未选择）</option>' +
      setCandidates.map(s => `<option value="${esc(s)}" ${sel === s ? "selected" : ""}>${esc(s)}</option>`).join("");
    const fSets = el("div", "field");
    fSets.innerHTML = `<label>角色所穿套装（填 1 个＝四件套；填 2 个＝两个两件套；都留空＝其他，不判套装）</label>` +
      `<div class="form-row">` +
      `<select id="cSet1">${setOpts(curSets[0] || "")}</select>` +
      `<select id="cSet2">${setOpts(curSets[1] || "")}</select>` +
      `</div>`;

    const fEr = el("div", "form-row",
      `<div class="field"><label>充能需求 (%)</label><input id="cEr" type="number" min="100" value="${isFinite(role.erRequirement) ? role.erRequirement : ""}"></div>` +
      `<div class="field"><label>当前面板充能 (%)</label><input id="cER" type="number" min="100" value="${isFinite(role.currentER) ? role.currentER : ""}"></div>`);

    const fEff = el("div", "field");
    fEff.innerHTML = "<label>有效词条（点击选择）</label><div class='chips' id='cChips'></div>";
    body.append(fName, fEle, fSets, fLoose, fEr, fEff);

    const weightsBox = el("div", "field");
    body.appendChild(weightsBox);
    const wBox = el("div");
    weightsBox.innerHTML = "<label>词条权值</label>";
    weightsBox.appendChild(wBox);

    function renderChips() {
      const box = fEff.querySelector("#cChips");
      box.innerHTML = "";
      C.SUB_STATS.forEach(st => {
        const chip = el("span", "chip" + (role.effectiveStats.includes(st) ? " on" : ""), esc(st));
        chip.addEventListener("click", () => {
          const idx = role.effectiveStats.indexOf(st);
          if (idx >= 0) role.effectiveStats.splice(idx, 1);
          else role.effectiveStats.push(st);
          renderChips();
          renderWeights();
          updateErFields();   // 充能有效性变化 → 联动充能输入框
        });
        box.appendChild(chip);
      });
    }
    // 充能字段联动：仅当「元素充能效率」为有效词条时可编辑；勾选时若为空自动填 180，取消勾选清空并禁用
    function updateErFields() {
      const on = role.effectiveStats.includes("元素充能效率");
      const i1 = fEr.querySelector("#cEr"), i2 = fEr.querySelector("#cER");
      i1.disabled = !on; i2.disabled = !on;
      if (on) {
        if (i1.value === "") i1.value = 180;
        if (i2.value === "") i2.value = 180;
      } else {
        i1.value = ""; i2.value = "";
      }
    }
    function renderWeights() {
      wBox.innerHTML = "";
      role.effectiveStats.forEach(st => {
        // 初始化默认权值 1（未设置时写入，避免保存时缺失）
        if (typeof role.weights[st] !== "number" || !isFinite(role.weights[st])) role.weights[st] = 1;
        const f = el("div", "field", `<label>${esc(st)} 权值</label>` +
          `<input type="number" step="0.1" min="0" max="1" value="${role.weights[st]}" data-stat="${esc(st)}">`);
        f.querySelector("input").addEventListener("input", e => {
          // R8：权值限 0~1（值模型即时夹取；校验域 0<w≤2 未动——定稿口径不变）
          const v = parseFloat(e.target.value);
          role.weights[st] = isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
        });
        wBox.appendChild(f);
      });
    }
    renderChips();
    renderWeights();
    updateErFields();   // 初始按「是否配置充能」设置充能输入框状态

    const foot = el("div");
    const btnCancel = el("button", "btn", "取消");
    const btnSave = el("button", "btn btn-primary", "保存");
    btnCancel.addEventListener("click", closeModal);
    btnSave.addEventListener("click", () => {
      role.name = fName.querySelector("#cName").value.trim();
      role.element = fEle.querySelector("#cEle").value || "";
      // 套装：选择项过滤空值后压缩（只填了第 2 个 → 自动提到第 1 个），最多两个
      role.sets = [fSets.querySelector("#cSet1").value, fSets.querySelector("#cSet2").value]
        .map(v => String(v || "").trim()).filter(Boolean).slice(0, 2);
      role.looseSlot = fLoose.querySelector("#cLoose").value || null;
      // 充能：仅当「元素充能效率」为有效词条时保存（否则存 null，算法自动不惩罚/不提示）
      if (hasER(role)) {
        role.erRequirement = parseFloat(fEr.querySelector("#cEr").value) || 180;
        role.currentER = parseFloat(fEr.querySelector("#cER").value) || 180;
      } else {
        role.erRequirement = null;
        role.currentER = null;
      }
      // 从表单统一收集权值（即使未触发 input 事件也生效）
      wBox.querySelectorAll("input").forEach(inp => {
        const st = inp.dataset.stat;
        if (st) {
          const v = parseFloat(inp.value);
          role.weights[st] = isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;   // R8：保存时同样夹取 0~1
        }
      });
      const r = data.validateRoleConfig(role);
      if (r.hard.length > 0) {
        feedback.info({
          title: "无法保存",
          type: "error",
          message: `<div class="err-box">请修正以下问题后重试：<ul>` +
            r.hard.map(e => `<li>${esc(e.msg)}</li>`).join("") + `</ul></div>`,
          confirmText: "知道了"
        });
        return;
      }
      const res = store.updateRole(role);
      if (res && res.error) {
        feedback.toast(res.error, "error");
        return;
      }
      closeModal();
      render();
    });
    foot.append(btnCancel, btnSave);
    openModal(`角色配置：${esc(role.name)}`, body, foot);
  }

  // ============ 导入 / 导出 ============
  /** 圣遗物文本特征检测（R5 粘贴即评估）：等级行 / 词条名+数值 / 部位名，≥2 项命中才算 */
  function detectArtifactText(text) {
    if (!text || text.length < 8) return false;
    const hasLevel = /\+\d{1,2}(?!\d)/.test(text);
    const hasStat = /(暴击率|暴击伤害|攻击力|生命值|防御力|元素精通|元素充能效率)[^\d%]{0,6}\d/.test(text);
    const hasSlot = /(生之花|死之羽|时之沙|空之杯|理之冠)/.test(text);
    return [hasLevel, hasStat, hasSlot].filter(Boolean).length >= 2;
  }

  /** 粘贴文本 → 圣遗物对象（R8）：解析 + 硬校验全过才返回；否则 null（转录入框修正） */
  function parsePastedArtifact(text) {
    let parsed;
    try { parsed = global.App.parser.parseArtifactText(text); } catch (e) { return null; }
    const art = parsed && parsed.result;
    if (!parsed || parsed.ok !== true || !art || !art.slot || !Array.isArray(art.substats)) return null;
    art.id = store.genId();
    // validateArtifact 返回错误数组（含 level: "hard"），并非 {hard, soft}
    const errors = data.validateArtifact(art);
    if (errors && errors.some(e => e.level === "hard")) return null;
    return art;
  }

  /** 进入价值评估并打开录入（R5：⌘K / 粘贴共用；R8：autoRecognize = 打开后自动点「识别」并预填） */
  function startAssessFlow(prefillText, autoRecognize) {
    view = { type: "evaluate", evalRoleId: store.getCurrentRole() ? store.getCurrentRole().id : null };
    render();
    openArtifactModal(store.getRoles()[0], null, "new");
    if (prefillText) {
      const ta = document.querySelector(".artifact-text");
      if (ta) ta.value = prefillText;
    }
    if (autoRecognize) {
      const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "识别");
      if (b) b.click();
    }
  }

  // ============ 指令面板（⌘K 快速跳转，R5）============
  let paletteRoot = null, paletteInput = null, paletteList = null, paletteItems = [], paletteIdx = 0, palettePrevFocus = null;

  /** 条目 = 操作 + 视图 + 角色（含元素图标）；输入实时过滤 */
  function paletteEntries() {
    const ops = [
      { group: "操作", label: "新建角色", hint: "创建并配置新角色", fn: () => createRoleFlow() },
      { group: "操作", label: "录入新圣遗物", hint: "进入价值评估并打开录入", fn: () => startAssessFlow() },
      { group: "操作", label: "导入数据", hint: "备份或外部数据", fn: () => $("#btnImport").click() },
      { group: "操作", label: "导出备份", hint: "下载完整数据备份", fn: () => $("#btnExport").click() },
      { group: "操作", label: "切换外观", hint: "深+金 ⇄ 浅+蓝", fn: () => $("#appearanceToggle").click() }
    ];
    const views = [
      { group: "视图", label: "角色列表", hint: "全部角色", fn: () => { view = { type: "list" }; render(); } },
      { group: "视图", label: "价值评估", hint: "对新件做全角色评估", fn: () => { view = { type: "evaluate", evalRoleId: store.getCurrentRole() ? store.getCurrentRole().id : null }; render(); } },
      { group: "视图", label: "重塑分析", hint: "判断满级件重塑价值", fn: () => { view = { type: "remodel" }; render(); } },
      { group: "视图", label: "藏品库", hint: "95 位收藏版图", fn: () => { view = { type: "collection" }; render(); } }
    ];
    // 最近访问优先（R7）：LRU 序在前，其余保持原顺序
    const recents = loadRecents();
    const recentIdx = name => { const i = recents.indexOf(name); return i < 0 ? 999 : i; };
    const roles = store.getRoles().slice()
      .sort((a, b) => recentIdx(a.name) - recentIdx(b.name))
      .map(r => ({
        group: "角色", label: r.name, hint: "",
        ele: r.element || C.CHARACTER_ELEMENT_HINTS[r.name] || "",
        fn: () => { view = { type: "detail", roleId: r.id }; render(); }
      }));
    const q = (paletteInput.value || "").trim().toLowerCase();
    let out = ops.concat(views, roles);
    if (q) out = out.filter(x => x.label.toLowerCase().includes(q) || (x.hint || "").toLowerCase().includes(q));
    return out.slice(0, 80);
  }

  function paintPaletteSel() {
    paletteList.querySelectorAll(".pk-item").forEach((row, i) => row.classList.toggle("on", i === paletteIdx));
  }
  function renderPaletteList() {
    paletteItems = paletteEntries();
    if (paletteIdx >= paletteItems.length) paletteIdx = 0;
    if (!paletteItems.length) { paletteList.innerHTML = '<div class="pk-empty">没有匹配项</div>'; return; }
    let last = "";
    paletteList.innerHTML = paletteItems.map((it, i) => {
      const head = it.group !== last ? '<div class="pk-group">' + it.group + "</div>" : "";
      last = it.group;
      const ic = it.ele ? elementIconHtml({ element: it.ele }) : "";
      return head +
        '<div class="pk-item' + (i === paletteIdx ? " on" : "") + '" data-i="' + i + '">' +
        '<span class="pk-label">' + ic + esc(it.label) + "</span>" +
        (it.hint ? '<span class="pk-hint">' + esc(it.hint) + "</span>" : "") +
        "</div>";
    }).join("");
  }
  function movePaletteSel(d) {
    if (!paletteItems.length) return;
    paletteIdx = (paletteIdx + d + paletteItems.length) % paletteItems.length;
    paintPaletteSel();
    const row = paletteList.querySelector('.pk-item[data-i="' + paletteIdx + '"]');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
  }
  function ensurePalette() {
    if (paletteRoot) return;
    paletteRoot = el("div", "palette-root hidden");
    paletteRoot.setAttribute("aria-hidden", "true");
    paletteRoot.innerHTML =
      '<div class="palette-scrim"></div>' +
      '<div class="palette" role="dialog" aria-modal="true" aria-label="快速跳转（指令面板）">' +
      '<input class="palette-input" type="text" placeholder="搜索角色 / 视图 / 操作…" aria-label="搜索角色、视图或操作">' +
      '<div class="palette-list"></div>' +
      "</div>";
    document.body.appendChild(paletteRoot);
    paletteInput = paletteRoot.querySelector(".palette-input");
    paletteList = paletteRoot.querySelector(".palette-list");
    paletteRoot.querySelector(".palette-scrim").addEventListener("click", closePalette);
    paletteInput.addEventListener("input", () => { paletteIdx = 0; renderPaletteList(); });
    paletteInput.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); movePaletteSel(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); movePaletteSel(-1); }
      else if (e.key === "Enter") { e.preventDefault(); const it = paletteItems[paletteIdx]; if (it) runPaletteItem(it); }
      else if (e.key === "Escape") { e.stopPropagation(); closePalette(); }
    });
    paletteList.addEventListener("click", e => {
      const row = e.target.closest(".pk-item");
      if (!row) return;
      const it = paletteItems[+row.dataset.i];
      if (it) runPaletteItem(it);
    });
    paletteList.addEventListener("mousemove", e => {
      const row = e.target.closest(".pk-item");
      if (!row) return;
      const i = +row.dataset.i;
      if (i !== paletteIdx) { paletteIdx = i; paintPaletteSel(); }
    });
  }
  function openPalette() {
    ensurePalette();
    palettePrevFocus = document.activeElement;
    paletteRoot.classList.remove("hidden");
    paletteRoot.setAttribute("aria-hidden", "false");
    paletteInput.value = "";
    paletteIdx = 0;
    renderPaletteList();
    paletteInput.focus();
  }
  function closePalette() {
    if (!paletteRoot || paletteRoot.classList.contains("hidden")) return;
    paletteRoot.classList.add("hidden");
    paletteRoot.setAttribute("aria-hidden", "true");
    if (palettePrevFocus && typeof palettePrevFocus.focus === "function") palettePrevFocus.focus();
  }
  function togglePalette() {
    if (paletteRoot && !paletteRoot.classList.contains("hidden")) closePalette();
    else openPalette();
  }
  function runPaletteItem(it) {
    closePalette();
    it.fn();
  }

  /** 导入预览摘要（R6）：按名字比对「新增 / 更新 / 无变化」+ 藏品件数（只读，不落盘） */
  function storeDiff(cur, inc) {
    const curMap = new Map(((cur && cur.roles) || []).map(r => [r.name, r]));
    let added = 0, updated = 0, same = 0;
    ((inc && inc.roles) || []).forEach(r => {
      const c = curMap.get(r.name);
      if (!c) { added++; return; }
      try { if (JSON.stringify(c) === JSON.stringify(r)) same++; else updated++; }
      catch (e) { updated++; }
    });
    return { added, updated, same, collCur: ((cur && cur.collection) || []).length, collInc: ((inc && inc.collection) || []).length };
  }

  // ============ hash 路由（R6）：视图 ⇄ 地址栏（详情按角色名；评估临时对象不进 hash）============
  function viewKeyOf(v) { return v.type === "detail" ? "detail|" + v.roleId : v.type; }
  function viewToHash() {
    if (view.type === "detail") {
      const r = store.getRole(view.roleId);
      return r ? "#/role/" + encodeURIComponent(r.name) : "#/";
    }
    if (view.type === "evaluate") return "#/eval";
    if (view.type === "remodel") return "#/remodel";
    if (view.type === "collection") return "#/collection";
    return "#/";
  }
  function hashToView() {
    const h = location.hash || "";
    if (h.indexOf("#/role/") === 0) {
      const name = decodeURIComponent(h.slice(7));
      const r = store.getRoles().find(x => x.name === name);
      return r ? { type: "detail", roleId: r.id } : { type: "list" };
    }
    if (h === "#/eval") return { type: "evaluate", evalRoleId: store.getCurrentRole() ? store.getCurrentRole().id : null };
    if (h === "#/remodel") return { type: "remodel" };
    if (h === "#/collection") return { type: "collection" };
    return { type: "list" };
  }

  // ============ 最近访问（R7）============

  // ⌘K 最近访问（R7）：角色名 LRU ≤20，独立 key（不入主 store）
  const RECENT_KEY = "gys_recent_roles_v1";
  function loadRecents() {
    try {
      const a = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(a) ? a.filter(x => typeof x === "string").slice(0, 20) : [];
    } catch (e) { return []; }
  }
  function pushRecent(name) {
    if (!name) return;
    try {
      const a = loadRecents().filter(x => x !== name);
      a.unshift(name);
      localStorage.setItem(RECENT_KEY, JSON.stringify(a.slice(0, 20)));
    } catch (e) { /* 静默 */ }
  }

  /** 新纪录判定（R7）：该件入藏后将刷新哪些位；返回 {n, bucketKey} 或 null（并登记桶标记） */
  function collRecordWon(art) {
    const res = core.analyzeCollection(art, store.getCollection());
    if (!res.inScope) return null;
    const n = res.rows.filter(r => r.verdict === "new" || r.verdict === "better").length;
    if (!n) return null;
    collRecordBuckets.add(res.bucket.key);
    return { n, bucketKey: res.bucket.key };
  }

  function setupIO() {
    // 「更多」菜单（2026-10-15 批次 5）：导入 / 导出收纳；点外 / Esc 关闭
    const moreWrap = document.querySelector(".more-wrap");
    const moreBtn = $("#btnMore");
    const moreDrop = $("#moreDropdown");
    const setMoreOpen = open => {
      moreDrop.classList.toggle("hidden", !open);
      moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    moreBtn.addEventListener("click", e => { e.stopPropagation(); setMoreOpen(moreDrop.classList.contains("hidden")); });
    document.addEventListener("click", e => { if (!moreWrap.contains(e.target)) setMoreOpen(false); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") setMoreOpen(false); });
    moreDrop.querySelectorAll(".more-item").forEach(b => b.addEventListener("click", () => setMoreOpen(false)));

    $("#btnExport").addEventListener("click", () => {
      const storeObj = store.getStore();
      if (storeObj.roles.length === 0) { feedback.toast("暂无数据可导出", "warn"); return; }
      const fname = global.App.io.exportBackup(storeObj);
      feedback.toast(`已导出：${fname}`, "success");
    });

    $("#btnImport").addEventListener("click", () => $("#importFile").click());
    $("#importFile").addEventListener("change", async e => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const res = await global.App.io.importFile(file);
        if (!res.ok) {
          let html = `<div class="err-box">${esc(res.message || "导入失败")}`;
          if (res.errors && res.errors.length) {
            html += `<ul>` + res.errors.slice(0, 20)
              .map(x => `<li>${esc(x.role)} - ${esc(x.field)}：${esc(x.msg)}</li>`).join("") + `</ul>`;
          }
          html += `</div>`;
          feedback.info({ title: "导入失败", type: "error", message: html });
          if (res.rawPreview) console.log("原始 JSON 结构预览：", res.rawPreview);
          return;
        }
        // 导入预览（R6）：先比对差异再落盘（覆盖 / 合并 / 放弃 三选一）
        const diff = storeDiff(store.getStore(), res.store);
        const mode = await feedback.confirm({
          title: "导入预览",
          message: `文件中 ${res.store.roles.length} 个角色（当前 ${store.getRoles().length} 个）：` +
            `新增 ${diff.added} · 更新 ${diff.updated} · 无变化 ${diff.same}；藏品 ${diff.collCur} → ${diff.collInc} 件。`,
          detail: "覆盖 = 用导入数据替换现有全部数据（当前不在文件中的角色将被移除）；合并 = 同名角色被文件覆盖、新角色追加、其余保留。",
          confirmText: "覆盖数据",
          cancelText: "合并数据"
        });
        if (mode == null) return;                    // Esc / 关闭 → 放弃导入
        const merged = global.App.io.mergeStore(store.getStore(), res.store, mode ? "overwrite" : "merge");
        store.replaceStore(merged);

        // 展示导入统计与警告（外部适配器元信息）
        let html = `<div class="info-success">导入成功（${merged.roles.length} 个角色`
          + `${merged.collection && merged.collection.length ? ` · 藏品 ${merged.collection.length} 件` : ""}）</div>`;
        const meta = res.meta;
        if (meta) {
          const lines = [];
          if (meta.equipped !== undefined) lines.push(`已导入 ${meta.equipped} 件已装备圣遗物`);
          if (meta.bag) lines.push(`备份中有 ${meta.bag} 件未装备圣遗物未自动导入；如需收藏，可在「藏品」页手动录入`);
          const warns = (meta.warnings || []).slice(0, 8);
          if (warns.length) lines.push("提示：\n" + warns.map(w => "· " + w).join("\n"));
          if (warns.length > 8) lines.push(`…另有 ${meta.warnings.length - 8} 条`);
          if (lines.length) html += `<div class="warn" style="margin-top:8px">${esc(lines.join("<br>"))}</div>`;
          html += `<div class="info" style="margin-top:8px">外部导入的角色未配置有效词条/权值，请进入「角色配置」补充后再查看评分。</div>`;
        } else if (res.adapterId === "backup_v1") {
          html += `<div class="info" style="margin-top:8px">（备份数据恢复）</div>`;
        }
        await feedback.info({ title: "导入完成", type: "info", message: html });
        render();
      } catch (err) {
        feedback.info({ title: "导入失败", type: "error", message: esc(err.message) });
      }
    });

    $("#btnNewRole").addEventListener("click", createRoleFlow);

    $("#btnEvaluate").addEventListener("click", () => {
      const cur = store.getCurrentRole();
      view = { type: "evaluate", evalRoleId: cur ? cur.id : null };
      render();
    });

    $("#btnRemodel").addEventListener("click", () => {
      view = { type: "remodel" };
      render();
    });

    $("#btnCollection").addEventListener("click", () => {
      view = { type: "collection" };
      render();
    });

    // 「/」聚焦首页搜索框（2026-10-15 批次 3；输入态中不劫持）
    document.addEventListener("keydown", e => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const box = document.querySelector(".search-box input");
      if (box) { e.preventDefault(); box.focus(); }
    });

    // ⌘K / Ctrl+K 指令面板（R5）
    document.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        togglePalette();
      }
    });
    // 全局 Esc 兜底关闭指令面板
    document.addEventListener("keydown", e => { if (e.key === "Escape") closePalette(); });

    // 粘贴即评估（R5 起；R9：仅「价值评估」页响应——其余页面零打扰）
    // 评估页内：解析 + 硬校验全过 → 直接开始评估；有误 → 打开录入框（预填 + 自动识别）
    document.addEventListener("paste", e => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (view.type !== "evaluate") return;
      const text = (e.clipboardData && e.clipboardData.getData("text")) || "";
      if (!detectArtifactText(text)) return;
      const art = parsePastedArtifact(text);
      if (art) {
        pendingArtifact = art;
        evalHidden.clear();
        render();
        feedback.toast("已按粘贴文本开始评估", "success");
      } else {
        startAssessFlow(text, true);
      }
    });

    // 防误触整页缩放（R11）：触控板双指缩放 / Ctrl+滚轮会触发浏览器级页面缩放——
    // 该缩放「刷新不回、需关闭标签重开才重置」（file:// 下），表现为「网页整体突然变小」。
    // 拦截 Ctrl+wheel（Chromium 把触控板 pinch 也上报为带 ctrlKey 的 wheel）；
    // 键盘 Ctrl+加减号 / Ctrl+0 不受影响（有意缩放仍可用）。
    window.addEventListener("wheel", e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

    // 底部 Tab（R5）：移动端主导航
    const tabbar = document.getElementById("tabbar");
    if (tabbar) {
      tabbar.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => {
        if (b.dataset.view === "evaluate") view = { type: "evaluate", evalRoleId: store.getCurrentRole() ? store.getCurrentRole().id : null };
        else view = { type: b.dataset.view };
        render();
      }));
    }
    // ⋯ 菜单内的「新建角色」（R5：移动端顶栏瘦身后的入口；菜单自动收起由既有绑定负责）
    const btnNewRoleM = $("#btnNewRoleM");
    if (btnNewRoleM) btnNewRoleM.addEventListener("click", createRoleFlow);

    // hash 路由（R6）：首屏按地址栏应用（刷新保位 / 深链）；浏览器后退 → 视图后退
    if (location.hash && location.hash !== "#/") view = hashToView();
    window.addEventListener("hashchange", () => {
      const v = hashToView();
      if (viewKeyOf(v) === viewKeyOf(view)) return;   // 自身写入触发 / 等价视图 → 不重渲染
      view = v;
      render();
    });

    $("#logoBtn").addEventListener("click", () => {
      view = { type: "list" };
      render();
    });
    // 品牌区键盘可达（回车 / 空格返回列表）
    $("#logoBtn").addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        view = { type: "list" };
        render();
      }
    });
  }

  global.App = global.App || {};
  global.App.ui = { render, setupIO, openRoleConfigModal, openArtifactModal, openEvaluateModal, renderCollectionView, buildCollectionPanel };
})(window);
