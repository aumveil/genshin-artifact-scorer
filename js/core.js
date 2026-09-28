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
   * 主入口：评估新圣遗物的所有潜在使用方式（情况一/一′ 自由件/二/三 + 汇总）
   * @returns {Object} {valuable, summary, results:[{case,...evaluateAgainst 结果}]}
   */
  function evaluateArtifact(newArtifact, role) {
    const results = [];
    const equipped = role.artifacts && role.artifacts[newArtifact.slot];

    // 情况二：作为套装件（同部位、该部位是套装件而非散件、同套装、同主词条）
    const isSetReplace = !!(equipped && newArtifact.slot !== role.looseSlot
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
   * 3/4 初始自动推断（2026-09-28）：按「单发档位分解」判定总 roll 数。
   * 账本：4 初始 = 4 条×1 发初始 + 5 次强化 = 9 发；3 初始 = 3 发初始 + 首次强化生成第 4 条(1 发) + 4 次强化 = 8 发。
   * 每条副词条显示值必为 k 发单发档位值（ROLL_TIERS 四档）之和，k ∈ 1..5（4 初始单条最多 1+4 发）。
   * 对 4 条词条求可行 k 集合后枚举总和：仅可 Σ=9 → 4 初始；仅可 Σ=8 → 3 初始；
   * 两者皆可（档位两可）或皆不可（异常值/未知词条）→ null（调用方回退默认 4 初始）。
   * 显示值 ×10 整数化比较避免浮点误差；每词条枚举 ≤ C(k+3,3) ≤ 56 种组合，总量级毫秒级。
   */
  function inferInitialCount(artifact) {
    if (!artifact || artifact.level < C.MAX_LEVEL) return null;
    const subs = (artifact.substats || []).filter(s => s.activated !== false);
    if (subs.length !== 4) return null;                    // 满级恒 4 条；不足则无判据
    const R = subs.map(s => {
      const tiers = C.ROLL_TIERS[s.stat];
      if (!tiers) return null;                             // 未知词条（理论上不会出现）
      const target = Math.round(s.value * 10);
      const [t0, t1, t2, t3] = tiers.map(v => Math.round(v * 10));
      const ks = [];
      for (let k = 1; k <= 5; k++) {
        let ok = false;
        for (let a = 0; a <= k && !ok; a++)
          for (let b = 0; a + b <= k && !ok; b++)
            for (let c = 0; a + b + c <= k && !ok; c++) {
              const d = k - a - b - c;
              if (t0 * a + t1 * b + t2 * c + t3 * d === target) ok = true;
            }
        if (ok) ks.push(k);
      }
      return ks.length ? ks : null;                        // 该词条值无法由档位分解（超限录入等）
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
   * 「角色装备某套装」判定（5.5 情况二/三宿主条件之一）：
   * 非散件部位中存在 set == setName 的已穿戴件（散件位不算装备套装）。
   */
  function wearsSet(role, setName) {
    if (!role) return false;
    return C.SLOT_KEYS.some(slot => {
      if (role.looseSlot && slot === role.looseSlot) return false;
      const a = role.artifacts && role.artifacts[slot];
      return !!(a && a.set === setName);
    });
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
    if (sourceRole && artifact.slot !== sourceRole.looseSlot) {
      hosts.unshift({ role: sourceRole, case: "self", kind: "self" });   // 情况一（套装件恒可评自己）
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
  global.App.core = {
    calcArtifactScore, calcPerfect, calcEnergyPenalty, calcCharacterScore,
    maxW, remaining, ERContrib, evaluateAgainst, evaluateArtifact, freeSlots,
    expectedHits, calcRemodel, remodelSignature, inferInitialCount, collectRemodelCandidates, wearsSet, remodelTargets, analyzeRemodel
  };
})(window);
