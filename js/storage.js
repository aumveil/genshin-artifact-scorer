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
    return {
      version: C.STORAGE_VERSION,
      exportedAt: raw.exportedAt || null,
      roles: raw.roles || [],
      customSets: Array.isArray(raw.customSets) ? raw.customSets : []
    };
  }

  // —— 首页筛选状态持久化（刷新 / 重新打开页面时恢复上次筛选）——
  function loadFilter() {
    try {
      const raw = localStorage.getItem(FILTER_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || typeof d !== "object" || !Array.isArray(d.sets)) return null;
      return {
        slot: typeof d.slot === "string" ? d.slot : "",
        mainStat: typeof d.mainStat === "string" ? d.mainStat : "",
        sets: d.sets.filter(s => typeof s === "string")
      };
    } catch (e) {
      return null;   // 损坏数据 → 返回 null，由调用方回退默认筛选
    }
  }
  function saveFilter(f) {
    try {
      const data = {
        slot: (f && f.slot) || "",
        mainStat: (f && f.mainStat) || "",
        sets: (f && Array.isArray(f.sets)) ? f.sets : []
      };
      localStorage.setItem(FILTER_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;   // 超容量或隐私模式：静默失败，不影响功能
    }
  }

  global.App = global.App || {};
  global.App.storage = { load, save, migrate, emptyStore, KEY, FILTER_KEY, loadFilter, saveFilter };
})(window);
