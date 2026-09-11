/**
 * ui.js - 视图层（对应《圣遗物网页实现方案.md》三、网页设计）
 * 四个视图：角色列表 / 角色详情 / 双模式录入弹窗 / 价值评估；导入导出。
 * 全局命名空间：App.ui
 */
(function (global) {
  "use strict";
  const C = global.App.constants;
  const store = global.App.store;
  const core = global.App.core;
  const data = global.App.data;
  const feedback = global.App.feedback;   // 反馈层：toast / confirm / prompt / info

  let view = { type: "list" };            // {type:'list'} | {type:'detail', roleId}
  // 首页筛选状态：独立于 view（切视图不丢失），并持久化到 localStorage（刷新/重开恢复上次筛选）
  let listFilter = (typeof global.App.storage.loadFilter === "function" && global.App.storage.loadFilter())
    || { slot: "", mainStat: "", sets: [] };
  const persistFilter = () => { try { global.App.storage.saveFilter(listFilter); } catch (e) { /* 静默 */ } };
  let pendingArtifact = null;             // 新圣遗物临时对象（评估用）
  let evalHidden = new Set();             // 评估会话内被手动移除的有提升角色 id（重新录入/放弃时清空）

  const $ = sel => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = n => (Number.isFinite(n) ? (Math.round(n * 100) / 100).toString() : "-");

  // 角色元素图标 HTML（优先级：role.element > 角色名映射；未配置返回空串）
  function elementIconHtml(role, extraCls) {
    const ele = (role && (role.element || C.CHARACTER_ELEMENT_HINTS[role.name])) || "";
    if (!ele || !C.ELEMENTS[ele]) return "";
    return `<img class="ele-icon${extraCls ? " " + extraCls : ""}" src="assets/elements/${C.ELEMENTS[ele]}" alt="${ele}" title="${ele}">`;
  }

  // 角色是否配置充能：有效词条含「元素充能效率」。不含充能时——充能需求/面板充能不适用（配置禁用），
  // 首页充能徽章与详情页充能信息块均隐藏（充能对评分无影响，避免误导）。
  function hasER(role) {
    return !!((role && role.effectiveStats) || []).includes("元素充能效率");
  }

  // ============ 渲染入口 ============
  function render() {
    const app = $("#app");
    app.innerHTML = "";
    const roles = store.getRoles();
    if (view.type === "detail") {
      const role = store.getRole(view.roleId);
      if (role) { app.appendChild(renderDetail(role)); return; }
      view = { type: "list" };
    }
    if (view.type === "evaluate") {
      app.appendChild(renderEvaluateView());
      return;
    }
    if (roles.length === 0) {
      const empty = el("div", "empty",
        '<div class="icon" aria-hidden="true">🏺</div>' +
        '<div class="empty-title">还没有角色数据</div>' +
        '<div class="empty-desc">创建你的第一个角色，录入圣遗物后即可查看评分；也可以从备份文件导入已有数据。</div>');
      const btnNew = el("button", "btn btn-primary", "＋ 新建角色");
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
    card.addEventListener("click", () => {
      view = { type: "detail", roleId: role.id };
      render();
    });
    return card;
  }

  function renderRoleList(roles) {
    const wrap = el("div");
    // 筛选状态：散件部位 / 主属性 / 套装多选（≥2 件命中视为套装，固定无件数选择；叠加 AND）
    // 状态存于模块级 listFilter（独立于 view），进详情/评估页返回后保持
    const f = listFilter;
    if (!Array.isArray(f.sets)) f.sets = [];
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

    // —— 筛选计算（部位/主属性/套装 三条件叠加 AND）——
    function computeFiltered() {
      return roles.filter(role => {
        if (f.slot && role.looseSlot !== f.slot) return false;
        if (f.mainStat) {
          if (f.slot) {
            const art = role.artifacts && role.artifacts[f.slot];
            return !!(art && art.mainStat === f.mainStat);
          }
          return C.SLOT_KEYS.some(s => role.artifacts[s] && role.artifacts[s].mainStat === f.mainStat);
        }
        if (f.sets.length) {
          // 套装判定：已录入圣遗物中套装 ∈ 所选集合的件数 ≥ 2（2 件套即算套装，固定阈值）
          const hit = C.SLOT_KEYS.filter(s => {
            const art = role.artifacts && role.artifacts[s];
            return !!(art && art.set && f.sets.includes(art.set));
          }).length;
          if (hit < 2) return false;
        }
        return true;
      });
    }

    // —— 筛选栏：散件部位 → 主属性 → 套装（下拉多选）→ 清除 ——
    const fBar = el("div", "filter-bar");
    const lblSlot = el("span", "filter-lbl", "散件部位");
    const slotSel = el("select");
    slotSel.innerHTML = '<option value="">全部</option>' + C.SLOT_KEYS.map(k =>
      `<option value="${k}" ${f.slot === k ? "selected" : ""}>${C.SLOTS[k].name}</option>`).join("");
    const lblStat = el("span", "filter-lbl", "主属性");
    const statSel = el("select");
    const statCandidates = f.slot ? (C.MAIN_STATS_BY_SLOT[f.slot] || []) : allMain;
    statSel.innerHTML = '<option value="">全部</option>' + statCandidates.map(s =>
      `<option value="${esc(s)}" ${f.mainStat === s ? "selected" : ""}>${esc(s)}</option>`).join("");
    const btnClear = el("button", "btn btn-sm", "✕ 清除");

    // —— 套装筛选（下拉多选面板：checkbox 列表；≥2 件视为套装，固定无件数选择）——
    const setBox = el("div", "set-filter");
    const setBtnText = () => f.sets.length
      ? `套装 ${f.sets.length}套 ▾`
      : "套装 ▾";
    const setBtn = el("button", "btn btn-sm set-btn", setBtnText());
    const panel = el("div", "set-dropdown hidden");
    const list = el("div", "set-list");
    allSets.forEach(name => {
      const lab = el("label", "set-item");
      lab.innerHTML = `<input type="checkbox" ${f.sets.includes(name) ? "checked" : ""}><span>${esc(name)}</span>`;
      lab.querySelector("input").addEventListener("change", e => {
        if (e.target.checked) { if (!f.sets.includes(name)) f.sets.push(name); }
        else f.sets = f.sets.filter(s => s !== name);
        setBtn.textContent = setBtnText();
        persistFilter();   // 持久化筛选状态（刷新/重开恢复）
        updateResults();   // 局部刷新，面板保持打开可连续勾选
      });
      list.appendChild(lab);
    });
    panel.appendChild(list);
    setBox.append(setBtn, panel);
    setBtn.addEventListener("click", e => {
      e.stopPropagation();
      panel.classList.toggle("hidden");
    });
    // 点击面板外关闭
    document.addEventListener("click", e => {
      if (!setBox.contains(e.target)) panel.classList.add("hidden");
    });

    slotSel.addEventListener("change", e => {
      listFilter.slot = e.target.value;
      const cands = listFilter.slot ? (C.MAIN_STATS_BY_SLOT[listFilter.slot] || []) : allMain;
      if (listFilter.mainStat && !cands.includes(listFilter.mainStat)) listFilter.mainStat = "";
      persistFilter();   // 持久化筛选状态（刷新/重开恢复）
      render();
    });
    statSel.addEventListener("change", e => {
      listFilter.mainStat = e.target.value;
      persistFilter();   // 持久化筛选状态（刷新/重开恢复）
      render();
    });
    btnClear.addEventListener("click", () => {
      listFilter = { slot: "", mainStat: "", sets: [] };
      persistFilter();   // 清除同样落盘，刷新后保持「全部」
      render();
    });
    fBar.append(lblSlot, slotSel, lblStat, statSel, setBox, btnClear);
    wrap.appendChild(fBar);

    // —— 结果区（信息 + 列表/空态），套装勾选时局部刷新 ——
    const infoEl = el("div", "filter-info");
    wrap.appendChild(infoEl);
    const listWrap = el("div");
    wrap.appendChild(listWrap);

    function updateResults() {
      const filtered = computeFiltered();
      const sorted = [...filtered].sort((a, b) =>
        core.calcCharacterScore(b).percent - core.calcCharacterScore(a).percent);
      const active = !!(f.slot || f.mainStat || f.sets.length);
      if (active) {
        infoEl.textContent = `筛选 ${filtered.length}/${roles.length} 个角色` +
          (f.slot ? ` · 散件·${C.SLOTS[f.slot].name}` : "") +
          (f.mainStat ? ` · ${f.mainStat}` : "") +
          (f.sets.length ? ` · 套装 ${f.sets.join("、")}（≥2件）` : "") +
          `，按分数降序`;
        infoEl.style.display = "";
      } else {
        infoEl.style.display = "none";
      }
      listWrap.innerHTML = "";
      if (sorted.length === 0) {
        const empty = el("div", "empty",
          '<div class="icon" aria-hidden="true">🔍</div>' +
          '<div class="empty-title">没有符合筛选条件的角色</div>' +
          '<div class="empty-desc">试试调整筛选条件，或清除筛选查看全部角色。</div>');
        const btnC = el("button", "btn", "✕ 清除筛选");
        btnC.addEventListener("click", () => {
          listFilter = { slot: "", mainStat: "", sets: [] };
          persistFilter();   // 清除同样落盘，刷新后保持「全部」
          render();
        });
        empty.appendChild(btnC);
        listWrap.appendChild(empty);
      } else {
        const list = el("div", "role-list");
        sorted.forEach(role => list.appendChild(buildRoleCard(role)));
        listWrap.appendChild(list);
      }
    }
    updateResults();
    return wrap;
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
    const btnBack = el("button", "btn btn-ghost", "← 返回");
    const btnEditCfg = el("button", "btn", "⚙ 角色配置");
    const btnEdit = el("button", "btn", "✎ 编辑");
    const btnNew = el("button", "btn btn-primary", "＋ 录入新圣遗物");
    const btnDelRole = el("button", "btn btn-danger", "🗑 删除");
    btnBack.title = "返回角色列表";
    btnDelRole.title = "删除该角色（不可恢复）";
    btnBack.addEventListener("click", () => { view = { type: "list" }; render(); });
    btnEditCfg.addEventListener("click", () => openRoleConfigModal(role));
    btnEdit.addEventListener("click", () => openEditSlotModal(role));
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
    grpMain.append(btnEditCfg, btnEdit, btnNew);
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
    ov.innerHTML =
      `<div class="big">${score.percent.toFixed(1)}<em>分</em></div>` +
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
      erBlock +
      `</div></div>`;
    wrap.appendChild(ov);

    // 5 部位卡
    const grid = el("div", "artifact-grid");
    C.SLOT_KEYS.forEach(slot => {
      const art = role.artifacts[slot];
      grid.appendChild(renderArtifactCard(role, slot, art));
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function renderArtifactCard(role, slot, art) {
    const isLoose = role.looseSlot === slot;   // 散件部位：金色「散」角标视觉引导（不文字说明）
    if (!art) {
      const card = el("div", "artifact-card empty-art" + (isLoose ? " loose" : ""),
        `<div style="text-align:center">＋<br>${C.SLOTS[slot].name}</div>`);
      card.addEventListener("click", () => openArtifactModal(role, slot, "new"));
      return card;
    }
    const card = el("div", "artifact-card");
    const sScore = core.calcArtifactScore(art, role);
    const eff = role.effectiveStats || [];
    // 部位达成度百分比 = 单件词条数 / 该部位完美词条数；按得分给整卡着色边框
    const perfect = core.calcPerfect(slot, role);
    const pct = perfect > 0 ? (sScore / perfect) * 100 : 0;
    const rankCls = pct > 80 ? "score-red" : pct > 70 ? "score-orange" : pct > 60 ? "score-purple" : pct > 50 ? "score-blue" : "score-green";
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
      `<span class="a-slot">${C.SLOTS[slot].name}${isLoose ? ' <i class="a-loose-tag">散</i>' : ""}</span>` +
      `<span class="a-level">Lv.${art.level}</span></div>` +
      `<div class="a-set">${esc(art.set)}</div>` +
      // 主属性数值：百分比词条加 %，数值词条（花·生命值 / 羽·攻击力）不加
      `<div class="a-main">${esc(art.mainStat)}${art.mainValue ? `<span class="v">${art.mainValue}${C.STAT_TYPE[art.mainStat] === "percent" ? "%" : ""}</span>` : ""}</div>` +
      `<ul>${subsHtml}</ul>` +
      `<div class="a-foot">` +
      `<span class="a-score">${sScore.toFixed(2)} 词条</span>` +
      `<span class="a-pct ${rankCls}">${pct.toFixed(1)}%</span>` +
      `</div>`;

    return card;
  }

  /** 编辑部位选择弹窗（详情页右上角「编辑」入口：选择要编辑哪个部位） */
  function openEditSlotModal(role) {
    const body = el("div");
    const grid = el("div", "slot-pick");
    C.SLOT_KEYS.forEach(slot => {
      const art = role.artifacts[slot];
      const btn = el("button", "btn" + (art ? "" : " slot-empty"),
        `${C.SLOTS[slot].name}${art ? ` · ${esc(C.MAIN_SHORT[art.mainStat] || art.mainStat)}` : "（未录）"}`);
      btn.addEventListener("click", () => {
        closeModal();
        openArtifactModal(role, slot, "edit");
      });
      grid.appendChild(btn);
    });
    body.appendChild(grid);
    const foot = el("div");
    const btnCancel = el("button", "btn", "取消");
    btnCancel.addEventListener("click", closeModal);
    foot.appendChild(btnCancel);
    openModal("选择要编辑的部位", body, foot);
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
    const isEdit = mode === "edit";
    const isNew = mode === "new";
    let formState = {
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

    if (isEdit && role.artifacts[slot]) {
      const a = role.artifacts[slot];
      formState = {
        slot: a.slot, set: a.set, mainStat: a.mainStat, level: a.level,
        substats: (a.substats || []).map(s => ({ stat: s.stat, value: s.value, activated: s.activated }))
      };
      // 补齐 4 行
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
    const title = isEdit ? `编辑 ${C.SLOTS[slot].name}` : "录入新圣遗物";

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
            `<button class="rm" title="删除行">✕</button>`;
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
        const addBtn = el("button", "btn btn-sm", "＋ 添加副词条");
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
    const btnSave = el("button", "btn btn-primary", isEdit ? "保存" : "保存并评估");
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
      if (isEdit) {
        // 编辑已穿戴件：直接保存到角色
        store.replaceArtifact(role.id, artifact.slot, artifact);
        closeModal();
        render();
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
    foot.append(btnClear, btnCancel, btnSave);

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

  /** 情况优先级：情况三（套装件替换散件）> 情况二（套装件替换）> 情况一（散件替换） */
  function caseRank(r) {
    return r.isSetSwap ? 3 : (r.case === "套装替换" ? 2 : 1);
  }
  /** 情况类别短词（弹窗用，无「情况 X」编号） */
  function caseLabel(r) {
    return r.case === "套装替换" ? "套装件替换"
      : (r.isSetSwap ? "套装件替换散件" : "散件替换");
  }

  /** 待评估新圣遗物摘要卡（独立页与弹窗共用）：主信息一行 + 副词条一行，紧凑显示
   *  注意：函数名区别于「部位卡」renderArtifactCard(role, slot, art)，避免闭包内函数覆盖 */
  function renderPendingCard(art, onEdit) {
    const box = el("div", "eval-case");
    box.innerHTML =
      `<div class="c-head"><span class="c-title">待评估新圣遗物</span>` +
      (onEdit ? `<button class="btn btn-sm" id="reEdit">修改</button>` : "") + `</div>` +
      `<div class="art-summary">${C.SLOTS[art.slot].name} · ${esc(art.set)} · Lv.${art.level} · ${esc(art.mainStat)}</div>` +
      ((art.substats || []).length
        ? `<div class="art-substats">${(art.substats || []).map(s =>
            `${esc(s.stat)} ${s.value}${C.STAT_TYPE[s.stat] === "percent" ? "%" : ""}${s.activated ? "" : "（待激活）"}`).join(" · ")}</div>`
        : "");
    if (onEdit) box.querySelector("#reEdit").addEventListener("click", onEdit);
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
    sum.textContent = res.valuable ? "✓ 有价值"
      : (res.results.length === 0 ? "⚠ 无适用场景（该部位不是散件部位，且无同套装同主词条的已穿戴件）" : "✗ 无价值");
    box.appendChild(sum);

    if (res.results.length === 0) {
      box.appendChild(el("div", "info", "可将其录入到对应部位后重新评估，或修改新圣遗物信息。"));
    }

    res.results.forEach(r => {
      const card = el("div", "eval-case case-" + caseRank(r));
      const verdictCls = r.worthy ? "badge-green" : "badge-gray";
      const diffCls = r.diffToCurrent >= 0 ? "diff-pos" : "diff-neg";
      const setSwapWarn = r.isSetSwap
        ? `<div class="warn" style="margin-top:8px">⚠ 替换后该部位将变为「${esc(art.set)}」套装件，角色将失去散件（散件部位将置空）</div>`
        : "";
      card.innerHTML =
        `<div class="c-head"><span class="c-title">${caseLabel(r)}</span>` +
        `<span class="badge ${verdictCls}">${esc(r.verdict)}</span></div>` +
        setSwapWarn +
        `<div class="eval-row">` +
        `<span>当前 ${fmt(r.currentScore)}</span>` +
        `<span>潜力 ${fmt(r.potentialScore)}（现 ${fmt(r.newCurrentScore)}${r.remaining ? `，剩${r.remaining}次` : ""}）</span>` +
        `<span class="${diffCls}">${r.diffToCurrent >= 0 ? "+" : ""}${fmt(r.diffToCurrent)} 词条</span>` +
        (r.newPercent != null ? `<span>替换后 ${r.newPercent.toFixed(1)} 分</span>` : "") +
        `<span>充能 ${fmt(r.newER)}%${r.tags.length ? ` <span class="badge badge-yellow">${esc(r.tags[0])}</span>` : ""}</span>` +
        `</div>`;
      box.appendChild(card);
    });

    return { box, res };
  }

  /** 执行替换：写入角色该部位；情况三（套装件替换散件）时散件部位置空 */
  function applyReplace(role, art, isSetSwap) {
    store.replaceArtifact(role.id, art.slot, art);
    if (isSetSwap) {
      role.looseSlot = null;   // 替换后无散件（5 件全套装）
      store.updateRole(role);
    }
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
          applyReplace(role, pendingArtifact, setSwap);
          pendingArtifact = null;
          evalHidden.clear();
          closeModal();
          render();
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
        '<div class="icon" aria-hidden="true">⚖️</div>' +
        '<div class="empty-title">还没有角色数据</div>' +
        '<div class="empty-desc">请先创建角色或导入数据，再对新的圣遗物进行价值评估。</div>');
      const btn = el("button", "btn btn-primary", "＋ 新建角色");
      btn.addEventListener("click", createRoleFlow);
      empty.appendChild(btn);
      wrap.appendChild(empty);
      return wrap;
    }

    // 头部：标题 + 说明
    const head = el("div", "detail-head");
    head.appendChild(el("div", "detail-title", "圣遗物价值评估"));
    wrap.appendChild(head);
    wrap.appendChild(el("div", "info", "录入一件新圣遗物后，将自动对全部角色评估，按使用方式优先级列出所有「有提升」的情况。"));

    if (!pendingArtifact) {
      // 无待评估新圣遗物：提示 + 录入入口
      const box = el("div", "eval-case");
      box.innerHTML = `<div class="c-head"><span class="c-title">录入要评估的新圣遗物</span></div>`;
      const btn = el("button", "btn btn-primary", "＋ 录入新圣遗物");
      btn.addEventListener("click", () => openArtifactModal(roles[0], null, "new"));
      box.appendChild(btn);
      wrap.appendChild(box);
      return wrap;
    }

    // —— 评估全部角色 ——
    const art = pendingArtifact;
    const all = roles.map(r => ({ role: r, res: core.evaluateArtifact(art, r) }));
    const hiddenCount = evalHidden.size;
    const valuable = all.filter(x => x.res.valuable && !evalHidden.has(x.role.id));

    // 新件摘要（一行主信息 + 一行副词条）
    wrap.appendChild(renderPendingCard(art, () => openArtifactModal(roles[0], art.slot, "new", pendingArtifact)));

    // 汇总
    const sum = el("div", "eval-summary " + (valuable.length ? "valuable" : "no-value"));
    if (valuable.length) {
      sum.textContent = `✓ 评估 ${roles.length} 个角色：${valuable.length} 个角色有提升` +
        (hiddenCount > 0 ? `（已手动移除 ${hiddenCount} 个）` : "");
    } else if (hiddenCount > 0) {
      sum.textContent = `已手动移除全部有提升角色，暂无更多提升项（共评估 ${roles.length} 个角色）`;
    } else {
      sum.textContent = `✗ 评估 ${roles.length} 个角色：均无提升（词条不足或无适用场景）`;
    }
    wrap.appendChild(sum);

    // 图例：颜色 = 使用方式（优先级 三 > 二 > 一）
    wrap.appendChild(el("div", "legend",
      `<span class="lg"><i class="sw s3"></i>套装件替换散件 · 最高优先</span>` +
      `<span class="lg"><i class="sw s2"></i>套装件替换</span>` +
      `<span class="lg"><i class="sw s1"></i>散件替换</span>`));

    // 按情况分组（优先级：情况三 > 二 > 一），组内每角色一行紧凑显示
    const groups = { 3: [], 2: [], 1: [] };
    valuable.forEach(({ role, res }) => {
      res.results.filter(r => r.worthy).forEach(r => {
        groups[caseRank(r)].push({ role, r });
      });
    });

    [3, 2, 1].forEach(rank => {
      const items = groups[rank];
      if (!items.length) return;
      const groupBox = el("div", "eval-case case-" + rank);
      items.forEach(({ role, r }) => {
        const diffCls = r.diffToCurrent >= 0 ? "diff-pos" : "diff-neg";
        // 有效词条 + 权值（词条简称 + 金色权值，风格同首页）
        const effArr = role.effectiveStats || [];
        const weights = role.weights || {};
        const effHtml = effArr.length
          ? effArr.map(s => `<b>${esc(C.MAIN_SHORT[s] || s)}<i>${fmt(weights[s] || 0)}</i></b>`).join("")
          : '<span class="eff-none">未配置</span>';
        // grid 固定列（eval-row-grid）：角色名 | 词条差 | 潜力 | 有效词条 | 替换后分 | 状态标签 | 操作按钮
        // 条件列（替换后分/状态标签）以空 span 占位，保证所有行各列起始位置一致（纵向对齐）
        const row = el("div", "eval-row eval-row-grid");
        row.innerHTML =
          `<span class="row-role" title="点击查看角色详情">${esc(role.name)}</span>` +
          `<span class="row-diff ${diffCls}">${r.diffToCurrent >= 0 ? "+" : ""}${fmt(r.diffToCurrent)} 词条</span>` +
          `<span class="row-pot">潜力 ${fmt(r.potentialScore)}（现 ${fmt(r.newCurrentScore)}${r.remaining ? `，剩${r.remaining}次` : ""}）</span>` +
          `<span class="row-eff">${effHtml}</span>` +
          `<span class="row-pct">${r.newPercent != null ? `替换后 ${r.newPercent.toFixed(1)} 分` : ""}</span>` +
          `<span class="row-tag">${r.isSetSwap ? `<span class="badge badge-yellow">替换后无散件</span>` : ""}</span>`;
        // 点击角色名 → 跳转该角色详情页（评估临时对象保留，返回评估页结果仍在）
        row.querySelector(".row-role").addEventListener("click", () => {
          view = { type: "detail", roleId: role.id };
          render();
        });
        // 操作区（最右列，两端对齐）：手动移除 + 替换（仅满级圣遗物）
        const actions = el("div", "row-actions");
        const btnHide = el("button", "btn btn-sm btn-hide", "✕");
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
              applyReplace(role, art, r.isSetSwap);
              pendingArtifact = null;
              evalHidden.clear();
              feedback.toast(`已替换到「${role.name}」的${slotName}`, "success");
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

    // 操作：修改 / 放弃
    const actions = el("div", null);
    actions.style.cssText = "display:flex;gap:10px;margin-top:14px";
    const btnCancel = el("button", "btn", "放弃");
    btnCancel.addEventListener("click", () => { pendingArtifact = null; evalHidden.clear(); render(); });
    actions.appendChild(btnCancel);
    wrap.appendChild(actions);
    return wrap;
  }

  // ============ 角色配置弹窗 ============
  function openRoleConfigModal(role) {
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
    fLoose.innerHTML = `<label>散件部位（5 件全套装可选「无散件」）</label><select id="cLoose">${looseOpts}</select>`;
    const fEr = el("div", "form-row",
      `<div class="field"><label>充能需求 (%)</label><input id="cEr" type="number" min="100" value="${isFinite(role.erRequirement) ? role.erRequirement : ""}"></div>` +
      `<div class="field"><label>当前面板充能 (%)</label><input id="cER" type="number" min="100" value="${isFinite(role.currentER) ? role.currentER : ""}"></div>`);

    const fEff = el("div", "field");
    fEff.innerHTML = "<label>有效词条（点击选择）</label><div class='chips' id='cChips'></div>";
    body.append(fName, fEle, fLoose, fEr, fEff);

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
          `<input type="number" step="0.1" min="0.1" max="${C.MAX_WEIGHT}" value="${role.weights[st]}" data-stat="${esc(st)}">`);
        f.querySelector("input").addEventListener("input", e => {
          role.weights[st] = parseFloat(e.target.value);
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
        if (st) role.weights[st] = parseFloat(inp.value);
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
  function setupIO() {
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
        // 选择导入策略：覆盖 / 合并 / 放弃（三选一）
        const mode = await feedback.confirm({
          title: "选择导入策略",
          message: `将导入 ${res.store.roles.length} 个角色，请选择合并方式：`,
          detail: "覆盖 = 用导入数据替换现有全部数据；合并 = 同名角色覆盖、新角色追加。",
          confirmText: "覆盖数据",
          cancelText: "合并数据"
        });
        if (mode == null) return;                    // Esc / 关闭 → 放弃导入
        const merged = global.App.io.mergeStore(store.getStore(), res.store, mode ? "overwrite" : "merge");
        store.replaceStore(merged);

        // 展示导入统计与警告（外部适配器元信息）
        let html = `<div class="info-success">导入成功（${merged.roles.length} 个角色）</div>`;
        const meta = res.meta;
        if (meta) {
          const lines = [];
          if (meta.equipped !== undefined) lines.push(`已导入 ${meta.equipped} 件已装备圣遗物`);
          if (meta.bag) lines.push(`背包中 ${meta.bag} 件未装备圣遗物未导入（本工具暂不支持背包）`);
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
  global.App.ui = { render, setupIO, openRoleConfigModal, openArtifactModal, openEvaluateModal };
})(window);
