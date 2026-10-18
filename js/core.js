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

  /**
   * 充能是否适用于该角色：有效词条含「元素充能效率」。
   * 【唯一来源】算法层与 UI 都读它——首页「无充」徽章、配置弹窗充能输入框禁用、评估结果充能提示，口径必须一致。
   * 2026-10-17 修：此前算法层只看 erRequirement/currentER 是否有限，不看该角色是否把充能列为有效词条，
   * 导致 38/77 个「无充」角色仍被算超额惩罚、仍发「充能满足 / 充能不足」提示（与首页「无充」徽章直接矛盾）。
   * 背景：erRequirement/currentER 是历史字段，取消勾选有效词条时并不立即清空（保存时才写 null），
   * 导入的旧数据更是普遍保留占位 180/180 ——「有数值」不等于「该角色评估充能」。
   */
  function erApplies(role) {
    return !!((role && role.effectiveStats) || []).includes("元素充能效率");
  }

  /** 充能超额惩罚（直接全扣，不区分来源）；不看充能的角色恒 0（2026-10-17） */
  function calcEnergyPenalty(role) {
    if (!erApplies(role)) return 0;                    // 未把充能列为有效词条 → 超额不扣分
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
    // 「充能不足」标签同样只对看充能的角色产生（2026-10-17）——否则首页会给无充角色挂红「充能」徽章
    if (erApplies(role) && isFinite(role.currentER) && isFinite(role.erRequirement) && role.currentER < role.erRequirement) {
      tags.push(`充能不足，缺 ${(role.erRequirement - role.currentER).toFixed(0)}%`);
    }
    const percent = perfectTotal > 0 ? Math.max(0, adjustedTotal / perfectTotal * 100) : 0;
    return { words: total, adjustedWords: adjustedTotal, perfect: perfectTotal, percent, tags };
  }

  // ============ R2：分数构成（按词条分组的加权贡献，与 calcArtifactScore 同口径） ============
  /** 分数构成：返回 [{stat, label, value, pct}] 按贡献降序；不含无效 / 待激活词条 */
  function scoreComposition(role) {
    if (!role) return [];
    const eff = role.effectiveStats || [];
    const w = role.weights || {};
    const acc = {};
    let total = 0;
    C.SLOT_KEYS.forEach(slot => {
      const S = role.artifacts && role.artifacts[slot];
      if (!S) return;
      (S.substats || []).forEach(s => {
        if (s.activated === false) return;
        if (!eff.includes(s.stat) || !C.UMAX[s.stat]) return;
        const v = (s.value / C.UMAX[s.stat]) * (w[s.stat] || 0);
        acc[s.stat] = (acc[s.stat] || 0) + v;
        total += v;
      });
    });
    return Object.keys(acc)
      .map(stat => ({ stat, label: C.MAIN_SHORT[stat] || stat, value: acc[stat], pct: total > 0 ? (acc[stat] / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);
  }

  // ============ 算法三：圣遗物价值评估（含强化潜力）============
  /**
   * 剩余未解锁强化次数：max(0, 5 − floor(level/4))。
   * ⚠️ level 先夹取到 [0, MAX_LEVEL] 再向下取整（2026-10-17 修）：原实现「非整数一律当 0 级」，
   *   一旦数据里出现小数/负数（导入绕过校验、旧备份、脚本直改 localStorage），潜力会虚高——
   *   level 20.5 → 当 0 级 → 多算 5 次强化；level −1 → floor(−0.25) = −1 → 6 次（比 0 级还多）。
   *   UI 录入与 validateArtifact 都要求整数 0~20，故正常数据零影响（全库审计 897 用例未触发）。
   */
  function remaining(level) {
    const lv = Number.isFinite(level) ? Math.min(C.MAX_LEVEL, Math.max(0, Math.floor(level))) : 0;
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
   * @returns {Object} worthy/verdict/currentScore/newCurrentScore/potentialScore/remaining/diffToCurrent/newER/tags/curPercent/newPercent
   *   stopNeed / stopTolerance：止损容错（2026-10-17）——「追平」口径，仅「未达但满级可追平」的行非 null（见函数内注释）
   *   curPercent / newPercent：替换前 / 替换后的角色达成度%（均仅满级非 null；同分母，供「达成度对照条」）
   */
  function evaluateAgainst(newArtifact, oldArtifact, role) {
    const slot = newArtifact.slot;
    const curScore = calcArtifactScore(oldArtifact, role);
    const newCurrent = calcArtifactScore(newArtifact, role);

    // ⚠️ 「有效词条」判定（2026-10-17 修）：pendingContrib 与 maxWExist 都必须过 `effectiveStats`，
    //    与 calcArtifactScore / calcRemodel 同口径。role.weights 可能残留**非有效词条**的键
    //    （角色配置里取消勾选只删 effectiveStats、不清 weights，导入也不校验多余键），
    //    只查 weights 会把无效词条当成有效：待激活词条凭空计分、强化叠加也能砸在它上面。
    //    定稿文档 §4.2 明写「若该词条非有效词条，贡献 0」「maxW(slot) = 该部位可用有效词条的最高权值」。
    //    现网实例：钟离 eff = 暴击率/生命值% 但 weights 残留「生命值」=1，0 级新沙（副条全无效词条池）
    //    曾被算成 +0.41 词条（0.80 待激活 + 4×1.00 叠加），实为 0 潜力。
    const eff = role.effectiveStats || [];
    const pending = (newArtifact.substats || []).filter(s => s.activated === false);
    let pendingContrib = 0;
    pending.forEach(s => {
      if (!eff.includes(s.stat)) return;                       // 非有效词条 → 贡献 0（文档 §4.2）
      const w = (role.weights || {})[s.stat] || 0;
      if (C.UMAX[s.stat]) pendingContrib += (s.value / C.UMAX[s.stat]) * w;
    });

    const rem = remaining(newArtifact.level);
    // 强化叠加只能落在「已有副词条（含待激活）」上（游戏机制：副词条种类确定后不再新增）：
    // 叠加权重 = 已有词条中**有效**词条的最高权值；若全部为无效词条 → 0（强化对评分无提升）
    let maxWExist = 0;
    (newArtifact.substats || []).forEach(s => {
      if (!eff.includes(s.stat)) return;                       // 同上：残留权值键不参与叠加
      const w = (role.weights || {})[s.stat] || 0;
      if (w > maxWExist) maxWExist = w;
    });
    const potential = newCurrent + pendingContrib
                    + Math.max(0, rem - pending.length) * maxWExist;

    // 充能联动（仅按副词条充能差；主词条充能变化需手动更新 currentER）
    const newER = (Number.isFinite(role.currentER) ? role.currentER : 0)
                - ERContrib(oldArtifact) + ERContrib(newArtifact);

    // 「充能已配置」＝ ①该角色把充能列为有效词条（`erApplies`）且 ②需求与面板值**都**是有限数值。
    // ⚠️ ① 是 2026-10-17 补的：erRequirement/currentER 是历史字段，取消勾选有效词条不会立即清空，
    //    导入的旧数据更普遍保留占位 180/180 —— 只看数值有限性会让 38/77 个「无充」角色照发充能提示
    //    （全库审计 182 例：钟离等角色评估带充能的新件时显示「充能满足」，而首页徽章写着「无充」）。
    // ⚠️ ② 必须用 Number.isFinite：全局 isFinite(null) 返回 true（Number(null)=0），
    //    会把「未配置充能」当成需求量 0%，进而输出虚假的「充能不足」提示（2026-09-29 修）。
    const erConfigured = erApplies(role)
      && Number.isFinite(role.erRequirement) && Number.isFinite(role.currentER);
    const erOk = !erConfigured || newER >= role.erRequirement;

    // —— 充能提示（2026-09-29 二次口径变更 · 用户指示）——
    // 提示同时看「这次替换对充能做了什么（Δ = newER − currentER）」与「替换后是否达标」：
    //   Δ < 0 且替换后不足 → 「充能不足，缺 X%」   （lack，红）
    //   Δ > 0 且替换后仍不足 → 「充能补足，还差 X%」（partial，黄）
    //   Δ > 0 且替换后达标 → 「充能满足」          （met，绿）
    //   Δ = 0 / 下降但仍达标 / 充能未配置 → 无提示
    // 旧口径只看 newER < erRequirement，会把「正在补足充能的替换」也标成「充能不足」。
    // Δ 取 2 位小数：抵消浮点尾差（如 180−18.1+18.1 = 180.00000000000003），
    // 否则「充能未变化」会被误判为「增加」并给出「充能满足」。
    const erDelta = erConfigured ? Math.round((newER - role.currentER) * 100) / 100 : 0;
    const tags = [];
    let erTagLevel = null;                                   // null | "lack" | "partial" | "met"（UI 配色用）
    if (erConfigured) {
      const gap = role.erRequirement - newER;                // > 0 表示替换后仍缺口
      if (erDelta < 0 && gap > 0) {
        tags.push(`充能不足，缺 ${gap.toFixed(0)}%`);
        erTagLevel = "lack";
      } else if (erDelta > 0 && gap > 0) {
        tags.push(`充能补足，还差 ${gap.toFixed(0)}%`);
        erTagLevel = "partial";
      } else if (erDelta > 0) {
        tags.push("充能满足");
        erTagLevel = "met";
      }
    }

    // 判定（判定与评分解耦）
    const diff = potential - curScore;
    // 充能约束（2026-09-29 口径变更 · 用户指示按方案 C 修改）：
    //   **充能不足不再否决替换**，仅以 tags（「充能不足，缺 X%」）在 UI 上提示。
    //   变更原因：原口径把「替换后 newER ≥ erRequirement」作为满级替换的硬条件，
    //   而多数角色的 currentER 与 erRequirement 同值（导入占位默认 180/180，零余量），
    //   于是任何降低充能副词条、但词条当量明显更优的替换都会被否掉
    //   （实测：七七新羽 +1.21 词条仍被判「不建议替换（替换后充能不足）」）。
    //   erConfigured / erOk 仍然计算并返回，供 UI 展示提示与后续扩展。
    let worthy, verdict;
    if (newArtifact.level >= C.MAX_LEVEL) {
      // 满级：只看词条是否有提升；充能不足仅提示、不否决（超额仍按算法二扣分）
      worthy = diff > C.MIN_DIFF;
      verdict = worthy ? "建议替换" : "不建议替换（词条无提升）";
    } else {
      // 未满级：仅判定是否值得强化。
      // ⚠️ 除 diff ≥ 0 外还要求潜力 > 0（2026-10-17 用户拍板）：
      //   新旧件同为 0 分时（该角色对两件都吃不到任何有效词条，含 effectiveStats 为空的角色），
      //   diff = 0 会让「0 分换 0 分」也显示「+0.00 词条 / 值得强化」。潜力 0 = 强化 5 次也不会有
      //   任何有效词条可叠加 → 根本没有超越机会，不该判值得（全库审计 22 例：七七/心海/珐露珊的
      //   0 分现役件，以及爱诺/五郎有效词条为空时的全部位）。
      //   「恰好追平」不受影响：那种情形潜力必然 > 0（如 2.5 vs 2.5），仍判值得强化。
      worthy = diff >= 0 && potential > 0;
      verdict = worthy ? "值得强化" : "不值得强化";
    }

    // —— 止损容错（2026-10-17 用户要求，「替换角度」版）——
    // 「追平」口径：新件未达现有件分、但满级可达（diff ≥ 0 与「值得强化」同界）时，
    // 还需至少命中 stopNeed 次（满挡命中最高权值词条的当量口径，与潜力公式同源）才能追平（≥ curScore）；
    // stopTolerance = m − stopNeed = 还能歪几次——歪满 (容错+1) 次后即无望（剩余全中满值也追不上）。
    // ⚠️ 与藏品视角口径的差异（有意为之）：藏品为「严格超过藏品值」，此处为「追平（≥）」（2026-10-17 用户拍板）。
    // 显示条件：diff ≥ 0 且当前未达（base < curScore）；其余（已达成 / 追不上 / 满级无可叠加强化）→ null。
    // UI（stopLossDisplay）：满级 null →「已满级」（黄同款）；其余 null →「—」（灰）。
    const stopBase = newCurrent + pendingContrib;
    const stopM = Math.max(0, rem - pending.length);
    let stopNeed = null, stopTolerance = null;
    if (diff >= 0 && stopBase < curScore) {
      for (let k = 0; k <= stopM; k++) {
        if (stopBase + k * maxWExist >= curScore) { stopNeed = k; stopTolerance = stopM - k; break; }
      }
    }

    // 替换前 / 后评分（仅满级输出，封底 0 分）——2026-10-17 起成对返回：
    //   curPercent = 角色当前（替换前）达成度；newPercent = 替换后达成度（两者同分母 perfectTotal）。
    let newPercent = null, curPercent = null;
    if (newArtifact.level >= C.MAX_LEVEL) {
      const char = calcCharacterScore(role);
      curPercent = char.percent;
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
      stopNeed, stopTolerance, // 止损容错（2026-10-17）：追平口径（≥）；null = 不适用（已达成 / 追不上 / 无强化次数）
      newER, tags, curPercent, newPercent,
      erConfigured, erOk,      // 充能是否配置 / 替换后是否达标（提示用，不参与判定）
      erDelta,                 // 面板充能变化量（newER − currentER，2 位小数）
      erTagLevel               // 充能提示级别：null | "lack"（不足红）| "partial"（补足黄）| "met"（满足绿）
    };
  }

  /**
   * 5 部位是否录全（每件都已有 set）——「角色套装」字段（role.sets）的生效前提。
   * 未录全 → 该字段不生效，「取角色套装」一律返回空（当这个角色不存在，2026-10-09 口径）。
   */
  function isFullyRecorded(role) {
    if (!role) return false;
    const arts = role.artifacts || {};
    return C.SLOT_KEYS.every(k => !!(arts[k] && arts[k].set));
  }

  /**
   * 【唯一来源】角色所穿套装（2026-10-09 起由角色级字段 `role.sets` 固化，不再从圣遗物实时推导）。
   * 语义（用户口径）：1 个 = 四件套（4+1，含 5 件同套）；2 个 = 两个两件套（2+2+1）；空 = 其他（不判套装）。
   * 返回 [] 的两种情形等价处理：
   *   ① 5 部位未录全 → 当这个角色不存在（不读字段、不做一致性检测、不作为判定对象与宿主）
   *   ② `sets` 为空/非法 → 留空＝「其他」，一切套装类判定停用
   * 为何放在 core：算法层需要它，且 data.js 依赖 core 的常量，反向引用会成环。
   */
  function roleSets(role) {
    if (!isFullyRecorded(role)) return [];
    const s = role.sets;
    if (!Array.isArray(s)) return [];
    return s.filter(x => typeof x === "string" && x.trim() !== "").slice(0, 2);
  }

  /** 该角色是否「判套装」（roleSets 非空）——套装类结论的总开关 */
  function hasSetInfo(role) {
    return roleSets(role).length > 0;
  }

  /**
   * 判断新圣遗物是否为「角色所穿套装的部件」：
   * 其 set ∈ 角色所穿套装集合（roleSets）。用于情况三识别：套装件替换散件 → 替换后该部位变为套装件。
   * 2026-10-09 改：此前是遍历「除散件位外任一已穿戴部位」的 set 实时比较；现统一读角色套装字段。
   */
  function isSetPiece(art, role) {
    if (!art || !art.set) return false;
    return roleSets(role).includes(art.set);
  }

  /**
   * looseSlot 是否显式设置了散件位。
   * null / undefined / 空串 三者均表示「无散件」——data.js 的校验把空串与 null 同为合法值
   * （「允许为空 = 无散件」），持久化/导入的历史数据可能带空串，算法层必须同口径处理。
   */
  function hasLooseSlot(role) {
    const ls = role && role.looseSlot;
    return ls != null && ls !== "";
  }

  /**
   * 自由位判定（方案 A，2026-09-28）：该角色当前「可自由替换」的部位列表——
   * 即换成异套件也不会损失套装效果的位置（散件位 / 冗余位）。
   * - 显式设置了 looseSlot：仅该部位（既有语义完全不变）
   * - looseSlot 为空（无散件 / 全套装）：部位 S 可自由替换 ⟺ 除 S 外其余 4 件均已录入且同属一套
   *   - 5 件全同套 → 5 个部位全为自由位：任意一件都是冗余件，换掉后仍是 4 件套（原神无 5 件套效果，不损失加成）
   *   - 4 件同套 + 1 件异套 → 仅那 1 件（真正的冗余位）
   *   - 2+2+1 等分散套装 → 无自由位（换掉任一件都会破坏 2 件套）→ 保守不评估
   */
  function freeSlots(role) {
    if (!role) return [];
    if (hasLooseSlot(role)) return [role.looseSlot];
    const arts = role.artifacts || {};
    return C.SLOT_KEYS.filter(slot => {
      if (!arts[slot]) return false;                      // 该部位未录入 → 无被替换件
      const others = C.SLOT_KEYS.filter(k => k !== slot).map(k => arts[k]);
      if (others.some(a => !a || !a.set)) return false;    // 其余部位未录全 → 无法判定
      return others.every(a => a.set === others[0].set);   // 其余 4 件同套 → 该部位可自由替换
    });
  }

  /**
   * 主入口：评估新圣遗物的所有潜在使用方式（情况零 首次装备 / 一·一′ 自由件 / 二 / 三 + 汇总）
   * 2026-10-09 口径（角色套装字段固化后）：
   *  - 情况二/三 属「套装类结论」，需该角色**判套装**（`hasSetInfo`）才产生；
   *    留空（「其他」）或 5 部位未录全（当这个角色不存在）→ 只剩情况一/一′（纯词条 + looseSlot 判定）。
   *  - 情况一/一′ 判定依据是 `looseSlot` / `freeSlots`（部位级），与本字段无关，保持不变。
   * 2026-10-18 新增「情况零：首次装备」（用户拍板，见实现方案 §8.36）：
   *  - 该部位**尚无已穿戴件**时，情况一/一′/二的前提（`equipped` 存在）全不成立，旧实现直接判
   *    「无适用场景」——新建角色逐件录入的**前 5 次必然命中**，且未满级件在弹窗里没有任何录入口。
   *  - 现口径：无现役件 = 被替换件为「0 分件」，复用 evaluateAgainst(new, null) —— 数学上自洽
   *    （curScore=0、diff=潜力、达成度 0%→替换后），不新增评价维度，也不预测套装（此时 5 部位未录全，
   *    roleSets 本就返回空）。
   *  - 该分支**优先于一切套装/散件判定**：空位装什么都不会破坏现有搭配，无需 looseSlot / sets。
   * @returns {Object} {valuable, summary, emptySlot, results:[{case,...evaluateAgainst 结果}]}
   */
  function evaluateArtifact(newArtifact, role) {
    const results = [];
    const equipped = role.artifacts && role.artifacts[newArtifact.slot];
    const setInfo = hasSetInfo(role);   // 该角色是否判套装（套装类结论总开关）

    if (!equipped) {
      // 情况零：首次装备（该部位为空）——套装上下文此时尚未成立（5 部位未录全 → roleSets 返回空），
      // 也不必判断：空位装任何件都不会破坏现有搭配，只看这件的词条价值。
      const r = evaluateAgainst(newArtifact, null, role);
      r.emptySlot = true;
      r.case = "首次装备";
      // verdict 覆写：evaluateAgainst 的「建议替换 / 不建议替换」在空位场景不成立
      const full = newArtifact.level >= C.MAX_LEVEL;
      r.verdict = r.worthy
        ? (full ? "建议装备" : "值得强化")
        : (full ? "不建议装备（无有效词条）" : "不值得强化");
      results.push(r);
      return {
        valuable: r.worthy, emptySlot: true,
        summary: r.worthy ? "有价值" : "无价值",
        results
      };
    }

    // 情况二：作为套装件（同部位、该部位是套装件而非散件、同套装、同主词条）
    const isSetReplace = !!(setInfo && equipped && newArtifact.slot !== role.looseSlot
      && newArtifact.set === equipped.set && newArtifact.mainStat === equipped.mainStat);

    // 情况一/一′/三：作为散件（looseSlot 显式指定）或自由件（looseSlot 为空 → 冗余位自动识别）
    // 要求部位 ∈ 自由位 且 主词条与被替换件一致（主词条不同不算替换）；
    // 同套同主词条已由情况二覆盖（同一被替换件、同一公式），此处跳过以免重复评估
    if (!isSetReplace && equipped && newArtifact.mainStat === equipped.mainStat
        && freeSlots(role).includes(newArtifact.slot)) {
      const r = evaluateAgainst(newArtifact, equipped, role);
      // 情况三：新件是角色所穿套装的部件 → 替换后散件部位变为套装件（角色失去散件）。
      // 仅在显式配置了散件位时成立——looseSlot 为空（null/undefined/空串）时本无散件可失去（自由位即冗余位）
      const hasLoose = hasLooseSlot(role);
      r.isSetSwap = hasLoose && isSetPiece(newArtifact, role);
      r.case = hasLoose ? (r.isSetSwap ? "散件(变为套装件)" : "散件") : "自由件";
      results.push(r);
    }

    if (isSetReplace) {
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

  // ============ 算法四：圣遗物重塑价值评估（定稿算法文档第五章）============
  /** 组合数 C(n, x) */
  function comb(n, x) {
    let r = 1;
    for (let i = 1; i <= x; i++) r = r * (n - i + 1) / i;
    return r;
  }

  /**
   * 安全网期望命中次数 E[Y_k]：X ~ B(n, 1/2)，Y = max(X, k)
   * 游戏的「动态检测」实现（歪满保底缺口后剩余强化强制命中指定词条）与其数学等价。
   * E[Y_k] = n/2 + Σ_{x=0}^{k-1} C(n,x)/2ⁿ · (k−x)
   */
  function expectedHits(n, k) {
    let e = n / 2;
    for (let x = 0; x < k; x++) e += (comb(n, x) / Math.pow(2, n)) * (k - x);
    return e;
  }

  /**
   * 单件重塑价值计算（算法文档 5.3/5.4）。
   * E[remodel] = ROLL_AVG × [Σw_init + E[Y_k]·(w1+w2)/2 + (n−E[Y_k])·(w3+w4)/2]
   * RV = E[remodel] − currentScore（期望净提升，主排序指标）
   * @param artifact    满 5★ 圣遗物
   * @param role        角色配置（决定词条权值）
   * @param k           保底档位：2 基础 / 3 高阶 / 4 谕告（默认基础档——保守、不依赖账号圣言解明进度）
   * @param initialCount 初始词条数 4（默认，n=5）或 3（n=4，第 1 次强化生成第 4 词条且重塑中不变）
   * @returns null（未满级 / 无有效词条）或 {w1,w2,w34,sumW,n,k,eY,eRemodel,currentScore,rv,achieve,floors,ceiling,dust,efficiency,suggest}
   */
  function calcRemodel(artifact, role, k = C.REMODEL_K.basic, initialCount = 4) {
    if (!artifact || !role) return null;
    if (artifact.level < C.MAX_LEVEL) return null;          // 仅满级件可重塑
    const w = role.weights || {};
    const eff = role.effectiveStats || [];
    const entries = (artifact.substats || [])
      .filter(s => s.activated !== false)                    // 防御式：待激活词条不计（满级件不应存在）
      .map(s => ({ stat: s.stat, w: eff.includes(s.stat) ? (w[s.stat] || 0) : 0 }))
      .sort((a, b) => b.w - a.w);
    const w1 = entries[0] ? entries[0].w : 0;
    const w2 = entries[1] ? entries[1].w : 0;
    const w34 = (entries[2] ? entries[2].w : 0) + (entries[3] ? entries[3].w : 0);
    if (w1 <= 0) return null;                                // 无有效词条，重塑无意义
    const sumW = w1 + w2 + w34;                              // Σw_init（全部副词条有效权值和）
    const n = initialCount === 3 ? 4 : 5;
    const eY = expectedHits(n, k);
    const eRemodel = C.ROLL_AVG * (sumW + eY * (w1 + w2) / 2 + (n - eY) * w34 / 2);
    const current = calcArtifactScore(artifact, role);
    const perfect = calcPerfect(artifact.slot, role);
    const rv = eRemodel - current;
    const dust = C.DUST_COST[artifact.slot] || 1;
    return {
      w1, w2, w34, sumW, n, k, eY,
      eRemodel, currentScore: current,
      rv,                                                    // 主排序指标：期望净提升
      achieve: perfect > 0 ? eRemodel / perfect : 0,         // 期望达成度（算法二 perfect 为分母）
      floors: {                                              // 三档确定性下限（最坏分配）
        basic: C.ROLL_AVG * (sumW + (w1 + w2)),              //   保底 2 次最坏 1+1
        advanced: C.ROLL_AVG * (sumW + (w1 + 2 * w2)),       //   保底 3 次最坏 1+2
        oracle: C.ROLL_AVG * (sumW + 2 * (w1 + w2))          //   保底 4 次最坏 2+2
      },
      ceiling: sumW + n * w1,                                // 组合天花板（满挡口径，托底不抬天花板）
      dust,
      efficiency: rv / dust,                                 // 单位材料效率（展示维度）
      suggest: entries.filter(e => e.w > 0).slice(0, 2).map(e => e.stat)  // 建议指定的 2 条词条（权值 top2 严格最优）
    };
  }

  /** 圣遗物签名（跨角色去重：同一件物理圣遗物在多个角色身上重复录入时只分析一次） */
  function remodelSignature(art) {
    if (!art) return "";
    return [art.set, art.slot, art.mainStat, art.level,
      (art.substats || []).map(s => `${s.stat}:${s.value}:${s.activated !== false ? 1 : 0}`).join("|")
    ].join("#");
  }

  /**
   * 3/4 初始自动推断（2026-09-28 建；**2026-10-10 判据改为区间法**）。
   * 账本：4 初始 = 4 条×1 发初始 + 5 次强化 = 9 发；3 初始 = 3 发初始 + 首次强化生成第 4 条(1 发) + 4 次强化 = 8 发。
   * 判据：每条副词条显示值 v 必落在「k 发档位和的相容区间」内：
   *       k×(min档位 − half) ≤ v ≤ k×(max档位 + half)，k ∈ 1..5（4 初始单条最多 1+4 发）
   *   half = 面板显示舍入半宽（C.DISPLAY_HALF：percent 0.05 / flat 0.5）——显示值本身是四舍五入的结果，
   *   故只要求**区间相容**，不要求能被档位**精确重构**。
   *   ⚠️ 旧口径（等值分解：k 发档位和必须严格等于显示值）把过强假设当硬条件，在档位和「跳档」处两头出错：
   *     ① 漏判可行 k → 明明能判的件被当成「判不了」（实测 379 件里 130 件）；
   *     ② 反向假唯一 → 两可件被错判成确定值（实测 70 件，如攻击力%21 只能凑 41+53+58+58）。
   *   区间排除是**必要条件**（排除一定可靠），包含只是「可能」，故对 4 条词条求可行 k 集合后枚举总和：
   *   仅可 Σ=9 → 4 初始；仅可 Σ=8 → 3 初始；两者皆可（两可）或皆不可（异常录入/Σ 不可能）→ null（回退默认 4 初始）。
   *   显示值 ×100 整数化比较避免浮点尾差；每词条至多 5 次比较（原实现为 ≤56 组枚举）。
   */
  function inferInitialCount(artifact) {
    if (!artifact || artifact.level < C.MAX_LEVEL) return null;
    const subs = (artifact.substats || []).filter(s => s.activated !== false);
    if (subs.length !== 4) return null;                    // 满级恒 4 条；不足则无判据
    const R = subs.map(s => {
      const tiers = C.ROLL_TIERS[s.stat];
      if (!tiers || !(s.value > 0)) return null;           // 未知词条 / 值缺失（理论上不会出现）
      const half = C.DISPLAY_HALF[C.STAT_TYPE[s.stat]] || 0;
      const S = 100;                                       // ×100 整数化
      const lo = Math.round((Math.min.apply(null, tiers) - half) * S);   // 单发下限
      const hi = Math.round((Math.max.apply(null, tiers) + half) * S);   // 单发上限
      const v = Math.round(s.value * S);
      const ks = [];
      for (let k = 1; k <= 5; k++) if (v >= k * lo && v <= k * hi) ks.push(k);
      return ks.length ? ks : null;                        // 任何发数都装不下（超限录入等）
    });
    if (R.some(r => r === null)) return null;
    const feasible = total => {
      for (const k1 of R[0]) for (const k2 of R[1]) for (const k3 of R[2]) for (const k4 of R[3])
        if (k1 + k2 + k3 + k4 === total) return true;
      return false;
    };
    const can4 = feasible(9), can3 = feasible(8);
    if (can4 && !can3) return 4;
    if (can3 && !can4) return 3;
    return null;                                           // 两可或皆否 → 无法唯一判定
  }

  /** 扫描全部角色已穿戴圣遗物 → 满级 5★ 候选（按签名去重，保留首个持有者引用） */
  function collectRemodelCandidates(roles) {
    const seen = new Map();
    (roles || []).forEach(role => {
      C.SLOT_KEYS.forEach(slot => {
        const art = role.artifacts && role.artifacts[slot];
        if (!art || art.level < C.MAX_LEVEL) return;
        const sig = remodelSignature(art);
        if (!seen.has(sig)) seen.set(sig, { artifact: art, sourceRole: role, signature: sig });
      });
    });
    return Array.from(seen.values());
  }

  /**
   * 「角色装备某套装」判定（5.5 情况二/三宿主条件之一）。
   * 2026-10-09 改：此前遍历非散件部位找 `set === setName` 的已穿戴件；
   * 现统一读角色套装字段（`roleSets`）——未录全 / 留空 / 字段不含该套装 → 一律 false。
   */
  function wearsSet(role, setName) {
    return roleSets(role).includes(setName);
  }

  /**
   * 三情况归属判定（算法文档 5.5）→ 可评估对象集合 [{role, case, kind}]。
   * kind = 行动的三情况类别：self（原地强化）| transfer（同套转移）| promote（晋升套装件）。
   * - 情况一：X 是持有者的套装件（slot ≠ looseSlot）→ 评自己（原地强化，baseline = X 对自己当前分）
   * - 情况二：套装件 + 宿主 → 评每个宿主（顶替转移，baseline = 宿主现有件分）
   * - 情况三：散件（slot == looseSlot）→ 不评自身（散件随时可被新散件替换，不值得耗重塑道具），
   *           仅评满足宿主条件的角色（X 对其是天然套装件，转移后凑更高件数套装；A 补散件即可）
   * - 新录入件（sourceRole = null）：游离件，按情况三口径评全部宿主
   * 宿主条件：Y ≠ 持有者 且 Y 装备 X 所属套装（wearsSet）且 Y 在同部位装备同主属性圣遗物
   * （该件对 Y 的套装归属不限——重塑不改主词条，X 只能与同主词条功能位形成替换比较）。
   * host 行动的 kind 由 X 对持有者的身份决定：X 是套装件 → transfer；X 是散件/游离件 → promote。
   */
  function remodelTargets(artifact, sourceRole, roles) {
    if (!artifact) return [];
    const hostKind = sourceRole && artifact.slot !== sourceRole.looseSlot ? "transfer" : "promote";
    const hosts = (roles || []).filter(r =>
      r !== sourceRole &&
      wearsSet(r, artifact.set) &&
      r.artifacts && r.artifacts[artifact.slot] &&
      r.artifacts[artifact.slot].mainStat === artifact.mainStat
    ).map(r => ({ role: r, case: "host", kind: hostKind }));
    // 情况一（套装件恒可评自己）：2026-10-09 起额外要求持有者**判套装**，
    // 否则「这件是不是套装件」无从判定 → 不产生套装类结论（留空 / 未录全角色不再原地强化自评）
    if (sourceRole && hasSetInfo(sourceRole) && artifact.slot !== sourceRole.looseSlot) {
      hosts.unshift({ role: sourceRole, case: "self", kind: "self" });
    }
    return hosts;
  }

  /**
   * 重塑分析主入口（算法文档 5.5/5.6）：逐候选 × 逐可评估对象计算，
   * 统一 RV 骨架 = E[remodel] − 功能位现状分（情况一减自己、二/三减宿主现有件），
   * 每件取 RV 最优行动（互斥：重塑后的件只能装备在一处），按 RV 降序。
   * @param candidates     collectRemodelCandidates 的产物（或同结构数组，新录入件 sourceRole = null）
   * @param roles          全部角色配置
   * @param k              保底档位（默认基础档）
   * @param initialCountOf (candidate) => 3|4，3/4 初始判定；UI 传入「手动切换 > inferInitialCount 档位推断 > 默认 4」链，缺省全部按 4 初始
   * @param allowedKinds   可选，开启的情况类别数组（["self","transfer","promote"] 子集）；
   *                       缺省 = 全部开启。行动按 kind 过滤后，每件在剩余范围内重新取最优。
   */
  function analyzeRemodel(candidates, roles, k = C.REMODEL_K.basic, initialCountOf, allowedKinds) {
    const initOf = typeof initialCountOf === "function" ? initialCountOf : () => 4;
    const allowed = allowedKinds == null ? null : new Set(allowedKinds);
    const rows = [];
    (candidates || []).forEach(c => {
      const ic = initOf(c);
      const per = [];
      remodelTargets(c.artifact, c.sourceRole, roles).forEach(t => {
        if (allowed && !allowed.has(t.kind)) return;         // 情况开关：不在开启范围内的行动不参与
        const r = calcRemodel(c.artifact, t.role, k, ic);
        if (!r) return;                                      // 该对象下无有效词条等 → 跳过
        const baseline = t.case === "self"                   // 功能位现状分（统一 RV 骨架）
          ? r.currentScore
          : calcArtifactScore(t.role.artifacts[c.artifact.slot], t.role);
        const rv = r.eRemodel - baseline;
        per.push({
          role: t.role, case: t.case, kind: t.kind, baseline,
          r: Object.assign({}, r, { currentScore: baseline, rv, efficiency: rv / r.dust })
        });
      });
      if (!per.length) return;                               // 无可评估对象（散件无宿主等）→ 不进列表
      per.sort((a, b) => b.r.rv - a.r.rv);
      rows.push({
        artifact: c.artifact, sourceRole: c.sourceRole || null, signature: c.signature,
        initialCount: ic, best: per[0], all: per
      });
    });
    rows.sort((a, b) => b.best.r.rv - a.best.r.rv);
    return rows;
  }

  global.App = global.App || {};
  /**
   * 从 5 部位实况推导「套装构成」（仅供**一次性预填**与**一致性检测**使用，不参与判定）。
   * 归一化为与 `role.sets` 同口径：
   *   []      = 其他（3+1+1、2+1+1+1、部位未录全等无法归入两类的）
   *   [A]     = 四件套（4+1 或 5 件同套）
   *   [A, B]  = 两个两件套（2+2+1）
   */
  function deriveSetsFromArtifacts(role) {
    if (!isFullyRecorded(role)) return [];
    const counts = new Map();
    C.SLOT_KEYS.forEach(k => {
      const s = role.artifacts[k].set;
      counts.set(s, (counts.get(s) || 0) + 1);
    });
    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    if (entries[0][1] >= 4) return [entries[0][0]];              // 4+1 / 5 件同套
    const pairs = entries.filter(e => e[1] === 2);
    if (pairs.length === 2) return [pairs[0][0], pairs[1][0]];    // 2+2+1
    return [];                                                    // 其他
  }

  /** 两个套装构成是否等值（顺序无关） */
  function sameSetComposition(a, b) {
    const x = (a || []).slice().sort();
    const y = (b || []).slice().sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }

  /**
   * 一致性检测（策略 b 配套）：字段声明与圣遗物实况是否不符。
   * 仅在「5 部位录全 且 字段非空」时检查——
   *   · 未录全 → 当这个角色不存在，跳过（用户口径 2026-10-09）
   *   · 字段留空（「其他」）→ 无可比对，跳过
   * @returns {{checked:boolean, mismatch:boolean, actual:string[]}}
   */
  function checkSetConsistency(role) {
    const declared = roleSets(role);
    if (!declared.length) return { checked: false, mismatch: false, actual: [] };
    const actual = deriveSetsFromArtifacts(role);
    return { checked: true, mismatch: !sameSetComposition(declared, actual), actual };
  }

  // ============ 藏品（未装备圣遗物，2026-10-11）============
  // 详见《圣遗物网页实现方案.md》§七「藏品库」。桶 = 部位+主词条；维度 6 个；位 = 桶 × 维度（一件可占多位）。
  /** 某条副词条的累计值（含待激活词条；同一词条仅 1 条，累加为防御式处理） */
  function statValue(art, stat) {
    let v = 0;
    ((art && art.substats) || []).forEach(s => {
      if (s.stat === stat) v += (Number(s.value) || 0);
    });
    return v;
  }

  /** 维度值：单条维 = 该词条副词条值；双爆维 = 2 × 暴击率 + 暴击伤害 */
  function dimValue(art, dimKey) {
    const dim = C.COLLECTION_DIM_BY_KEY[dimKey];
    if (!art || !dim) return 0;
    if (dim.crit) return 2 * statValue(art, "暴击率") + statValue(art, "暴击伤害");
    return statValue(art, dim.stats[0]);
  }

  /** 维度理论满值（按该件主词条的可用槽数）；暴击头之类的单支情形由 constants 统一处理 */
  function dimFull(dimKey, mainStat) { return C.collectionFull(dimKey, mainStat); }

  /** 该件所属藏品桶（不属于 26 桶则 null） */
  function collectionBucketOf(art) {
    if (!art || !art.slot || !art.mainStat) return null;
    return C.COLLECTION_BUCKET_BY_KEY[C.collectionBucketKey(art.slot, art.mainStat)] || null;
  }

  /**
   * 藏品索引：位（桶 × 维度）→ 持有者（该位值最大者，并列全部计为持有者）；
   * 并派生「冗余件」= 不占任何位的件（被完全取代）→ 由 store 层删除。
   * 浮点比较统一 ×100 整数化（否则 0.1+0.2 类尾差会把「并列」误判为不等）。
   */
  function collectionIndex(collection) {
    const list = Array.isArray(collection) ? collection : [];
    const holders = new Map();                 // posKey → { bucketKey, bucket, dimKey, value, ivalue, arts }
    list.forEach(art => {
      const bucket = collectionBucketOf(art);
      if (!bucket) return;
      C.collectionBucketDims(bucket).forEach(dimKey => {
        const v = dimValue(art, dimKey);
        if (!(v > 0)) return;                  // 该件没有这一维 → 不占位
        const posKey = bucket.key + "|" + dimKey;
        const iv = Math.round(v * 100);
        let h = holders.get(posKey);
        if (!h) { h = { posKey, bucketKey: bucket.key, bucket, dimKey, value: v, ivalue: iv, arts: [] }; holders.set(posKey, h); }
        if (iv > h.ivalue) { h.value = v; h.ivalue = iv; h.arts = [art]; }
        else if (iv === h.ivalue) h.arts.push(art);
      });
    });
    const holding = new Set();
    holders.forEach(h => h.arts.forEach(a => holding.add(a)));
    return { holders, redundant: list.filter(a => !holding.has(a)) };
  }

  /**
   * 藏品视角分析（新件 X vs 藏品库）——功能 (a) 入藏判定 / (c) 极限程度 / (d) 潜力 / (e) 止损容错。
   * 功能 (b) 择优由「入库 + collectionIndex 重算 + 删除冗余件」实现（见 store.addCollectionItem）。
   * @returns {Object} { inScope, bucket, rows: [{ dimKey, label, unit, value, cur, delta, full, ratio,
   *                    verdict, holder, potential, potentialDelta, canExceed, need, tolerance }] }
   *   verdict：new（可入藏·新维度）| better（可入藏·刷新纪录）| worse（未超过）| none（该维为空且新件也没有）
   *   need / tolerance：仅「未超过但满级可超」（worse && canExceed）的行非 null（见 (e)）。
   */
  function analyzeCollection(newArtifact, collection) {
    const bucket = collectionBucketOf(newArtifact);
    if (!bucket) return { inScope: false, bucket: null, rows: [] };
    const { holders } = collectionIndex(collection);
    // (d) 潜力用的「可叠加次数」：3 初始件的第 1 次强化用于解锁待激活词条（§七-10），不参与叠加。
    // 与算法三 `remaining − |pending|` 同构（2026-10-13 修：此前未扣，含待激活件多算 1 发）。
    const pendingCount = (newArtifact.substats || []).filter(s => s.activated === false).length;
    const rem = Math.max(0, remaining(newArtifact.level) - pendingCount);
    const rows = C.collectionBucketDims(bucket).map(dimKey => {
      const dim = C.COLLECTION_DIM_BY_KEY[dimKey];
      const v = dimValue(newArtifact, dimKey);
      const h = holders.get(bucket.key + "|" + dimKey) || null;
      const cur = h ? h.value : null;
      const full = C.collectionFull(dimKey, newArtifact.mainStat);
      let verdict;
      if (cur == null) verdict = v > 0 ? "new" : "none";
      else if (Math.round(v * 100) > Math.round(cur * 100)) verdict = "better";
      else verdict = "worse";
      // (d) 潜力：乐观上限，且只有「该件已有该维度词条」才吃得到强化（强化不新增词条种类）
      const hasDim = dim.stats.some(s => statValue(newArtifact, s) > 0);
      const perRoll = C.collectionPerRoll(dimKey);
      const potential = v + (hasDim ? rem * perRoll : 0);
      const canExceed = cur != null && Math.round(potential * 100) > Math.round(cur * 100);
      // (e) 止损容错（2026-10-13 用户要求）：对「未超过但满级可超」的维度，还需至少命中 need 次
      //     （全命中且满值口径 = 找到最小的 k 使 v + k×单发满挡 严格超过 cur）；
      //     容错 tolerance = rem − need = 还能容忍几次「没加到该维度」——
      //     歪满 (容错+1) 次后即使剩余全中满值也追不上（与 canExceed 同一 ×100 整数化比较口径）。
      let need = null, tolerance = null;
      if (verdict === "worse" && canExceed) {
        for (let k = 0; k <= rem; k++) {
          if (Math.round((v + k * perRoll) * 100) > Math.round(cur * 100)) { need = k; break; }
        }
        if (need != null) tolerance = rem - need;
      }
      return {
        dimKey, label: dim.label, unit: dim.unit || "",
        value: v, cur, delta: cur == null ? null : v - cur,
        full, ratio: full > 0 ? v / full : 0,
        verdict, holder: h ? h.arts[0] : null,
        potential, potentialDelta: cur == null ? null : potential - cur,
        canExceed, need, tolerance
      };
    });
    return { inScope: true, bucket, rows };
  }

  global.App.core = {
    calcArtifactScore, calcPerfect, calcEnergyPenalty, calcCharacterScore, scoreComposition,
    erApplies,   // 充能是否适用（有效词条含「元素充能效率」）——UI 与算法共用同一判定（2026-10-17）
    maxW, E, remaining, ERContrib, evaluateAgainst, evaluateArtifact, freeSlots,
    expectedHits, calcRemodel, remodelSignature, inferInitialCount, collectRemodelCandidates, wearsSet, remodelTargets, analyzeRemodel,
    // 角色套装字段（2026-10-09）
    isFullyRecorded, roleSets, hasSetInfo, isSetPiece, deriveSetsFromArtifacts, sameSetComposition, checkSetConsistency,
    // 藏品（2026-10-11）
    statValue, dimValue, dimFull, collectionBucketOf, collectionIndex, analyzeCollection
  };
})(window);
