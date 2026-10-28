/**
 * io.js - 数据导入 / 导出（对应《圣遗物网页实现方案.md》2.6）
 * 导出：完整 JSON 备份（Blob 下载）
 * 导入：自动探测格式（本项目备份 / 外部适配器）→ 全量校验 → 覆盖/合并
 * 全局命名空间：App.io
 */
(function (global) {
  "use strict";
  const C = global.App.constants;

  // —— 导出 ——
  // 备份提醒（R6）：计时用独立 key（不入主 store，避开 6 处透传链与导入合并语义）
  const BACKUP_KEY = "gys_lastbackup_v1";
  const BACKUP_SNOOZE_KEY = "gys_backup_snooze_v1";

  /** 记录一次成功导出（重置备份提醒计时） */
  function markBackupExported() {
    try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch (e) { /* 隐私模式等：静默 */ }
  }

  /** 备份提醒判定：距上次导出 ≥14 天且期间有变更（或从未导出）→ {days|null, never}；否则 null */
  function backupReminderDue(store) {
    try {
      const roles = (store && store.roles) || [];
      if (!roles.length) return null;
      const snooze = Number(localStorage.getItem(BACKUP_SNOOZE_KEY) || 0);
      if (Date.now() < snooze) return null;
      const last = Number(localStorage.getItem(BACKUP_KEY) || 0);
      if (!last) return { days: null, never: true };
      const maxUpdated = roles.reduce((m, r) => Math.max(m, r.updatedAt || 0), 0);
      if (maxUpdated <= last) return null;                  // 上次导出后无变更 → 不打扰
      const days = Math.floor((Date.now() - last) / 86400000);
      return days >= 14 ? { days, never: false } : null;
    } catch (e) { return null; }
  }

  /** 稍后再说（7 天内不再提示） */
  function snoozeBackupReminder() {
    try { localStorage.setItem(BACKUP_SNOOZE_KEY, String(Date.now() + 7 * 86400000)); } catch (e) { /* 静默 */ }
  }

  /** 触发浏览器下载文本（导出 / 损坏副本共用；withBom 仅常规导出开启，便于 Excel 等工具识别） */
  function downloadText(text, fname, withBom) {
    const blob = new Blob([(withBom ? "\ufeff" : "") + text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function dateStamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function exportBackup(store) {
    const payload = {
      version: C.STORAGE_VERSION,
      exportedAt: new Date().toISOString(),
      roles: store.roles,
      customSets: Array.isArray(store.customSets) ? store.customSets : undefined,
      collection: Array.isArray(store.collection) ? store.collection : undefined   // 藏品库（2026-10-11）
    };
    const json = JSON.stringify(payload, null, 2);
    const fname = `圣遗物备份_${dateStamp()}.json`;
    downloadText(json, fname, true);
    markBackupExported();   // R6：备份提醒计时重置
    return fname;
  }

  /**
   * 下载「损坏数据」的原始副本（2026-10-25，配套 storage 的损坏隔离）。
   * 内容**原样**落盘（不加 BOM、不重排），供用户手工修复后重新导入；无隔离副本 → null。
   */
  function downloadCorruptBackup() {
    const raw = global.App.storage.getCorruptRaw();
    if (!raw) return null;
    const fname = `圣遗物数据_损坏副本_${dateStamp()}.json`;
    downloadText(raw, fname, false);
    return fname;
  }

  /** 读取文件为文本 */
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("文件读取失败"));
      fr.readAsText(file, "utf-8");
    });
  }

  /**
   * 导入文件：解析 + 探测 + 转换 + 校验。
   * @returns {Promise<{ok:boolean, adapterId?:string, errors?:Array, store?:object, message?:string}>}
   */
  async function importFile(file) {
    const text = await readFile(file);
    let raw;
    try {
      // 去除 BOM
      raw = JSON.parse(text.replace(/^\ufeff/, ""));
    } catch (e) {
      return { ok: false, message: "文件不是合法 JSON，请检查文件内容" };
    }
    // 探测 + 转换
    const res = global.App.adapters.convertFile(raw);
    if (res.error) {
      return { ok: false, message: res.error, rawPreview: JSON.stringify(raw, null, 2).slice(0, 2000) };
    }
    // 剥离已废弃字段（历史备份可能携带 note / mainValue），再全量校验
    global.App.storage.sanitizeStore(res.store);
    // 全量校验
    const errors = global.App.data.validateStore(res.store);
    if (errors.length > 0) {
      return { ok: false, message: "导入数据存在校验错误", errors, store: res.store, adapterId: res.adapter.id };
    }
    return { ok: true, store: res.store, adapterId: res.adapter.id, meta: res.store._meta };
  }

  /**
   * 合并策略：覆盖 or 合并（同名角色覆盖，新名追加）
   */
  function mergeStore(current, incoming, mode) {
    if (mode === "overwrite") {
      return {
        version: C.STORAGE_VERSION, exportedAt: null,
        roles: incoming.roles.map(cloneRole),
        customSets: Array.isArray(incoming.customSets) ? incoming.customSets.slice() : [],
        // 藏品库：覆盖模式跟随导入方（外部格式无藏品 → 空，属覆盖语义）
        collection: (Array.isArray(incoming.collection) ? incoming.collection : []).map(cloneRole)
      };
    }
    // merge（自定义套装取并集，去重）
    const roles = current.roles.map(cloneRole);
    incoming.roles.forEach(inc => {
      const idx = roles.findIndex(r => r.name === inc.name);
      if (idx >= 0) {
        roles[idx] = cloneRole(inc); // 同名覆盖
      } else {
        roles.push(cloneRole(inc));
      }
    });
    const customSets = (Array.isArray(current.customSets) ? current.customSets : []).slice();
    (Array.isArray(incoming.customSets) ? incoming.customSets : []).forEach(s => {
      if (!customSets.includes(s)) customSets.push(s);
    });
    // 藏品库：合并模式**保留当前藏品**——藏品没有名字，无法按名合并；外部格式也不含藏品概念
    const collection = Array.isArray(current.collection) ? current.collection.map(cloneRole) : [];
    return { version: C.STORAGE_VERSION, exportedAt: null, roles, customSets, collection };
  }

  function cloneRole(role) {
    return JSON.parse(JSON.stringify(role));
  }

  global.App = global.App || {};
  global.App.io = { exportBackup, downloadCorruptBackup, readFile, importFile, mergeStore, backupReminderDue, snoozeBackupReminder };
})(window);
