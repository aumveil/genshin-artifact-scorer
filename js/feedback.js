/**
 * feedback.js - 交互反馈层（UI 优化新增）
 * 统一替代原生 alert/confirm/prompt，提供：
 *   - 增强版模态框（打开动画 / Esc 与遮罩关闭 / 焦点管理 / 滚动锁定）
 *   - toast 轻量通知（成功 / 错误 / 警告 / 信息）
 *   - confirm 确认对话框（Promise<boolean|null>，支持危险强调与自定义按钮）
 *   - prompt 输入对话框（Promise<string|null>）
 *   - info 信息对话框（替代 alert，支持成功/错误/警告样式）
 * 全局命名空间：App.feedback；ui.js 的 openModal/closeModal 委托至此，保证视觉统一。
 */
(function (global) {
  "use strict";

  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  let closeTimer = null;
  let lastFocus = null;
  let active = null;        // { settle, done } 当前挂起的对话框（confirm/prompt/info）
  const rootSel = "#modalRoot";

  // ============ 模态框基础（增强版）============
  function openModal(titleHtml, bodyNode, footNode, opts) {
    opts = opts || {};
    const root = $(rootSel);
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    root.innerHTML = "";
    root.classList.remove("hidden");

    const modal = el("div", "modal");
    if (opts.size) modal.classList.add("modal-" + opts.size);

    const head = el("div", "modal-head",
      `<h3>${titleHtml}</h3><button class="modal-close" title="关闭" aria-label="关闭">✕</button>`);
    head.querySelector(".modal-close").addEventListener("click", () => closeModal());
    modal.appendChild(head);

    const body = el("div", "modal-body");
    body.appendChild(bodyNode);
    modal.appendChild(body);

    if (footNode) {
      const foot = el("div", "modal-foot");
      foot.appendChild(footNode);
      modal.appendChild(foot);
    }
    root.appendChild(modal);

    // 打开动画（下一帧添加类，触发 CSS transition）
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("modal-open")));

    // 遮罩点击关闭（点击背景区域）
    if (opts.backdrop !== false) {
      root.addEventListener("click", e => { if (e.target === root) closeModal(); });
    }

    // 焦点管理：记录触发元素，将焦点移入弹窗
    lastFocus = document.activeElement;
    const first = modal.querySelector("input, select, textarea, button");
    if (first && first.focus) setTimeout(() => first.focus(), 30);

    // 滚动锁定
    document.body.style.overflow = "hidden";
    return { modal, body, head };
  }

  function closeModal() {
    const root = $(rootSel);
    if (!root || root.classList.contains("hidden")) return;
    root.classList.remove("modal-open");
    document.body.style.overflow = "";
    // 若有挂起的对话框（confirm/prompt/info），以 null 结果结束
    if (active && !active.done) {
      const a = active;
      active = null;
      a.done = true;
      a.settle(null);
    }
    // 延迟清空以播放淡出；期间若重新 openModal 则中断
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (!root.classList.contains("modal-open")) {
        root.innerHTML = "";
        root.classList.add("hidden");
      }
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* 元素可能已销毁 */ } }
    }, 160);
  }

  // Esc 关闭任意弹窗
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      const root = $(rootSel);
      if (root && !root.classList.contains("hidden")) closeModal();
    }
  });

  // ============ Toast 轻量通知 ============
  let toastWrap = null;
  function ensureToastWrap() {
    if (!toastWrap) {
      toastWrap = el("div", "toast-wrap");
      toastWrap.setAttribute("aria-live", "polite");
      document.body.appendChild(toastWrap);
    }
    return toastWrap;
  }
  function toast(msg, type, duration) {
    const t = el("div", "toast toast-" + (type || "info"));
    t.textContent = msg;
    ensureToastWrap().appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 260);
    }, duration || 2600);
    return t;
  }

  // ============ Confirm 确认对话框 ============
  /**
   * @param {Object} opts { title, message(纯文本), confirmText, cancelText, danger }
   * @returns {Promise<boolean|null>} true=确认 false=取消 null=关闭对话框（Esc/遮罩）
   */
  function confirm(opts) {
    opts = opts || {};
    return new Promise(resolve => {
      active = { settle: resolve, done: false };
      const body = el("div", "confirm-body");
      const msg = el("div", "confirm-msg");
      msg.textContent = opts.message || "";
      body.appendChild(msg);
      if (opts.detail) {
        const d = el("div", "confirm-detail");
        d.textContent = opts.detail;
        body.appendChild(d);
      }
      const foot = el("div");
      const btnCancel = el("button", "btn", opts.cancelText || "取消");
      const btnOk = el("button", "btn " + (opts.danger ? "btn-danger" : "btn-primary"), opts.confirmText || "确定");
      let done = false;
      const settle = v => {
        if (done) return;
        done = true;
        if (active === null || active.done) { /* 已被全局关闭接管 */ }
        active = null;
        resolve(v);
        closeModal();
      };
      btnCancel.addEventListener("click", () => settle(false));
      btnOk.addEventListener("click", () => settle(true));
      foot.append(btnCancel, btnOk);
      const { modal } = openModal(opts.title || "请确认", body, foot, { backdrop: true });
      // 危险操作默认焦点放「取消」按钮，降低误触
      const focusTarget = opts.danger ? btnCancel : btnOk;
      setTimeout(() => focusTarget.focus(), 40);
      void modal;
    });
  }

  // ============ Prompt 输入对话框 ============
  /**
   * @param {Object} opts { title, label, placeholder, defaultValue, confirmText }
   * @returns {Promise<string|null>} 输入值；取消/Esc 返回 null
   */
  function prompt(opts) {
    opts = opts || {};
    return new Promise(resolve => {
      active = { settle: resolve, done: false };
      const body = el("div");
      const field = el("div", "field");
      const label = opts.label ? `<label for="prInput">${esc(opts.label)}</label>` : "";
      field.innerHTML = label +
        `<input id="prInput" type="text" value="${esc(opts.defaultValue || "")}" placeholder="${esc(opts.placeholder || "")}" maxlength="30" autocomplete="off">`;
      body.appendChild(field);
      const foot = el("div");
      const btnCancel = el("button", "btn", "取消");
      const btnOk = el("button", "btn btn-primary", opts.confirmText || "确定");
      let done = false;
      const settle = v => {
        if (done) return;
        done = true;
        active = null;
        resolve(v);
        closeModal();
      };
      const input = field.querySelector("input");
      btnCancel.addEventListener("click", () => settle(null));
      btnOk.addEventListener("click", () => settle(input.value.trim() || null));
      input.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); btnOk.click(); }
      });
      foot.append(btnCancel, btnOk);
      openModal(opts.title || "请输入", body, foot, { backdrop: true });
      setTimeout(() => { input.focus(); input.select(); }, 40);
    });
  }

  // ============ Info 信息对话框（替代 alert）============
  /**
   * @param {Object} opts { title, message(HTML), type: info|success|error|warn, confirmText }
   * @returns {Promise<void>}
   */
  function info(opts) {
    opts = opts || {};
    return new Promise(resolve => {
      active = { settle: resolve, done: false };
      const body = el("div", "info-body info-" + (opts.type || "info"));
      body.innerHTML = opts.message;
      const foot = el("div");
      const btnOk = el("button", "btn btn-primary", opts.confirmText || "知道了");
      let done = false;
      const settle = () => {
        if (done) return;
        done = true;
        active = null;
        resolve();
        closeModal();
      };
      btnOk.addEventListener("click", settle);
      foot.appendChild(btnOk);
      openModal(opts.title || "提示", body, foot, { backdrop: true });
      setTimeout(() => btnOk.focus(), 40);
    });
  }

  global.App = global.App || {};
  global.App.feedback = { openModal, closeModal, toast, confirm, prompt, info };
})(window);
