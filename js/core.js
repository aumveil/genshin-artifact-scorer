/**
 * core.js - 算法层（对应《圣遗物网页实现方案.md》2.9 与定稿《圣遗物评分算法设计.md》）
 * 全部为纯函数，无 DOM 依赖。
 * 全局命名空间：App.core
 */
(function (global) {
  "use strict";
  const C = global.App.constants;

  // ============ 算法一：单件圣遗物词条计算 ============
  /** 单件加权有效词条数（仅已激活 + 有效词条） */
  function calcArtifactScore(S, role) {
    if (!S || !role) return 0;
    const eff = role.effectiveStats || [];
    const w = role.weights || {};
    let total = 0;
    (S.substats || []).forEach(s => {
      if (s.activated === false) return;             // 待激活不计
      if (eff.includes(s.stat) && C.UMAX[s.stat]) {
        total += (s.value / C.UMAX[s.stat]) * (w[s.stat] || 0);
      }
    });
    return total;
  }

  // ============ 算法二：角色圣遗物评分 ============
  /** 可用有效词条集：E(slot) = effectiveStats − {mainStat(slot)} */
  function E(slot, role) {
    const eff = (role.effectiveStats || []).slice();
    const art = role.artifacts && role.artifacts[slot];
    const ms = art && art.mainStat;
    if (ms && eff.includes(ms)) {
      return eff.filter(x => x !== ms);
    }
    return eff;
  }

  /** 该部位可用有效词条的最高权值（E 为空则 0） */
  function maxW(slot, role) {
    const w = role.weights || {};
    let m = 0;
    E(slot, role).forEach(s => { if ((w[s] || 0) > m) m = w[s]; });
    return m;
  }

  /** 每部位完美词条数 = init + 5 × maxW */
  function calcPerfect(slot, role) {
    const es = E(slot, role);
    const w = role.weights || {};
    // init：E 中权值最高的前 min(4,|E|) 条权值和
    const top = es.slice().sort((a, b) => (w[b] || 0) - (w[a] || 0)).slice(0, Math.min(4, es.length));
    const init = top.reduce((sum, s) => sum + (w[s] || 0), 0);
    const mw = maxW(slot, role);
    return init + 5 * mw;
  }

  /** 充能超额惩罚（直接全扣，不区分来源） */
  function calcEnergyPenalty(role) {
    const er = role.erRequirement, cur = role.currentER;
    if (!isFinite(er) || !isFinite(cur)) return 0;
    const excess = Math.max(0, (cur - er) / C.UMAX["元素充能效率"]); // (currentER−req)/6.5%
    const wER = (role.weights || {})["元素充能效率"] || 0;
    return excess * wER;
  }

  /** 角色评分：total + perfectTotal + adjustedTotal + percent(封底0) + tags */
  function calcCharacterScore(role) {
    let total = 0, perfectTotal = 0;
    C.SLOT_KEYS.forEach(slot => {
      total += calcArtifactScore(role.artifacts && role.artifacts[slot], role);
      perfectTotal += calcPerfect(slot, role);
    });
    const penalty = calcEnergyPenalty(role);
    const adjustedTotal = total - penalty;
    const tags = [];
    if (isFinite(role.currentER) && isFinite(role.erRequirement) && role.currentER < role.erRequirement) {
      tags.push(`充能不足，缺 ${(role.erRequirement - role.currentER).toFixed(0)}%`);
    }
    const percent = perfectTotal > 0 ? Math.max(0, adjustedTotal / perfectTotal * 100) : 0;
    return { words: total, adjustedWords: adjustedTotal, perfect: perfectTotal, percent, tags };
  }

  // ============ 算法三：圣遗物价值评估（含强化潜力）============
  /** 剩余未解锁强化次数：max(0, 5 − floor(level/4)) */
  function remaining(level) {
    const lv = Number.isInteger(level) ? level : 0;
    return Math.max(0, 5 - Math.floor(lv / 4));
  }

  /** 该件圣遗物副词条提供的充能百分比贡献（面板口径，% 数值） */
  function ERContrib(artifact) {
    if (!artifact) return 0;
    let sum = 0;
    (artifact.substats || []).forEach(s => {
      if (s.activated !== false && s.stat === "元素充能效率") sum += s.value;
    });
    return sum;
  }

  /**
   * 核心比较函数（情况一/二共用）：新圣遗物 vs 指定被替换件
   * @returns {Object} worthy/verdict/currentScore/newCurrentScore/potentialScore/remaining/diffToCurrent/newER/tags/newPercent
   */
  function evaluateAgainst(newArtifact, oldArtifact, role) {
    const slot = newArtifact.slot;
    const curScore = calcArtifactScore(oldArtifact, role);
    const newCurrent = calcArtifactScore(newArtifact, role);

    const pending = (newArtifact.substats || []).filter(s => s.activated === false);
    let pendingContrib = 0;
    pending.forEach(s => {
      const w = (role.weights || {})[s.stat] || 0;
      if (C.UMAX[s.stat]) pendingContrib += (s.value / C.UMAX[s.stat]) * w;
    });

    const rem = remaining(newArtifact.level);
    // 强化叠加只能落在「已有副词条（含待激活）」上（游戏机制：副词条种类确定后不再新增）：
    // 叠加权重 = 已有词条中有效词条的最高权值；若全部为无效词条 → 0（强化对评分无提升）
    let maxWExist = 0;
    (newArtifact.substats || []).forEach(s => {
      const w = (role.weights || {})[s.stat] || 0;
      if (w > maxWExist) maxWExist = w;
    });
    const potential = newCurrent + pendingContrib
                    + Math.max(0, rem - pending.length) * maxWExist;

    // 充能联动（仅按副词条充能差；主词条充能变化需手动更新 currentER）
    const newER = (isFinite(role.currentER) ? role.currentER : 0)
                - ERContrib(oldArtifact) + ERContrib(newArtifact);

    const tags = [];
    if (isFinite(role.erRequirement) && newER < role.erRequirement) {
      tags.push(`充能不足，缺 ${(role.erRequirement - newER).toFixed(0)}%`);
    }

    // 判定（判定与评分解耦）
    const diff = potential - curScore;
    // 充能未配置（erRequirement 非数值）时跳过充能约束；配置了则要求替换后满足需求底线
    const erConfigured = isFinite(role.erRequirement);
    const erOk = !erConfigured || newER >= role.erRequirement;
    let worthy, verdict;
    if (newArtifact.level >= C.MAX_LEVEL) {
      // 满级：词条有提升 且 替换后充能满足需求底线（未配置充能则无充能约束）
      worthy = (diff > C.MIN_DIFF) && erOk;
      if (worthy) verdict = "建议替换";
      else if (erConfigured && newER < role.erRequirement) verdict = "不建议替换（替换后充能不足）";
      else verdict = "不建议替换（词条无提升）";
    } else {
      // 未满级：仅判定是否值得强化
      worthy = diff >= 0;
      verdict = worthy ? "值得强化" : "不值得强化";
    }

    // 替换后评分（仅满级输出，封底 0 分）
    let newPercent = null;
    if (newArtifact.level >= C.MAX_LEVEL) {
      const char = calcCharacterScore(role);
      const newTotal = char.words - curScore + potential; // 满级 potential == newCurrent
      const newPenalty = erConfigured
        ? Math.max(0, (newER - role.erRequirement) / C.UMAX["元素充能效率"]) * ((role.weights || {})["元素充能效率"] || 0)
        : 0;   // 未配置充能 → 无充能惩罚
      const newAdjusted = newTotal - newPenalty;
      newPercent = char.perfect > 0 ? Math.max(0, newAdjusted / char.perfect * 100) : 0;
    }

    return {
      worthy, verdict,
      currentScore: curScore,
      newCurrentScore: newCurrent,
      potentialScore: potential,
      remaining: rem,
      diffToCurrent: diff,
      newER, tags, newPercent
    };
  }

  /**
   * 判断新圣遗物是否为「角色所穿套装的部件」：
   * 其 set 与角色除散件部位外任一已穿戴部位的 set 相同。
   * 用于情况三识别：套装件替换散件 → 替换后该部位变为套装件。
   */
  function isSetPiece(art, role) {
    if (!art || !art.set) return false;
    return C.SLOT_KEYS.some(slot => {
      if (slot === role.looseSlot) return false;
      const a = role.artifacts && role.artifacts[slot];
      return a && a.set === art.set;
    });
  }

  /**
   * 主入口：评估新圣遗物的所有潜在使用方式（情况一/二/三 + 汇总）
   * @returns {Object} {valuable, summary, results:[{case,...evaluateAgainst 结果}]}
   */
  function evaluateArtifact(newArtifact, role) {
    const results = [];
    // 情况一/三：作为散件（部位 = 散件部位 且 主词条与被替换散件一致——主词条不同不算替换）
    const oldLoose = role.artifacts && role.artifacts[role.looseSlot];
    if (role.looseSlot != null && newArtifact.slot === role.looseSlot && oldLoose
        && newArtifact.mainStat === oldLoose.mainStat) {
      const r = evaluateAgainst(newArtifact, oldLoose, role);
      // 情况三：新件是角色所穿套装的部件 → 替换后散件部位变为套装件（角色失去散件）
      r.isSetSwap = isSetPiece(newArtifact, role);
      r.case = r.isSetSwap ? "散件(变为套装件)" : "散件";
      results.push(r);
    }
    // 情况二：作为套装件（同部位、该部位是套装件而非散件、同套装、同主词条）
    const equipped = role.artifacts && role.artifacts[newArtifact.slot];
    if (equipped && newArtifact.slot !== role.looseSlot
        && newArtifact.set === equipped.set && newArtifact.mainStat === equipped.mainStat) {
      const r = evaluateAgainst(newArtifact, equipped, role);
      r.case = "套装替换";
      results.push(r);
    }

    const valuable = results.length > 0 && results.some(r => r.worthy);
    let summary;
    if (valuable) summary = "有价值";
    else if (results.length === 0) summary = "无适用场景";
    else summary = "无价值";

    return { valuable, summary, results };
  }

  global.App = global.App || {};
  global.App.core = {
    calcArtifactScore, calcPerfect, calcEnergyPenalty, calcCharacterScore,
    maxW, remaining, ERContrib, evaluateAgainst, evaluateArtifact
  };
})(window);
