/* =========================================================
   reader-guard.js · 读者阅读页防盗（仅阅读页启用）
   创作者编辑器(editor.html) / 后台(admin.html) 不引入本脚本。
   功能：
   1) 禁用右键 / 复制 / 文字选中（输入框与可编辑区例外）
   2) 全局半透明滚动文字水印（页面底层，不遮挡正文）
   3) 文章底部固定版权声明区
   4) 移动端截图行为检测 → 温和磨砂弹窗提示（不黑屏、不强制刷新）
   ========================================================= */
(function () {
  "use strict";

  // 自我保护：编辑器 / 后台即便被误引入也不启用任何限制
  var PAGE = document.body ? document.body.getAttribute("data-page") : "";
  if (PAGE === "editor" || PAGE === "admin" || window.__NO_READER_GUARD__) return;

  /* ---------- 可配置文案 ---------- */
  var WATERMARK_BASE = "摇摇又汞汞站｜禁止截图、录屏、盗文传播";
  var watermarkUser = "";   // 公开站无登录态，水印固定为站点文案（不绑定个人账号）

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  function watermarkText() {
    // 用户名置首（防盗溯源：水印以站点文案为主，不绑定个人账号）
    return watermarkUser ? watermarkUser + "｜" + WATERMARK_BASE : WATERMARK_BASE;
  }

  // 文章底部版权声明（站点指定文案）
  var COPYRIGHT_HTML =
    '<div class="rg-c-title">版权声明</div>' +
    '<p>同人创作均为粉丝原创，版权归作者所有，转载请获授权，商用二改一律禁止</p>';

  document.body.classList.add("rg-active");

  /* ---------- 1. 全局滚动水印 ---------- */
  function buildWatermark() {
    var w = 460, h = 180;   // 加宽以容纳「｜昵称」
    var svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='" + w + "' height='" + h + "'>" +
      "<text x='8' y='96' font-family='PingFang SC, Microsoft YaHei, sans-serif' " +
      "font-size='13' fill='rgba(120,124,150,0.10)' " +
      "transform='rotate(-22 " + (w / 2) + " " + (h / 2) + ")'>" + escapeXml(watermarkText()) + "</text></svg>";
    var layer = document.createElement("div");
    layer.className = "rg-watermark";
    layer.setAttribute("aria-hidden", "true");
    layer.style.backgroundImage = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
    document.body.appendChild(layer);
  }

  // 重建水印层（昵称加载完成后刷新文案）
  function refreshWatermark() {
    var old = document.querySelector(".rg-watermark");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    buildWatermark();
  }

  /* ---------- 2. 文章底部版权声明 ---------- */
  function injectCopyright() {
    if (document.querySelector(".rg-copyright")) return;
    if (PAGE !== "fanfic") return; // 版权声明仅放置在同人专区（fanfic）页面
    var footer = document.querySelector(".footer");
    if (!footer || !footer.parentNode) return;
    var sec = document.createElement("section");
    sec.className = "rg-copyright";
    sec.setAttribute("aria-label", "版权声明");
    sec.innerHTML = COPYRIGHT_HTML;
    footer.parentNode.insertBefore(sec, footer);
  }

  /* ---------- 3. 禁用右键 / 复制 / 选中 / 拖拽盗存 ---------- */
  var EDITABLE_SEL = 'input, textarea, [contenteditable="true"], [contenteditable=""]';
  function isEditable(t) { return !!(t && t.closest && t.closest(EDITABLE_SEL)); }

  // 是否处于「编辑态」：焦点在表单控件，或页面上有打开的编辑/弹窗层。
  // 此时禁用一切防盗拦截（含截图弹窗），避免遮挡编辑界面、干扰输入。
  function inEditingContext() {
    var ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return true;
    if (document.querySelector(".modal-mask.open")) return true;
    return false;
  }

  function bindGuard() {
    // 右键菜单：输入框/可编辑区放行（保证搜索框、表单可用）
    document.addEventListener("contextmenu", function (e) {
      if (isEditable(e.target)) return;
      e.preventDefault();
    });
    // 复制 / 剪切：同上放行例外
    document.addEventListener("copy", function (e) {
      if (isEditable(e.target)) return;
      e.preventDefault();
    });
    document.addEventListener("cut", function (e) {
      if (isEditable(e.target)) return;
      e.preventDefault();
    });
    // 文字选中：同上放行例外（配合 CSS user-select:none 双重保险）
    document.addEventListener("selectstart", function (e) {
      if (isEditable(e.target)) return;
      if (inEditingContext()) return;
      e.preventDefault();
    });
    // 拖拽盗存：禁止把文章内图片 / 链接拖到本地保存
    document.addEventListener("dragstart", function (e) {
      var t = e.target;
      if (t && (t.tagName === "IMG" || t.tagName === "A" || (t.closest && t.closest("img, a")))) {
        e.preventDefault();
      }
    });
    // 移动端补救：iOS Safari 会忽略 user-select:none，长按仍能短暂选中并弹出系统「复制」；
    // 选区一出现立即清空，使系统复制针对空选区无效（输入框/可编辑区放行）
    document.addEventListener("selectionchange", function () {
      if (inEditingContext()) return;   // 编辑弹窗 / 输入框内：绝不干预，保证可正常输入与选中
      var sel = window.getSelection ? window.getSelection() : null;
      if (!sel || sel.rangeCount === 0) return;
      var node = sel.anchorNode;
      if (node && node.nodeType === 3) node = node.parentNode;
      if (node && node.closest && node.closest(EDITABLE_SEL)) return;
      try { sel.removeAllRanges(); } catch (e) {}
    });
  }

  /* ---------- 4. 温和截图提示弹窗 ---------- */
  var lastShown = 0;
  function maybeScreenshot() {
    // 仅「同人专区」(fanfic.html) 弹出此温馨提示；首页 / 物料 / 规则 / 我的 / 阅读页等均不弹
    if (location.pathname.split("/").pop() !== "fanfic.html") return;
    if (inEditingContext()) return;      // 编辑弹窗 / 输入框内不弹提示，避免遮挡编辑界面
    var now = Date.now();
    if (now - lastShown < 8000) return;   // 同一会话内最多 8 秒提示一次，避免打扰
    lastShown = now;
    showModal();
  }

  function showModal() {
    if (document.querySelector(".rg-modal-mask")) return;
    var mask = document.createElement("div");
    mask.className = "rg-modal-mask";
    mask.innerHTML =
      '<div class="rg-modal" role="dialog" aria-modal="true">' +
        '<h4>温馨提示 🧡💙</h4>' +
        '<p>亲爱的汞妹，感谢你喜欢摇汞的同人创作～<br>' +
        '本文为粉丝原创作品，我们用心守护每一份热爱。<br>' +
        '请勿截图、录屏或搬运盗文传播；如需分享，欢迎通过页脚联系方式与作者或站方联系获取授权。</p>' +
        '<button type="button" class="btn btn-blue rg-close">我已知晓，继续阅读</button>' +
      '</div>';
    document.body.appendChild(mask);

    function close() {
      mask.classList.remove("rg-show");
      setTimeout(function () { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 320);
    }
    mask.addEventListener("click", function (e) { if (e.target === mask) close(); });
    mask.querySelector(".rg-close").addEventListener("click", close);

    // 下一帧加 class，触发淡入过渡
    requestAnimationFrame(function () { requestAnimationFrame(function () { mask.classList.add("rg-show"); }); });
  }

  function bindScreenshotDetection() {
    // 桌面端：PrintScreen 键
    window.addEventListener("keyup", function (e) {
      if (e.key === "PrintScreen" || e.code === "PrintScreen") maybeScreenshot();
    });

    // 移动端（尽力而为）：应用切到后台再回来、或可视视口高度骤减（截图工具条）
    var hiddenAt = 0;
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { hiddenAt = Date.now(); }
      else if (hiddenAt && Date.now() - hiddenAt < 1500) { maybeScreenshot(); hiddenAt = 0; }
    });

    if (window.visualViewport) {
      var lastH = window.visualViewport.height;
      window.visualViewport.addEventListener("resize", function () {
        var h = window.visualViewport.height;
        if (lastH - h > window.innerHeight * 0.25) maybeScreenshot();
        lastH = h;
      });
    }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    buildWatermark();
    injectCopyright();
    bindGuard();
    bindScreenshotDetection();

    // 进页面先弹一次引导提示（同一会话仅弹一次，避免每次跳转都打扰）
    try {
      if (!sessionStorage.getItem("rg_intro_shown")) {
        sessionStorage.setItem("rg_intro_shown", "1");
        setTimeout(function () { maybeScreenshot(); }, 900);
      }
    } catch (e) {}

    // 公开站：水印保持站点文案（不绑定个人账号）
    try {
      fetch("/api/me?_=" + Date.now())
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && d.user && d.user.nickname) {
            watermarkUser = String(d.user.nickname).slice(0, 24);
            refreshWatermark();
          }
        })
        .catch(function () {});
    } catch (e) {}

    // 编辑弹窗打开时，立即移除可能残留的截图提示遮罩，避免遮挡编辑界面
    try {
      var mo = new MutationObserver(function () {
        if (inEditingContext()) {
          var m = document.querySelector(".rg-modal-mask");
          if (m && m.parentNode) m.parentNode.removeChild(m);
        }
      });
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
