"use strict";
/**
 * ui_ocr_test.js - 验证 receiveOcrArtifact 的语义
 *
 * 期望行为：
 *   ① 识别顺利 → **不弹窗**，直接切到「价值评估」并展示结果
 *   ② 识别不完整（缺部位） → 回退到录入弹窗，让用户对着原文修正
 *   ③ 完全没有角色数据 → 提示，不做任何跳转
 */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "../..");

const SAMPLE_TEXT = [
  "乐团的晨光", "生之花", "生命值", "717", "+0",
  "暴击率+3.1%", "防御力+21", "元素精通+23", "攻击力+14（待激活）",
  "流浪大地的乐团：（0）",
].join("\n");

const BROKEN_TEXT = "一些无法识别的东西\n乱七八糟";

function findBackup() {
  const dir = path.join(ROOT, "backups");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
  return path.join(dir, files[files.length - 1]);
}

(async () => {
  const results = [];
  const ok = (n, c, e) => { results.push({ n, pass: !!c }); console.log(`  ${c ? "✓" : "✗"} ${n}${e ? "  (" + e + ")" : ""}`); };

  const backup = fs.readFileSync(findBackup(), "utf-8").replace(/^\uFEFF/, "");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", e => console.log("  PAGEERROR:", e.message));

  await page.goto(pathToFileURL(path.join(ROOT, "index.html")).href);
  await page.evaluate(d => { localStorage.clear(); localStorage.setItem("gys_reliquary_v1", d); }, backup);
  await page.reload();
  await page.waitForSelector(".role-card", { timeout: 10000 });

  // —— 用例 1：正常识别 → 直接进评估，不弹窗 ——
  const r1 = await page.evaluate(t => App.ui.receiveOcrArtifact({ text: t }), SAMPLE_TEXT);
  await page.waitForTimeout(700);

  const s1 = await page.evaluate(() => {
    const card = document.querySelector(".pend-card");
    const sum = document.querySelector(".eval-summary");
    return {
      dialog: !!document.querySelector('[role="dialog"]'),
      hasPend: !!card,
      pendText: card ? card.textContent.replace(/\s+/g, " ").slice(0, 100) : "",
      summary: sum ? sum.textContent.replace(/\s+/g, " ").trim() : "",
      cases: document.querySelectorAll(".eval-case.case-3, .eval-case.case-2, .eval-case.case-1, .eval-case.case-0").length,
    };
  });

  ok("返回 true", r1 === true);
  ok("**没有弹窗**", !s1.dialog);
  ok("出现待评估件卡片", s1.hasPend, s1.pendText.slice(0, 60));
  ok("卡片含部位「生之花」", /生之花/.test(s1.pendText));
  ok("卡片含套装「流浪大地的乐团」", /流浪大地的乐团/.test(s1.pendText));
  // 汇总出现即证明评估真的跑过了（文案里带「评估 N 个角色」）。
  // 不强制有结果行：样本是 Lv.0 的件，对所有角色都无提升是正确业务结果。
  ok("评估已执行（有汇总）", /评估\s*\d+\s*个角色/.test(s1.summary), s1.summary.slice(0, 50));

  // —— 用例 2：识别不完整 → 回退录入弹窗 ——
  const r2 = await page.evaluate(t => App.ui.receiveOcrArtifact({ text: t }), BROKEN_TEXT);
  await page.waitForTimeout(700);
  const s2 = await page.evaluate(() => ({
    dialog: !!document.querySelector('[role="dialog"]'),
    textarea: (document.querySelector(".artifact-text") || {}).value || "",
  }));
  ok("无法识别时返回 false", r2 === false);
  ok("回退打开录入弹窗", s2.dialog);
  ok("原文已填入弹窗", s2.textarea.includes("乱七八糟"));

  // —— 用例 3：无角色数据 ——
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("gys_reliquary_v1", JSON.stringify({ version: 1, roles: [], customSets: [], collection: [] }));
  });
  await page.reload();
  await page.waitForTimeout(800);
  const r3 = await page.evaluate(t => App.ui.receiveOcrArtifact({ text: t }), SAMPLE_TEXT);
  await page.waitForTimeout(300);
  const toast3 = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".toast")).map(t => t.textContent.trim()).join(" | "));
  ok("无角色时返回 false", r3 === false);
  ok("无角色时给出提示", /新建一个角色/.test(toast3), toast3.slice(0, 50));

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log("");
  console.log(`结果：${results.length - failed.length} / ${results.length} 通过`);
  if (failed.length) { console.log("失败：" + failed.map(f => f.n).join(" / ")); process.exitCode = 1; }
})().catch(e => { console.error("异常:", e.message); process.exitCode = 1; });
