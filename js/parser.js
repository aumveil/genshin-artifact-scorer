/**
 * parser.js - 圣遗物文本识别（对应《圣遗物网页实现方案.md》2.7）
 * 输入一段圣遗物文本，自动解析：部位/套装/等级/主属性/副词条（含待激活）。
 * 词条消歧：最长前缀匹配 + 数值单位（% 有无）判定。
 * 全局命名空间：App.parser
 */
(function (global) {
  "use strict";
  const C = global.App.constants;

  // 按长度降序的别名 key（保证最长匹配优先）
  const statKeysSorted = Object.keys(C.STAT_ALIASES).sort((a, b) => b.length - a.length);
  const slotKeysSorted = Object.keys(C.SLOT_ALIASES).sort((a, b) => b.length - a.length);

  // 套装候选：内置套装 + 别名 + 自定义套装（自定义套装使「第二次识别」直接命中）
  function buildSetCandidates(customSets) {
    const s = new Set();
    C.SETS.forEach(x => s.add(x));
    Object.keys(C.SET_ALIASES).forEach(x => s.add(x));
    (customSets || []).forEach(x => x && s.add(x));
    return Array.from(s).sort((a, b) => b.length - a.length);
  }

  // 分隔符：点号/顿号/逗号/分号/任意空白（含单空格，兼容「生命值 717」名值同行）
  const SEPARATOR_RE = /[\s·、,，;；]+/;

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // 歧义词条：数值词条带 % 时应推断为对应百分比词条（如「攻击力+4.1%」= 攻击力百分比）
  const AMBIG_PCT = {
    "攻击力": "攻击力百分比", "生命值": "生命值百分比", "防御力": "防御力百分比"
  };

  /** 从文本中解析一条「词条名+数值(±%)」 */
  function parseStatSegment(text) {
    const t = text.trim();
    // 词条名（最长前缀） + 可选 + 号 + 数值 + 可选 %
    for (const key of statKeysSorted) {
      const re = new RegExp("^" + esc(key) + "\\s*\\+?\\s*([0-9]+(?:\\.[0-9]+)?)(%?)");
      const m = t.match(re);
      if (m) {
        let canonical = C.STAT_ALIASES[key];
        const num = parseFloat(m[1]);
        const hasPct = m[2] === "%";

        // 歧义消解：数值词条名 + 带 % → 推断为对应百分比词条
        if (hasPct && C.STAT_TYPE[canonical] !== "percent" && AMBIG_PCT[canonical]) {
          canonical = AMBIG_PCT[canonical];
        }
        const isPctStat = C.STAT_TYPE[canonical] === "percent";

        // 未知类型词条（如主属性伤害加成）：按 % 推断，不校验
        if (C.STAT_TYPE[canonical] === undefined) {
          return { stat: canonical, value: num, valuePct: hasPct, warning: null };
        }
        // 单位一致性：百分比词条应带 %，数值词条不应带 %
        if (isPctStat && !hasPct) {
          return { stat: canonical, value: num, valuePct: false, warning: `${canonical} 为百分比词条，但文本中未带 %，请核对` };
        }
        if (!isPctStat && hasPct) {
          return { stat: canonical, value: num, valuePct: true, warning: `${canonical} 为数值词条，但文本中带 %，请核对` };
        }
        return { stat: canonical, value: num, valuePct: hasPct, warning: null };
      }
    }
    return null;
  }

  /** 只匹配词条名（不含数值），用于多行格式的主属性名行（如独立的「生命值」行） */
  function matchStatNameOnly(line) {
    const t = line.trim();
    for (const key of statKeysSorted) {
      // 前缀匹配词条名，且词条名之后不是数字（防止「生命值2」被截成「生命值」）
      if (t.startsWith(key) && !/^\d/.test(t.slice(key.length))) {
        return C.STAT_ALIASES[key];
      }
    }
    return null;
  }

  /** 解析主属性数值片段（可带 %，如 717 / 46.6%）→ { value, hasPct } */
  function parseMainValueLine(line) {
    const m = line.trim().match(/^(\d+(?:\.\d+)?)\s*(%?)/);
    return m ? { value: parseFloat(m[1]), hasPct: m[2] === "%" } : null;
  }

  /** 主入口：解析圣遗物文本 */
  function parseArtifactText(text, opts) {
    const customSets = (opts && opts.customSets) || [];
    const setCandidates = buildSetCandidates(customSets);
    const warnings = [];
    let t = String(text || "").trim();

    // ===== 归一化：删除所有 ★（星级符号，与识别无关）→ 换行统一为 ·（分行位置不确定，先合并成一行再识别切割）=====
    t = t.replace(/★+/g, "").replace(/\r?\n+/g, "·").replace(/ {2,}/g, " ");

    // 1. 部位（最长匹配）
    let slot = null, slotPos = -1;
    for (const key of slotKeysSorted) {
      const pos = t.indexOf(key);
      if (pos >= 0) {
        slot = C.SLOT_ALIASES[key];
        slotPos = pos;
        break;
      }
    }

    // 2. 套装（最长匹配；含自定义套装）
    let set = null, setPos = -1, setUnknown = false;
    for (const key of setCandidates) {
      const pos = t.indexOf(key);
      if (pos >= 0) {
        set = C.SET_ALIASES[key] || key;
        setPos = pos;
        break;
      }
    }
    // 未识别时先不报「未识别到套装」——留到启发式（4.0）之后再判断

    // 3. 主属性 / 等级 / 副词条段提取（统一算法：片段分类，不依赖行结构/分行位置）
    //    等级依据 +N 判断（不依赖星级行 ★）：
    //    - 独立等级片段（整体为 ★*+N / +N / Lv.N）→ 从片段流中提取并跳过
    //    - 紧凑格式主属性片段内数值后的 +N 尾巴
    let mainStat = null, mainValue = null, level = null;
    let subText = "";   // 副词条段（套装出现之前）
    if (slotPos >= 0) {
      // 部位之后 → 套装之前的内容
      let seg = t.slice(slotPos + slotNameLen(slot, t, slotPos));
      if (setPos >= 0 && setPos > slotPos) {
        seg = seg.slice(0, setPos - slotPos - slotNameLen(slot, t, slotPos));
      }
      let segParts = seg.split(SEPARATOR_RE).map(s => s.trim()).filter(Boolean);

      // ===== 等级提取一：独立等级片段（+N / Lv.N，如 ★★★★★+0 归一化后为 +0、Lv.0）=====
      // 不依赖 ★ 判断格式：只要片段整体是「+ 数字」形式即视为等级（+ 后面一定是等级）
      if (level === null) {
        const remain = [];
        for (const p of segParts) {
          const lv = p.match(/^\+(\d+)$/) || p.match(/^Lv\.?\s*(\d+)$/i);
          if (lv) { level = parseInt(lv[1], 10); continue; }   // 等级片段：提取并跳过
          remain.push(p);
        }
        segParts = remain;
      }

      if (segParts.length === 0) {
        warnings.push("未识别到主属性：(空)");
      } else {
        let i = 0;
        const firstParsed = parseStatSegment(segParts[0]);
        if (firstParsed) {
          // ===== 紧凑格式：主属性段 = 第一个片段「词条名+数值(+N)」=====
          mainStat = firstParsed.stat;
          mainValue = firstParsed.value;
          if (firstParsed.warning) warnings.push(firstParsed.warning);
          // 等级提取二：主属性段数值后的 +N / Lv.N（如 雷元素伤害加成7.0%+0 → 0）
          if (level === null) {
            const lv = segParts[0].match(/\+(\d+)\s*$/) || segParts[0].match(/Lv\.?\s*(\d+)/i);
            if (lv) level = parseInt(lv[1], 10);
          }
          i = 1;
        } else {
          // ===== 分段格式（主属性名 / 数值 分行或分段）=====
          // 片段 1：主属性名（纯词条名，无数值）
          const nm = matchStatNameOnly(segParts[0]);
          if (nm) {
            mainStat = nm;
            i = 1;
            // 片段 2：主属性数值（纯数值，可带 %，如 717 / 46.6%）
            if (i < segParts.length) {
              const v = parseMainValueLine(segParts[i]);
              if (v !== null) {
                mainValue = v.value;
                i++;
                // 主属性名歧义消解：数值攻击力/生命值/防御力 的数值带 % → 对应百分比词条
                // （如「时之沙 攻击力 46.6%」→ 攻击力百分比，不与副词条数值「攻击力」冲突）
                if (v.hasPct && AMBIG_PCT[mainStat]) mainStat = AMBIG_PCT[mainStat];
              }
            }
          } else {
            warnings.push("未识别到主属性：" + segParts[0]);
          }
        }
        // 副词条段 = 剩余片段
        subText = segParts.slice(i).join("·");
      }
    } else {
      warnings.push("未识别到部位");
    }
    if (level === null) {
      warnings.push("未识别到等级（+N），请手动填写");
    } else if (level < 0 || level > C.MAX_LEVEL) {
      warnings.push(`等级 ${level} 超出 0~${C.MAX_LEVEL}，请核对`);
    }

    // 4. 拆分副词条
    const parts = subText.split(SEPARATOR_RE).map(s => s.trim()).filter(Boolean);

    // 4.0 未知套装启发式：未匹配到已知套装时，副词条段末尾的「套装名:(N)」形态片段应识别为套装
    //     （已知套装会被上方 setPos 切割出副词条段，不会混入；只有未知套装才会残留成这种片段）
    if (!set) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const m = parts[i].match(/^(.+?)[:：]\s*\(?(\d+)\)?$/);
        if (m) {
          set = m[1].trim();
          setUnknown = true;   // 标记：来自启发式识别的「新套装」，由调用方决定是否加入自定义套装
          parts.splice(i, 1);
          break;
        }
      }
    }
    if (!set) warnings.push("未识别到套装，请手动选择");

    const substats = [];
    let pendingCount = 0;
    parts.forEach(p => {
      const isPending = /待激活|未激活/.test(p);
      const clean = p.replace(/[（(]?(待激活|未激活)[）)]?/g, "").trim();
      const pm = parseStatSegment(clean);
      if (pm) {
        if (pm.warning) warnings.push(pm.warning);
        const activated = !isPending;
        if (!activated) pendingCount++;
        substats.push({ stat: pm.stat, value: pm.value, activated });
      } else {
        warnings.push("无法识别副词条片段：" + p);
      }
    });

    // 6. 初始判定
    if (substats.length === 4 && pendingCount === 0) {
      // 初始四
    } else if (substats.length === 4 && pendingCount === 1) {
      // 3 激活 + 1 待激活 = 初始三
    } else if (substats.length === 3 && pendingCount === 0) {
      warnings.push("识别到 3 条激活副词条（无待激活），可能是 3 初始数据不完整或等级已解锁，请核对");
    } else {
      warnings.push(`副词条识别数量异常（${substats.length} 条，待激活 ${pendingCount} 条），请手动核对`);
    }

    // 7. 互斥检查（不重复原则）：副词条之间、副词条与主词条
    const seen = new Set();
    substats.forEach(s => {
      if (seen.has(s.stat)) warnings.push(`副词条重复：${s.stat}（不重复原则，请修正）`);
      seen.add(s.stat);
    });
    if (mainStat && seen.has(mainStat)) warnings.push(`副词条与主词条重复：${mainStat}（不重复原则，请修正）`);

    const result = {
      slot, set, setUnknown,      // setUnknown：true = 启发式识别出的新套装（不在内置/自定义列表），需调用方确认
      mainStat,
      mainValue: mainValue,       // 仅展示用，算法不依赖
      level: level,               // 可能为 null
      substats: substats.slice(0, 4),
      raw: t
    };
    return { ok: warnings.length === 0, result, warnings };
  }

  // 部位名实际长度（别名可能为简称，需回原文定位）
  function slotNameLen(slot, text, pos) {
    for (const key of slotKeysSorted) {
      if (C.SLOT_ALIASES[key] === slot && text.indexOf(key, pos) === pos) {
        return key.length;
      }
    }
    return 0;
  }

  global.App = global.App || {};
  global.App.parser = { parseArtifactText, parseStatSegment };
})(window);
