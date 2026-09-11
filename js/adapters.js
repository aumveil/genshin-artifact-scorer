/**
 * adapters.js - 外部格式适配器注册表（对应《圣遗物网页实现方案.md》2.6）
 * 每个适配器实现 detect(raw) 与 convert(raw)。
 * 已实现：backup_v1（本项目备份）、mona（莫娜占卜铺导出）。
 * 全局命名空间：App.adapters
 */
(function (global) {
  "use strict";
  const C = global.App.constants;

  // —— 词条/部位名称规范化工具（供各适配器复用）——
  function normalizeStat(name) {
    if (!name) return null;
    const n = String(name).trim();
    if (C.STAT_ALIASES[n]) return C.STAT_ALIASES[n];
    return null;
  }
  function normalizeSlot(name) {
    if (!name) return null;
    const n = String(name).trim();
    if (C.SLOT_ALIASES[n]) return C.SLOT_ALIASES[n];
    return null;
  }
  function normalizeSet(name) {
    if (!name) return null;
    const n = String(name).trim();
    if (C.SET_ALIASES[n]) return C.SET_ALIASES[n];
    if (C.SETS.includes(n)) return n;
    return null;
  }

  // ============ 莫娜占卜铺（mona-chan）适配器 ============
  // 部位映射：莫娜 key → 内部 key
  const MONA_SLOT_MAP = { flower: "flower", feather: "plume", sand: "sands", cup: "goblet", head: "circlet" };
  // 词条映射：莫娜英文 → 内部中文规范名
  const MONA_STAT_MAP = {
    lifeStatic: "生命值", attackStatic: "攻击力", defendStatic: "防御力",
    lifePercentage: "生命值百分比", attackPercentage: "攻击力百分比", defendPercentage: "防御力百分比",
    elementalMastery: "元素精通", recharge: "元素充能效率",
    critical: "暴击率", criticalDamage: "暴击伤害",
    physicalBonus: "物理伤害加成", fireBonus: "火元素伤害加成", waterBonus: "水元素伤害加成",
    iceBonus: "冰元素伤害加成", windBonus: "风元素伤害加成", rockBonus: "岩元素伤害加成",
    thunderBonus: "雷元素伤害加成", dendroBonus: "草元素伤害加成", cureEffect: "治疗加成"
  };
  // 套装映射：莫娜英文 key → 中文名（已核对官方中文名）
  const MONA_SET_MAP = {
    // —— 新套装（6.x）——
    "DisenchantmentInDeepShadow": "影中沉凝的幻灭",
    "HeavensGift": "天之美赐",
    "ADayCarvedFromRisingWinds": "风起之日",
    "AubadeOfMorningstarAndMoon": "晨星与月的晓歌",
    "SpinMoonSerenade": "纺月的夜歌",
    "RealmMirrorNight": "穹境示现之夜",
    "FinaleOfTheDeepGalleries": "深廊终曲",
    // —— 5.x ——
    "LongNightsOath": "长夜之誓",
    "ObsidianCodex": "黑曜秘典",
    "ScrollOfTheHeroOfCinderCity": "烬城勇者绘卷",
    "UnfinishedReverie": "未竟的遐思",
    "FragmentOfHarmonicWhimsy": "谐律异想断章",
    "NighttimeWhispersInTheEchoingWoods": "回声之林夜话",
    "SongOfDaysPast": "昔时之歌",
    "GoldenTroupe": "黄金剧团",
    "MarechausseeHunter": "逐影猎人",
    "VourukashasGlow": "花海甘露之光",
    "NymphsDream": "水仙之梦",
    "FlowerOfParadiseLost": "乐园遗落之花",
    "DesertPavilionChronicle": "沙上楼阁史话",
    "GildedDreams": "饰金之梦",
    "DeepwoodMemories": "深林的记忆",
    "VermillionHereafter": "辰砂往生录",
    // —— 旧套装（大小写两种风格并存）——
    "oceanHuedClam": "海染砗磲",
    "huskOfOpulentDreams": "华馆梦醒形骸记",
    "emblemOfSeveredFate": "绝缘之旗印",
    "shimenawaReminiscence": "追忆之注连",
    "paleFlame": "苍白之火",
    "tenacityOfTheMillelith": "千岩牢固",
    "heartOfDepth": "沉沦之心",
    "archaicPetra": "悠古的磐岩",
    "noblesseOblige": "昔日宗室之仪",
    "crimsonWitch": "炽烈的炎之魔女",
    "thunderingFury": "如雷的盛怒",
    "wandererTroupe": "流浪大地的乐团",
    "viridescentVenerer": "翠绿之影",
    "gladiatorFinale": "角斗士的终幕礼",
    "maidenBeloved": "被怜爱的少女",
    "lavaWalker": "渡过烈火的贤人",
    "blizzardStrayer": "冰风迷途的勇士",
    "EchoesOfAnOffering": "来歆余响",
    "thunderSmoother": "平息鸣雷的尊者"
  };

  /**
   * 转换数值：莫娜百分比用小数字段（0.041=4.1%），数值词条为整数。
   * 内部口径：百分比词条存百分数（4.1），数值词条存原值。
   */
  function monaValueToInternal(statZh, v) {
    const type = C.STAT_TYPE[statZh];
    if (type === "percent") {
      return Math.round(v * 1000) / 10; // 小数 → 百分数（保留 1 位）
    }
    return Math.round(v * 10) / 10;     // 数值词条：保留 1 位
  }

  /** 莫娜适配器 */
  const monaAdapter = {
    id: "mona",
    name: "莫娜占卜铺（mona-chan）导出",
    detect(raw) {
      if (!raw || typeof raw !== "object") return false;
      // 特征：version 为字符串 + 含 5 个部位数组 + 元素含 setName/mainTag/normalTags
      if (!raw.flower || !raw.feather || !raw.sand || !raw.cup || !raw.head) return false;
      const first = raw.flower[0];
      return !!(first && first.setName && first.mainTag && Array.isArray(first.normalTags));
    },
    convert(raw) {
      const warnings = [];
      const byRole = {};  // 角色名 → {slot: artifact}
      const slotKeys = ["flower", "feather", "sand", "cup", "head"];

      let equippedCount = 0, bagCount = 0;
      slotKeys.forEach(monaSlot => {
        const arr = raw[monaSlot] || [];
        arr.forEach(item => {
          if (!item) return;
          if (!item.equip) { bagCount++; return; } // 背包件不导入（本工具无背包结构）
          const roleName = String(item.equip).trim();
          const slot = MONA_SLOT_MAP[monaSlot];
          if (!byRole[roleName]) byRole[roleName] = {};
          if (byRole[roleName][slot]) {
            warnings.push(`${roleName} 的 ${slot} 部位存在多件装备，仅保留第一件`);
            return;
          }
          // 套装
          const setZh = MONA_SET_MAP[item.setName];
          if (!setZh) warnings.push(`${roleName} ${slot}: 未知套装 ${item.setName}（保留英文，请手动修正）`);
          // 主属性
          const mainZh = MONA_STAT_MAP[item.mainTag && item.mainTag.name];
          if (!mainZh) warnings.push(`${roleName} ${slot}: 未知主属性 ${item.mainTag && item.mainTag.name}`);
          // 副词条
          const substats = (item.normalTags || []).map(t => {
            const statZh = MONA_STAT_MAP[t.name];
            if (!statZh) warnings.push(`${roleName} ${slot}: 未知副词条 ${t.name}`);
            return {
              stat: statZh || t.name,
              value: statZh ? monaValueToInternal(statZh, t.value) : t.value,
              activated: true   // 莫娜数据均为 4 条已激活（无 3 初始）
            };
          });

          const artifact = {
            id: global.App.store ? global.App.store.genId() : ("imp_" + roleName + "_" + slot + "_" + Math.random().toString(36).slice(2, 8)),
            slot,
            set: setZh || item.setName,
            mainStat: mainZh || (item.mainTag && item.mainTag.name),
            mainValue: item.mainTag ? monaValueToInternal(mainZh || (item.mainTag.name), item.mainTag.value) : null,
            level: item.level || 0,
            substats,
            note: "从莫娜占卜铺导入"
          };
          byRole[roleName][slot] = artifact;
          equippedCount++;
        });
      });

      // 组装角色
      /**
       * 推断散件部位：件数为 1 的套装对应部位即为散件（1 件套无套装效果，必然是散件/未凑套）。
       * 规则：装备 ≥4 件时，按部位顺序取第一个「该套装仅 1 件」的部位；无则 null（全同套等无散件）。
       * 覆盖 4+1（61/68）、2+2+1（1 件套）、3+1+1（取第一个单件套）；全同 5 件套 → null。
       */
      function inferLooseSlot(arts) {
        const counts = {};
        let total = 0;
        for (const slot of C.SLOT_KEYS) {
          const art = arts[slot];
          if (!art || !art.set) continue;
          total++;
          counts[art.set] = (counts[art.set] || 0) + 1;
        }
        if (total < 4) return null;   // 装备不足，不推断（由用户手动设置）
        for (const slot of C.SLOT_KEYS) {
          const art = arts[slot];
          if (art && art.set && counts[art.set] === 1) return slot;
        }
        return null;
      }

      const roles = Object.keys(byRole).map(name => {
        const arts = byRole[name];
        const missing = slotKeys.filter(s => !arts[MONA_SLOT_MAP[s]]);
        if (missing.length) warnings.push(`${name}: 缺少 ${missing.map(s => MONA_SLOT_MAP[s]).join("、")} 部位`);
        return {
          id: global.App.store ? global.App.store.genId() : ("imp_role_" + name),
          name,
          looseSlot: inferLooseSlot(arts),   // 依据套装分布推断散件（4+1 异套件等），无则 null（可手动设置）
          effectiveStats: [],           // 外部格式无配置，需手动补充
          weights: {},
          erRequirement: 180,
          currentER: 180,
          artifacts: {
            flower: arts.flower || null, plume: arts.plume || null, sands: arts.sands || null,
            goblet: arts.goblet || null, circlet: arts.circlet || null
          },
          createdAt: Date.now(), updatedAt: Date.now()
        };
      });

      return {
        version: C.STORAGE_VERSION,
        exportedAt: new Date().toISOString(),
        roles,
        _meta: {
          source: "mona",
          equipped: equippedCount,
          bag: bagCount,
          roleCount: roles.length,
          warnings
        }
      };
    }
  };

  const adapters = [
    {
      // 本项目备份格式
      id: "backup_v1",
      name: "圣遗物评分网页备份",
      detect(raw) {
        return raw && raw.version === C.STORAGE_VERSION && Array.isArray(raw.roles);
      },
      convert(raw) {
        return { version: C.STORAGE_VERSION, exportedAt: raw.exportedAt || null, roles: raw.roles || [] };
      }
    },
    monaAdapter
  ];

  /** 探测并转换：返回 {adapter, store} 或 {error} */
  function convertFile(raw) {
    for (const a of adapters) {
      try {
        if (a.detect(raw)) {
          const store = a.convert(raw);
          return { adapter: a, store };
        }
      } catch (e) {
        console.warn(`适配器 ${a.id} 转换失败：`, e);
      }
    }
    return { error: "暂不支持该文件格式，请提供样例以便适配" };
  }

  global.App = global.App || {};
  global.App.adapters = { adapters, convertFile, normalizeStat, normalizeSlot, normalizeSet, MONA_SET_MAP };
})(window);
