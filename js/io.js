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
  function exportBackup(store) {
    const payload = {
      version: C.STORAGE_VERSION,
      exportedAt: new Date().toISOString(),
      roles: store.roles,
      customSets: Array.isArray(store.customSets) ? store.customSets : undefined
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob(["\ufeff" + json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    const fname = `圣遗物备份_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
        customSets: Array.isArray(incoming.customSets) ? incoming.customSets.slice() : []
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
    return { version: C.STORAGE_VERSION, exportedAt: null, roles, customSets };
  }

  function cloneRole(role) {
    return JSON.parse(JSON.stringify(role));
  }

  global.App = global.App || {};
  global.App.io = { exportBackup, readFile, importFile, mergeStore };
})(window);
