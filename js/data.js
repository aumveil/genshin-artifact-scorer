/**
 * data.js - 数据结构校验（对应《圣遗物网页实现方案.md》2.8）
 * 校验分硬性（阻止保存/导入）与软性（警示不阻止）。
 * 全局命名空间：App.data
 */
(function (global) {
  "use strict";
  const C = global.App.constants;

  // —— 通用工具 ——
  function isNum(v) { return typeof v === "number" && isFinite(v); }

  // —— 圣遗物校验 ——
  /**
   * @returns {Array<{field:string, msg:string, level:"hard"|"soft"}>}
   */
  function validateArtifact(art) {
    const errors = [];
    if (!art) return [{ field: "artifact", msg: "圣遗物为空", level: "hard" }];

    // 部位
    if (!C.SLOT_KEYS.includes(art.slot)) {
      errors.push({ field: "slot", msg: "部位不合法", level: "hard" });
    }
    // 套装必填
    if (!art.set || !String(art.set).trim()) {
      errors.push({ field: "set", msg: "请选择所属套装", level: "hard" });
    }
    // 主词条必填 + 与部位匹配
    if (!art.mainStat) {
      errors.push({ field: "mainStat", msg: "请选择主词条", level: "hard" });
    } else if (art.slot && C.MAIN_STATS_BY_SLOT[art.slot] && !C.MAIN_STATS_BY_SLOT[art.slot].includes(art.mainStat)) {
      const slotName = C.SLOTS[art.slot] ? C.SLOTS[art.slot].name : art.slot;
      errors.push({ field: "mainStat", msg: `${slotName}的主词条不合法（应为 ${C.MAIN_STATS_BY_SLOT[art.slot].join(" / ")}）`, level: "hard" });
    }
    // 等级
    if (!Number.isInteger(art.level) || art.level < 0 || art.level > C.MAX_LEVEL) {
      errors.push({ field: "level", msg: `等级必须在 0~${C.MAX_LEVEL} 之间`, level: "hard" });
    }
    // 副词条
    const subs = Array.isArray(art.substats) ? art.substats : [];
    if (subs.length < 3 || subs.length > 4) {
      errors.push({ field: "substats", msg: "副词条数量必须为 3 或 4 条", level: "hard" });
    }
    const pendingCount = subs.filter(s => s && s.activated === false).length;
    if (pendingCount > 1) {
      errors.push({ field: "substats", msg: "待激活词条数量不能超过 1 条", level: "hard" });
    }
    // level ≥ 4 不允许待激活
    if (art.level >= 4 && pendingCount > 0) {
      errors.push({ field: "substats", msg: "4 级以上圣遗物不应存在待激活词条（4 级已解锁）", level: "hard" });
    }

    const seenStats = new Set();
    if (art.mainStat) seenStats.add(art.mainStat); // 主副词条不重复

    subs.forEach((s, i) => {
      const path = `substats[${i}]`;
      if (!s || !C.SUB_STATS.includes(s.stat)) {
        errors.push({ field: path, msg: `第 ${i + 1} 条副词条词条名不合法`, level: "hard" });
        return;
      }
      // 不重复原则
      if (seenStats.has(s.stat)) {
        errors.push({ field: path, msg: `副词条不能与主词条或其他副词条重复：${s.stat}`, level: "hard" });
      }
      seenStats.add(s.stat);

      // 数值
      if (!isNum(s.value)) {
        errors.push({ field: path + ".value", msg: `${s.stat} 数值无效`, level: "hard" });
      } else if (s.value <= 0) {
        errors.push({ field: path + ".value", msg: `${s.stat} 数值必须大于 0`, level: "hard" });
      } else {
        const umax = C.UMAX[s.stat];
        // 单位一致性：百分比词条应填百分数（值 ≤ 100 视为百分数）；数值词条应填数值
        const type = C.STAT_TYPE[s.stat];
        if (type === "percent" && s.value > 100) {
          errors.push({ field: path + ".value", msg: `${s.stat} 为百分比词条，请填百分数（0~100）`, level: "hard" });
        }
        // 物理上限：单条词条最多 6 次 roll，显示值 ≤ Umax × 6
        if (s.value > umax * C.MAX_ROLLS_PER_STAT) {
          errors.push({ field: path + ".value", msg: `${s.stat} 数值超出理论上限（≤ ${(umax * C.MAX_ROLLS_PER_STAT).toFixed(1)}）`, level: "hard" });
        }
      }
      // 激活状态
      if (typeof s.activated !== "boolean") {
        errors.push({ field: path + ".activated", msg: `第 ${i + 1} 条副词条激活状态缺失`, level: "hard" });
      }
    });

    return errors;
  }

  // —— 角色配置校验 ——
  /**
   * @returns {{hard:Array, soft:Array}}
   */
  function validateRoleConfig(role) {
    const hard = [], soft = [];
    if (!role) { hard.push({ field: "role", msg: "角色为空" }); return { hard, soft }; }

    // 角色名
    if (!role.name || !String(role.name).trim()) {
      hard.push({ field: "name", msg: "角色名不能为空" });
    }
    // 有效词条
    const eff = Array.isArray(role.effectiveStats) ? role.effectiveStats : [];
    if (eff.length === 0) {
      hard.push({ field: "effectiveStats", msg: "至少需要一个有效词条" });
    }
    // 权值
    const w = role.weights || {};
    eff.forEach(stat => {
      const wv = w[stat];
      if (!isNum(wv) || wv <= 0) {
        hard.push({ field: `weights.${stat}`, msg: `有效词条 ${stat} 必须配置权值` });
      } else if (wv > C.MAX_WEIGHT) {
        hard.push({ field: `weights.${stat}`, msg: `权值不能超过 ${C.MAX_WEIGHT}` });
      }
    });
    // 散件部位（允许为空 = 无散件，如 5 件全套装）
    if (role.looseSlot != null && role.looseSlot !== "" && !C.SLOT_KEYS.includes(role.looseSlot)) {
      hard.push({ field: "looseSlot", msg: "散件部位不合法" });
    }
    // 5 部位（软性：允许未录全）
    const arts = role.artifacts || {};
    const missing = C.SLOT_KEYS.filter(k => !arts[k] || !arts[k].mainStat);
    if (missing.length > 0) {
      soft.push({ field: "artifacts", msg: `还有 ${missing.length} 个部位未录入，评分暂不完整` });
    }
    // 充能
    if (isNum(role.erRequirement) && role.erRequirement < 100) {
      soft.push({ field: "erRequirement", msg: "充能需求一般不低于 100%" });
    }
    if (isNum(role.currentER) && role.currentER < 100) {
      soft.push({ field: "currentER", msg: "面板充能一般不低于 100%" });
    }
    // 元素（软性：允许为空 = 不显示元素图标；非空时必须为 7 元素之一）
    if (role.element && !C.ELEMENT_KEYS.includes(role.element)) {
      soft.push({ field: "element", msg: `元素「${role.element}」不在可选范围内` });
    }
    // 充能（软性）：充能是有效词条但需求/面板未填写 → 提示（不阻止保存）
    if (eff.includes("元素充能效率") && (!isNum(role.erRequirement) || !isNum(role.currentER))) {
      soft.push({ field: "erRequirement", msg: "充能是有效词条，建议填写充能需求与当前面板充能（算法会按阈值扣减超额充能）" });
    }
    return { hard, soft };
  }

  // —— 全量校验（导入用）——
  /**
   * 校验整个 store 的结构合法性。
   * 注意：effectiveStats/weights 等「角色配置」允许为空（外部导入后可手动补充），
   * 此处只校验：角色名唯一 + 已录入圣遗物数据合法。
   * @returns {Array<{role:string, field:string, msg:string}>} 全部硬错误
   */
  function validateStore(store) {
    const errors = [];
    if (!store || !Array.isArray(store.roles)) {
      return [{ role: "-", field: "store", msg: "数据结构不合法（缺少 roles 数组）" }];
    }
    const nameSeen = new Set();
    store.roles.forEach((role, ri) => {
      const label = role && role.name ? role.name : `角色 #${ri + 1}`;
      // 角色名唯一
      if (role && role.name) {
        if (nameSeen.has(role.name)) {
          errors.push({ role: label, field: "name", msg: `存在重名角色：${role.name}` });
        }
        nameSeen.add(role.name);
      }
      // 各部位圣遗物数据合法性（角色配置缺失不阻止导入，可后补）
      (C.SLOT_KEYS).forEach(slot => {
        const art = role && role.artifacts && role.artifacts[slot];
        if (!art) return; // 未录（软性）
        validateArtifact(art).forEach(e => {
          if (e.level === "hard") errors.push({ role: label, field: `artifacts.${slot}.${e.field}`, msg: e.msg });
        });
      });
    });
    return errors;
  }

  // —— 判断角色是否录全 5 部位 ——
  function missingSlots(role) {
    const arts = (role && role.artifacts) || {};
    return C.SLOT_KEYS.filter(k => !arts[k] || !arts[k].mainStat);
  }

  global.App = global.App || {};
  global.App.data = { validateArtifact, validateRoleConfig, validateStore, missingSlots };
})(window);
