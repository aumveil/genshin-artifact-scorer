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

console.log("== 算法四：重塑价值评估（算法文档 五）==");
{
  // —— E[Y_k] 安全网期望表（5.2）——
  assert(closeTo(core.expectedHits(5, 2), 2.71875, 1e-9), "E[Y_2](n=5) = 2.71875", core.expectedHits(5, 2));
  assert(closeTo(core.expectedHits(5, 3), 3.21875, 1e-9), "E[Y_3](n=5) = 3.21875", core.expectedHits(5, 3));
  assert(closeTo(core.expectedHits(5, 4), 4.03125, 1e-9), "E[Y_4](n=5) = 4.03125", core.expectedHits(5, 4));
  assert(closeTo(core.expectedHits(4, 2), 2.375, 1e-9), "E[Y_2](n=4) = 2.375", core.expectedHits(4, 2));
  assert(closeTo(core.expectedHits(4, 3), 3.0625, 1e-9), "E[Y_3](n=4) = 3.0625", core.expectedHits(4, 3));
  assert(closeTo(core.expectedHits(4, 4), 4, 1e-9), "E[Y_4](n=4) = 4（保底拉满）", core.expectedHits(4, 4));

  // —— 文档 5.7 示例：同组合（暴击/爆伤/大攻/精通，权值 1/1/0.8/0.6）不同分配 ——
  const roleA = {
    effectiveStats: ["暴击率", "暴击伤害", "攻击力百分比", "元素精通"],
    weights: { "暴击率": 1.0, "暴击伤害": 1.0, "攻击力百分比": 0.8, "元素精通": 0.6 }
  };
  const 乙 = { slot: "flower", set: "X", mainStat: "生命值", level: 20, substats: [
    { stat: "暴击率", value: 7.4, activated: true }, { stat: "暴击伤害", value: 7.8, activated: true },
    { stat: "攻击力百分比", value: 5.8, activated: true }, { stat: "元素精通", value: 23, activated: true }] };
  const 甲 = { slot: "flower", set: "X", mainStat: "生命值", level: 20, substats: [
    { stat: "暴击率", value: 7.4, activated: true }, { stat: "暴击伤害", value: 14.6, activated: true },
    { stat: "攻击力百分比", value: 10.5, activated: true }, { stat: "元素精通", value: 42, activated: true }] };

  const rB = core.calcRemodel(乙, roleA, 2);
  assert(!!rB, "乙件可计算", rB);
  assert(closeTo(rB.currentScore, 4.2974, 1e-3), "乙 currentScore ≈ 4.30", rB.currentScore);
  assert(closeTo(rB.eRemodel, 6.5583, 1e-3), "乙 E[remodel] ≈ 6.56（基础档）", rB.eRemodel);
  assert(closeTo(rB.rv, 2.2608, 1e-3), "乙 RV ≈ +2.26", rB.rv);
  assert(closeTo(rB.floors.basic, 4.59, 1e-9), "保底线 基础 = 4.59", rB.floors.basic);
  assert(closeTo(rB.floors.advanced, 5.44, 1e-9), "保底线 高阶 = 5.44", rB.floors.advanced);
  assert(closeTo(rB.floors.oracle, 6.29, 1e-9), "保底线 谕告 = 6.29", rB.floors.oracle);
  assert(closeTo(rB.ceiling, 8.4, 1e-9), "组合上限 = 8.4", rB.ceiling);
  assert(closeTo(rB.achieve, 6.55828125 / 8.4, 1e-6), "期望达成度 = E[remodel]/perfect", rB.achieve);
  assert(rB.n === 5 && rB.dust === 1, "4 初始 n=5、花 1 尘", `${rB.n}/${rB.dust}`);
  assert(rB.suggest.join(",") === "暴击率,暴击伤害", "建议指定词条 = 权值 top2", rB.suggest);

  const rA = core.calcRemodel(甲, roleA, 2);
  assert(closeTo(rA.currentScore, 6.31, 0.02), "甲 currentScore ≈ 6.31（算法一示例同件）", rA.currentScore);
  assert(closeTo(rA.rv, 0.2451, 1e-3), "甲 RV ≈ +0.25（分配好 → 收益微小）", rA.rv);
  assert(rA.rv < rB.rv, "同组合下分配差的乙 RV > 分配好的甲（组合好+分配歪才值得重塑）");

  // 档位切换与 3 初始
  assert(closeTo(core.calcRemodel(乙, roleA, 3).eRemodel, 6.685781, 1e-6), "高阶档 k=3 E[remodel] = 6.685781", core.calcRemodel(乙, roleA, 3).eRemodel);
  assert(closeTo(core.calcRemodel(乙, roleA, 4).eRemodel, 6.892969, 1e-6), "谕告档 k=4 E[remodel] = 6.892969", core.calcRemodel(乙, roleA, 4).eRemodel);
  const r3 = core.calcRemodel(乙, roleA, 2, 3);
  assert(r3.n === 4, "3 初始 → n=4", r3.n);
  assert(closeTo(r3.eRemodel, 5.875625, 1e-6), "3 初始 E[remodel] = 5.875625", r3.eRemodel);

  // —— NGA 口径交叉验证（情形二：三有效角色 三条腿3有效，E=3.53125 词条 → 0.85×6.53125 当量）——
  const roleSk = {
    effectiveStats: ["暴击率", "暴击伤害", "攻击力百分比"],
    weights: { "暴击率": 1.0, "暴击伤害": 1.0, "攻击力百分比": 1.0 }
  };
  const sk = { slot: "flower", set: "X", mainStat: "生命值", level: 20, substats: [
    { stat: "暴击率", value: 3.9, activated: true }, { stat: "暴击伤害", value: 7.8, activated: true },
    { stat: "攻击力百分比", value: 5.8, activated: true }, { stat: "防御力", value: 23, activated: true }] };
  const rSk = core.calcRemodel(sk, roleSk, 3, 3);
  assert(closeTo(rSk.eRemodel, 0.85 * 6.53125, 1e-9), "NGA 情形二：E[remodel] = 0.85×6.53125", rSk.eRemodel);

  // —— 边界 ——
  assert(core.calcRemodel(Object.assign({}, 乙, { level: 16 }), roleA, 2) === null, "未满级 → null");
  const junk = { slot: "flower", set: "X", mainStat: "生命值", level: 20, substats: [
    { stat: "防御力", value: 23, activated: true }, { stat: "生命值百分比", value: 5.8, activated: true },
    { stat: "防御力百分比", value: 7.3, activated: true }, { stat: "生命值", value: 299, activated: true }] };
  assert(core.calcRemodel(junk, roleA, 2) === null, "无有效词条 → null");

  // —— 候选扫描去重 + 三情况归属 + 统一 RV 口径 + 互斥取最优 ——
  const mkRole = (name, art, loose) => ({
    id: name, name, looseSlot: loose || null,
    effectiveStats: roleA.effectiveStats, weights: roleA.weights,
    artifacts: { flower: art || null, plume: null, sands: null, goblet: null, circlet: null }
  });
  const roleJia = mkRole("甲角色", 甲);
  const roleYi = mkRole("乙角色", 乙);
  const roleDup = mkRole("重复-乙", JSON.parse(JSON.stringify(乙)));
  const roles2 = [roleJia, roleYi, roleDup];
  const cands = core.collectRemodelCandidates(roles2);
  assert(cands.length === 2, "同签名圣遗物跨角色去重（3 角色 3 件 → 2 件）", cands.length);
  assert(cands.every(c => !!c.sourceRole), "候选携带持有者引用（三情况归属判定依赖）");

  const rows2 = core.analyzeRemodel(cands, roles2, 2);
  const rowJia = rows2.find(x => x.artifact === 甲);
  const rowYi = rows2.find(x => x.artifact === 乙);
  assert(rows2.length === 2, "分析 2 件候选", rows2.length);
  assert(rows2[0].best.r.rv >= rows2[1].best.r.rv, "按 RV 降序排列");
  // 情况一：乙件（套装件）best = 自己（原地强化，baseline = 自身现状）
  assert(rowYi.best.case === "self", "情况一：乙件最佳行动 = 原地强化", rowYi.best.case);
  assert(rowYi.best.role.name === "乙角色", "情况一评估对象 = 持有者自身", rowYi.best.role.name);
  assert(closeTo(rowYi.best.r.rv, 2.2608, 1e-3), "情况一 RV = 期望 − 自身现状 = 2.2608", rowYi.best.r.rv);
  // 互斥取最优：甲件评自己 (+0.245) vs 转给乙角色 (+2.2608) → 选转移（情况二宿主）
  assert(rowJia.best.case === "host", "互斥取最优：甲件选「重塑后转移乙角色」而非原地强化", rowJia.best.case);
  assert(rowJia.best.role.name === "乙角色", "情况二评估对象 = 同套宿主", rowJia.best.role.name);
  assert(closeTo(rowJia.best.r.rv, 2.2608, 1e-3), "情况二 RV = 期望 − 宿主现有件分", rowJia.best.r.rv);
  assert(closeTo(rowJia.best.r.currentScore, 4.2974, 1e-3), "转移现状 = 宿主现有件评分（baseline 覆盖）", rowJia.best.r.currentScore);
  assert(rowJia.all.length === 3, "甲件可评估对象 = 自己 + 2 个同套宿主", rowJia.all.length);

  // 宿主条件（wearsSet + 同部位同主词条）+ 扣除口径：穿 X 套的偏置角色（花位全无效件）
  const junkB = { slot: "flower", set: "X", mainStat: "生命值", level: 20, substats: [
    { stat: "防御力", value: 23, activated: true }, { stat: "生命值百分比", value: 5.8, activated: true },
    { stat: "防御力百分比", value: 7.3, activated: true }, { stat: "生命值", value: 299, activated: true }] };
  const roleB = {
    id: "B", name: "爆伤偏置", looseSlot: null,
    effectiveStats: roleA.effectiveStats,
    weights: { "暴击率": 0.6, "暴击伤害": 1.5, "攻击力百分比": 0.5, "元素精通": 0.5 },
    artifacts: { flower: junkB, plume: null, sands: null, goblet: null, circlet: null }
  };
  const candYi = cands.find(c => c.artifact === 乙);
  const rowsB = core.analyzeRemodel([candYi], [roleYi, roleB], 2);
  assert(rowsB[0].best.case === "host" && rowsB[0].best.role.name === "爆伤偏置",
    "宿主判定：穿同套且同部位同主词条 → 评宿主", rowsB[0].best.role.name);
  assert(closeTo(rowsB[0].best.r.rv, 6.0310, 1e-3),
    "扣除口径：RV = 6.0310 − 0（宿主现有件全无效 → baseline 0）", rowsB[0].best.r.rv);
  assert(closeTo(rowsB[0].best.r.currentScore, 0, 1e-9), "转移现状 = 宿主现有件分（0）", rowsB[0].best.r.currentScore);
  // 宿主现有件有分 → 必须扣除（与算法三替换口径一致；不扣除会误报 6.0310）
  const roleB2 = Object.assign({}, roleB, { id: "B2", name: "爆伤偏置2", artifacts: { flower: {
    slot: "flower", set: "X", mainStat: "生命值", level: 20,
    substats: [{ stat: "暴击率", value: 7.8, activated: true }, { stat: "暴击伤害", value: 7.8, activated: true }]
  }, plume: null, sands: null, goblet: null, circlet: null } });
  const rowsB2 = core.analyzeRemodel([candYi], [roleYi, roleB2], 2);
  assert(closeTo(rowsB2[0].best.r.rv, 6.031015625 - 2.7, 1e-3),
    "扣除口径：宿主现有件 2.7 分 → RV = 3.3310", rowsB2[0].best.r.rv);

  // 情况三：散件不评自身，仅评装备其所属套装的宿主
  const looseFlower = { slot: "flower", set: "绝缘", mainStat: "生命值", level: 20, substats: [
    { stat: "暴击率", value: 3.9, activated: true }, { stat: "暴击伤害", value: 7.8, activated: true }] };
  const roleC = mkRole("散件持有者", looseFlower, "flower");
  const roleD = mkRole("绝缘宿主", { slot: "flower", set: "绝缘", mainStat: "生命值", level: 20,
    substats: [{ stat: "暴击率", value: 3.9, activated: true }] });
  const rows3 = core.analyzeRemodel(
    [{ artifact: looseFlower, sourceRole: roleC, signature: core.remodelSignature(looseFlower) }],
    [roleC, roleD], 2);
  assert(rows3.length === 1, "情况三：散件（绝缘花）仅评绝缘宿主", rows3.length);
  assert(rows3[0].best.case === "host" && rows3[0].best.role.name === "绝缘宿主",
    "情况三评估对象 = 装备其所属套装的宿主（不含持有者）", rows3[0].best.role.name);
  assert(closeTo(rows3[0].best.r.rv, 3.0109, 1e-3),
    "情况三 RV = 4.0109 − 1.0（宿主现有件分）", rows3[0].best.r.rv);
  assert(rows3[0].all.length === 1, "散件的可评估对象不含持有者自身", rows3[0].all.length);
  const rows4 = core.analyzeRemodel(
    [{ artifact: looseFlower, sourceRole: roleC, signature: core.remodelSignature(looseFlower) }],
    [roleC], 2);
  assert(rows4.length === 0, "散件无宿主 → 不进列表", rows4.length);

  // wearsSet 严格口径：散件位不算装备套装（散件恰为同套时不得误判为宿主）
  const roleE = mkRole("散件恰同套", JSON.parse(JSON.stringify(looseFlower)), "flower");
  assert(core.wearsSet(roleD, "绝缘") === true, "wearsSet：非散件部位有同套件 → true");
  assert(core.wearsSet(roleE, "绝缘") === false,
    "wearsSet 严格口径：仅散件位为同套 → false（散件位不算装备套装）");
  const rowsE = core.analyzeRemodel(
    [{ artifact: looseFlower, sourceRole: roleC, signature: core.remodelSignature(looseFlower) }],
    [roleC, roleE], 2);
  assert(rowsE.length === 0, "散件唯一同套持有者在散件位 → 非宿主，不进列表", rowsE.length);

  // 新录入件（游离件）：无情况一，评全部同套宿主
  const rows5 = core.analyzeRemodel(
    [{ artifact: 乙, sourceRole: null, signature: core.remodelSignature(乙) }],
    [roleJia, roleYi, roleDup], 2);
  assert(rows5.length === 1 && rows5[0].best.case === "host",
    "新录入件按游离件评宿主（无情况一）", rows5[0] && rows5[0].best.case);
  assert(rows5[0].all.length === 3, "游离件可评估对象 = 3 个同套宿主", rows5[0].all.length);

  // —— 三情况开关（allowedKinds）：关闭的类型不参与评估，每件在开启范围内重新取最优 ——
  const selfEntryJia = rowJia.all.find(a => a.case === "self");
  const rowsSelf = core.analyzeRemodel(cands, roles2, 2, null, ["self"]);
  const rowJiaSelf = rowsSelf.find(x => x.artifact === 甲);
  assert(rowJiaSelf.best.case === "self" && rowJiaSelf.best.kind === "self",
    "仅开启原地强化：甲件最佳行动 = 自己", rowJiaSelf.best.case);
  assert(closeTo(rowJiaSelf.best.r.rv, selfEntryJia.r.rv, 1e-9),
    "仅原地强化：甲件 RV 与全开时自身口径一致（行内对象含 kind）", rowJiaSelf.best.r.rv);
  assert(rowJiaSelf.all.length === 1, "仅原地强化：甲件只剩自己 1 个可评估对象", rowJiaSelf.all.length);

  const rowsTrans = core.analyzeRemodel(cands, roles2, 2, null, ["transfer"]);
  const rowYiTrans = rowsTrans.find(x => x.artifact === 乙);
  assert(rowYiTrans.best.case === "host" && rowYiTrans.best.role.name === "重复-乙",
    "仅开启同套转移：乙件自身被排除（持有者不算宿主），最佳 = 转移重复-乙", rowYiTrans.best.role.name);
  assert(rowYiTrans.all.length === 2, "仅同套转移：乙件 2 个宿主对象（无自己）", rowYiTrans.all.length);
  assert(closeTo(rowYiTrans.best.r.rv, 2.2608, 1e-3),
    "仅同套转移：乙件 RV = 2.2608（baseline = 宿主现有件 4.2974）", rowYiTrans.best.r.rv);

  const rowsProm = core.analyzeRemodel(cands, roles2, 2, null, ["promote"]);
  assert(rowsProm.length === 0, "仅开启晋升套装件：套装件无此类行动 → 全部落榜", rowsProm.length);
  const rowsPromLoose = core.analyzeRemodel(
    [{ artifact: looseFlower, sourceRole: roleC, signature: core.remodelSignature(looseFlower) }],
    [roleC, roleD], 2, null, ["promote"]);
  assert(rowsPromLoose.length === 1 && rowsPromLoose[0].best.kind === "promote",
    "仅晋升套装件：散件仍评绝缘宿主（kind = promote）", rowsPromLoose[0] && rowsPromLoose[0].best.kind);

  const rowsMix = core.analyzeRemodel(
    [
      { artifact: 甲, sourceRole: roleJia, signature: core.remodelSignature(甲) },
      { artifact: looseFlower, sourceRole: roleC, signature: core.remodelSignature(looseFlower) }
    ],
    [roleJia, roleYi, roleDup, roleC, roleD], 2, null, ["self", "promote"]);
  const mixJia = rowsMix.find(x => x.artifact === 甲);
  const mixLoose = rowsMix.find(x => x.artifact === looseFlower);
  assert(mixJia && mixJia.best.kind === "self", "组合 [self+promote]：套装件取原地强化", mixJia && mixJia.best.kind);
  assert(mixLoose && mixLoose.best.kind === "promote", "组合 [self+promote]：散件取晋升套装件", mixLoose && mixLoose.best.kind);

  const rowsNone = core.analyzeRemodel(cands, roles2, 2, null, []);
  assert(rowsNone.length === 0, "全关 → 无行动可评估，列表为空", rowsNone.length);
}

console.log("== 算法四补充：3/4 初始自动推断（inferInitialCount，单发档位分解）==");
{
  const mk = (subs, level) => ({ slot: "flower", set: "X", mainStat: "生命值", level: level ?? 20, substats: subs });
  const s = (stat, value) => ({ stat, value, activated: true });

  // 刚性 4 初始：各词条可行发数 k 均唯一，Σk = 1+2+2+4 = 9（仅可 4 初始 = 9 发）
  const art4 = mk([
    s("暴击率", 3.1),          // k∈{1}：31 为单发档位，两发最小 54
    s("暴击伤害", 11.6),       // k∈{2}：54+62=116，一发不含 116、三发最小 162
    s("元素充能效率", 11.0),   // k∈{2}：45+65=110，三发最小 135
    s("防御力", 76)            // k∈{4}：19×4=76，三发最大 69、五发最小 80
  ]);
  assert(core.inferInitialCount(art4) === 4, "刚性 4 初始（Σk=9 唯一分解）→ 4", core.inferInitialCount(art4));

  // 刚性 3 初始：Σk = 1+1+2+4 = 8（仅可 3 初始 = 8 发）
  const art3 = mk([
    s("暴击率", 3.1),          // k∈{1}
    s("暴击伤害", 5.4),        // k∈{1}
    s("攻击力百分比", 9.4),    // k∈{2}：41+53=94，三发最小 123
    s("生命值", 836)           // k∈{4}：209×4=836，三发余数不整除、五发最小 1045
  ]);
  assert(core.inferInitialCount(art3) === 3, "刚性 3 初始（Σk=8 唯一分解）→ 3", core.inferInitialCount(art3));

  // 两可：精通 80 可为 k=4（19×3+23）或 k=5（16×5），Σ=8（4+2+1+1）与 Σ=9（5+2+1+1）皆可 → null
  const artAmb = mk([
    s("元素精通", 80),
    s("暴击率", 5.4),          // k∈{2}
    s("暴击伤害", 5.4),        // k∈{1}
    s("元素充能效率", 5.2)     // k∈{1}
  ]);
  assert(core.inferInitialCount(artAmb) === null, "档位两可（Σ=8/9 皆可）→ null 回退默认", core.inferInitialCount(artAmb));

  // 异常/边界：值无法档位分解、未满级、副词条不足 4 条 → null
  assert(core.inferInitialCount(mk([s("暴击率", 3.3), s("暴击伤害", 5.4), s("元素充能效率", 5.2), s("防御力", 76)])) === null,
    "暴击率 3.3 无法档位分解 → null");
  assert(core.inferInitialCount(Object.assign({}, art4, { level: 19 })) === null, "未满级 → null");
  assert(core.inferInitialCount(mk(art4.substats.slice(0, 3))) === null, "副词条不足 4 条 → null");
  // 待激活词条不计入判据：4 有效 + 1 待激活 → 仍按 4 条推断
  const artPend = mk([...art4.substats, { stat: "生命值", value: 299, activated: false }]);
  assert(core.inferInitialCount(artPend) === 4, "待激活词条不参与推断 → 4", core.inferInitialCount(artPend));

  // 集成：analyzeRemodel 的 initialCountOf 接入推断 → 行内 n 与显式传 3 一致
  const roleInf = {
    id: "inf", name: "推断角色", looseSlot: null,
    effectiveStats: ["暴击率", "暴击伤害", "攻击力百分比"],
    weights: { "暴击率": 1.0, "暴击伤害": 1.0, "攻击力百分比": 0.8 },
    artifacts: { flower: art3, plume: null, sands: null, goblet: null, circlet: null }
  };
  const candInf = { artifact: art3, sourceRole: roleInf, signature: core.remodelSignature(art3) };
  const rowsInf = core.analyzeRemodel([candInf], [roleInf], 2, c => core.inferInitialCount(c.artifact));
  assert(rowsInf.length === 1 && rowsInf[0].best.r.n === 4,
    "集成：initialCountOf 走档位推断（3 初始）→ n=4 重掷次数", rowsInf[0] && rowsInf[0].best.r.n);
  assert(closeTo(rowsInf[0].best.r.eRemodel, core.calcRemodel(art3, roleInf, 2, 3).eRemodel, 1e-9),
    "集成：E[remodel] 与显式 3 初始完全一致");
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
  assert(!("mainValue" in res.result), "识别结果不含 mainValue（主属性数值字段已移除）", Object.keys(res.result).join(","));
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
    assert(rv.result.slot === "flower" && rv.result.mainStat === "生命值" && rv.result.level === 0,
      `分行变体 ${vi + 1}: 部位/主属性/等级 一致`, JSON.stringify(rv.result));
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

console.log("== 方案 A：无散件（looseSlot=null）自由位评估 ==");
{
  // 夹具：5 件同套（魔女）角色；looseSlot 可空 → 冗余位自动识别
  const subs = [
    { stat: "暴击率", value: 3.9, activated: true }, { stat: "暴击伤害", value: 7.8, activated: true },
    { stat: "攻击力百分比", value: 5.8, activated: true }, { stat: "元素精通", value: 23, activated: true }];
  const big = [
    { stat: "暴击率", value: 7.8, activated: true }, { stat: "暴击伤害", value: 15.6, activated: true },
    { stat: "攻击力百分比", value: 11.6, activated: true }, { stat: "元素精通", value: 23, activated: true }];
  const MAIN = { flower: "生命值", plume: "攻击力", sands: "攻击力百分比", goblet: "火元素伤害加成", circlet: "暴击率" };
  const mkArt = (slot, set, mainStat, level, substats) => ({ slot, set, mainStat, level, substats: JSON.parse(JSON.stringify(substats)) });
  function mkRole(looseSlot, setOf) {
    const arts = {};
    Object.keys(MAIN).forEach(slot => { arts[slot] = mkArt(slot, setOf(slot), MAIN[slot], 20, subs); });
    return {
      looseSlot,
      effectiveStats: ["暴击率", "暴击伤害", "攻击力百分比", "元素精通"],
      weights: { "暴击率": 1.0, "暴击伤害": 1.0, "攻击力百分比": 0.8, "元素精通": 0.6 },
      erRequirement: 180, currentER: 180,
      artifacts: arts
    };
  }
  const mag = () => "炽烈的炎之魔女";
  const role5 = mkRole(null, mag);                       // 5 件全魔女（无散件）

  // —— freeSlots 判定 ——
  assert(core.freeSlots(role5).length === 5, "5 件全同套 → 5 个部位全为自由位", JSON.stringify(core.freeSlots(role5)));
  assert(core.freeSlots(mkRole("goblet", mag)).join() === "goblet", "显式 looseSlot → 自由位仅该部位（既有语义不变）",
    JSON.stringify(core.freeSlots(mkRole("goblet", mag))));
  const role41 = mkRole(null, s => (s === "goblet" ? "流浪大地的乐团" : mag()));
  assert(core.freeSlots(role41).join() === "goblet", "4 件同套 + 1 件异套 → 自由位仅那 1 件（冗余位）", JSON.stringify(core.freeSlots(role41)));
  const role221 = mkRole(null, s => (s === "flower" || s === "plume") ? "A" : (s === "goblet" ? "C" : "B"));
  assert(core.freeSlots(role221).length === 0, "2+2+1 分散套装 → 无自由位（保守不评估）", JSON.stringify(core.freeSlots(role221)));
  const role4only = mkRole(null, mag); delete role4only.artifacts.circlet;
  assert(core.freeSlots(role4only).length === 0, "仅录 4 件（缺 1 部位）→ 无自由位（无法判定）", JSON.stringify(core.freeSlots(role4only)));
  // 「无散件」的三种等价写法（data.js 校验把空串与 null 同为合法值）必须同口径
  assert(core.freeSlots(mkRole("", mag)).length === 5, "looseSlot 为空串 \"\" → 与 null 同口径（5 个自由位）", JSON.stringify(core.freeSlots(mkRole("", mag))));
  const role5undef = mkRole(null, mag); role5undef.looseSlot = undefined;
  assert(core.freeSlots(role5undef).length === 5, "looseSlot 字段缺失（undefined）→ 与 null 同口径", JSON.stringify(core.freeSlots(role5undef)));

  // —— 异套件：修复前恒「无适用场景」，现按自由件评估 ——
  const offCup = mkArt("goblet", "流浪大地的乐团", "火元素伤害加成", 20, big);
  const ev = core.evaluateArtifact(offCup, role5);
  const free = ev.results.find(r => r.case === "自由件");
  assert(!!free, "五件套 + 异套件（同部位同主词条）→ 新增「自由件」情况", JSON.stringify(ev.results.map(r => r.case)));
  assert(ev.results.length === 1 && free.isSetSwap === false, "自由件评估无 isSetSwap（looseSlot 为空时本无散件可失去）");
  assert(ev.valuable && free.verdict === "建议替换", "自由件词条更高 → 有价值 / 建议替换", free && free.verdict);
  assert(closeTo(free.currentScore, core.calcArtifactScore(role5.artifacts.goblet, role5)), "自由件比较基准 = 该部位当前件");

  // —— 同套同主词条 → 仍走情况二，且不重复评估 ——
  const onCup = mkArt("goblet", "炽烈的炎之魔女", "火元素伤害加成", 20, big);
  const ev2 = core.evaluateArtifact(onCup, role5);
  assert(ev2.results.length === 1 && ev2.results[0].case === "套装替换", "五件套 + 同套件 → 仅「套装替换」一条（不重复评估）",
    JSON.stringify(ev2.results.map(r => r.case)));
  assert(ev2.results[0].isSetSwap === undefined, "情况二不带 isSetSwap 标记");

  // —— 主词条不同 → 仍不评估（替换语义要求主词条一致）——
  const offSands = mkArt("sands", "流浪大地的乐团", "元素充能效率", 20, big);
  const ev3 = core.evaluateArtifact(offSands, role5);
  assert(ev3.results.length === 0 && ev3.summary === "无适用场景", "五件套 + 异套件但主词条不同 → 无适用场景", ev3.summary);

  // —— 4+1（looseSlot=null）：仅冗余位可换异套件 ——
  const ev4 = core.evaluateArtifact(mkArt("goblet", "角斗士的终幕礼", "火元素伤害加成", 20, big), role41);
  assert(ev4.results.some(r => r.case === "自由件"), "4+1 无散件：冗余位（杯）换异套件 → 自由件", JSON.stringify(ev4.results.map(r => r.case)));
  const ev5 = core.evaluateArtifact(mkArt("flower", "角斗士的终幕礼", "生命值", 20, big), role41);
  assert(ev5.results.length === 0, "4+1 无散件：非冗余位（花）换异套件 → 不评估（会破坏 4 件套）", JSON.stringify(ev5.results.map(r => r.case)));
  // 冗余位换成「所穿套装」件：isSetSwap 必须为 false（不误判情况三）
  const ev6 = core.evaluateArtifact(mkArt("goblet", "炽烈的炎之魔女", "火元素伤害加成", 20, big), role41);
  const free41 = ev6.results.find(r => r.case === "自由件");
  assert(!!free41 && free41.isSetSwap === false, "4+1 无散件：冗余位换所穿套装件 → 自由件且不误判为情况三",
    JSON.stringify(ev6.results.map(r => r.case + "/" + r.isSetSwap)));

  // —— 显式 looseSlot 的既有行为回归 ——
  const roleLoose = mkRole("goblet", mag);               // 显式散件位 = 杯（该件恰好也是同套）
  const ev7 = core.evaluateArtifact(mkArt("goblet", "炽烈的炎之魔女", "火元素伤害加成", 20, big), roleLoose);
  assert(ev7.results.length === 1 && ev7.results[0].case === "散件(变为套装件)" && ev7.results[0].isSetSwap === true,
    "回归：显式 looseSlot 上替换同套件 → 仍识别为情况三", JSON.stringify(ev7.results.map(r => r.case)));
  const ev8 = core.evaluateArtifact(mkArt("sands", "炽烈的炎之魔女", "攻击力百分比", 20, big), roleLoose);
  assert(ev8.results.some(r => r.case === "套装替换"), "回归：非散件部位同套件 → 情况二", JSON.stringify(ev8.results.map(r => r.case)));

  // —— 未满级自由件 → 值得强化 ——
  const ev9 = core.evaluateArtifact(mkArt("goblet", "流浪大地的乐团", "火元素伤害加成", 0, big), role5);
  const free9 = ev9.results.find(r => r.case === "自由件");
  assert(!!free9 && free9.worthy && free9.verdict === "值得强化", "未满级自由件 → 值得强化", free9 && free9.verdict);

  // —— 空串写法（looseSlot = ""）必须与 null 行为一致 ——
  const roleEmpty = mkRole("", mag);
  const evE1 = core.evaluateArtifact(offCup, roleEmpty);
  assert(evE1.results.length === 1 && evE1.results[0].case === "自由件" && evE1.results[0].isSetSwap === false,
    "looseSlot = \"\" + 异套件 → 自由件（空串不被当成散件位）", JSON.stringify(evE1.results.map(r => r.case)));
  const evE2 = core.evaluateArtifact(onCup, roleEmpty);
  assert(evE2.results.length === 1 && evE2.results[0].case === "套装替换" && !evE2.results[0].isSetSwap,
    "looseSlot = \"\" + 同套件 → 情况二且不误判情况三", JSON.stringify(evE2.results.map(r => r.case + "/" + r.isSetSwap)));
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

  // 词条数值单位转换：百分比 ×100（小数→百分数），数值不变；废弃字段（mainValue / note）应已剥离
  const flower = huto && huto.artifacts.flower;
  if (flower) {
    assert(flower.mainStat === "生命值", "花主属性 = 生命值", flower.mainStat);
    assert(!("mainValue" in flower) && !("note" in flower), "导入件不含废弃字段 mainValue / note", Object.keys(flower).join(","));
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

  // 废弃字段剥离（2026-09-28）：note（旧备注）/ mainValue（主属性数值）由 sanitizeStore 从历史数据中删除
  const dirty = storage.migrate({
    version: 1, exportedAt: null,
    roles: [{
      id: "r1", name: "测试",
      artifacts: {
        flower: { slot: "flower", set: "X", mainStat: "生命值", mainValue: 4780, level: 20, substats: [], note: "从莫娜占卜铺导入" },
        plume: null
      }
    }],
    customSets: []
  });
  const df = dirty.roles[0].artifacts.flower;
  assert(!("note" in df) && !("mainValue" in df), "migrate 剥离废弃字段 note / mainValue", Object.keys(df).join(","));
  assert(df.mainStat === "生命值" && df.level === 20 && df.set === "X", "剥离废弃字段不影响其余字段", JSON.stringify(df));
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

  // —— 新结构往返：落盘只保留当前路条件（两条互斥路径）——
  const okLoose = storage.saveFilter({ mode: "loose", slot: "goblet", mainStat: "火元素伤害加成", sets: ["炽烈的炎之魔女"] });
  const backLoose = storage.loadFilter();
  assert(okLoose === true && backLoose && backLoose.mode === "loose" && backLoose.slot === "goblet"
    && backLoose.mainStat === "火元素伤害加成" && backLoose.sets.length === 0,
    "按散件往返一致（套装字段互斥清空）", JSON.stringify(backLoose));
  const okRole = storage.saveFilter({ mode: "role", slot: "flower", mainStat: "生命值", sets: ["绝缘之旗印"] });
  const backRole = storage.loadFilter();
  assert(okRole === true && backRole && backRole.mode === "role" && backRole.sets.length === 1
    && backRole.sets[0] === "绝缘之旗印" && backRole.slot === "" && backRole.mainStat === "",
    "按角色往返一致（件级字段互斥清空）", JSON.stringify(backRole));

  // —— 兼容旧结构 { slot, mainStat, sets }（无 mode）：有件级条件视为按散件，否则按角色 ——
  global.localStorage.setItem(storage.FILTER_KEY, JSON.stringify({ slot: "flower", sets: "x" }));
  const old1 = storage.loadFilter();
  assert(old1 && old1.mode === "loose" && old1.slot === "flower" && old1.sets.length === 0,
    "旧结构含件级条件 → 映射为按散件（sets 非数组 → 空）", JSON.stringify(old1));
  global.localStorage.setItem(storage.FILTER_KEY, JSON.stringify({ slot: "flower", mainStat: 123, sets: ["A", 5, null] }));
  const old2 = storage.loadFilter();
  assert(old2 && old2.mode === "loose" && old2.mainStat === "" && old2.sets.length === 0,
    "旧结构非法主属性/成员被过滤，且不与套装条件混用", JSON.stringify(old2));
  global.localStorage.setItem(storage.FILTER_KEY, JSON.stringify({ sets: ["绝缘之旗印", 5] }));
  const old3 = storage.loadFilter();
  assert(old3 && old3.mode === "role" && old3.sets.length === 1 && old3.sets[0] === "绝缘之旗印" && old3.slot === "",
    "旧结构仅套装条件 → 映射为按角色（非法成员被过滤）", JSON.stringify(old3));

  // —— 损坏数据 ——
  global.localStorage.setItem(storage.FILTER_KEY, "{bad json");
  assert(storage.loadFilter() === null, "损坏 JSON → loadFilter 返回 null");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
