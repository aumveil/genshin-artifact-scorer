/**
 * store.js - 状态层（对应《圣遗物网页实现方案.md》2.5/阶段5）
 * 角色 CRUD、当前角色切换、藏品库 CRUD；每次变更后自动持久化。
 * 全局命名空间：App.store
 */
(function (global) {
  "use strict";

  let state = {
    store: global.App.storage.load(),
    currentRoleId: null       // 当前选中角色（无则 null）
  };

  function getStore() { return state.store; }
  function getRoles() { return state.store.roles; }

  // —— 自定义套装（文本识别「新套装」确认后持久化；存储于 store 顶层 customSets，随导出/导入）——
  function getCustomSets() {
    return Array.isArray(state.store.customSets) ? state.store.customSets : [];
  }
  /** 加入自定义套装（去重）；返回是否新增 */
  function addCustomSet(name) {
    const n = String(name || "").trim();
    if (!n) return false;
    if (!Array.isArray(state.store.customSets)) state.store.customSets = [];   // 确保写入目标数组存在
    const list = state.store.customSets;
    if (list.includes(n)) return false;
    list.push(n);
    save();
    return true;
  }

  function getCurrentRole() {
    return state.store.roles.find(r => r.id === state.currentRoleId) || null;
  }
  function setCurrentRole(id) { state.currentRoleId = id; }

  let lastSaveFailAt = 0;   // 保存失败提示节流（10s）：避免连续操作刷屏

  function save() {
    const res = global.App.storage.save(state.store);
    if (!res.ok) {
      // 2026-10-29：不再用原生 alert（阻塞且破坏视觉统一）；改走 feedback.toast，保留 console.error 供排查。
      // 只提示不阻断——写失败时内存数据仍可用，但刷新会丢，文案必须让用户立刻导出。
      console.error("数据保存失败：", res.error);
      const fb = global.App.feedback;
      const now = Date.now();
      if (fb && typeof fb.toast === "function") {
        if (now - lastSaveFailAt > 10000) {
          lastSaveFailAt = now;
          fb.toast("保存失败：可能超出浏览器存储容量，请立即「导出」备份（本次修改刷新后会丢）", "error", 9000);
        }
      } else if (typeof alert === "function") {
        alert("数据保存失败（可能超出浏览器存储容量），请尽快「导出」备份！");   // 无反馈层时的兜底（正常不会走到）
      }
    }
  }

  function genId() {
    return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  /**
   * 新建空角色（角色名命中元素映射表时自动带出 element，仍可在角色配置中修改）。
   * 重名保护（2026-10-25 P0）：hash 路由按角色名解析（`#/role/<name>` 恒落第一个）、导入合并也按名匹配，
   * 同名角色会让两者产生歧义 → 与 updateRole 同口径拒绝，返回 `{ error }`；调用方须判 `role.id`。
   * 名称统一 trim 后落库（避免「胡桃」与「胡桃 」被当成两个角色）。
   */
  function newRole(name) {
    const n = String(name == null ? "" : name).trim() || "新角色";
    if (state.store.roles.some(r => r && String(r.name || "").trim() === n)) {
      return { error: "已存在同名角色" };
    }
    const role = {
      id: genId(),
      name: n,
      element: global.App.constants.CHARACTER_ELEMENT_HINTS[n] || "",
      sets: [],                  // 角色所穿套装（0 个=其他/不判套装；1 个=四件套；2 个=两个两件套）
      looseSlot: "goblet",
      effectiveStats: [],
      weights: {},
      erRequirement: 180,
      currentER: 180,
      artifacts: { flower: null, plume: null, sands: null, goblet: null, circlet: null },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    state.store.roles.push(role);
    save();
    return role;
  }

  function getRole(id) {
    return state.store.roles.find(r => r.id === id) || null;
  }

  /** 更新角色（整体替换）；name trim + 去重（与 newRole 同口径，2026-10-25） */
  function updateRole(role) {
    const idx = state.store.roles.findIndex(r => r.id === role.id);
    if (idx < 0) return false;
    const nextName = String(role.name == null ? "" : role.name).trim();
    if (!nextName) return { error: "角色名不能为空" };
    // 重名检查（排除自身；两侧都 trim 后比较，避免尾随空格绕过）
    const dup = state.store.roles.some(r => r.id !== role.id && String(r.name || "").trim() === nextName);
    if (dup) return { error: "已存在同名角色" };
    role.name = nextName;
    role.updatedAt = Date.now();
    state.store.roles[idx] = role;
    save();
    return true;
  }

  function deleteRole(id) {
    const idx = state.store.roles.findIndex(r => r.id === id);
    if (idx < 0) return false;
    state.store.roles.splice(idx, 1);
    if (state.currentRoleId === id) state.currentRoleId = null;
    save();
    return true;
  }

  /**
   * 恢复被删除的角色（2026-10-29，配套详情页「删除 → 撤销」）。
   * @param role 删除前的深拷贝快照（调用方负责 clone，避免撤销后被继续修改）
   * @param index 原数组位置；越界/非法时追加到末尾
   * @returns {boolean} false = id 已存在（不覆盖现有数据）/ 参数非法
   */
  function restoreRole(role, index) {
    if (!role || !role.id) return false;
    if (state.store.roles.some(r => r && r.id === role.id)) return false;
    const i = (Number.isInteger(index) && index >= 0 && index <= state.store.roles.length)
      ? index
      : state.store.roles.length;
    state.store.roles.splice(i, 0, role);
    save();
    return true;
  }

  /**
   * 替换某部位圣遗物（确认替换 / 编辑已穿戴件时调用；旧件直接丢弃）。
   * 充能联动（2026-09-29）：面板充能 `currentER` 按**副词条充能贡献差**自动更新，
   * 与算法三 `evaluateAgainst` 的 `newER = currentER − ERContrib(旧) + ERContrib(新)` 同口径
   * ——否则替换后面板仍显示替换前的值，首页徽章会继续显示替换前的充能状态。
   * 边界：仅当充能已配置（`currentER` 为数值）时联动；**主词条充能不在联动范围**
   * （`ERContrib` 只算副词条）——评估→替换路径本就要求主词条与被替换件一致，故不会发生；
   * 但详情页「编辑已穿戴件」可改主词条，故此处报告 `mainStatChanged` / `erMainStatTouched`，
   * 由 UI 提示用户手动核对面板充能。
   * @returns {boolean|Object} 角色不存在 → false；否则 { ok:true, erFrom, erTo, erDelta, mainStatChanged, erMainStatTouched }
   */
  function replaceArtifact(roleId, slot, newArtifact) {
    const role = getRole(roleId);
    if (!role) return false;
    const old = role.artifacts[slot] || null;
    role.artifacts[slot] = JSON.parse(JSON.stringify(newArtifact));
    const next = role.artifacts[slot];
    let erFrom = null, erTo = null, erDelta = 0;
    // 仅对「看充能」的角色联动（2026-10-17）：erApplies 为假时 currentER 只是历史占位值（多为 180），
    // 联动它既无意义，又会在用户日后把充能勾成有效词条时留下一个被污染的面板值。
    const core = global.App.core;
    if (core.erApplies(role) && Number.isFinite(role.currentER)) {
      // 取 2 位小数：抵消浮点尾差（否则「充能未变化」会被当成有变化，弹出「180% → 180%」提示）
      erDelta = Math.round((core.ERContrib(next) - core.ERContrib(old)) * 100) / 100;
      if (erDelta) {
        erFrom = role.currentER;
        erTo = Math.round((role.currentER + erDelta) * 10) / 10;   // 保留 1 位小数，消除浮点尾差
        role.currentER = erTo;
      }
    }
    // 主词条是否变化；变化且任一侧是充能主词条 → 面板充能还需手动核对（主词条充能不计入自动联动）
    const mainStatChanged = !!(old && old.mainStat !== next.mainStat);
    const erMainStatTouched = mainStatChanged
      && (old.mainStat === "元素充能效率" || next.mainStat === "元素充能效率");
    role.updatedAt = Date.now();
    save();
    return { ok: true, erFrom, erTo, erDelta, mainStatChanged, erMainStatTouched };
  }

  // ============ 藏品库（未装备给任何角色的圣遗物，2026-10-11）============
  // 语义（用户定案）：一件藏品可同时占据多个「位」（桶 × 维度）；
  //   被新件顶掉某一位后，若它仍占着别的位则保留，**只有不再占据任何位才删除**。
  // 详见《圣遗物网页实现方案.md》§七「藏品库」。

  /** 藏品库（始终返回数组；旧数据缺字段时补空数组） */
  function getCollection() {
    if (!Array.isArray(state.store.collection)) state.store.collection = [];
    return state.store.collection;
  }

  /**
   * 删除「被完全取代」的藏品件（core.collectionIndex 的 redundant）。
   * ⚠ 并列件（ties）不在此列——2026-10-29 起同值保留先入者，旧并列件留待用户显式清理。
   * @param keep 本次操作涉及的件（新入库 / 刚更新）——即使它暂时不占任何位也不删它
   * @returns {Array} 被删除的件（供 UI 提示）
   */
  function pruneCollection(keep) {
    const list = getCollection();
    if (list.length < 2) return [];
    const core = global.App.core;
    if (!core || typeof core.collectionIndex !== "function") return [];
    const { redundant } = core.collectionIndex(list);
    const dead = redundant.filter(a => a !== keep);
    if (!dead.length) return [];
    const deadSet = new Set(dead);
    state.store.collection = list.filter(a => !deadSet.has(a));
    return dead;
  }

  /**
   * 判断某件是否是「某个位的唯一持有者」（collectionIndex 的 holders 里 arts[0] 为它）。
   * 2026-10-29：一位一件后 arts 恒为长度 1；并列件不算持有者，也不入库。
   */
  function holdsAnyPosition(item, idx) {
    let held = false;
    idx.holders.forEach(h => { if (h.arts[0] === item) held = true; });
    return held;
  }

  /** 加入藏品库（深拷贝 + 生成 id）→ 只有占位才入库 → 清理被完全取代的旧件 → 落盘 */
  function addCollectionItem(artifact) {
    const item = JSON.parse(JSON.stringify(artifact));
    if (!item.id) item.id = genId();
    const list = getCollection();
    list.push(item);
    const core = global.App.core;
    const idx = (core && typeof core.collectionIndex === "function") ? core.collectionIndex(list) : null;
    if (idx && !holdsAnyPosition(item, idx)) {
      // 一位一件（2026-10-29）：所有维度都没有严格超过现有藏品 → 不入藏。
      // 并列件不替换先入者（reason=tie），完全更差的件也不留（reason=worse），避免「存了但看不见」。
      state.store.collection = list.filter(a => a !== item);
      return { ok: false, reason: idx.ties.includes(item) ? "tie" : "worse", item };
    }
    const removed = pruneCollection(item);
    save();
    return { ok: true, item, removed };
  }

  /** 更新藏品件（按 id 整体替换）→ 更新后仍须占位 → 清理 → 落盘；不占位则回退旧件 */
  function updateCollectionItem(item) {
    const list = getCollection();
    const idx = list.findIndex(a => a.id === item.id);
    if (idx < 0) return { ok: false, reason: "missing" };
    const prev = list[idx];
    const next = JSON.parse(JSON.stringify(item));
    list[idx] = next;
    const core = global.App.core;
    const ci = (core && typeof core.collectionIndex === "function") ? core.collectionIndex(list) : null;
    if (ci && !holdsAnyPosition(next, ci)) {
      list[idx] = prev;   // 回退：编辑后不再占位的件不留在库里（否则同样是「隐形藏品」）
      return { ok: false, reason: ci.ties.includes(next) ? "tie" : "worse" };
    }
    const removed = pruneCollection(next);
    save();
    return { ok: true, item: next, removed };
  }

  /** 删除藏品件（藏品页手动删除；不触发连带清理） */
  function removeCollectionItem(id) {
    const list = getCollection();
    const idx = list.findIndex(a => a.id === id);
    if (idx < 0) return false;
    list.splice(idx, 1);
    save();
    return true;
  }

  /** 批量删除藏品（并列件一次性清理用）；返回实际删除数 */
  function removeCollectionItems(ids) {
    const set = new Set(Array.isArray(ids) ? ids : []);
    if (!set.size) return 0;
    const before = getCollection();
    const next = before.filter(a => !set.has(a.id));
    const n = before.length - next.length;
    if (!n) return 0;
    state.store.collection = next;
    save();
    return n;
  }

  /** 覆盖整个 store（导入用）；collection 必须透传 */
  function replaceStore(store) {
    state.store = {
      version: 1, exportedAt: null,
      roles: store.roles || [],
      customSets: Array.isArray(store.customSets) ? store.customSets : [],
      collection: Array.isArray(store.collection) ? store.collection : []
    };
    state.currentRoleId = null;
    save();
  }

  /** 用外部角色替换当前角色数据（导入合并场景） */
  function upsertRole(role) {
    const idx = state.store.roles.findIndex(r => r.id === role.id);
    if (idx >= 0) state.store.roles[idx] = role;
    else state.store.roles.push(role);
    save();
  }

  global.App = global.App || {};
  global.App.store = {
    getStore, getRoles, getCustomSets, addCustomSet,
    getCurrentRole, setCurrentRole,
    newRole, getRole, updateRole, deleteRole, restoreRole,
    replaceArtifact, replaceStore, upsertRole, genId, save,
    // 藏品库（2026-10-11）
    getCollection, addCollectionItem, updateCollectionItem, removeCollectionItem, removeCollectionItems, pruneCollection
  };
})(window);
