/* =========================================================
   load-guard.js — 资源加载失败可见提示 + 启动自检（无依赖）
   ---------------------------------------------------------
   作用：当关键脚本 / 样式表因网络、缓存或拦截而加载失败、
   导致页面空白时，在顶部显示红色提示，而不是默默空白，
   方便你第一时间定位（而不是以为站点坏了）。
   - 只监控「会致整页空白」的关键脚本：static-api.js / main.js / reader.js
     （reader-guard 等失败不影响内容，不报警，避免误报）
   - 只监控同域样式表；忽略 favicon、跨域 tailwind CDN 等噪声
   - 另含启动自检：若 main.js / reader.js 超时未启动，也给出提示
   部署时由 deploy.bat 自动带 ?v= 戳，保证本文件本身不被缓存。
   ========================================================= */
(function () {
  "use strict";

  // 会导致整页空白的关键脚本（其余脚本失败不影响内容，不报警）
  var CRITICAL = ["static-api.js", "main.js", "reader.js"];

  function sameOrigin(url) {
    if (!url) return false;
    if (url.indexOf("//") === 0) return true;                 // 协议相对 //x.com/a.js
    if (/^[a-z]+:/i.test(url)) {                              // 带协议（http/https/...）
      try {
        var u = new URL(url, location.href);
        return u.origin === location.origin;
      } catch (e) { return false; }
    }
    return true;                                              // 相对路径
  }

  function banner() {
    var el = document.getElementById("loadErrorBanner");
    if (!el) {
      el = document.createElement("div");
      el.id = "loadErrorBanner";
      el.setAttribute("role", "alert");
      el.style.cssText =
        "position:fixed;left:0;right:0;top:0;z-index:2147483647;" +
        "background:#b3261e;color:#fff;font:14px/1.55 system-ui,-apple-system,sans-serif;" +
        "padding:11px 16px;box-shadow:0 2px 12px rgba(0,0,0,.35);max-height:55vh;overflow:auto;text-align:left";
      (document.body || document.documentElement).appendChild(el);
    }
    return el;
  }

  function report(msg, isResource) {
    if (isResource) window.__loadGuardResErr = true;          // 资源错误已说明，避免启动自检重复报警
    var el = banner();
    var line = document.createElement("div");
    line.style.cssText = "margin:3px 0";
    line.textContent = "⚠️ " + msg;
    el.appendChild(line);
  }

  // 捕获阶段监听：<script>/<link> 资源加载失败会触发 error 事件
  // （这类事件不冒泡到 window.onerror，但捕获阶段可截获）
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (!t) return;

    if (t.tagName === "LINK") {
      if (t.getAttribute("rel") !== "stylesheet") return;     // 忽略 favicon 等
      var css = t.href || "";
      if (!sameOrigin(css)) return;
      report("样式表加载失败：" + css + "。请刷新页面，或在手机浏览器「地址栏锁图标 → 清除站点数据」后重试。", true);
      return;
    }

    if (t.tagName === "SCRIPT") {
      var src = t.src || "";
      if (!sameOrigin(src)) return;                           // 忽略跨域（如 tailwind CDN）
      var name = src.split("/").pop().split("?")[0];
      if (CRITICAL.indexOf(name) === -1) return;             // 只报警会致空白的关键脚本
      report("关键脚本 " + name + " 加载失败，页面内容可能无法显示。请刷新页面，或在手机浏览器「地址栏锁图标 → 清除站点数据」后重试。", true);
    }
  }, true);

  // 启动自检：若 main.js / reader.js 在预期时间内未完成启动，给出可见提示
  var BOOT_DELAY = window.__bootCheckDelay || 6000;
  function bootCheck() {
    if (window.__loadGuardResErr) return;                     // 资源错误已说明，避免重复
    if (window.__appBooted) return;
    report("页面脚本未能正常启动，内容可能为空。请刷新页面，或在手机浏览器「地址栏锁图标 → 清除站点数据」后重试。", false);
  }
  if (document.readyState === "complete") setTimeout(bootCheck, BOOT_DELAY);
  else window.addEventListener("load", function () { setTimeout(bootCheck, BOOT_DELAY); });
})();
