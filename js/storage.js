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
    return { version: C.STORAGE_VERSION, exportedAt: null, roles: [], customSets: [] };
  }

  // —— 已废弃字段清理（2026-09-28）——
  // note：旧备注字段（曾由莫娜适配器写入「从莫娜占卜铺导入」）；
  // mainValue：主属性数值（不入库、不展示，算法本就不依赖）。
  // 历史备份与旧 localStorage 数据经此剥离，保证数据结构干净。
  const DEPRECATED_ARTIFACT_FIELDS = ["note", "mainValue"];
  function sanitizeStore(store) {
    if (!store || !Array.isArray(store.roles)) return store;
    store.roles.forEach(role => {
      const arts = (role && role.artifacts) || {};
      C.SLOT_KEYS.forEach(key => {
        const art = arts[key];
        if (!art || typeof art !== "object") return;
        DEPRECATED_ARTIFACT_FIELDS.forEach(f => { delete art[f]; });
      });
    });
    return store;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return emptyStore();
      const data = JSON.parse(raw);
      return migrate(data);
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

  // 按 version 升级（预留）；customSets 必须透传，否则刷新页面后自定义套装丢失
  function migrate(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.roles)) {
      return emptyStore();
    }
    // 未来：if (raw.version === 1) {...转 v2...}
    return sanitizeStore({
      version: C.STORAGE_VERSION,
      exportedAt: raw.exportedAt || null,
      roles: raw.roles || [],
      customSets: Array.isArray(raw.customSets) ? raw.customSets : []
    });
  }

  // —— 首页筛选状态持久化（刷新 / 重新打开页面时恢复上次筛选）——
  // 结构：{ mode: "role" | "loose", slot, mainStat, sets }
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
      const mode = (d.mode === "loose" || d.mode === "role")
        ? d.mode
        : ((slot || mainStat) ? "loose" : "role");
      return mode === "loose"
        ? { mode, slot, mainStat, sets: [] }               // 按散件：套装条件不参与（互斥）
        : { mode, slot: "", mainStat: "", sets };          // 按角色：件级条件不参与（互斥）
    } catch (e) {
      return null;   // 损坏数据 → 返回 null，由调用方回退默认筛选
    }
  }
  function saveFilter(f) {
    try {
      const mode = (f && f.mode === "loose") ? "loose" : "role";
      const data = mode === "loose"
        ? { mode, slot: (f && f.slot) || "", mainStat: (f && f.mainStat) || "", sets: [] }
        : { mode, slot: "", mainStat: "", sets: (f && Array.isArray(f.sets)) ? f.sets : [] };
      localStorage.setItem(FILTER_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;   // 超容量或隐私模式：静默失败，不影响功能
    }
  }

  global.App = global.App || {};
  global.App.storage = { load, save, migrate, emptyStore, sanitizeStore, KEY, FILTER_KEY, loadFilter, saveFilter };
})(window);
