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

  function save() {
    const res = global.App.storage.save(state.store);
    if (!res.ok) {
      // 写失败（如超容量）提示导出备份
      alert("数据保存失败（可能超出浏览器存储容量），请尽快「导出」备份！");
    }
  }

  function genId() {
    return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  /** 新建空角色（角色名命中元素映射表时自动带出 element，仍可在角色配置中修改） */
  function newRole(name) {
    const role = {
      id: genId(),
      name: name || "新角色",
      element: global.App.constants.CHARACTER_ELEMENT_HINTS[name] || "",
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

  /** 更新角色（整体替换）；name 去重 */
  function updateRole(role) {
    const idx = state.store.roles.findIndex(r => r.id === role.id);
    if (idx < 0) return false;
    // 重名检查（排除自身）
    const dup = state.store.roles.some(r => r.id !== role.id && r.name === role.name);
    if (dup) return { error: "已存在同名角色" };
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
    if (Number.isFinite(role.currentER)) {
      const core = global.App.core;
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
   * 删除「被完全取代」的藏品件（core.collectionIndex 的冗余件）。
   * @param keep 本次操作涉及的件（新入库 / 刚更新）——即使它暂时不占任何位也不删它
   *             （用户主动收藏的件不该被系统悄悄丢掉）
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

  /** 加入藏品库（深拷贝 + 生成 id）→ 自动清理被完全取代的旧件 → 落盘 */
  function addCollectionItem(artifact) {
    const item = JSON.parse(JSON.stringify(artifact));
    if (!item.id) item.id = genId();
    getCollection().push(item);
    const removed = pruneCollection(item);
    save();
    return { ok: true, item, removed };
  }

  /** 更新藏品件（按 id 整体替换）→ 自动清理 → 落盘 */
  function updateCollectionItem(item) {
    const list = getCollection();
    const idx = list.findIndex(a => a.id === item.id);
    if (idx < 0) return { ok: false };
    const next = JSON.parse(JSON.stringify(item));
    list[idx] = next;
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
    newRole, getRole, updateRole, deleteRole,
    replaceArtifact, replaceStore, upsertRole, genId, save,
    // 藏品库（2026-10-11）
    getCollection, addCollectionItem, updateCollectionItem, removeCollectionItem, pruneCollection
  };
})(window);
