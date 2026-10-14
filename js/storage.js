/**
 * storage.js - localStorage 持久化（对应《圣遗物网页实现方案.md》2.5）
 * 全局命名空间：App.storage
 */
(function (global) {
  "use strict";
  const C = global.App.constants;
  const KEY = "gys_reliquary_v" + C.STORAGE_VERSION;
  const FILTER_KEY = "gys_reliquary_filter_v" + C.STORAGE_VERSION;   // 首页筛选状态（独立 key，随角色数据分开存）

  function emptyStore() {
    return { version: C.STORAGE_VERSION, exportedAt: null, roles: [], customSets: [], collection: [] };
  }

  // —— 已废弃字段清理（2026-09-28）——
  // note：旧备注字段（曾由莫娜适配器写入「从莫娜占卜铺导入」）；
  // mainValue：主属性数值（不入库、不展示，算法本就不依赖）。
  // 历史备份与旧 localStorage 数据经此剥离，保证数据结构干净。藏品件同样适用。
  const DEPRECATED_ARTIFACT_FIELDS = ["note", "mainValue"];

  /** 剥离单件圣遗物的废弃字段 */
  function stripDeprecatedArtifactFields(art) {
    if (!art || typeof art !== "object") return;
    DEPRECATED_ARTIFACT_FIELDS.forEach(f => { delete art[f]; });
  }

  /**
   * 「角色套装」字段一次性预填（2026-10-09）。
   * 策略 b：字段为准、圣遗物变更**不自动同步**；但迁移时把当前实况一次性快照进字段，
   * 免得手工填 77 次。实现要点：
   *   · 触发条件 = `!Array.isArray(role.sets)`（键不存在 ⇒ 从未迁移 / 外部导入的旧数据）。
   *     **不**用 store 级标记、也不升级 STORAGE_VERSION —— storage key 内含 version，
   *     改它等于换 key，会被当成「无数据」→ 看似全部丢失。
   *     以「键是否存在」为判据的好处：用户主动留空（`sets: []` =「其他」）不会被二次填上，
   *     新备份往返导入也不会被覆盖，而旧 localStorage 与莫娜导入仍能自动推导。
   *   · 推导不出唯一答案的（3+1+1、2+1+1+1、部位未录全）→ 写空数组（=「其他」，不判套装）。
   *   · 归入 sanitizeStore：load（刷新/重开）与 io.importFile（导入）两条路径同时生效。
   */
  function prefillRoleSets(store) {
    if (!store || !Array.isArray(store.roles)) return store;
    const core = global.App.core;
    // 防御：storage.js 在 index.html 中先于 core.js 加载（script 顺序），
    // 但本函数只在运行时（load / import）被调用，那时 core 必然已就绪；此处仅兜底极端情形。
    if (!core) return store;
    store.roles.forEach(role => {
      if (!role || Array.isArray(role.sets)) return;
      role.sets = core.deriveSetsFromArtifacts(role);
    });
    return store;
  }

  /**
   * 数据清洗（load 与 import 两条路径共用）：
   *  1. 剥离废弃的圣遗物字段（note / mainValue）——角色已穿戴件与藏品库同时处理；
   *  2. 角色 element 缺失或为空时，按 CHARACTER_ELEMENT_HINTS 自动补全（2026-10-09）；
   *  3. 角色 sets 字段从未迁移的旧数据预填一次（2026-10-09）；
   *  4. 藏品库（store.collection）缺失时补空数组（2026-10-11）——
   *     ⚠️ 与 customSets 同类的迁移红线：漏了就会「导出有、刷新后没有」。
   *
   * 补全规则：**只填空值，绝不覆盖已有值** —— 用户手工选定的元素优先保留
   * （含映射表中未收录的角色）；映射表查不到的角色保持原样。
   */
  function sanitizeStore(store) {
    if (!store || !Array.isArray(store.roles)) return store;
    store.roles.forEach(role => {
      if (!role) return;
      if (!role.element) {
        const guessed = C.CHARACTER_ELEMENT_HINTS[role.name];
        if (guessed) role.element = guessed;
      }
      const arts = role.artifacts || {};
      C.SLOT_KEYS.forEach(key => stripDeprecatedArtifactFields(arts[key]));
    });
    // 藏品库（2026-10-11）：确保为数组，并逐件剥离废弃字段
    if (!Array.isArray(store.collection)) store.collection = [];
    store.collection.forEach(stripDeprecatedArtifactFields);
    prefillRoleSets(store);
    return store;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return emptyStore();
      const data = JSON.parse(raw);
      const migrated = migrate(data);
      // 迁移补过字段（如 element）时立即回写：否则内存里已补齐、localStorage 仍是空的，
      // 会出现「导出有、存储没有」的不一致，且每次打开都要重算一遍。
      try {
        const next = JSON.stringify(migrated);
        if (next !== raw) localStorage.setItem(KEY, next);
      } catch (e) { /* 超容量/隐私模式：静默忽略，本次使用不受影响 */ }
      return migrated;
    } catch (e) {
      console.warn("存储数据损坏，已重置：", e);
      return emptyStore();
    }
  }

  function save(store) {
    try {
      store.version = C.STORAGE_VERSION;
      localStorage.setItem(KEY, JSON.stringify(store));
      return { ok: true };
    } catch (e) {
      // 超容量或隐私模式
      return { ok: false, error: e };
    }
  }

  // 按 version 升级（预留）；customSets / collection 必须透传，否则刷新后自定义套装或藏品丢失
  function migrate(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.roles)) {
      return emptyStore();
    }
    // 未来：if (raw.version === 1) {...转 v2...}
    return sanitizeStore({
      version: C.STORAGE_VERSION,
      exportedAt: raw.exportedAt || null,
      roles: raw.roles || [],
      customSets: Array.isArray(raw.customSets) ? raw.customSets : [],
      collection: Array.isArray(raw.collection) ? raw.collection : []
    });
  }

  // —— 首页筛选状态持久化（刷新 / 重新打开页面时恢复上次筛选）——
  // 结构：{ mode: "role" | "loose", slot, mainStat, sets, q }
  //   q = 搜索关键词（2026-10-15 批次 3 新增；与两条路径正交，路径切换时保留）
  //   mode = "role"  按角色路径：只筛套装（sets）
  //   mode = "loose" 按散件路径：只筛散件部位（slot）与主词条（mainStat）
  // 两条路径互斥（切换即清空另一路），故落盘时只保留当前路条件。
  // 兼容旧结构 { slot, mainStat, sets }（无 mode）：有件级条件（slot/mainStat）视为「按散件」，否则视为「按角色」。
  function loadFilter() {
    try {
      const raw = localStorage.getItem(FILTER_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || typeof d !== "object") return null;
      const slot = typeof d.slot === "string" ? d.slot : "";
      const mainStat = typeof d.mainStat === "string" ? d.mainStat : "";
      const sets = Array.isArray(d.sets) ? d.sets.filter(s => typeof s === "string") : [];
      const q = typeof d.q === "string" ? d.q : "";
      const mode = (d.mode === "loose" || d.mode === "role")
        ? d.mode
        : ((slot || mainStat) ? "loose" : "role");
      return mode === "loose"
        ? { mode, slot, mainStat, sets: [], q }            // 按散件：套装条件不参与（互斥）
        : { mode, slot: "", mainStat: "", sets, q };       // 按角色：件级条件不参与（互斥）
    } catch (e) {
      return null;   // 损坏数据 → 返回 null，由调用方回退默认筛选
    }
  }
  function saveFilter(f) {
    try {
      const mode = (f && f.mode === "loose") ? "loose" : "role";
      const q = (f && typeof f.q === "string") ? f.q : "";
      const data = mode === "loose"
        ? { mode, slot: (f && f.slot) || "", mainStat: (f && f.mainStat) || "", sets: [], q }
        : { mode, slot: "", mainStat: "", sets: (f && Array.isArray(f.sets)) ? f.sets : [], q };
      localStorage.setItem(FILTER_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;   // 超容量或隐私模式：静默失败，不影响功能
    }
  }

  global.App = global.App || {};
  global.App.storage = { load, save, migrate, emptyStore, sanitizeStore, KEY, FILTER_KEY, loadFilter, saveFilter };
})(window);
