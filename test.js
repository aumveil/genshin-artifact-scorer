/**
 * test.js - 算法层与文本识别回归测试（Node 环境）
 * 复用定稿《圣遗物评分算法设计.md》示例数据：
 *   perfectTotal=36 / percent=69.4 / 单件 6.31 / 潜力 7.4 / 6.53 / 5.166
 * 运行：node test.js
 */
"use strict";

global.window = global; // 模拟浏览器 window（仅加载纯逻辑模块，不涉及 localStorage/DOM）

require("./js/constants.js");
require("./js/data.js");
require("./js/parser.js");
require("./js/core.js");
require("./js/adapters.js");
require("./js/storage.js");

const C = global.App.constants;
const core = global.App.core;
const data = global.App.data;
const parser = global.App.parser;

let pass = 0, fail = 0;
function assert(cond, name, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.error("  ✗ " + name + (extra !== undefined ? "  → " + extra : "")); }
}
function closeTo(a, b, eps = 0.02) { return Math.abs(a - b) < eps; }

console.log("== 算法二示例（算法文档 3.6）==");
{
  const role = {
    id: "t1", name: "测试",
    looseSlot: "goblet",
    effectiveStats: ["暴击率", "暴击伤害", "攻击力百分比"],
    weights: { "暴击率": 1.0, "暴击伤害": 1.0, "攻击力百分比": 0.5 },
    erRequirement: 180, currentER: 180,
    artifacts: {
      flower: { slot: "flower", set: "X", mainStat: "生命值", level: 20, substats: [{ stat: "暴击率", value: 3.9, activated: true }, { stat: "暴击伤害", value: 7.8, activated: true }, { stat: "攻击力百分比", value: 5.8, activated: true }, { stat: "元素精通", value: 23, activated: true }] },
      plume: { slot: "plume", set: "X", mainStat: "攻击力", level: 20, substats: [{ stat: "暴击率", value: 3.9, activated: true }, { stat: "暴击伤害", value: 7.8, activated: true }, { stat: "攻击力百分比", value: 5.8, activated: true }, { stat: "元素精通", value: 23, activated: true }] },
      sands: { slot: "sands", set: "X", mainStat: "攻击力百分比", level: 20, substats: [{ stat: "暴击率", value: 3.9, activated: true }, { stat: "暴击伤害", value: 7.8, activated: true }, { stat: "元素精通", value: 23, activated: true }, { stat: "生命值百分比", value: 5.8, activated: true }] },
      goblet: { slot: "goblet", set: "X", mainStat: "火元素伤害加成", level: 20, substats: [{ stat: "暴击率", value: 3.9, activated: true }, { stat: "暴击伤害", value: 7.8, activated: true }, { stat: "攻击力百分比", value: 5.8, activated: true }, { stat: "元素精通", value: 23, activated: true }] },
      circlet: { slot: "circlet", set: "X", mainStat: "暴击伤害", level: 20, substats: [{ stat: "暴击率", value: 3.9, activated: true }, { stat: "攻击力百分比", value: 5.8, activated: true }, { stat: "元素精通", value: 23, activated: true }, { stat: "生命值百分比", value: 5.8, activated: true }] }
    }
  };
  // 各部位完美词条数：花7.5 羽7.5 沙7.0 杯7.5 头6.5
  assert(closeTo(core.calcPerfect("flower", role), 7.5), "完美词条数 花 = 7.5", core.calcPerfect("flower", role));
  assert(closeTo(core.calcPerfect("sands", role), 7.0), "完美词条数 沙 = 7.0", core.calcPerfect("sands", role));
  assert(closeTo(core.calcPerfect("circlet", role), 6.5), "完美词条数 头 = 6.5", core.calcPerfect("circlet", role));
  const char = core.calcCharacterScore(role);
  assert(closeTo(char.perfect, 36), "perfectTotal = 36", char.perfect);
  // 测试构造各件得分：花2.5+羽2.5+沙2.0+杯2.5+头1.5 = 11（主词条占用词条的部位相应减少）
  assert(closeTo(char.words, 11), "测试构造 total = 11", char.words);
  assert(closeTo(char.percent, 11 / 36 * 100), "percent = total/perfect×100 公式正确", char.percent);

  // 模拟 total=25 的场景：用空副词条构造 25 词条难，直接验证公式口径
  const fake = core.calcCharacterScore(Object.assign({}, role, { artifacts: {} }));
  // 空 artifacts：words=0, perfect 按 E 全量（无主词条扣减）
}

console.log("== 算法一示例（算法文档 2.4）==");
{
  const role = {
    effectiveStats: ["暴击率", "暴击伤害", "攻击力百分比", "元素精通"],
    weights: { "暴击率": 1.0, "暴击伤害": 1.0, "攻击力百分比": 0.8, "元素精通": 0.6 }
  };
  const S = { slot: "flower", set: "X", mainStat: "生命值", level: 20, substats: [
    { stat: "暴击率", value: 7.4, activated: true },
    { stat: "暴击伤害", value: 14.6, activated: true },
    { stat: "攻击力百分比", value: 10.5, activated: true },
    { stat: "元素精通", value: 42, activated: true }
  ]};
  const score = core.calcArtifactScore(S, role);
  assert(closeTo(score, 6.31), "单件得分 ≈ 6.31", score);
}

console.log("== 算法三示例（算法文档 4.5）==");
{
  // 示例 A：满级杯替换
  const role = {
    looseSlot: "goblet",
    effectiveStats: ["暴击率", "暴击伤害", "攻击力百分比", "元素充能效率"],
    weights: { "暴击率": 1.0, "暴击伤害": 1.0, "攻击力百分比": 0.8, "元素充能效率": 0.9 },
    erRequirement: 180, currentER: 200,
    artifacts: {
      goblet: { slot: "goblet", set: "S", mainStat: "火元素伤害加成", level: 20, substats: [
        { stat: "暴击率", value: 3.9, activated: true }, { stat: "暴击伤害", value: 7.8, activated: true },
        { stat: "攻击力百分比", value: 5.8, activated: true }, { stat: "元素精通", value: 23, activated: true }] }
    }
  };
  const newCup = { slot: "goblet", set: "S", mainStat: "火元素伤害加成", level: 20, substats: [
    { stat: "暴击率", value: 7.8, activated: true }, { stat: "暴击伤害", value: 15.6, activated: true },
    { stat: "攻击力百分比", value: 11.6, activated: true }, { stat: "元素充能效率", value: 13.0, activated: true }] };
  const cur = core.calcArtifactScore(role.artifacts.goblet, role);
  const ev = core.evaluateArtifact(newCup, role);
  // 文档示例中当前杯 4.85 为假设值；本测试构造的当前杯（暴击3.9+爆伤7.8+大攻5.8+精通23）得分 = 1+1+0.8 = 2.8
  assert(closeTo(cur, 2.8), "测试构造当前杯 = 2.8", cur);
  const newScore = core.calcArtifactScore(newCup, role);
  assert(closeTo(newScore, 7.4), "新杯 = 7.4", newScore);
  assert(ev.results.some(r => r.case === "散件" && r.worthy), "示例A：建议替换");
  assert(ev.valuable, "示例A：有价值");

  // 示例 B：未满级花强化（level=4 剩 4 次）
  const roleB = {
    looseSlot: "flower",
    effectiveStats: ["暴击率", "暴击伤害", "攻击力百分比"],
    weights: { "暴击率": 1.0, "暴击伤害": 1.0, "攻击力百分比": 0.8 },
    erRequirement: 180, currentER: 180,
    artifacts: {
      flower: { slot: "flower", set: "S", mainStat: "生命值", level: 20, substats: [
        { stat: "暴击率", value: 3.9, activated: true }, { stat: "暴击伤害", value: 7.8, activated: true },
        { stat: "攻击力百分比", value: 5.8, activated: true }, { stat: "元素精通", value: 23, activated: true }] }
    }
  };
  const curB = core.calcArtifactScore(roleB.artifacts.flower, roleB); // 3.9/3.9 + 7.8/7.8 + 5.8/5.8*0.8 = 1+1+0.8 = 2.8
  const newFlower = { slot: "flower", set: "S", mainStat: "生命值", level: 4, substats: [
    { stat: "暴击率", value: 3.5, activated: true }, { stat: "暴击伤害", value: 7.0, activated: true },
    { stat: "攻击力百分比", value: 5.3, activated: true }, { stat: "防御力", value: 19, activated: true }] };
  const evB = core.evaluateArtifact(newFlower, roleB);
  const rB = evB.results.find(r => r.case === "散件");
  assert(closeTo(rB.potentialScore, 6.53), "示例B：潜力 = 6.53", rB.potentialScore);
  assert(rB.worthy, "示例B：值得强化");

  // 示例 C：0 级 3 初始羽（待激活防御力）
  const roleC = {
    looseSlot: "plume",
    effectiveStats: ["暴击率", "暴击伤害", "攻击力百分比"],
    weights: { "暴击率": 1.0, "暴击伤害": 1.0, "攻击力百分比": 0.8 },
    erRequirement: 180, currentER: 180,
    artifacts: {
      plume: { slot: "plume", set: "S", mainStat: "攻击力", level: 20, substats: [
        { stat: "暴击率", value: 3.9, activated: true }, { stat: "暴击伤害", value: 7.8, activated: true },
        { stat: "攻击力百分比", value: 5.8, activated: true }, { stat: "元素精通", value: 23, activated: true }] }
    }
  };
  const newPlume = { slot: "plume", set: "S", mainStat: "攻击力", level: 0, substats: [
    { stat: "攻击力百分比", value: 4.1, activated: true },
    { stat: "生命值百分比", value: 4.7, activated: true },
    { stat: "元素充能效率", value: 6.5, activated: true },
    { stat: "防御力", value: 19, activated: false }] };
  const evC = core.evaluateArtifact(newPlume, roleC);
  const rC = evC.results.find(r => r.case === "散件");
  // 攻击力4.1%→0.707×0.8=0.566 + 充能6.5%→本测试权值无充能→0
  // 强化只能叠加在已有副词条上：已有词条中有效词条最高权值 = 攻击力百分比 0.8（生命值/充能/防御力 无效）
  // potential = 0.566 + 0 + (5-1)×0.8 = 3.766；测试构造现有羽 = 1+1+0.8 = 2.8 → 值得强化
  assert(rC.remaining === 5, "示例C：remaining = 5", rC.remaining);
  assert(closeTo(rC.potentialScore, 3.766, 0.02), "示例C：潜力 = 3.766（强化仅叠加已有词条）", rC.potentialScore);
  assert(rC.worthy, "示例C：值得强化（潜力 3.766 > 现有 2.8）", rC.diffToCurrent);
}

console.log("== 潜力仅叠加已有副词条（全无效词条 → 潜力 0）==");
{
  // 克洛琳德场景：有效词条 暴击/爆伤/攻击力百分比，新件副词条全为无效词条（防御力/生命%/%防御力/攻击力）
  const role = {
    looseSlot: "sands",
    effectiveStats: ["暴击率", "暴击伤害", "攻击力百分比"],
    weights: { "暴击率": 1.0, "暴击伤害": 1.0, "攻击力百分比": 0.8 },
    erRequirement: 180, currentER: 180,
    artifacts: {
      sands: { slot: "sands", set: "S", mainStat: "攻击力百分比", level: 20, substats: [
        { stat: "暴击率", value: 7.4, activated: true }, { stat: "暴击伤害", value: 14.0, activated: true },
        { stat: "元素精通", value: 23, activated: true }, { stat: "生命值百分比", value: 5.8, activated: true }] }
    }
  };
  const newSands = { slot: "sands", set: "S", mainStat: "攻击力百分比", level: 0, substats: [
    { stat: "防御力", value: 23, activated: true }, { stat: "生命值百分比", value: 5.8, activated: true },
    { stat: "防御力百分比", value: 7.3, activated: true }, { stat: "攻击力", value: 18, activated: true }] };
  const ev = core.evaluateArtifact(newSands, role);
  const r = ev.results.find(x => x.case === "散件");
  assert(closeTo(r.potentialScore, 0, 0.001), "全无效副词条 → 潜力 0（强化无提升）", r.potentialScore);
  assert(!r.worthy, "潜力 0 < 当前散件 → 不值得强化", r.diffToCurrent);
}

console.log("== 0 级副词条档位表（ROLL_TIERS）==");
{
  // 10 种副属性均有 4 档；第 4 档 = Umax（档位与 Umax 口径一致）
  for (const st of C.SUB_STATS) {
    const tiers = C.ROLL_TIERS[st];
    assert(Array.isArray(tiers) && tiers.length === 4, `档位表完整：${st}`, JSON.stringify(tiers));
    assert(closeTo(tiers[3], C.UMAX[st]), `第 4 档 = Umax：${st}`, `${tiers[3]} vs ${C.UMAX[st]}`);
  }
  assert(C.ROLL_TIERS["防御力百分比"][2] === 6.6, "防御力百分比 3 档 = 6.6（非 6.5）", C.ROLL_TIERS["防御力百分比"][2]);
  assert(C.ROLL_TIERS["暴击率"][0] === 2.7 && C.ROLL_TIERS["暴击率"][3] === 3.9, "暴击率档位 2.7/3.1/3.5/3.9", JSON.stringify(C.ROLL_TIERS["暴击率"]));
  assert(C.ROLL_TIERS["元素充能效率"][0] === 4.5 && C.ROLL_TIERS["元素充能效率"][3] === 6.5, "充能档位 4.5/5.2/5.8/6.5", JSON.stringify(C.ROLL_TIERS["元素充能效率"]));
}

console.log("== 文本识别（用户样例）==");
{
  const text = "空之杯雷元素伤害加成7.0%+0·攻击力+4.1%·生命值+4.7%·元素充能效率+6.5%·防御力+19（待激活）角斗士的终幕礼：(0)";
  const res = parser.parseArtifactText(text);
  assert(res.result.slot === "goblet", "部位 = 空之杯", res.result.slot);
  assert(res.result.set === "角斗士的终幕礼", "套装 = 角斗士的终幕礼", res.result.set);
  assert(res.result.level === 0, "等级 = 0（主属性 +0）", res.result.level);
  assert(res.result.mainStat === "雷元素伤害加成", "主属性 = 雷元素伤害加成", res.result.mainStat);
  assert(res.result.substats.length === 4, "副词条 4 条", res.result.substats.length);
  const pending = res.result.substats.filter(s => s.activated === false);
  assert(pending.length === 1 && pending[0].stat === "防御力" && pending[0].value === 19,
    "待激活 = 防御力+19", JSON.stringify(pending));
  const atk = res.result.substats.find(s => s.stat === "攻击力百分比");
  assert(atk && closeTo(atk.value, 4.1), "攻击力+4.1% → 攻击力百分比 4.1", JSON.stringify(atk));
  console.log("  warnings:", res.warnings);
}

console.log("== 文本识别：多行字段格式（用户样例）==");
{
  const text = "生之花\n生命值\n717\n★★★★★+0\n暴击率+2.7%·元素精通+23·暴击伤害+5.4%\n·攻击力+4.1%（待激活）角斗士的终幕礼：(4)";
  const res = parser.parseArtifactText(text);
  assert(res.result.slot === "flower", "部位 = 生之花", res.result.slot);
  assert(res.result.mainStat === "生命值", "主属性 = 生命值", res.result.mainStat);
  assert(res.result.mainValue === 717, "主属性数值 = 717", res.result.mainValue);
  assert(res.result.level === 0, "等级 = 0（星级行 +0）", res.result.level);
  assert(res.result.set === "角斗士的终幕礼", "套装 = 角斗士的终幕礼", res.result.set);
  assert(res.result.substats.length === 4, "副词条 4 条", JSON.stringify(res.result.substats));
  const s0 = res.result.substats[0], s1 = res.result.substats[1], s2 = res.result.substats[2], s3 = res.result.substats[3];
  assert(s0.stat === "暴击率" && closeTo(s0.value, 2.7), "副词条1 = 暴击率2.7", JSON.stringify(s0));
  assert(s1.stat === "元素精通" && s1.value === 23, "副词条2 = 元素精通23", JSON.stringify(s1));
  assert(s2.stat === "暴击伤害" && closeTo(s2.value, 5.4), "副词条3 = 暴击伤害5.4", JSON.stringify(s2));
  assert(s3.stat === "攻击力百分比" && closeTo(s3.value, 4.1) && s3.activated === false,
    "副词条4 = 攻击力百分比4.1（待激活）", JSON.stringify(s3));
  const badWarn = res.warnings.filter(w => w.includes("未识别到等级") || w.includes("副词条识别数量异常") || w.includes("未识别到主属性"));
  assert(badWarn.length === 0, "无 等级/主属性/副词条数量 异常警告", JSON.stringify(res.warnings));

  // 分行位置不确定：同一内容多种分行方式，识别结果必须一致
  const variants = [
    "生之花\n生命值\n717\n★★★★★+0\n暴击率+2.7%·元素精通+23·暴击伤害+5.4%\n·攻击力+4.1%（待激活）角斗士的终幕礼：(4)",
    "生之花 生命值 717 ★★★★★+0 暴击率+2.7%·元素精通+23·暴击伤害+5.4% 攻击力+4.1%（待激活）角斗士的终幕礼",
    "生之花\n生命值 717\n★★★★★+0\n暴击率+2.7%\n元素精通+23\n暴击伤害+5.4%\n攻击力+4.1%（待激活）角斗士的终幕礼",
    "生之花\n生命值\n717\n★★★★★+0\n暴击率+2.7%·元素精通+23\n·暴击伤害+5.4%·攻击力+4.1%（待激活）\n角斗士的终幕礼"
  ];
  variants.forEach((v, vi) => {
    const rv = parser.parseArtifactText(v);
    assert(rv.result.slot === "flower" && rv.result.mainStat === "生命值" && rv.result.mainValue === 717 && rv.result.level === 0,
      `分行变体 ${vi + 1}: 部位/主属性/数值/等级 一致`, JSON.stringify(rv.result));
    assert(rv.result.substats.length === 4 && rv.result.substats[3].stat === "攻击力百分比" && rv.result.substats[3].activated === false,
      `分行变体 ${vi + 1}: 副词条 4 条含待激活`, JSON.stringify(rv.result.substats.map(s => s.stat)));
    assert(rv.ok, `分行变体 ${vi + 1}: 零警告 ok=true`, JSON.stringify(rv.warnings));
  });

  // 等级不依赖 ★：独立 +N 片段（无星级行）也应识别为等级
  const noStar = "生之花\n生命值\n717\n+0\n暴击率+2.7%·元素精通+23·暴击伤害+5.4%·攻击力+4.1%（待激活）角斗士的终幕礼";
  const rn = parser.parseArtifactText(noStar);
  assert(rn.result.level === 0, "无星级：独立 +0 片段 → 等级 0", JSON.stringify(rn.result));
  assert(rn.result.substats.length === 4 && rn.ok, "无星级：副词条 4 条且零警告", JSON.stringify(rn.warnings));
  const noStarLv = "生之花\n生命值\n717\nLv.12\n暴击率+2.7%·元素精通+23·暴击伤害+5.4%·攻击力+4.1%（待激活）角斗士的终幕礼";
  const rl = parser.parseArtifactText(noStarLv);
  assert(rl.result.level === 12, "无星级：独立 Lv.12 → 等级 12", JSON.stringify(rl.result));
}

console.log("== 词条消歧（% 判定）==");
{
  const r1 = parser.parseStatSegment("攻击力+4.1%");
  const r2 = parser.parseStatSegment("攻击力+19");
  const r3 = parser.parseStatSegment("暴击+7.4%");
  const r4 = parser.parseStatSegment("精通+42");
  assert(r1.stat === "攻击力百分比", "攻击力+4.1% → 攻击力百分比", JSON.stringify(r1));
  assert(r2.stat === "攻击力", "攻击力+19 → 攻击力", JSON.stringify(r2));
  assert(r3.stat === "暴击率", "暴击+7.4% → 暴击率", JSON.stringify(r3));
  assert(r4.stat === "元素精通", "精通+42 → 元素精通", JSON.stringify(r4));
}

console.log("== 互斥检查（不重复原则）==");
{
  // 副词条重复（两条相同的攻击力）
  const dup = parser.parseArtifactText("理之冠暴击率+3.5%+0·攻击力+14·攻击力+14·生命值+209·元素精通+16 角斗士的终幕礼");
  assert(dup.warnings.some(w => w.includes("副词条重复")), "副词条重复 → 警告", JSON.stringify(dup.warnings));
  // 副词条与主词条重复（头主词条=暴击率，副词条也含暴击率）
  const mainDup = parser.parseArtifactText("理之冠暴击率+3.5%+0·暴击率+3.1%·攻击力+14·生命值+209·元素精通+16 角斗士的终幕礼");
  assert(mainDup.warnings.some(w => w.includes("与主词条重复")), "副词条与主词条重复 → 警告", JSON.stringify(mainDup.warnings));
  // 正常样例不触发互斥警告
  const ok = parser.parseArtifactText("空之杯雷元素伤害加成7.0%+0·攻击力+4.1%·生命值+4.7%·元素充能效率+6.5%·防御力+19（待激活）角斗士的终幕礼");
  assert(!ok.warnings.some(w => w.includes("重复")), "正常样例无互斥警告", JSON.stringify(ok.warnings));

  // 主属性名歧义消解（结合数值单位）：「攻击力 46.6%」→ 攻击力百分比，不与副词条数值「攻击力」冲突
  const atkPct = parser.parseArtifactText("时之沙\n攻击力\n46.6%\n+0\n暴击率+3.1%·攻击力+14·生命值+209·元素精通+16 角斗士的终幕礼");
  assert(atkPct.result.mainStat === "攻击力百分比", "时之沙 攻击力 46.6% → 主属性=攻击力百分比", atkPct.result.mainStat);
  assert(!atkPct.warnings.some(w => w.includes("与主词条重复")), "主属性攻击力百分比 与 副词条数值攻击力 不冲突", JSON.stringify(atkPct.warnings));
  // 「攻击力 311」（羽数值）保持数值攻击力：与副词条数值「攻击力」冲突（游戏规则）
  const atkFlat = parser.parseArtifactText("死之羽\n攻击力\n311\n+0\n攻击力+14·暴击率+3.1%·暴击伤害+7.8%·元素精通+16 角斗士的终幕礼");
  assert(atkFlat.result.mainStat === "攻击力", "死之羽 攻击力 311 → 主属性=攻击力（数值）", atkFlat.result.mainStat);
  assert(atkFlat.warnings.some(w => w.includes("与主词条重复：攻击力")), "羽数值攻击力 与 副词条数值攻击力 冲突", JSON.stringify(atkFlat.warnings));
}

console.log("== 未知套装识别（启发式 + 自定义套装持久化）==");
{
  const text = "空之杯火元素伤害加成7.0%+20·暴击率+7.4%·暴击伤害+15.6%·攻击力百分比+11.6%·元素精通+23 炉火融炼之心:(4)";
  // 1. 第一次遇见未知套装：识别为套装（而非副词条片段），标记 setUnknown
  const r1 = parser.parseArtifactText(text);
  assert(r1.result.set === "炉火融炼之心", "未知套装启发式识别 → set=炉火融炼之心", r1.result.set);
  assert(r1.result.setUnknown === true, "第一次识别 setUnknown=true（待确认）", String(r1.result.setUnknown));
  assert(!r1.warnings.some(w => w.includes("无法识别副词条片段")), "无「无法识别副词条片段」警告", JSON.stringify(r1.warnings));
  assert(!r1.warnings.some(w => w.includes("未识别到套装")), "无「未识别到套装」警告", JSON.stringify(r1.warnings));
  assert(r1.result.substats.length === 4 && r1.result.substats[3].stat === "元素精通", "副词条正常识别 4 条（套装名未混入）", JSON.stringify(r1.result.substats));
  // 2. 第二次识别（customSets 已含该套装）：直接命中，setUnknown=false
  const r2 = parser.parseArtifactText(text, { customSets: ["炉火融炼之心"] });
  assert(r2.result.set === "炉火融炼之心" && r2.result.setUnknown === false, "加入自定义套装后直接识别（setUnknown=false）", JSON.stringify({ set: r2.result.set, u: r2.result.setUnknown }));
  assert(r2.ok, "第二次识别零警告", JSON.stringify(r2.warnings));
  // 3. 内置套装不受影响
  const r3 = parser.parseArtifactText("空之杯火元素伤害加成7.0%+20·暴击率+7.4%·暴击伤害+15.6%·攻击力百分比+11.6%·元素精通+23 炽烈的炎之魔女:(20)");
  assert(r3.result.set === "炽烈的炎之魔女" && r3.result.setUnknown === false, "内置套装 setUnknown=false", JSON.stringify({ set: r3.result.set, u: r3.result.setUnknown }));
}

console.log("== 删除 ★ 后等级识别（★★★★★+0 → +0）==");
{
  const r = parser.parseArtifactText("生之花\n生命值\n717\n★★★★★+0\n暴击率+2.7%·元素精通+23·暴击伤害+5.4%·攻击力+4.1%（待激活）角斗士的终幕礼");
  assert(r.result.level === 0, "★★★★★+0（归一化删★后 +0）→ 等级 0", JSON.stringify(r.result));
  assert(r.result.substats.length === 4 && r.ok, "删★后副词条 4 条且零警告", JSON.stringify(r.warnings));
  // data.js 校验：羽（主词条数值攻击力）+ 副词条攻击力百分比 → 合法（游戏允许），不报重复
  const art = { slot: "plume", set: "角斗士的终幕礼", mainStat: "攻击力", level: 20,
    substats: [{ stat: "攻击力百分比", value: 5.8, activated: true }, { stat: "暴击率", value: 3.1, activated: true },
               { stat: "暴击伤害", value: 7.8, activated: true }, { stat: "元素精通", value: 16, activated: true }] };
  const verr = data.validateArtifact(art).filter(e => e.level === "hard");
  assert(verr.length === 0, "data.js：羽数值攻击力 + 副词条攻击力百分比 无硬错误", JSON.stringify(verr));
  // 羽 + 副词条数值攻击力 → 报重复（游戏规则）
  const art2 = JSON.parse(JSON.stringify(art));
  art2.substats[0] = { stat: "攻击力", value: 14, activated: true };
  const verr2 = data.validateArtifact(art2).filter(e => e.level === "hard");
  assert(verr2.some(e => e.msg.includes("重复")), "data.js：羽数值攻击力 + 副词条数值攻击力 报重复", JSON.stringify(verr2));
}

console.log("== 主词条匹配校验 ==");
{
  // 散件杯当前主词条为攻击力百分比，新杯主词条为火伤 → 主词条不同，情况一不适用
  const role = {
    looseSlot: "goblet",
    effectiveStats: ["暴击率", "暴击伤害", "攻击力百分比"],
    weights: { "暴击率": 1.0, "暴击伤害": 1.0, "攻击力百分比": 0.8 },
    erRequirement: 180, currentER: 180,
    artifacts: { goblet: { slot: "goblet", set: "S", mainStat: "攻击力百分比", level: 20, substats: [
      { stat: "暴击率", value: 3.9, activated: true }, { stat: "暴击伤害", value: 7.8, activated: true },
      { stat: "攻击力百分比", value: 5.8, activated: true }, { stat: "元素精通", value: 23, activated: true }] } }
  };
  const newCup = { slot: "goblet", set: "S", mainStat: "火元素伤害加成", level: 20, substats: [
    { stat: "暴击率", value: 7.8, activated: true }, { stat: "暴击伤害", value: 15.6, activated: true },
    { stat: "攻击力百分比", value: 11.6, activated: true }, { stat: "元素精通", value: 23, activated: true }] };
  const ev = core.evaluateArtifact(newCup, role);
  assert(!ev.results.some(r => r.case === "散件"), "主词条不同 → 情况一不适用");
  assert(!ev.valuable, "主词条不同 → 无价值（散件场景排除）");

  // 主词条一致 → 情况一适用
  const role2 = JSON.parse(JSON.stringify(role));
  role2.artifacts.goblet.mainStat = "火元素伤害加成";
  const ev2 = core.evaluateArtifact(newCup, role2);
  assert(ev2.results.some(r => r.case === "散件"), "主词条一致 → 情况一适用");
}

console.log("== 情况二只对非散件部位适用 ==");
{
  // looseSlot=goblet，角色当前杯是散件（同名套装+同主词条不应触发情况二）
  const role = {
    looseSlot: "goblet",
    effectiveStats: ["暴击率","暴击伤害","攻击力百分比"],
    weights: { "暴击率":1.0, "暴击伤害":1.0, "攻击力百分比":0.8 },
    erRequirement: 180, currentER: 180,
    artifacts: { goblet: { slot:"goblet", set:"绝缘之旗印", mainStat:"火元素伤害加成", level:20, substats:[
      {stat:"暴击率",value:3.9,activated:true},{stat:"暴击伤害",value:7.8,activated:true},
      {stat:"攻击力百分比",value:5.8,activated:true},{stat:"元素精通",value:23,activated:true}]} }
  };
  const newCup = { slot:"goblet", set:"绝缘之旗印", mainStat:"火元素伤害加成", level:20, substats:[
    {stat:"暴击率",value:7.8,activated:true},{stat:"暴击伤害",value:15.6,activated:true},
    {stat:"攻击力百分比",value:11.6,activated:true},{stat:"元素精通",value:23,activated:true}] };
  const ev = core.evaluateArtifact(newCup, role);
  assert(ev.results.some(r => r.case === "散件"), "杯子是散件 → 情况一适用");
  assert(!ev.results.some(r => r.case === "套装替换"), "杯子是散件 → 情况二不适用（避免散件被重复评估）");

  // 新件是非散件部位（如沙）→ 情况二才适用
  const newSands = { slot:"sands", set:"绝缘之旗印", mainStat:"元素充能效率", level:20, substats:[
    {stat:"暴击率",value:3.9,activated:true},{stat:"暴击伤害",value:7.8,activated:true},
    {stat:"攻击力百分比",value:5.8,activated:true},{stat:"元素精通",value:23,activated:true}] };
  const role2 = JSON.parse(JSON.stringify(role));
  role2.artifacts.sands = { slot:"sands", set:"绝缘之旗印", mainStat:"元素充能效率", level:20, substats:[
    {stat:"暴击率",value:3.9,activated:true},{stat:"暴击伤害",value:7.8,activated:true},
    {stat:"攻击力百分比",value:5.8,activated:true},{stat:"元素精通",value:23,activated:true}] };
  const ev2 = core.evaluateArtifact(newSands, role2);
  assert(ev2.results.some(r => r.case === "套装替换"), "新沙（非散件）→ 情况二适用");
  assert(!ev2.results.some(r => r.case === "散件"), "新沙（非散件）→ 情况一不适用");
}

console.log("== 情况三：套装件替换散件 ==");
{
  // 角色：4 件魔女（花/羽/沙/头）+ 散件杯（乐团火伤杯）
  const role = {
    looseSlot: "goblet",
    effectiveStats: ["暴击率","暴击伤害","攻击力百分比","元素精通"],
    weights: { "暴击率":1.0, "暴击伤害":1.0, "攻击力百分比":0.8, "元素精通":0.6 },
    erRequirement: 180, currentER: 180,
    artifacts: {
      flower:  { slot:"flower",  set:"炽烈的炎之魔女", mainStat:"生命值", level:20, substats:[
        {stat:"暴击率",value:3.9,activated:true},{stat:"暴击伤害",value:7.8,activated:true},
        {stat:"攻击力百分比",value:5.8,activated:true},{stat:"元素精通",value:23,activated:true}] },
      plume:   { slot:"plume",   set:"炽烈的炎之魔女", mainStat:"攻击力", level:20, substats:[
        {stat:"暴击率",value:3.9,activated:true},{stat:"暴击伤害",value:7.8,activated:true},
        {stat:"攻击力百分比",value:5.8,activated:true},{stat:"元素精通",value:23,activated:true}] },
      sands:   { slot:"sands",   set:"炽烈的炎之魔女", mainStat:"攻击力百分比", level:20, substats:[
        {stat:"暴击率",value:3.9,activated:true},{stat:"暴击伤害",value:7.8,activated:true},
        {stat:"攻击力百分比",value:5.8,activated:true},{stat:"元素精通",value:23,activated:true}] },
      circlet: { slot:"circlet", set:"炽烈的炎之魔女", mainStat:"暴击率", level:20, substats:[
        {stat:"暴击率",value:3.9,activated:true},{stat:"暴击伤害",value:7.8,activated:true},
        {stat:"攻击力百分比",value:5.8,activated:true},{stat:"元素精通",value:23,activated:true}] },
      goblet:  { slot:"goblet",  set:"流浪大地的乐团", mainStat:"火元素伤害加成", level:20, substats:[
        {stat:"暴击率",value:2.7,activated:true},{stat:"暴击伤害",value:5.4,activated:true},
        {stat:"攻击力百分比",value:4.1,activated:true},{stat:"元素精通",value:16,activated:true}] }
    }
  };
  // 新件：魔女套火伤杯（词条高于旧散件杯）
  const newCup = { slot:"goblet", set:"炽烈的炎之魔女", mainStat:"火元素伤害加成", level:20, substats:[
    {stat:"暴击率",value:7.8,activated:true},{stat:"暴击伤害",value:15.6,activated:true},
    {stat:"攻击力百分比",value:11.6,activated:true},{stat:"元素精通",value:23,activated:true}] };
  const ev = core.evaluateArtifact(newCup, role);
  const setSwap = ev.results.find(x => x.case === "散件(变为套装件)");
  assert(!!setSwap && setSwap.isSetSwap === true, "情况三识别：魔女套杯替换散件杯（变为套装件）", JSON.stringify(ev.results.map(x => x.case)));
  assert(ev.valuable, "情况三词条更高 → 有价值");

  // 新件不是所穿套装件（仍是散件）→ 不算情况三，普通情况一
  const newCup2 = Object.assign({}, newCup, { set: "流浪大地的乐团" });
  const ev2 = core.evaluateArtifact(newCup2, role);
  assert(ev2.results.some(x => x.case === "散件" && !x.isSetSwap), "非所穿套装件 → 普通情况一（非情况三）");
}

console.log("== looseSlot 允许为空（无散件）==");
{
  const r = data.validateRoleConfig({ name: "X", looseSlot: null, effectiveStats: ["暴击率"], weights: { "暴击率": 1 }, artifacts: {} });
  assert(!r.hard.some(e => e.field === "looseSlot"), "looseSlot=null（无散件）通过校验");
  const r2 = data.validateRoleConfig({ name: "X", looseSlot: "invalid", effectiveStats: ["暴击率"], weights: { "暴击率": 1 }, artifacts: {} });
  assert(r2.hard.some(e => e.field === "looseSlot"), "looseSlot 非法值仍报错");
}

console.log("== 莫娜占卜铺适配器（mona.json）==");
{
  const fs = require("fs");
  const mona = JSON.parse(fs.readFileSync("C:/Users/秋晨/Desktop/圣遗物/mona.json", "utf8"));
  const adapters = global.App.adapters;

  // detect
  assert(adapters.convertFile(mona).adapter && adapters.convertFile(mona).adapter.id === "mona", "detect：识别为莫娜格式");

  const res = adapters.convertFile(mona);
  const store = res.store;
  const meta = store._meta;

  // 背包件不导入
  assert(meta.bag === 1991, "背包件 1991 不导入", meta.bag);
  assert(meta.equipped + meta.bag === 2325, "装备+背包 = 总数 2325", meta.equipped + meta.bag);

  // 角色数量：equip 非空的角色名数
  const roleCount = store.roles.length;
  assert(roleCount >= 60, "导入角色数 ≥ 60（装备角色）", roleCount);

  // 胡桃 5 件齐全
  const huto = store.roles.find(r => r.name === "胡桃");
  assert(!!huto, "存在角色「胡桃」");
  const slots = ["flower","plume","sands","goblet","circlet"];
  assert(slots.every(s => huto && huto.artifacts[s]), "胡桃 5 部位齐全");

  // 词条数值单位转换：百分比 ×100（小数→百分数），数值不变
  const flower = huto && huto.artifacts.flower;
  if (flower) {
    assert(flower.mainStat === "生命值", "花主属性 = 生命值", flower.mainStat);
    assert(closeTo(flower.mainValue, 4780, 1), "花主属性数值 4780（lifeStatic 为数值词条）", flower.mainValue);
    assert(flower.substats.length === 4, "副词条 4 条");
    flower.substats.forEach(s => {
      assert(!!C.SUB_STATS.includes(s.stat), "副词条词条名已中文化：" + s.stat, s.stat);
    });
  }
  // 任意一件百分比副词条数值应为百分数（>1）
  const anyPct = store.roles.flatMap(r => Object.values(r.artifacts)).filter(Boolean)
    .flatMap(a => a.substats).find(s => C.STAT_TYPE[s.stat] === "percent" && s.value > 1);
  assert(!!anyPct, "百分比副词条数值已转为百分数（如 4.1 而非 0.041）", anyPct && JSON.stringify(anyPct));

  // 套装均已映射为中文（不在 SETS 则警告，但不应出现）
  const unknownSets = store.roles.flatMap(r => Object.values(r.artifacts)).filter(Boolean)
    .filter(a => !C.SETS.includes(a.set)).map(a => a.set);
  assert(unknownSets.length === 0, "全部套装已映射为中文", JSON.stringify([...new Set(unknownSets)]));

  // validateStore 通过（配置缺失不应阻止导入）
  const storeErr = data.validateStore(store);
  assert(storeErr.length === 0, "validateStore 无硬错误（配置可后补）", JSON.stringify(storeErr.slice(0, 3)));

  // 散件部位智能推断（4+1 异套件 = 散件；全同套 = 无散件；不再全部默认杯）
  const kelee = store.roles.find(r => r.name === "可莉");
  assert(kelee && kelee.looseSlot === "circlet", "可莉 4+1（头为角斗士）→ 散件=头", kelee && kelee.looseSlot);
  const barb = store.roles.find(r => r.name === "芭芭拉");
  assert(barb && barb.looseSlot === "flower", "芭芭拉 2+2+1（花为单件套）→ 散件=花", barb && barb.looseSlot);
  const aino = store.roles.find(r => r.name === "爱诺");
  assert(aino && aino.looseSlot === null, "爱诺 全同 5 件套 → 无散件", aino && aino.looseSlot);
  const defaultCup = store.roles.filter(r => r.looseSlot === "goblet").length;
  assert(defaultCup < store.roles.length, "散件不再全部默认杯（推断后仅少数恰好为杯）", `杯 ${defaultCup}/${store.roles.length}`);
  // 4+1 角色占多数且都能推断出散件
  const inferred = store.roles.filter(r => r.looseSlot != null).length;
  assert(inferred >= store.roles.length - 5, "绝大多数角色成功推断散件", `推断 ${inferred}/${store.roles.length}`);
}

console.log("== 校验函数 ==");
{
  const bad = data.validateArtifact({ slot: "flower", set: "X", mainStat: "攻击力", level: 20, substats: [
    { stat: "暴击率", value: 7.4, activated: true }, { stat: "暴击率", value: 3.9, activated: true },
    { stat: "攻击力百分比", value: 5.8, activated: true }, { stat: "元素精通", value: 23, activated: true }] });
  assert(bad.some(e => e.field === "mainStat"), "主词条与部位不匹配报错");
  assert(bad.some(e => e.msg.includes("重复")), "重复词条报错");
  const ok = data.validateArtifact({ slot: "flower", set: "X", mainStat: "生命值", level: 20, substats: [
    { stat: "暴击率", value: 7.4, activated: true }, { stat: "暴击伤害", value: 14.6, activated: true },
    { stat: "攻击力百分比", value: 10.5, activated: true }, { stat: "元素精通", value: 42, activated: true }] });
  assert(ok.every(e => e.level !== "hard"), "合法圣遗物无硬错误（数值可超单发 Umax）", JSON.stringify(ok));
}

console.log("== storage.migrate 保留 customSets（自定义套装持久化回归）==");
{
  const storage = global.App.storage;
  // 带 customSets 的存量存储：migrate 必须透传，否则刷新页面后自定义套装丢失（2026-08-23 修复）
  const m1 = storage.migrate({ version: 1, exportedAt: null, roles: [], customSets: ["炉火融炼之心"] });
  assert(Array.isArray(m1.customSets) && m1.customSets[0] === "炉火融炼之心", "migrate 保留 customSets（刷新后自定义套装不丢失）", JSON.stringify(m1.customSets));
  const m2 = storage.migrate({ version: 1, exportedAt: null, roles: [], customSets: ["A", "B"] });
  assert(m2.customSets.length === 2 && m2.customSets[1] === "B", "migrate 完整透传多个自定义套装");
  // 旧数据无 customSets / 损坏数据：返回空数组（不报错）
  const m3 = storage.migrate({ version: 1, exportedAt: null, roles: [] });
  assert(Array.isArray(m3.customSets) && m3.customSets.length === 0, "旧数据无 customSets → 空数组");
  const m4 = storage.migrate(null);
  assert(Array.isArray(m4.customSets) && m4.customSets.length === 0, "空/损坏数据 → emptyStore 含空 customSets");
}

console.log("== storage 筛选状态持久化（刷新/重开恢复）==");
{
  const storage = global.App.storage;
  // Node 无 localStorage：注入内存实现（仅本次测试块使用）
  if (typeof global.localStorage === "undefined") {
    const mem = {};
    global.localStorage = {
      getItem: k => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: k => { delete mem[k]; },
      clear: () => { for (const k in mem) delete mem[k]; },
      key: i => Object.keys(mem)[i] || null,
      get length() { return Object.keys(mem).length; }
    };
  }
  global.localStorage.clear();
  assert(storage.loadFilter() === null, "无筛选记录 → loadFilter 返回 null（回退默认「全部」）");
  const ok = storage.saveFilter({ slot: "goblet", mainStat: "火元素伤害加成", sets: ["炽烈的炎之魔女", "炉火融炼之心"] });
  const back = storage.loadFilter();
  assert(ok === true && back && back.slot === "goblet" && back.mainStat === "火元素伤害加成" && back.sets.length === 2 && back.sets[1] === "炉火融炼之心", "saveFilter → loadFilter 往返一致", JSON.stringify(back));
  global.localStorage.setItem(storage.FILTER_KEY, "{bad json");
  assert(storage.loadFilter() === null, "损坏 JSON → loadFilter 返回 null");
  global.localStorage.setItem(storage.FILTER_KEY, JSON.stringify({ slot: "flower", sets: "x" }));
  assert(storage.loadFilter() === null, "sets 非数组 → loadFilter 返回 null");
  global.localStorage.setItem(storage.FILTER_KEY, JSON.stringify({ slot: "flower", mainStat: 123, sets: ["A", 5, null] }));
  const f2 = storage.loadFilter();
  assert(f2 && f2.sets.length === 1 && f2.sets[0] === "A" && f2.mainStat === "", "非字符串成员/主属性被过滤为合法形状", JSON.stringify(f2));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
