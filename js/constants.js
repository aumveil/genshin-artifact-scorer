/**
 * constants.js - 常量与枚举（对应《圣遗物网页实现方案.md》2.4/2.8 及定稿算法文档 1.3）
 * 全局命名空间：App.constants
 */
(function (global) {
  "use strict";

  const SLOTS = {
    flower:   { key: "flower",   name: "生之花", short: "花" },
    plume:    { key: "plume",    name: "死之羽", short: "羽" },
    sands:    { key: "sands",    name: "时之沙", short: "沙" },
    goblet:   { key: "goblet",   name: "空之杯", short: "杯" },
    circlet:  { key: "circlet",  name: "理之冠", short: "头" }
  };
  const SLOT_KEYS = ["flower", "plume", "sands", "goblet", "circlet"];

  // 满挡单发最大值表（Umax，滚数当量基准，定稿算法文档 1.3）
  const UMAX = {
    "暴击率": 3.9,
    "暴击伤害": 7.8,
    "攻击力百分比": 5.8,
    "生命值百分比": 5.8,
    "防御力百分比": 7.3,
    "元素精通": 23,
    "元素充能效率": 6.5,
    "攻击力": 19,
    "生命值": 299,
    "防御力": 23
  };

  // 0 级副词条档位（5★ 单次 roll 四档显示值；第 4 档 = Umax，wiki/米游社确认）
  const ROLL_TIERS = {
    "暴击率": [2.7, 3.1, 3.5, 3.9],
    "暴击伤害": [5.4, 6.2, 7.0, 7.8],
    "攻击力百分比": [4.1, 4.7, 5.3, 5.8],
    "生命值百分比": [4.1, 4.7, 5.3, 5.8],
    "防御力百分比": [5.1, 5.8, 6.6, 7.3],
    "元素精通": [16, 19, 21, 23],
    "元素充能效率": [4.5, 5.2, 5.8, 6.5],
    "攻击力": [14, 16, 18, 19],
    "生命值": [209, 239, 269, 299],
    "防御力": [16, 19, 21, 23]
  };

  // 面板显示值的舍入半宽（3/4 初始区间推断用，2026-10-10）：
  // 副词条显示值本身是四舍五入后的结果 —— percent 保留 1 位小数（±0.05）、flat 整数显示（±0.5）。
  // 推断只要求「显示值落在 k 发档位和的相容区间内」，不要求能被档位精确重构。
  const DISPLAY_HALF = { percent: 0.05, flat: 0.5 };

  // 副词条类型：percent = 百分比词条，flat = 数值词条
  const STAT_TYPE = {};
  for (const k in UMAX) {
    STAT_TYPE[k] = (k.includes("百分比") || k === "暴击率" || k === "暴击伤害" || k === "元素充能效率") ? "percent" : "flat";
  }
  // 主属性类型补充（元素伤害/治疗/暴击等均为百分比）
  ["治疗加成", "物理伤害加成", "风元素伤害加成", "岩元素伤害加成", "雷元素伤害加成",
   "草元素伤害加成", "水元素伤害加成", "火元素伤害加成", "冰元素伤害加成",
   "暴击率", "暴击伤害", "生命值百分比", "攻击力百分比", "防御力百分比", "元素充能效率"].forEach(k => {
    STAT_TYPE[k] = "percent";
  });

  // 副属性 10 种（定稿算法文档）
  const SUB_STATS = Object.keys(UMAX);

  // 主属性候选（按部位过滤；花/羽固定；与游戏实际一致——杯无充能/治疗主词条）
  const MAIN_STATS_BY_SLOT = {
    flower:  ["生命值"],
    plume:   ["攻击力"],
    sands:   ["攻击力百分比", "防御力百分比", "生命值百分比", "元素精通", "元素充能效率"],
    goblet:  ["攻击力百分比", "防御力百分比", "生命值百分比", "元素精通",
              "物理伤害加成", "风元素伤害加成", "岩元素伤害加成", "雷元素伤害加成",
              "草元素伤害加成", "水元素伤害加成", "火元素伤害加成", "冰元素伤害加成"],
    circlet: ["攻击力百分比", "防御力百分比", "生命值百分比", "元素精通", "暴击率", "暴击伤害", "治疗加成"]
  };

  // 部位别名表（文本识别用）
  const SLOT_ALIASES = {
    "生之花": "flower", "花": "flower",
    "死之羽": "plume", "羽": "plume",
    "时之沙": "sands", "沙": "sands",
    "空之杯": "goblet", "杯": "goblet",
    "理之冠": "circlet", "头": "circlet", "冠": "circlet"
  };

  // 词条别名表（文本识别用，简称/常见叫法 → 规范名）
  const STAT_ALIASES = {
    "攻击力百分比": "攻击力百分比", "大攻击": "攻击力百分比", "攻击力%": "攻击力百分比", "攻%": "攻击力百分比", "百分比攻击力": "攻击力百分比",
    "攻击力": "攻击力", "小攻击": "攻击力", "攻击": "攻击力",
    "生命值百分比": "生命值百分比", "大生命": "生命值百分比", "生命值%": "生命值百分比", "生%": "生命值百分比", "百分比生命值": "生命值百分比",
    "生命值": "生命值", "小生命": "生命值", "生命": "生命值",
    "防御力百分比": "防御力百分比", "大防御": "防御力百分比", "防御力%": "防御力百分比", "防%": "防御力百分比", "百分比防御力": "防御力百分比",
    "防御力": "防御力", "小防御": "防御力", "防御": "防御力",
    "暴击率": "暴击率", "暴击": "暴击率", "暴率": "暴击率",
    "暴击伤害": "暴击伤害", "爆伤": "暴击伤害", "暴伤": "暴击伤害", "爆击伤害": "暴击伤害",
    "元素精通": "元素精通", "精通": "元素精通",
    "元素充能效率": "元素充能效率", "充能": "元素充能效率", "充能效率": "元素充能效率", "充能%": "元素充能效率",
    "雷元素伤害加成": "雷元素伤害加成", "雷伤": "雷元素伤害加成", "雷伤加成": "雷元素伤害加成",
    "火元素伤害加成": "火元素伤害加成", "火伤": "火元素伤害加成", "火伤加成": "火元素伤害加成",
    "冰元素伤害加成": "冰元素伤害加成", "冰伤": "冰元素伤害加成", "冰伤加成": "冰元素伤害加成",
    "水元素伤害加成": "水元素伤害加成", "水伤": "水元素伤害加成", "水伤加成": "水元素伤害加成",
    "风元素伤害加成": "风元素伤害加成", "风伤": "风元素伤害加成", "风伤加成": "风元素伤害加成",
    "岩元素伤害加成": "岩元素伤害加成", "岩伤": "岩元素伤害加成", "岩伤加成": "岩元素伤害加成",
    "草元素伤害加成": "草元素伤害加成", "草伤": "草元素伤害加成", "草伤加成": "草元素伤害加成",
    "物理伤害加成": "物理伤害加成", "物伤": "物理伤害加成", "物伤加成": "物理伤害加成",
    "治疗加成": "治疗加成", "治疗": "治疗加成", "治疗量加成": "治疗加成"
  };

  // 常用套装列表（文本识别 + 下拉选择；可自定义扩展）
  const SETS = [
    "冒险家", "幸运儿", "游医",
    "行者之心", "勇士之心", "战狂", "教官", "流放者", "武人", "奇迹", "守卫之心", "赌徒", "学士",
    "角斗士的终幕礼", "流浪大地的乐团", "如雷的盛怒", "平息鸣雷的尊者", "炽烈的炎之魔女", "渡过烈火的贤人",
    "被怜爱的少女", "翠绿之影", "沉沦之心", "染血的骑士道", "昔日宗室之仪", "苍白之火", "冰风迷途的勇士", "悠古的磐岩",
    "千岩牢固", "绝缘之旗印", "追忆之注连", "华馆梦醒形骸记", "海染砗磲", "辰砂往生录",
    "来歆余响", "深林的记忆", "饰金之梦", "沙上楼阁史话", "乐园遗落之花", "水仙之梦", "花海甘露之光",
    "回声之林夜话", "逐影猎人", "黄金剧团", "昔时之歌", "谐律异想断章", "未竟的遐思",
    "烬城勇者绘卷", "黑曜秘典", "长夜之誓",
    "影中沉凝的幻灭", "天之美赐", "风起之日", "晨星与月的晓歌", "纺月的夜歌", "穹境示现之夜", "深廊终曲"
  ];
  // 套装别名（简称 → 规范名）
  const SET_ALIASES = {
    "角斗士": "角斗士的终幕礼", "角斗": "角斗士的终幕礼", "角斗士的终幕礼": "角斗士的终幕礼",
    "乐团": "流浪大地的乐团", "流浪大地": "流浪大地的乐团", "流浪大地的乐团": "流浪大地的乐团",
    "如雷": "如雷的盛怒", "如雷的盛怒": "如雷的盛怒",
    "平息鸣雷": "平息鸣雷的尊者", "平息鸣雷的尊者": "平息鸣雷的尊者",
    "魔女": "炽烈的炎之魔女", "火魔女": "炽烈的炎之魔女", "炽烈的炎之魔女": "炽烈的炎之魔女",
    "渡火": "渡过烈火的贤人", "渡过烈火的贤人": "渡过烈火的贤人",
    "少女": "被怜爱的少女", "被怜爱的少女": "被怜爱的少女",
    "翠绿": "翠绿之影", "风套": "翠绿之影", "翠绿之影": "翠绿之影",
    "水套": "沉沦之心", "沉沦之心": "沉沦之心",
    "骑士": "染血的骑士道", "染血的骑士道": "染血的骑士道",
    "宗室": "昔日宗室之仪", "昔日宗室之仪": "昔日宗室之仪",
    "苍白": "苍白之火", "苍白之火": "苍白之火",
    "千岩": "千岩牢固", "千岩牢固": "千岩牢固",
    "绝缘": "绝缘之旗印", "绝缘之旗印": "绝缘之旗印",
    "追忆": "追忆之注连", "追忆之注连": "追忆之注连",
    "华馆": "华馆梦醒形骸记", "华馆梦醒形骸记": "华馆梦醒形骸记",
    "海染": "海染砗磲", "海染砗磲": "海染砗磲",
    "辰砂": "辰砂往生录", "辰砂往生录": "辰砂往生录",
    "余响": "来歆余响", "来歆余响": "来歆余响",
    "深林": "深林的记忆", "草套": "深林的记忆", "深林的记忆": "深林的记忆",
    "饰金": "饰金之梦", "饰金之梦": "饰金之梦",
    "楼阁": "沙上楼阁史话", "沙上楼阁史话": "沙上楼阁史话",
    "乐园": "乐园遗落之花", "乐园遗落之花": "乐园遗落之花",
    "水仙": "水仙之梦", "水仙之梦": "水仙之梦",
    "花海": "花海甘露之光", "花海甘露之光": "花海甘露之光",
    "回声": "回声之林夜话", "回声之林夜话": "回声之林夜话",
    "猎人": "逐影猎人", "逐影猎人": "逐影猎人",
    "剧团": "黄金剧团", "黄金剧团": "黄金剧团",
    "昔时": "昔时之歌", "昔时之歌": "昔时之歌",
    "谐律": "谐律异想断章", "谐律异想断章": "谐律异想断章",
    "遐思": "未竟的遐思", "未竟的遐思": "未竟的遐思",
    "烬城": "烬城勇者绘卷", "烬城勇者绘卷": "烬城勇者绘卷",
    "黑曜": "黑曜秘典", "黑曜秘典": "黑曜秘典",
    "长夜": "长夜之誓", "长夜之誓": "长夜之誓",
    "影中沉凝": "影中沉凝的幻灭", "影中沉凝的幻灭": "影中沉凝的幻灭",
    "天之美赐": "天之美赐", "天美": "天之美赐",
    "风起之日": "风起之日", "风起": "风起之日",
    "晨星与月": "晨星与月的晓歌", "晨星与月的晓歌": "晨星与月的晓歌",
    "纺月的夜歌": "纺月的夜歌", "纺月": "纺月的夜歌",
    "穹境示现之夜": "穹境示现之夜", "穹境": "穹境示现之夜",
    "深廊终曲": "深廊终曲", "深廊": "深廊终曲"
  };

  // 主词条简称（首页部位徽章用，占位紧凑）
  const MAIN_SHORT = {
    "生命值": "生命", "攻击力": "攻击", "防御力": "防御",
    "生命值百分比": "生命%", "攻击力百分比": "攻击%", "防御力百分比": "防御%",
    "元素精通": "精通", "元素充能效率": "充能", "暴击率": "暴击", "暴击伤害": "爆伤",
    "治疗加成": "治疗", "物理伤害加成": "物伤",
    "火元素伤害加成": "火伤", "水元素伤害加成": "水伤", "风元素伤害加成": "风伤",
    "雷元素伤害加成": "雷伤", "冰元素伤害加成": "冰伤", "岩元素伤害加成": "岩伤", "草元素伤害加成": "草伤"
  };

  // 角色元素（图标文件位于 assets/elements/{元素}.png；RoleConfig.element 字段取值）
  const ELEMENTS = {
    "火": "火.png",
    "水": "水.png",
    "风": "风.png",
    "雷": "雷.png",
    "冰": "冰.png",
    "岩": "岩.png",
    "草": "草.png"
  };
  const ELEMENT_KEYS = Object.keys(ELEMENTS);

  // 元素 → 英文 slug（R1 图标 span + class；浅色变体文件位于 assets/elements/light/，2026-10-15）
  const ELEMENT_SLUG = { "火": "pyro", "水": "hydro", "风": "anemo", "雷": "electro", "草": "dendro", "冰": "cryo", "岩": "geo" };

  // 角色名 → 元素 默认映射（依据《角色有效属性与权值参考.md》66 角色 + 用户现有角色中新增的 11 位；
  // 新建/渲染时自动带出，仍可在角色配置中修改。2026-10-09 补齐 11 条，现有 77 个角色 100% 覆盖）
  const CHARACTER_ELEMENT_HINTS = {
    "可莉": "火", "班尼特": "火", "迪卢克": "火", "香菱": "火", "胡桃": "火", "宵宫": "火",
    "迪希雅": "火", "夏沃蕾": "火", "玛薇卡": "火", "阿蕾奇诺": "火", "林尼": "火", "伊安珊": "火",
    "尼可": "火",
    "妮露": "水", "玛拉妮": "水", "夜兰": "水", "那维莱特": "水", "神里绫人": "水", "达达利亚": "水",
    "珊瑚宫心海": "水", "莫娜": "水", "行秋": "水", "芙宁娜": "水", "希格雯": "水", "爱诺": "水", "哥伦比娅": "水",
    "沃雅妮莎": "水",
    "枫原万叶": "风", "温迪": "风", "魈": "风", "琴": "风", "闲云": "风", "珐露珊": "风", "恰斯卡": "风", "梦见月瑞希": "风",
    "法尔伽": "风", "布伦妮": "风", "薇斯纳": "风",
    "雷电将军": "雷", "八重神子": "雷", "菲谢尔": "雷", "克洛琳德": "雷", "赛诺": "雷", "刻晴": "雷",
    "久岐忍": "雷", "伊涅芙": "雷", "瓦雷莎": "雷", "菲林斯": "雷",
    "迪奥娜": "冰", "丝柯克": "冰", "茜特菈莉": "冰", "申鹤": "冰", "甘雨": "冰", "罗莎莉亚": "冰",
    "七七": "冰", "神里绫华": "冰", "莱欧斯利": "冰",
    "洛恩": "冰", "桑多涅": "冰", "奥黛塔": "冰",
    "荒泷一斗": "岩", "阿贝多": "岩", "钟离": "岩", "五郎": "岩", "娜维娅": "岩", "希诺宁": "岩",
    "叶洛亚": "岩", "莉奈娅": "岩", "兹白": "岩",
    "提纳里": "草", "纳西妲": "草", "艾尔海森": "草", "白术": "草", "艾梅莉埃": "草", "基尼奇": "草", "奈芙尔": "草", "菈乌玛": "草"
  };

  // 常量
  const MAX_LEVEL = 20;          // 等级上限
  const MAX_ROLLS_PER_STAT = 6;  // 单条词条最多 6 次 roll（初始1+强化5）
  const MIN_DIFF = 0;            // 满级替换最小价值差阈值（可配置）
  const MAX_WEIGHT = 2;          // 词条权值上限
  const STORAGE_VERSION = 1;     // 数据结构版本

  // 重塑（算法四，定稿算法文档第五章）：ROLL_AVG = 档位期望（70/80/90/100% 四档等概率）；
  // DUST_COST = 启圣之尘单次消耗（花/羽 1、沙/杯/头 2，进度按尘数积累 → 各部位终保底总尘相同）；
  // REMODEL_K = 保底档位（基础 2 / 高阶 3 / 谕告 4；主排序用基础档）
  const ROLL_AVG = 0.85;
  const DUST_COST = { flower: 1, plume: 1, sands: 2, goblet: 2, circlet: 2 };
  const REMODEL_K = { basic: 2, advanced: 3, oracle: 4 };

  // ============ 藏品（未装备圣遗物的收藏库，2026-10-11）============
  // 详见《圣遗物网页实现方案.md》§七「藏品库」。核心概念：
  //   桶 = 「部位 + 主词条」；维度 = 6 个收藏维度；位 = 桶 × 维度（一件藏品可同时占据多个位）。
  // 维度声明它涉及哪些副词条：单条维 1 条；双爆维（crit）涉及两条 → 复合。
  // 数组顺序 = 界面渲染顺序：**双爆列首**（2026-10-11 用户要求），其余依次 攻击% / 生命% / 防御% / 精通 / 充能。
  // 单维桶（各沙/杯/头的「仅双爆」）不受影响。
  const COLLECTION_DIMS = [
    { key: "crit",   label: "双爆",   stats: ["暴击率", "暴击伤害"], unit: "", crit: true },
    { key: "atkPct", label: "攻击%", stats: ["攻击力百分比"],       unit: "%" },
    { key: "hpPct",  label: "生命%", stats: ["生命值百分比"],       unit: "%" },
    { key: "defPct", label: "防御%", stats: ["防御力百分比"],       unit: "%" },
    { key: "em",     label: "精通",   stats: ["元素精通"],           unit: "" },
    { key: "er",     label: "充能",   stats: ["元素充能效率"],       unit: "%" }
  ];
  const COLLECTION_DIM_KEYS = COLLECTION_DIMS.map(d => d.key);
  const COLLECTION_DIM_BY_KEY = {};
  COLLECTION_DIMS.forEach(d => { COLLECTION_DIM_BY_KEY[d.key] = d; });

  // 桶清单（26 个，用户 2026-10-11 定案）。dims 声明「收录哪些维度」：
  //   ALL_DIMS   = 全维（6 个，其中主词条冲突的会被 collectionBucketDims 自动剔除）
  //   CRIT_ONLY  = 仅双爆
  // 元素杯按元素各 1 桶；含物理杯；含暴击头 / 暴伤头。主词条写法与 MAIN_STATS_BY_SLOT 一致。
  const ALL_DIMS = COLLECTION_DIM_KEYS.slice();
  const CRIT_ONLY = ["crit"];
  const COLLECTION_BUCKETS = [
    { key: "flower#生命值",         slot: "flower",  mainStat: "生命值",         name: "生之花",             dims: ALL_DIMS },
    { key: "plume#攻击力",          slot: "plume",   mainStat: "攻击力",         name: "死之羽",             dims: ALL_DIMS },
    { key: "sands#元素充能效率",    slot: "sands",   mainStat: "元素充能效率",   name: "充能沙",             dims: ALL_DIMS },
    { key: "sands#攻击力百分比",    slot: "sands",   mainStat: "攻击力百分比",   name: "攻击沙",             dims: CRIT_ONLY },
    { key: "sands#防御力百分比",    slot: "sands",   mainStat: "防御力百分比",   name: "防御沙",             dims: CRIT_ONLY },
    { key: "sands#生命值百分比",    slot: "sands",   mainStat: "生命值百分比",   name: "生命沙",             dims: CRIT_ONLY },
    { key: "sands#元素精通",        slot: "sands",   mainStat: "元素精通",       name: "精通沙",             dims: CRIT_ONLY },
    { key: "goblet#火元素伤害加成", slot: "goblet",  mainStat: "火元素伤害加成", name: "火伤杯",             dims: ALL_DIMS },
    { key: "goblet#水元素伤害加成", slot: "goblet",  mainStat: "水元素伤害加成", name: "水伤杯",             dims: ALL_DIMS },
    { key: "goblet#雷元素伤害加成", slot: "goblet",  mainStat: "雷元素伤害加成", name: "雷伤杯",             dims: ALL_DIMS },
    { key: "goblet#冰元素伤害加成", slot: "goblet",  mainStat: "冰元素伤害加成", name: "冰伤杯",             dims: ALL_DIMS },
    { key: "goblet#风元素伤害加成", slot: "goblet",  mainStat: "风元素伤害加成", name: "风伤杯",             dims: ALL_DIMS },
    { key: "goblet#岩元素伤害加成", slot: "goblet",  mainStat: "岩元素伤害加成", name: "岩伤杯",             dims: ALL_DIMS },
    { key: "goblet#草元素伤害加成", slot: "goblet",  mainStat: "草元素伤害加成", name: "草伤杯",             dims: ALL_DIMS },
    { key: "goblet#物理伤害加成",   slot: "goblet",  mainStat: "物理伤害加成",   name: "物伤杯",             dims: ALL_DIMS },
    { key: "goblet#攻击力百分比",   slot: "goblet",  mainStat: "攻击力百分比",   name: "攻击杯",             dims: CRIT_ONLY },
    { key: "goblet#防御力百分比",   slot: "goblet",  mainStat: "防御力百分比",   name: "防御杯",             dims: CRIT_ONLY },
    { key: "goblet#生命值百分比",   slot: "goblet",  mainStat: "生命值百分比",   name: "生命杯",             dims: CRIT_ONLY },
    { key: "goblet#元素精通",       slot: "goblet",  mainStat: "元素精通",       name: "精通杯",             dims: CRIT_ONLY },
    { key: "circlet#治疗加成",      slot: "circlet", mainStat: "治疗加成",       name: "治疗头",             dims: ALL_DIMS },
    { key: "circlet#攻击力百分比",  slot: "circlet", mainStat: "攻击力百分比",   name: "攻击头",             dims: CRIT_ONLY },
    { key: "circlet#防御力百分比",  slot: "circlet", mainStat: "防御力百分比",   name: "防御头",             dims: CRIT_ONLY },
    { key: "circlet#生命值百分比",  slot: "circlet", mainStat: "生命值百分比",   name: "生命头",             dims: CRIT_ONLY },
    { key: "circlet#元素精通",      slot: "circlet", mainStat: "元素精通",       name: "精通头",             dims: CRIT_ONLY },
    { key: "circlet#暴击率",        slot: "circlet", mainStat: "暴击率",         name: "暴击头",             dims: ALL_DIMS },
    { key: "circlet#暴击伤害",      slot: "circlet", mainStat: "暴击伤害",       name: "暴伤头",             dims: ALL_DIMS }
  ];
  const COLLECTION_BUCKET_BY_KEY = {};
  COLLECTION_BUCKETS.forEach(b => { COLLECTION_BUCKET_BY_KEY[b.key] = b; });

  /** 桶 key = 「部位#主词条」（藏品件与桶的匹配依据） */
  function collectionBucketKey(slot, mainStat) { return slot + "#" + mainStat; }

  /**
   * 该维度在某主词条下的「可用副词条槽数」= 维度涉及词条中不与主词条冲突的条数。
   * 例：主词条"暴击率" → 双爆维只剩暴击伤害 1 槽（副词条不与主词条重复）。
   */
  function collectionUsableSlots(dimKey, mainStat) {
    const dim = COLLECTION_DIM_BY_KEY[dimKey];
    if (!dim) return 0;
    return dim.stats.filter(s => s !== mainStat).length;
  }
  /** 单发满挡贡献：双爆 = 7.8（1 发暴击率×2 ≡ 1 发暴击伤害）；单条维 = Umax[词条] */
  function collectionPerRoll(dimKey) {
    const dim = COLLECTION_DIM_BY_KEY[dimKey];
    if (!dim) return 0;
    return dim.crit ? UMAX["暴击伤害"] : (UMAX[dim.stats[0]] || 0);
  }
  /**
   * 理论满值 = (可用槽数 + 5) × 单发满挡贡献（4 初始口径）。
   * 单条维：6 × Umax；双爆维一般桶：(2+5)×7.8 = 54.6；暴击头：(1+5)×7.8 = 46.8。
   */
  function collectionFull(dimKey, mainStat) {
    return (collectionUsableSlots(dimKey, mainStat) + 5) * collectionPerRoll(dimKey);
  }
  /** 桶实际收录的维度（剔除可用槽数为 0 的，如充能沙的「充能」维） */
  function collectionBucketDims(bucket) {
    return (bucket.dims || []).filter(k => collectionUsableSlots(k, bucket.mainStat) > 0);
  }

  global.App = global.App || {};
  global.App.constants = {
    SLOTS, SLOT_KEYS, UMAX, STAT_TYPE, SUB_STATS, MAIN_STATS_BY_SLOT,
    SLOT_ALIASES, STAT_ALIASES, SETS, SET_ALIASES, ROLL_TIERS, DISPLAY_HALF, MAIN_SHORT,
    ELEMENTS, ELEMENT_KEYS, ELEMENT_SLUG, CHARACTER_ELEMENT_HINTS,
    MAX_LEVEL, MAX_ROLLS_PER_STAT, MIN_DIFF, MAX_WEIGHT, STORAGE_VERSION,
    ROLL_AVG, DUST_COST, REMODEL_K,
    COLLECTION_DIMS, COLLECTION_DIM_KEYS, COLLECTION_DIM_BY_KEY,
    COLLECTION_BUCKETS, COLLECTION_BUCKET_BY_KEY,
    collectionBucketKey, collectionUsableSlots, collectionPerRoll, collectionFull, collectionBucketDims
  };
})(window);
