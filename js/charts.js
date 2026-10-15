/**
 * charts.js - 鉴赏台图形语言（R2 起；R8 收敛）
 * 提供：donut（圆环构成图）/ radar（权值画像雷达）/ heatGrid（藏品版图矩阵）
 * 约定：返回 HTML 字符串（与既有 seg 条同源，零依赖）；取色只用 token（--comp-N / grade 类）；
 *       不靠颜色单独载义（每段带数值 / title / aria）。
 */
(function (global) {
  "use strict";

  /**
   * 圆环构成图（R8：取代堆叠条；取代原 5 部位 mini 条的计量体系已删除）。
   * @param items [{label, value, pct}] 降序；超 max 段聚合「其他」；色走 --comp-N；图例带数值（不靠颜色单独载义）
   * @returns [svg + 图例] 组合（HTML 串），供 hero 最右侧 .ov-ring 使用
   */
  function donut(items, max = 5) {
    if (!items || !items.length) return "";
    let parts = items.slice();
    if (parts.length > max + 1) {
      const head = parts.slice(0, max);
      const rest = parts.slice(max);
      head.push({ label: "其他", value: rest.reduce((s, x) => s + x.value, 0), pct: rest.reduce((s, x) => s + x.pct, 0) });
      parts = head;
    }
    const R = 30, CIRC = 2 * Math.PI * R;
    const GAP = 0.011;   // R9：段间留缝（1.1% 弧长），相邻段可辨
    let off = 0;
    const segs = parts.map((p, i) => {
      const frac = Math.max(0, Math.min(100, p.pct)) / 100;
      const len = Math.max(0, frac - GAP) * CIRC;
      const seg = `<circle r="${R}" cx="40" cy="40" fill="none" stroke="var(--comp-${Math.min(i + 1, 6)})" stroke-width="9"` +
        ` stroke-dasharray="${len.toFixed(2)} ${(CIRC - len).toFixed(2)}"` +
        ` stroke-dashoffset="${(-(off + GAP / 2) * CIRC).toFixed(2)}" transform="rotate(-90 40 40)">` +
        `<title>${p.label} ${p.pct.toFixed(1)}%</title></circle>`;
      off += frac;
      return seg;
    }).join("");
    // R9：图例数值右对齐成列（dot | 名称自动撑开 | 数值 tabular 右对齐）
    const legend = parts.map((p, i) =>
      `<span class="cl-item" title="${p.label} ${p.pct.toFixed(1)}%"><i style="background:var(--comp-${Math.min(i + 1, 6)})"></i>` +
      `<span class="cl-name">${p.label}</span><em class="cl-pct">${Math.round(p.pct)}%</em></span>`
    ).join("");
    return `<svg viewBox="0 0 80 80" role="img" aria-label="分数构成：${parts.map(p => `${p.label} ${Math.round(p.pct)}%`).join("，")}">` +
      `<circle r="${R}" cx="40" cy="40" fill="none" stroke="var(--fill-1)" stroke-width="9"></circle>` +
      segs +
      `</svg>` +
      `<div class="ov-ring-legend">${legend}</div>`;
  }

  global.App = global.App || {};
  /**
   * 热力矩阵（藏品版图）：dims = 行标签数组；groups = [{cols}]，
   * 每列 = 与 dims 等长的数组（null = 该桶无此维度）；cell = {key, hold, fill(0..100), tip}。
   * 实格 / 空格（描边）带 data-bucket（供点击跳转），void 为空格位。
   */
  function heatGrid(dims, groups) {
    // R8：色阶改「拉伸后 5 级分档」——原连续映射在数据集中段（55~75%）只产生 2~3 档可辨，用户反馈「只能看出两种」
    const ALPHA = [15, 36, 58, 79, 100];
    const fills = [];
    groups.forEach(g => g.cols.forEach(col => col.forEach(c => { if (c && c.hold) fills.push(c.fill); })));
    const mn = fills.length ? Math.min(...fills) : 0;
    const mx = fills.length ? Math.max(...fills) : 100;
    const levelOf = v => mx > mn ? Math.min(4, Math.floor((v - mn) / (mx - mn) * 5)) : 4;
    const labels = `<div class="cm-labels">` + dims.map(d => `<span>${d}</span>`).join("") + `</div>`;
    const strip = groups.map(g => {
      const cells = [];
      for (let r = 0; r < dims.length; r++) {
        for (const col of g.cols) {
          const cell = col[r];
          if (!cell) { cells.push(`<span class="cm-cell void"></span>`); continue; }
          if (cell.hold) {
            const mix = ALPHA[levelOf(Math.max(0, Math.min(100, cell.fill)))];
            cells.push(`<span class="cm-cell" data-bucket="${cell.key}" title="${cell.tip}" style="background:color-mix(in srgb, var(--brand) ${mix}%, transparent)"></span>`);
          } else {
            cells.push(`<span class="cm-cell empty" data-bucket="${cell.key}" title="${cell.tip}"></span>`);
          }
        }
      }
      const head = g.label ? `<span class="cm-group-head">${g.label}</span>` : "";
      return `<div class="cm-group" style="grid-template-columns:repeat(${g.cols.length},var(--cm-cell))">${head}${cells.join("")}</div>`;
    }).join("");
    return labels + `<div class="cm-strip">${strip}</div>`;
  }

  global.App.charts = { donut, heatGrid };
})(window);
