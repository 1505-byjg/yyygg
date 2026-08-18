/* =============================================================
   main.js — 摇摇又汞汞 交互逻辑（原生 JS，无依赖）
   板块：物料合集(采访/节目/商务/直播/互动/其他) · 同人专区(全部公开)
   功能：导航悬浮+汉堡 / 轮播 / 站内搜索
        / 标签筛选 / 图片水印切换 / 夜间模式 / 懒加载 / 合规拦截
        / 会话感知(角色权限) / 同人投稿(仅管理员可发帖)
   说明：所有静态数据均为演示占位，替换真实内容见 README.md。
   ============================================================= */
(function () {
  "use strict";

  /* ---------- 0. 全局配置 ---------- */
  const IMG = "images/";          // 素材目录
  const WM_TEXT = "摇摇又汞汞专用，请勿盗用"; // 水印文字

  // 把本地图片压缩为 jpg base64（最大边 maxEdge，质量 q），控制体积以便存入数据库
  function compressImageFile(file, maxEdge, q) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("decode"));
        img.onload = () => {
          let { width, height } = img;
          const scale = Math.min(1, maxEdge / Math.max(width, height));
          const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          try { resolve(canvas.toDataURL("image/jpeg", q)); }
          catch (e) { reject(e); }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // 读文件为 base64 dataURL（视频用，不压缩）
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("read"));
      r.onload = () => resolve(r.result);
      r.readAsDataURL(file);
    });
  }

  // 从视频文件抽取首帧作为海报（jpeg dataURL，最长边 ≤640）。失败返回 ""，不阻断上传。
  function extractVideoPoster(file) {
    return new Promise((resolve) => {
      let url = "";
      try {
        url = URL.createObjectURL(file);
        const v = document.createElement("video");
        v.preload = "metadata"; v.muted = true; v.playsInline = true; v.src = url;
        const cleanup = () => { try { URL.revokeObjectURL(url); } catch {} };
        const cap = () => {
          try {
            const w = v.videoWidth || 320, h = v.videoHeight || 180;
            const scale = Math.min(1, 640 / Math.max(w, h));
            const cv = document.createElement("canvas");
            cv.width = Math.max(1, Math.round(w * scale));
            cv.height = Math.max(1, Math.round(h * scale));
            cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
            const data = cv.toDataURL("image/jpeg", 0.8);
            cleanup(); resolve(data);
          } catch { cleanup(); resolve(""); }
        };
        v.addEventListener("loadeddata", () => {
          // 跳到靠前的非黑帧再截图
          try {
            v.currentTime = Math.min(0.5, (v.duration || 1) / 3);
            v.addEventListener("seeked", cap, { once: true });
            setTimeout(cap, 800);   // 兜底：seeked 未触发也截图
          } catch { cap(); }
        }, { once: true });
        v.addEventListener("error", () => { cleanup(); resolve(""); }, { once: true });
        setTimeout(() => { cleanup(); resolve(""); }, 4000);   // 总兜底
      } catch { if (url) { try { URL.revokeObjectURL(url); } catch {} } resolve(""); }
    });
  }

  /* ---------- 1. 示例数据（演示用，可整体替换） ---------- */
  const MATERIALS = [
    { id: "m1", cat: "采访", title: "独家专访回顾",   cover: IMG + "mat1.svg", source: "官博",   link: "https://example.com/official/m1", desc: "官方杂志深度访谈，聊新作与幕后故事，全文 + 高清图已同步官博。", by: "@站务小星", date: "2026-03-12" },
    { id: "m2", cat: "采访", title: "综艺访谈合集",   cover: IMG + "mat2.svg", source: "视频平台", link: "https://example.com/official/m2", desc: "多平台访谈精剪合集，时长约 45 分钟，含未播花絮。", by: "@站务阿橙", date: "2026-03-18" },
    { id: "m3", cat: "采访", title: "访谈金句九图",   cover: IMG + "mat3.svg", source: "微博",   link: "https://example.com/official/m3", desc: "采访名场面九宫格，高清可当壁纸，文案已获授权转载。", by: "@站务小星", date: "2026-03-22" },
    { id: "m4", cat: "节目", title: "真人秀名场面",   cover: IMG + "mat4.svg", source: "视频平台", link: "https://example.com/official/m4", desc: "综艺真人秀高光片段合集，官方 4K 源，附分集索引。", by: "@站务阿橙", date: "2026-04-01" },
    { id: "m5", cat: "节目", title: "综艺舞台 cut",   cover: IMG + "mat5.svg", source: "官博",   link: "https://example.com/official/m5", desc: "舞台直拍 cut，含多机位，官方发布，禁止二传。", by: "@站务小星", date: "2026-04-08" },
    { id: "m6", cat: "采访", title: "访谈花絮九宫格", cover: IMG + "mat6.svg", source: "微博",   link: "https://example.com/official/m6", desc: "访谈现场花絮图组，幕后文字已整理，高清可保存。", by: "@站务阿橙", date: "2026-04-15" },
    { id: "m7", cat: "节目", title: "节目海报壁纸",   cover: IMG + "mat7.svg", source: "官博",   link: "https://example.com/official/m7", desc: "节目官方海报高清壁纸，多尺寸适配手机 / 桌面。", by: "@站务小星", date: "2026-04-20" },
    { id: "m8", cat: "节目", title: "节目锁屏壁纸",   cover: IMG + "mat8.svg", source: "视频平台", link: "https://example.com/official/m8", desc: "官方锁屏壁纸套组，含竖屏 / 横屏，可免费使用。", by: "@站务阿橙", date: "2026-04-26" },
  ];

  const FANFICS = []; // 原演示/展示用卡片（非管理员上传的占位内容）已下线，同人专区仅展示真实投稿

  /* ---------- 2. 工具函数 ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let toastTimer;
  function toast(msg, warn) {
    let el = $("#toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    el.className = "toast show" + (warn ? " warn" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = "toast"), 2600);
  }

  const BLOCK = ["私生", "航班", "酒店", "住址", "跟机", "蹲守", "身份证", "电话", "行程泄露"];
  function isIllegal(text) { return BLOCK.some((w) => text && text.includes(w)); }

  /* ---------- 3. 会话状态（角色权限） ---------- */
  let ME = null;          // { id, nickname, role, status, canPost }
  let FAN_POSTS = [];  // 同人专区投稿

  async function initSession() {
    try {
      const r = await fetch("/api/me?_=" + Date.now());
      if (r.ok) { const d = await r.json(); ME = d.user; }
    } catch {}
    applyNav();
  }

  function applyNav() {
    const login = $("#navLogin"), avatar = $("#navAvatar");
    // 公开站：隐藏登录入口与个人中心头像（登录/注册功能已移除）
    if (login) login.style.display = "none";
    if (avatar) avatar.style.display = "none";
    // 公开站：所有「同人专区」入口直接开放（移除灰化与点击拦截）
    document.querySelectorAll('a[href="fanfic.html"]').forEach((a) => {
      a.classList.remove("guest-locked");
      a.style.display = "";
      a.onclick = null;
    });
  }

  /* ---------- 3c. 同人图片大图预览（lightbox，支持多图翻页，图本体带水印 + 底部水印条） ---------- */
  let fanImgLb = null, fanLbList = [], fanLbIdx = 0;
  function updateFanLb() {
    if (!fanImgLb) return;
    const img = fanImgLb.querySelector(".img-lb-frame img");
    const count = fanImgLb.querySelector(".img-lb-count");
    const prev = fanImgLb.querySelector(".img-lb-prev");
    const next = fanImgLb.querySelector(".img-lb-next");
    img.src = fanLbList[fanLbIdx] || "";
    const multi = fanLbList.length > 1;
    if (count) count.textContent = multi ? (fanLbIdx + 1) + " / " + fanLbList.length : "";
    if (prev) prev.style.display = multi ? "" : "none";
    if (next) next.style.display = multi ? "" : "none";
  }
  function navFanLb(d) {
    if (!fanLbList.length) return;
    fanLbIdx = (fanLbIdx + d + fanLbList.length) % fanLbList.length;
    updateFanLb();
  }
  function openFanImageLightbox(images, alt, startIndex) {
    fanLbList = Array.isArray(images) ? images.slice() : [images];
    fanLbIdx = Math.max(0, Math.min(parseInt(startIndex, 10) || 0, fanLbList.length - 1));
    if (!fanImgLb) {
      fanImgLb = document.createElement("div");
      fanImgLb.className = "modal-mask img-lightbox";
      fanImgLb.id = "fanImgLightbox";
      fanImgLb.innerHTML = `
        <div class="img-lb-inner">
          <div class="img-lb-frame">
            <img class="wm" data-wm="${WM_TEXT}" alt="" />
            <div class="img-lb-band">${WM_TEXT}</div>
          </div>
          <button class="img-lb-prev" type="button" aria-label="上一张">‹</button>
          <button class="img-lb-next" type="button" aria-label="下一张">›</button>
          <div class="img-lb-count"></div>
          <button class="img-lb-close" type="button" aria-label="关闭">×</button>
        </div>`;
      document.body.appendChild(fanImgLb);
      fanImgLb.addEventListener("click", (e) => {
        if (e.target === fanImgLb || e.target.classList.contains("img-lb-close")) fanImgLb.classList.remove("open");
        else if (e.target.classList.contains("img-lb-prev")) navFanLb(-1);
        else if (e.target.classList.contains("img-lb-next")) navFanLb(1);
      });
      const kb = (e) => {
        if (!fanImgLb.classList.contains("open")) return;
        if (e.key === "ArrowLeft") navFanLb(-1);
        else if (e.key === "ArrowRight") navFanLb(1);
      };
      document.addEventListener("keydown", kb);
    }
    updateFanLb();
    fanImgLb.classList.add("open");
  }

  /* ---------- 4. 夜间模式 ---------- */
  function initTheme() {
    const dark = localStorage.getItem("sf_theme") === "dark";
    document.documentElement.classList.toggle("dark", dark);
    const btn = $("#themeToggle");
    if (btn) {
      btn.textContent = dark ? "☀️" : "🌙";
      btn.addEventListener("click", () => {
        const nowDark = document.documentElement.classList.toggle("dark");
        localStorage.setItem("sf_theme", nowDark ? "dark" : "light");
        btn.textContent = nowDark ? "☀️" : "🌙";
        toast(nowDark ? "已切换夜间模式" : "已切换日间模式");
      });
    }
  }

  /* ---------- 5. 导航：滚动悬浮 + 汉堡菜单 ---------- */
  function initNav() {
    const nav = $(".nav");
    if (nav) {
      const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 10);
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
    const burger = $("#hamburger"), menu = $("#navMenu");
    if (burger && menu) {
      const menuParent = menu.parentElement; // 保存原始父元素（.nav）
      const closeMenu = () => { menu.classList.remove("open"); menuParent.appendChild(menu); };
      window.closeNavMenu = closeMenu;   // 暴露给游客拦截等场景：点击受保护链接时彻底关闭抽屉
      burger.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!menu.classList.contains("open")) {
          // 打开时将菜单移到 body 下，脱离 .nav 的 backdrop-filter 包含块
          document.body.appendChild(menu);
        }
        menu.classList.toggle("open");
      });
      // 点击菜单外区域关闭
      document.addEventListener("click", (e) => {
        if (!menu.classList.contains("open")) return;
        if (!menu.contains(e.target) && e.target !== burger) closeMenu();
      });
      // 按 Esc 也关闭
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
    }
    const sb = $("#searchToggle"), box = $("#searchBox");
    if (sb && box) sb.addEventListener("click", () => box.classList.toggle("open"));
    const page = document.body.dataset.page;
    if (page) {
      const map = { "material": "物料合集", "fanfic": "同人专区", "rule": "社区规则" };
      $$(`.nav-menu a`).forEach((a) => { if (a.textContent.includes(map[page] || "")) a.classList.add("active"); });
    }
  }

  // 全屏轮播 banner 数据（从 API 拉取）
  let HERO_ITEMS = [];

  async function loadHero() {
    try {
      const r = await fetch("/api/hero");
      const d = await r.json();
      HERO_ITEMS = Array.isArray(d.items) ? d.items : [];
      LS.set("hero", HERO_ITEMS);          // 缓存成功数据，网络不稳时也能秒开
    } catch { /* 保留 prefill 的缓存值，不置空 */ }
  }

  /* ---------- 6. 全屏轮播 Banner ---------- */
  function initHero() {
    const track = $("#heroTrack"), dotsEl = $("#heroDots"), heroEl = $(".hero");
    if (!track) return;
    // 若 API 拉到了数据，重新渲染 slides（覆盖首屏空占位，杜绝示例图闪现）
    if (HERO_ITEMS && HERO_ITEMS.length) {
      // 纯静态站：轮播图永远走 hero.json 里的静态路径（images/xxx.jpg 或 data: 内嵌），
      // 不再依赖 /api/hero/<id>/image 后端接口（纯静态托管下该接口必定 404，会导致裂图）。
      track.innerHTML = HERO_ITEMS.map((it) => {
        const rawImg = it.image || "";
        const imgSrc = (typeof rawImg === "string" && rawImg.startsWith("data:")) ? rawImg : esc(rawImg);
        return `
        <div class="hero-slide wm" data-wm="${WM_TEXT}">
          ${imgSrc ? `<img src="${imgSrc}" alt="${esc(it.title)}" loading="eager" decoding="async" onload="this.classList.add('loaded')" onerror="if(!this.dataset.r1){this.dataset.r1=1;this.src=this.src.split('?')[0]+'?r='+Date.now();}else{this.classList.add('img-broken');}" />` : ""}
          <div class="hero-cap">
            ${it.link ? `<a href="${esc(it.link)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">` : ""}
              <h2>${esc(it.title)}</h2>
              <p>${esc(it.subtitle)}</p>
            ${it.link ? `</a>` : ""}
          </div>
        </div>`;
      }).join("");
      if (dotsEl) {
        dotsEl.innerHTML = HERO_ITEMS.map((_, i) => `<button aria-label="第 ${i + 1} 张" ${i === 0 ? 'class="active"' : ''}></button>`).join("");
      }
      if (heroEl) heroEl.classList.add("has-hero");
    } else if (heroEl) {
      heroEl.classList.remove("has-hero");
    }
    const slides = $$(".hero-slide", track);
    const dots = dotsEl ? $$("button", dotsEl) : [];
    if (slides.length <= 1) return;   // 仅单图不启自动轮播
    let idx = 0, timer;
    const go = (i) => {
      idx = (i + slides.length) % slides.length;
      track.style.transform = `translateX(-${idx * 100}%)`;
      dots.forEach((d, k) => d.classList.toggle("active", k === idx));
    };
    const play = () => (timer = setInterval(() => go(idx + 1), 45000));
    const stop = () => clearInterval(timer);
    dots.forEach((d, k) => d.addEventListener("click", () => { go(k); stop(); play(); }));
    const prev = $("#heroPrev"), next = $("#heroNext");
    if (prev) prev.addEventListener("click", () => { go(idx - 1); stop(); play(); });
    if (next) next.addEventListener("click", () => { go(idx + 1); stop(); play(); });
    const hero = $(".hero");
    if (hero) { hero.addEventListener("mouseenter", stop); hero.addEventListener("mouseleave", play); }
    play();
    // 兜底：若 3s 后仍有图未触发 onload（极少数边缘情况），强制显示，避免卡在透明
    setTimeout(() => {
      $$(".hero-slide img", track).forEach((im) => { if (!im.classList.contains("img-broken")) im.classList.add("loaded"); });
    }, 3000);
  }



  /* ---------- 8. 站内搜索（物料 / 同人） ---------- */
  function initSearch() {
    const input = $("#globalSearch"), panel = $("#searchPanel");
    if (!input || !panel) return;
    const render = (q) => {
      q = q.trim();
      if (!q) { panel.classList.remove("open"); return; }
      const mats = MATERIALS.filter((m) => m.title.includes(q) || m.cat.includes(q) || (m.desc && m.desc.includes(q)) || (m.source && m.source.includes(q)) || (m.by && m.by.includes(q)));
      const fics = memberFanItems().filter((f) => f.title.includes(q) || f.author.includes(q) || f.desc.includes(q));
      let html = "";
      if (!mats.length && !fics.length) html = `<p class="m-text-soft">未找到与“${esc(q)}”相关的内容。</p>`;
      mats.forEach((m) => (html += `<a class="search-result" href="material.html#mat-${encodeURIComponent(m.id)}"><span><b>${esc(m.title)}</b><br><span class="m-text-soft" style="font-size:12px">物料 · ${esc(m.cat)}</span></span></a>`));
      fics.forEach((f) => {
        const href = f.kind === "article" ? `reader.html?id=${encodeURIComponent(f.id)}` : `fanfic.html#post-${encodeURIComponent(f.id)}`;
        html += `<a class="search-result" href="${href}"><span><b>${esc(f.title)}</b><br><span class="m-text-soft" style="font-size:12px">同人 · ${esc(f.author)}</span></span></a>`;
      });
      $("#searchResultList").innerHTML = html;
      panel.classList.add("open");
    };
    input.addEventListener("input", (e) => render(e.target.value));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { render(e.target.value); } });
    document.addEventListener("click", (e) => { if (!panel.contains(e.target) && e.target !== input) panel.classList.remove("open"); });
  }

  // 搜索结果深链：从 #mat-<id> / #post-<id> 滚动定位并高亮到具体作品
  function scrollToHashFromSearch() {
    const h = location.hash || "";
    const id = h.startsWith("#mat-") || h.startsWith("#post-") ? h.slice(1) : "";
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("search-focus");
    setTimeout(() => el.classList.remove("search-focus"), 2600);
  }

  // 站点提示：后台发布的顶部横幅（按页面范围展示，可关闭并按 id 记忆）
  function initSiteTips() {
    const page = document.body.dataset.page || "index";
    const bar = document.createElement("div");
    bar.id = "siteTipBar";
    bar.className = "site-tip-bar";
    document.body.appendChild(bar);
    fetch("/api/tips").then((r) => r.json()).then((d) => {
      const tips = d.tips || [];
      tips.forEach((t) => {
        if (t.active === false) return;
        const pages = (t.pages && t.pages.length) ? t.pages : ["all"];
        if (!pages.includes("all") && !pages.includes(page)) return;
        const row = document.createElement("div");
        row.className = "site-tip-row";
        row.innerHTML =
          `<span class="site-tip-text">${esc(t.content || "")}</span>` +
          (t.link ? `<a class="site-tip-link" href="${esc(t.link)}" target="_blank" rel="noopener">查看 ›</a>` : "") +
          `<button class="site-tip-close" aria-label="关闭">×</button>`;
        // 关闭仅隐藏本次：不持久记忆，刷新页面后提示会再次弹出
        row.querySelector(".site-tip-close").addEventListener("click", () => {
          row.remove();
          if (!bar.children.length) bar.style.display = "none";
        });
        bar.appendChild(row);
      });
      if (bar.children.length) bar.style.display = "block";
    }).catch(() => {});
  }

  // 8.5 大图预览(lightbox)已移除：站点图片不再提供「查看原图」入口（见 T2）

  /* ---------- 9. 懒加载 + 水印 ---------- */
  function initLazyAndWatermark() {
    const imgs = $$("img[data-src]");
    // 退化：浏览器/webview 不支持 IntersectionObserver 时直接全部加载，
    // 否则「new IntersectionObserver」会抛错，导致 renderFanfic(boot) 整个中断、
    // 页面空白并触发 load-guard「未能正常启动」——这也是移动端内容为空的根因。
    if (!("IntersectionObserver" in window)) {
      imgs.forEach((img) => {
        const src = img.dataset.src || "";
        if (src) img.src = src;
        img.classList.add("loaded");
      });
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          const img = en.target;
          img.src = img.dataset.src;
          img.onload = () => img.classList.add("loaded");
          io.unobserve(img);
        }
      });
    }, { rootMargin: "200px" });
    imgs.forEach((img) => {
      img.classList.add("lazy");
      const src = img.dataset.src || "";
      // data: 内联图（上传的 base64 物料/同人封面）直接显示：懒加载对它无意义，
      // 且内联大图在 IO 边界情况下可能不触发 → 直接加载最稳妥
      if (src.startsWith("data:")) { img.src = src; img.classList.add("loaded"); return; }
      io.observe(img);
    });

    // 查看原图切换已移除：所有图片默认显示水印（WM_TEXT），不再提供去水敏入口
  }

  /* ---------- 10. 点赞（所有访客可用） ---------- */
  function bindActions(scope) {
    // 自己的投稿可删除
    $$("[data-del]", scope).forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("确定删除该投稿？")) return;
        const id = btn.dataset.del;
        try {
          const r = await fetch("/api/fanposts/" + id, { method: "DELETE" });
          if (r.ok) { toast("已删除"); await loadFanPosts(); drawFan(); }
          else { const d = await r.json().catch(() => ({})); toast(d.msg || "删除失败", true); }
        } catch { toast("网络错误", true); }
      });
    });
    // 文章类目：进入沉浸式阅读器
    $$("[data-open]", scope).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.open;
        location.href = "reader.html?id=" + encodeURIComponent(id);
      });
    });
    $$("[data-edit]", scope).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.edit;
        const post = FAN_POSTS.find((p) => p.id === id);
        if (post) openFanEdit(post);
        else toast("投稿数据未加载", true);
      });
    });
  }

  function openFanPost(post) {
    const modal = $("#fanPostModal");
    const body = $("#fanPostBody");
    if (!modal || !body) return;
    body.innerHTML = '<div class="fp-head"><h2>' + esc(post.title || "未命名文章") + '</h2>'
      + '<div class="fp-meta">' + authorHtml(post.author, post.authorUrl) + ' · ' + esc(post.date || "") + (post.pair && !post.hidePair ? ' · ' + esc(post.pair) : '') + '</div>'
      + ((post.tags && post.tags.length) ? '<div class="tag-list fp-tags">' + post.tags.map((t) => '<span class="tag-chip">' + esc(t) + '</span>').join("") + '</div>' : '')
      + '<div class="fan-post-content">' + (post.content || "") + '</div>';
    modal.classList.add("open");
  }

  /* ---------- 11a. 文章编辑弹窗 ---------- */
  const EDIT_TAG_LIB = {
    "题材": ["现代", "古风", "校园", "ABO", "末日", "架空", "日常", "治愈"],
    "结局": ["HE", "BE", "开放式"],
    "尺度": ["清水向", "微糖", "虐恋", "群像"],
    "类型": ["长篇", "短篇", "连载", "完结", "广播剧剧本", "同人图铺"],
  };
  function renderEditTags(container, selected) {
    if (!container) return;
    const sel = new Set(selected || []);
    container.innerHTML = Object.values(EDIT_TAG_LIB).flat().map((t) => `<span data-tag="${esc(t)}" class="${sel.has(t) ? "on" : ""}">${esc(t)}</span>`).join("");
    container.querySelectorAll("span").forEach((el) => {
      el.addEventListener("click", () => { el.classList.toggle("on"); });
    });
  }
  function getSelectedEditTags() {
    const els = $("#fanEditTags");
    if (!els) return [];
    return Array.from(els.querySelectorAll("span.on")).map((el) => el.dataset.tag).filter(Boolean);
  }
  async function openFanEdit(post) {
    const modal = $("#fanEditModal");
    if (!modal) return;
    // 从 FAN_POSTS 或 FANFICS 找到最新数据
    const p = (FAN_POSTS.find((x) => x.id === post.id)) || post;
    $("#fanEditId").value = p.id;
    $("#fanEditTitle").value = p.title || "";
    $("#fanEditAuthor").value = p.author || "";
    if ($("#fanEditPair")) $("#fanEditPair").value = ["年上", "年下", "无差"].includes(p.pair) ? p.pair : "无差";
    if ($("#fanEditSerial")) $("#fanEditSerial").value = (p.serial && ["serial", "completed", "single"].includes(p.serial)) ? p.serial : "single";
    $("#fanEditContent").value = p.content || "";
    renderEditTags($("#fanEditTags"), p.tags || []);
    modal.classList.add("open");
  }
  async function saveFanEdit() {
    const id = $("#fanEditId").value;
    if (!id) return;
    const title = $("#fanEditTitle").value.trim();
    if (!title) { toast("标题不能为空", true); return; }
    const body = {
      title,
      authorName: $("#fanEditAuthor").value.trim(),
      pair: ($("#fanEditPair") && $("#fanEditPair").value) || "无差",
      serial: ($("#fanEditSerial") && $("#fanEditSerial").value) || "single",
      tags: getSelectedEditTags(),
      content: $("#fanEditContent").value,
    };
    try {
      const r = await fetch("/api/fanposts/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        toast("已保存修改 ✨");
        // 刷新列表
        await loadFanPosts();
        const grid = $("#fanGrid");
        if (grid) renderFanfic(grid);
        document.getElementById("fanEditModal").classList.remove("open");
      } else { toast(d.msg || "保存失败", true); }
    } catch { toast("网络错误", true); }
  }

  /* ---------- 11b. 入场动画 ---------- */
  function initReveal() {
    const els = $$(".reveal");
    if (!els.length) return;
    // 兜底：不支持 IntersectionObserver 时直接全部显示，避免永久隐藏
    if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.1 });
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    els.forEach((el) => {
      const rect = el.getBoundingClientRect();
      // 首屏已可见的元素立即显示，不依赖 IO 首次回调的时序
      if (vh && rect.top < vh && rect.bottom > 0) el.classList.add("in");
      else io.observe(el);
    });
  }

  /* ---------- 12. PC 右侧悬浮栏 ---------- */
  function initFloatBar() {
    const top = $("#floatTop");
    if (top) top.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    const report = $("#floatReport");
    if (report) report.addEventListener("click", () => {
      const subject = encodeURIComponent("【违规举报】摇摇又汞汞粉丝站");
      const body = encodeURIComponent(
        "请描述违规内容（站方将在 24h 内核实处理）：\n\n"
        + "1. 违规链接/页面：" + location.href + "\n"
        + "2. 违规类型：\n"
        + "3. 详细说明：\n"
      );
      window.location.href = "mailto:buyaojiugong@163.com?subject=" + subject + "&body=" + body;
      toast("已为你打开邮件举报，收件邮箱：buyaojiugong@163.com");
    });
  }

  /* =============================================================
     13. 各页面渲染
     ============================================================= */
  // 把链接展示为友好域名（避免超长 URL 撑破卡片）
  function hostOf(url) {
    try { const u = new URL(url); return u.host.replace(/^www\./, ""); } catch { return ""; }
  }

  // 只放行 http/https，杜绝 javascript: 之类的危险协议
  function safeHref(url) {
    const s = String(url == null ? "" : url).trim();
    return /^https?:\/\//i.test(s) ? s : "";
  }

  // 作者署名：名字可点击 → 只看该作者全部作品；填了主页链接额外显示「找到老师」外链
  function authorHtml(name, url) {
    const n = esc(name || "");
    if (!n) return "";
    const h = safeHref(url);
    const filter = '<span class="author-filter" data-author="' + n + '" title="只看 ' + n + ' 的全部作品">' + n + '</span>';
    const ext = h ? ' <a class="author-link" href="' + esc(h) + '" target="_blank" rel="noopener noreferrer" title="找到 ' + n + ' 老师（主页）">找到老师</a>' : '';
    return filter + ext;
  }

  // 衍生链接 HTML：支持多个链接（links 数组，兼容旧 link 字符串）
  function matChildLinksHtml(c) {
    const links = (c.links && c.links.length) ? c.links.filter(Boolean) : (c.link ? [c.link] : []);
    if (!links.length) return "";
    const base = esc(c.title || "链接");
    return links.map((l, k) =>
      `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer" class="mat-child-link">${base}${links.length > 1 ? " " + (k + 1) : ""} ↗</a>`
    ).join(" ");
  }

  function matCard(m) {
    const hasLink = !!m.link;
    const host = hasLink ? hostOf(m.link) : "";
    const linkBtn = hasLink
      ? `<a class="link-btn" href="${esc(m.link)}" target="_blank" rel="noopener noreferrer" title="${esc(m.link)}">🔗 前往 ${esc(host || "外链")} ↗</a>`
      : `<span class="link-btn disabled" title="管理员未提供外链">🔗 无外链</span>`;
    return `
      <div class="mat-card card reveal" id="mat-${esc(m.id)}">
        <div class="info">
          <div class="meta-top">
            <span class="cat">${esc(m.cat)}</span>
            <span class="src-tag">来源 · ${esc(m.source)}</span>
          </div>
          <div class="title">${esc(m.title)}</div>
          <div class="desc">${esc(m.desc)}</div>
          <div class="meta-sub">📅 ${esc(m.date)} · 上传 ${esc(m.by)}</div>
          ${linkBtn}
          ${(m.children && m.children.length) ? `
          <details class="mat-children">
            <summary>📂 衍生（${m.children.length}）</summary>
            <ul>
              ${m.children.map((c) => `<li>${matChildLinksHtml(c)}</li>`).join("")}
            </ul>
          </details>` : ""}
        </div>
      </div>`;
  }

  function sortList(list, mode) {
    // 物料日期可能是「年月」(YYYY-MM) 或完整日期 (YYYY-MM-DD)，比较前把年月补成当月 1 号，避免混排错位
    const toKey = (x) => { const s = String(x.date || ""); return s.length === 7 ? s + "-01" : s; };
    // 上浮机制：按「最近活动时间」倒序（updatedAt 不存在则回退发布日期）
    const actKey = (x) => new Date(x.updatedAt || x.date || 0).getTime();
    if (mode === "active") return [...list].sort((a, b) => actKey(b) - actKey(a));
    if (mode === "date") return [...list].sort((a, b) => toKey(a).localeCompare(toKey(b)));
    return list;
  }

  function renderMaterials(container) {
    const cats = ["全部", "采访", "节目", "商务", "直播", "互动", "其他"];
    const bar = $("#matCats"), sortBar = $("#matSort");
    let curCat = "全部", curSort = "active";
    if (bar) bar.innerHTML = cats.map((c, i) => `<button class="chip ${i === 0 ? "active" : ""}" data-cat="${c}">${c}</button>`).join("");
    if (sortBar) sortBar.innerHTML = [["active", "最近更新"], ["date", "最早发布"]].map(([v, t]) => `<button class="chip ${v === curSort ? "active" : ""}" data-sort="${v}">${t}</button>`).join("");
    const draw = () => {
      let list = curCat === "全部" ? MATERIALS : MATERIALS.filter((m) => m.cat === curCat);
      list = sortList(list, curSort);
      container.innerHTML = list.map(matCard).join("") || `<p class="m-text-soft">暂无内容</p>`;
      bindActions(container); initLazyAndWatermark(); initReveal();
    };
    if (bar) bar.addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      $$("#matCats .chip").forEach((x) => x.classList.remove("active")); b.classList.add("active");
      curCat = b.dataset.cat; draw();
    });
    if (sortBar) sortBar.addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      $$("#matSort .chip").forEach((x) => x.classList.remove("active")); b.classList.add("active");
      curSort = b.dataset.sort; draw();
    });
    draw();
  }

  // 取投稿的图片数组（多图优先，单图兼容，无图返回空数组）
  function postImages(p) {
    if (p && p.files && p.files.length) return p.files;
    if (p && p.file) return [p.file];
    return [];
  }
  // 多图画廊：每张包裹 .wm 水印 + data-zoom 点开大图（带完整图集与索引，便于翻页）
  function fanGalleryHtml(imgs, title) {
    const listJson = esc(JSON.stringify(imgs));
    const cells = imgs.map((src, i) => `
      <div class="fan-gallery-cell wm" data-wm="${WM_TEXT}" style="border-radius:10px;overflow:hidden;position:relative">
        <img class="fan-img-zoom" data-zoom="1" data-zoom-list='${listJson}' data-zoom-index="${i}" src="${esc(src)}" alt="${esc(title)} 图${i + 1}" title="点击查看大图" style="width:100%;display:block;cursor:zoom-in" loading="lazy" />
      </div>`).join("");
    return `<div class="fan-gallery">${cells}</div>`;
  }
  // 卡片（多图）：仅展示首图，其余折叠；首图带完整图集与“+N”角标，点开可翻阅全部
  function fanFirstImageHtml(imgs, title) {
    const first = imgs[0];
    const rest = imgs.length - 1;
    const more = rest > 0 ? `<div class="fan-img-more">共 ${imgs.length} 张 · 点击翻看</div>` : "";
    return `<div class="fan-gallery-cell wm fan-gallery-first" data-wm="${WM_TEXT}" style="border-radius:10px;overflow:hidden;position:relative;cursor:zoom-in">
      <img class="fan-img-zoom" data-zoom="1" data-zoom-list='${esc(JSON.stringify(imgs))}' data-zoom-index="0" src="${esc(first)}" alt="${esc(title)}" title="点击查看全部图片" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" />
      ${more}
    </div>`;
  }

  function fanCard(f) {
    const kindLabel = f.kind === "image" ? "图片" : f.kind === "article" ? "文章" : "视频";
    // 标题兜底：图片 / 视频 允许无标题，卡片显示类型名而非空白
    const dispTitle = (f.title && String(f.title).trim()) ? f.title
      : (f.kind === "image" ? "图片" : f.kind === "video" ? "视频" : "无标题");
    // 连载/合集文章：卡片标注状态，并解析出最后一章名称
    const isCollection = (f.serial === true || f.serial === "serial" || f.serial === "completed");
    const serialLabel = isCollection ? ((f.serial === "completed") ? "已完结" : "连载中") : "短篇";
    let lastCh = "", chCount = 0;
    if (f.content) {
      try {
        const _doc = new DOMParser().parseFromString(f.content, "text/html");
        const _heads = _doc.querySelectorAll("h2, h3");
        chCount = _heads.length;
        if (chCount) lastCh = _heads[chCount - 1].textContent.trim();
      } catch (e) {}
    }
    // 视频：根据 link 类型智能嵌入（B 站 BV 号 / YouTube / 直接 mp4 URL）
    function renderVideo(url) {
      if (!url) return `<div class="audio-bar"><button type="button" onclick="window.__toast&&window.__toast('试看播放（演示）')">▶</button><span class="m-text-soft" style="font-size:12px">${esc(f.progress)}</span></div>`;
      const u = url.trim();
      // B 站：BV 号或完整 URL
      const bvMatch = u.match(/\/video\/(BV[a-zA-Z0-9]+)/) || u.match(/^BV[a-zA-Z0-9]+$/);
      if (bvMatch) {
        const bvid = bvMatch[1];
        return `<iframe src="https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=0&high_quality=1" scrolling="no" frameborder="0" allowfullscreen="true" style="width:100%;aspect-ratio:16/9;border-radius:10px;background:#0e1a2a"></iframe>`;
      }
      // YouTube
      const ytMatch = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([a-zA-Z0-9_-]{11})/);
      if (ytMatch) {
        return `<iframe src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allowfullscreen style="width:100%;aspect-ratio:16/9;border-radius:10px"></iframe>`;
      }
      // 直接 mp4 / webm / mov URL
      if (/\.(mp4|webm|mov)(\?.*)?$/i.test(u)) {
        return `<video src="${esc(u)}" controls preload="metadata" playsinline style="width:100%;border-radius:10px;background:#0e1a2a;max-height:340px"></video>`;
      }
      // 兜底：打开外链
      return `<a href="${esc(u)}" target="_blank" rel="noopener" class="btn btn-blue" style="display:inline-block;margin-top:6px">▶ 在新窗口打开视频</a>`;
    }
    // 优先显示本地上传的附件：图片取图集，其余类型媒体在下方 topMedia 中按统一布局置于卡片顶部
    const imgs = postImages(f);
    const delBtn = f.mine ? `<button data-del="${f.id}" type="button" class="m-text-soft" style="margin-left:8px;border:none;background:none;cursor:pointer;color:#9B3B3B">删除</button>` : "";
    // 统一卡片布局：站内图片功能已关闭，仅视频类保留顶部媒体，其余以文字信息为主（避免大块空白）
    let topMedia = "";
    if (f.kind === "video") {
      topMedia = f.file
        ? `<video src="${esc(f.file)}" controls preload="metadata" playsinline style="width:100%;border-radius:10px;background:#0e1a2a;max-height:340px;display:block"></video>`
        : renderVideo(f.link);
    } else if (f.kind === "image") {
      topMedia = "";   // 图片功能已关闭，不再展示「图片投稿已隐藏」占位
    }
    return `
      <div class="fan-card card reveal" id="post-${esc(f.id)}">
        ${topMedia}
        <div class="info">
          <div class="meta-top">
            <span class="cat">${kindLabel}</span>
            ${f.pair && !f.hidePair ? `<span class="pair-tag">${esc(f.pair)}</span>` : ""}
            ${!f.hideSerial ? `<span class="serial-tag serial-${!f.serial ? "single" : (f.serial === "completed" ? "done" : "serial")}">${serialLabel}${chCount ? " · " + chCount + "章" : ""}</span>` : ""}
            ${!f.hideSerial && isCollection && chCount ? `<span class="ch-update-tag">更新至第 ${chCount} 章</span>` : ""}
          </div>
          <div class="t">${esc(dispTitle)}</div>
          ${!f.hideSerial && isCollection && chCount ? `<div class="ch-last">📚 最新章：${esc(lastCh)}</div>` : ""}
          <div class="d">${authorHtml(f.author, f.authorUrl)} · ${esc(f.desc)}</div>
          ${(f.tags && f.tags.length) ? `<div class="tag-list">${f.tags.map((t) => `<span class="tag-chip">${esc(t)}</span>`).join("")}</div>` : ""}
          <div class="meta-sub">📅 ${esc(f.date)}${(f.updatedAt && String(f.updatedAt).slice(0, 10) !== f.date) ? " · 更新 " + esc(String(f.updatedAt).slice(0, 10)) : ""} ${delBtn}</div>
          <div class="act-row">
            ${(f.kind === "image" && f.link) ? `<a class="link-btn" href="${esc(f.link)}" target="_blank" rel="noopener noreferrer" title="${esc(f.link)}">🔗 前往 ${esc(hostOf(f.link) || "外链")} ↗</a>` : ""}
            ${f.kind === "article" ? `<button data-open="${f.id}" type="button" class="read-full">📖 阅读全文</button>` : ""}
            ${(f.kind === "article" && f.mine) ? `<button data-edit="${f.id}" type="button" class="read-full" style="margin-left:6px">✏️ 编辑</button>` : ""}
          </div>
        </div>
      </div>`;
  }

  async function loadFanPosts() {
    try {
      const r = await fetch("/api/fanposts");
      if (r.ok) { const d = await r.json(); FAN_POSTS = d.posts || []; LS.set("fanposts", FAN_POSTS); }
    } catch {}
  }

  function memberFanItems() {
    const myId = ME && ME.id;
    return FAN_POSTS.map((p) => ({
      id: p.id, kind: p.kind, title: p.title, author: p.author, authorUrl: p.authorUrl,
      // 视频用海报(cover)做缩略图，图片用上传图本身；其余兜底
      cover: p.kind === "video" ? (p.cover || (IMG + "fan4.svg")) : (p.file || p.cover || (IMG + "fan4.svg")),
      file: p.file,
      files: p.files || (p.file ? [p.file] : []),
      link: p.link,
      desc: p.desc, progress: p.link ? "含外链" : "同人投稿", content: p.content, serial: p.serial,
      pair: p.pair, tags: p.tags || [], date: p.date, updatedAt: p.updatedAt,
      hidePair: !!p.hidePair, hideSerial: !!p.hideSerial,
      mine: !!(myId && (ME.role === "admin" || p.authorId === myId)),
    }));
  }

  function renderFanfic(container) {

    // 文章详情弹窗关闭（一次性绑定，防重复）
    $$("[data-close]").forEach((b) => { if (b._cBound) return; b._cBound = true; b.addEventListener("click", () => { const m = document.getElementById(b.dataset.close); if (m) m.classList.remove("open"); }); });
    $$(".modal-mask").forEach((m) => { if (m._mBound) return; m._mBound = true; m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); }); });
    const kinds = [{ k: "全部", t: "全部" }, { k: "article", t: "文章" }, { k: "video", t: "视频" }];
    const pairs = ["全部", "年上", "年下", "无差"];
    const bar = $("#fanKinds"), pairBar = $("#fanPairs"), sortBar = $("#fanSort");
    const authorBar = $("#fanAuthors");
    let curKind = "全部", curPairs = new Set(), curSort = "active";
    let curAuthor = "全部";

    // 支持从 URL 进入（如读者页点作者跳回首页并自动筛选该作者）
    const urlAuthor = new URLSearchParams(location.search).get("author");
    if (urlAuthor) curAuthor = urlAuthor;

    // 选中某作者：只看 TA 的全部作品，并滚动到列表
    const setAuthor = (name) => {
      curAuthor = name || "全部";
      syncAuthorBar();
      drawFan();
      if (curAuthor !== "全部") {
        const g = document.getElementById("fanGrid");
        if (g) g.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    // 顶部「正在查看」提示条（无筛选时隐藏）
    const syncAuthorBar = () => {
      if (!authorBar) return;
      if (curAuthor === "全部") { authorBar.innerHTML = ""; return; }
      authorBar.innerHTML = '<span class="author-active">正在查看：<b>' + esc(curAuthor) + '</b> 的全部作品</span>'
        + '<button class="chip" type="button" data-clear-author>✕ 查看全部作者</button>';
    };

    if (bar) bar.innerHTML = kinds.map((x, i) => `<button class="chip ${i === 0 ? "active" : ""}" data-kind="${x.k}">${x.t}</button>`).join("");
    if (pairBar) pairBar.innerHTML = pairs.map((p, i) => `<button class="chip ${i === 0 ? "active" : ""}" data-pair="${p}">${p === "全部" ? "全部配对" : p}</button>`).join("");
    if (sortBar) sortBar.innerHTML = [["active", "最近更新"], ["date", "最早发布"]].map(([v, t], i) => `<button class="chip ${v === curSort ? "active" : ""}" data-sort="${v}">${t}</button>`).join("");

    const baseList = () => FANFICS.concat(memberFanItems());

    drawFan = () => {
      let list = baseList();
      if (curKind !== "全部") list = list.filter((f) => f.kind === curKind);
      if (curPairs.size > 0) list = list.filter((f) => curPairs.has(f.pair));
      if (curAuthor !== "全部") list = list.filter((f) => f.author === curAuthor);
      list = sortList(list, curSort);
      const empty = curAuthor === "全部" ? "暂无内容" : ("暂无「" + esc(curAuthor) + "」的作品");
      container.innerHTML = list.map(fanCard).join("") || `<p class="m-text-soft">${empty}</p>`;
      bindActions(container); initLazyAndWatermark(); initReveal();
    };

    if (bar) bar.addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      $$("#fanKinds .chip").forEach((x) => x.classList.remove("active")); b.classList.add("active");
      curKind = b.dataset.kind; drawFan();
    });
    if (pairBar) pairBar.addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      const p = b.dataset.pair;
      const chips = $$("#fanPairs .chip");
      if (p === "全部") { curPairs.clear(); }
      else {
        if (curPairs.has(p)) curPairs.delete(p); else curPairs.add(p);
        b.classList.toggle("active");
      }
      chips.forEach((x) => { if (x.dataset.pair === "全部") x.classList.toggle("active", curPairs.size === 0); });
      drawFan();
    });
    if (sortBar) sortBar.addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      $$("#fanSort .chip").forEach((x) => x.classList.remove("active")); b.classList.add("active");
      curSort = b.dataset.sort; drawFan();
    });

    /* 作者名点击 → 只看该作者全部作品（主站内筛选，不做分组） */
    if (container && !container._authorBound) {
      container._authorBound = true;
      container.addEventListener("click", (e) => {
        const el = e.target.closest(".author-filter"); if (!el) return;
        e.preventDefault(); e.stopPropagation();
        setAuthor(el.dataset.author);
      });
    }
    if (authorBar && !authorBar._clearBound) {
      authorBar._clearBound = true;
      authorBar.addEventListener("click", (e) => {
        if (e.target.closest("[data-clear-author]")) { e.preventDefault(); setAuthor("全部"); }
      });
    }
    // 阅读弹窗里的作者名也支持筛选（并关闭弹窗）
    const fanModal = document.getElementById("fanPostModal");
    if (fanModal && !fanModal._authorBound) {
      fanModal._authorBound = true;
      fanModal.addEventListener("click", (e) => {
        const el = e.target.closest(".author-filter"); if (!el) return;
        e.preventDefault(); e.stopPropagation();
        fanModal.classList.remove("open");
        setAuthor(el.dataset.author);
      });
    }

    syncAuthorBar();
    drawFan();
  }
  let drawFan = () => {}; // 供删除后重绘

  /* ---------- 14. 同人投稿（仅管理员可发帖） ---------- */
  function initComposer() {
    const c = $("#composer"), lock = $("#composerLock");
    if (!c) return;
    const refresh = () => {
      if (ME && ME.canPost) { c.style.display = "block"; if (lock) lock.style.display = "none"; }
      else if (ME && !ME.canPost) { c.style.display = "none"; if (lock) lock.style.display = "block"; }
      else { c.style.display = "none"; if (lock) lock.style.display = "none"; }
    };
    refresh();

    // 附件处理：图片压缩存 base64；视频读原始 base64 + 抽首帧海报（≤15MB，本地上传）
    let currentFile = null;  // 图片:{dataUrl,isVideo:false}；视频:{dataUrl,cover,isVideo:true}
    const fileInput = $("#postFile");
    const filePreview = $("#filePreview");
    const filePreviewImg = $("#filePreviewImg");
    const filePreviewName = $("#filePreviewName");
    const fileRemove = $("#fileRemove");
    const kindSel = $("#postKind");
    const sizeTip = $("#maxSizeTip");

    const clearFile = () => {
      currentFile = null;
      if (fileInput) fileInput.value = "";
      if (filePreview) filePreview.style.display = "none";
      if (filePreviewImg) { filePreviewImg.src = ""; filePreviewImg.style.display = "none"; }
      if (filePreviewName) filePreviewName.textContent = "";
    };
    if (fileInput) {
      fileInput.addEventListener("change", async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) { clearFile(); return; }
        const kind = kindSel ? kindSel.value : "article";
        if (kind === "image") {
          if (!f.type.startsWith("image/")) { toast("「图片」类型请选择图片文件", true); clearFile(); return; }
          if (f.size > 10 * 1024 * 1024) { toast("图片不能超过 10MB", true); clearFile(); return; }
          try {
            const dataUrl = await compressImageFile(f, 1600, 0.85);
            currentFile = { dataUrl, name: f.name, type: f.type, size: f.size, isVideo: false };
            if (filePreview) filePreview.style.display = "block";
            if (filePreviewImg) { filePreviewImg.src = dataUrl; filePreviewImg.style.display = "block"; }
            if (filePreviewName) filePreviewName.textContent = f.name;
          } catch (e) { toast("图片处理失败，请换一张", true); clearFile(); }
        } else if (kind === "video") {
          const okType = f.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(f.name);
          if (!okType) { toast("「视频」类型请选择视频文件（mp4/webm/mov）", true); clearFile(); return; }
          if (f.size > 15 * 1024 * 1024) { toast("视频不能超过 15MB", true); clearFile(); return; }
          try {
            toast("正在处理视频…");
            const dataUrl = await fileToDataUrl(f);
            const cover = await extractVideoPoster(f);
            currentFile = { dataUrl, cover, name: f.name, type: f.type, size: f.size, isVideo: true };
            if (filePreview) filePreview.style.display = "block";
            if (filePreviewImg) {
              if (cover) { filePreviewImg.src = cover; filePreviewImg.style.display = "block"; }
              else { filePreviewImg.src = ""; filePreviewImg.style.display = "none"; }
            }
            if (filePreviewName) filePreviewName.textContent = "🎬 " + f.name + "（" + (f.size / 1024 / 1024).toFixed(1) + "MB）";
          } catch (e) { toast("视频处理失败，请换一个", true); clearFile(); }
        } else {
          toast("当前类型无需附件", true); clearFile();
        }
      });
    }
    if (fileRemove) fileRemove.addEventListener("click", clearFile);
    if (kindSel) kindSel.addEventListener("change", () => {
      const k = kindSel.value;
      if (fileInput) {
        fileInput.accept = k === "image" ? "image/*"
          : k === "video" ? "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v" : "";
        fileInput.disabled = (k !== "image" && k !== "video");
      }
      if (sizeTip) sizeTip.textContent = k === "image" ? "≤10MB 图片，或改用外链"
        : k === "video" ? "≤15MB 视频（mp4/webm/mov），或改用外链" : "无需附件";
      clearFile();
    });

    const submit = $("#postSubmit");
    if (submit) submit.addEventListener("click", async () => {
      const title = $("#postTitle").value.trim();
      const kind = $("#postKind").value;
      const pair = $("#postPair").value;
      const desc = $("#postDesc").value.trim();
      const link = $("#postLink").value.trim();
      // 标题：文章需标题；图片 / 视频 不强制（按需求，上传图片和视频时不强制要求任何内容）
      if (kind === "article" && !title) { toast("请填写标题", true); return; }
      // 视频：本地上传视频 或 外链 均可选，不再强制要求
      // 文章不能传附件
      if (kind === "article" && currentFile) { toast("「文章」类型无需附件", true); return; }
      submit.disabled = true;
      try {
        const body = { title, kind, pair, desc, link };
        if (kind === "image" && currentFile) body.file = { dataUrl: currentFile.dataUrl };
        if (kind === "video" && currentFile && currentFile.isVideo) {
          body.file = { dataUrl: currentFile.dataUrl };
          if (currentFile.cover) body.cover = currentFile.cover;
        }
        const r = await fetch("/api/fanposts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
          toast("投稿成功，已发布 ✨");
          $("#postTitle").value = ""; $("#postDesc").value = ""; $("#postLink").value = "";
          clearFile();
          await loadFanPosts(); drawFan();
        } else { toast(d.msg || "发布失败", true); }
      } catch { toast("网络错误", true); }
      submit.disabled = false;
    });
  }

  /* ---------- 8.6 物料合集动态加载（管理员通过后台维护） ---------- */
  async function loadMaterials() {
    try {
      const d = await fetch("/api/materials").then((r) => r.json());
      if (d && Array.isArray(d.materials)) {
        // 用 API 数据覆盖内置静态数据
        MATERIALS.length = 0;
        for (const m of d.materials) MATERIALS.push(m);
        LS.set("materials", MATERIALS);   // 缓存成功数据，网络不稳时也能秒开
      }
    } catch {}
  }


  /* ---------- 14.5 首页公告 ---------- */
  async function loadAnnouncements() {
    const box = $("#annList");
    if (!box) return;
    try {
      const d = await fetch("/api/announcements").then((r) => r.json());
      const list = d.announcements || [];
      if (!list.length) { box.innerHTML = '<p class="ann-empty">暂无公告。</p>'; return; }
      const fmt = (iso) => { try { return new Date(iso).toLocaleDateString("zh-CN"); } catch { return ""; } };
      box.innerHTML = list.map((a) => `
        <div class="ann-item${a.pinned ? " ann-pinned" : ""}">
          <span class="ann-dot"></span>
          <div class="ann-body">
            <div class="ann-title">${esc(a.title || "公告")}${a.pinned ? '<span class="ann-pin-tag">置顶</span>' : ""}</div>
            ${a.content ? `<div class="ann-content">${esc(a.content)}</div>` : ""}
            ${a.link ? `<a class="ann-link" href="${esc(a.link)}" target="_blank" rel="noopener">查看详情 ›</a>` : ""}
            ${a.createdAt ? `<div class="ann-time">${fmt(a.createdAt)}</div>` : ""}
          </div>
        </div>`).join("");
      maybeShowAnnPopup(list);
    } catch (e) {
      box.innerHTML = '<p class="ann-empty">公告加载失败。</p>';
    }
  }

  /* ---------- 14.6 首页公告弹窗 ---------- */
  function setupAnnPopup() {
    const mask = $("#annPopupMask");
    if (!mask) return;
    let closed = false;
    const close = () => { mask.style.display = "none"; closed = true; };
    $("#annPopupClose").addEventListener("click", close);
    $("#annPopupOk").addEventListener("click", close);
    $("#annPopupDismiss").addEventListener("click", () => {
      const id = mask.dataset.annId;
      if (id) { try { localStorage.setItem("sf_popup_dismissed", id); } catch (e) {} }
      close();
    });
    mask.addEventListener("click", (e) => { if (e.target === mask && !closed) close(); });
  }
  function maybeShowAnnPopup(list) {
    const mask = $("#annPopupMask");
    if (!mask || mask.style.display === "flex") return;
    const popupAnn = list.find((a) => a.popup === true);
    if (!popupAnn) return;
    let dismissed = "";
    try { dismissed = localStorage.getItem("sf_popup_dismissed") || ""; } catch (e) {}
    if (dismissed === popupAnn.id) return;   // 同一公告已点过"不再提示"
    $("#annPopupTitle").textContent = popupAnn.title || "公告";
    $("#annPopupContent").innerHTML = esc(popupAnn.content || "").replace(/\n/g, "<br>");
    const link = $("#annPopupLink");
    if (popupAnn.link) { link.href = popupAnn.link; link.style.display = ""; } else { link.style.display = "none"; }
    mask.dataset.annId = popupAnn.id;
    mask.style.display = "flex";
  }

  /* ---------- 15. 启动 ---------- */
  // 数据缓存：用 localStorage 缓存上次成功加载的数据，网络不稳时先用缓存渲染，避免空白
  const LS = {
    get(k) { try { const v = localStorage.getItem("sf_cache_" + k); return v ? JSON.parse(v) : null; } catch { return null; } },
    set(k, v) { try { localStorage.setItem("sf_cache_" + k, JSON.stringify(v)); } catch {} }
  };
  let _hadCache = false;
  function prefillFromCache() {
    _hadCache = !!(LS.get("hero") || LS.get("fanposts") || LS.get("materials"));
    const h = LS.get("hero"); if (Array.isArray(h)) HERO_ITEMS = h;
    const f = LS.get("fanposts"); if (Array.isArray(f)) FAN_POSTS = f;
    const m = LS.get("materials"); if (Array.isArray(m)) { MATERIALS.length = 0; m.forEach((x) => MATERIALS.push(x)); }
  }
  // 软超时：超时后不 reject（避免中断 boot 导致空白），而是 resolve 哨兵让渲染继续走缓存/已填数据
  function softRace(p, ms) {
    return Promise.race([p, new Promise((res) => setTimeout(() => res({ __timedOut: true }), ms))]);
  }
  // 首屏渲染：用 prefill 的缓存（或初始数据）立即绘制，保证秒开、不空白
  function firstPaint(page) {
    if (page === "index") {
      setupAnnPopup();
      initHero();
      renderMaterials($("#matGrid"));
      renderFanfic($("#fanGrid"));
    } else if (page === "material") {
      renderMaterials($("#matGrid"));
      scrollToHashFromSearch();
    } else if (page === "fanfic") {
      renderFanfic($("#fanGrid"));
      scrollToHashFromSearch();
      initComposer();
      const editSave = $("#fanEditSave");
      if (editSave) editSave.addEventListener("click", saveFanEdit);
    }
  }
  // 数据到达后补渲染：用最新数据刷新（无变化则视觉不变）；一次性绑定只在首屏做
  function refreshPaint(page) {
    if (page === "index") {
      initHero();
      renderMaterials($("#matGrid"));
      renderFanfic($("#fanGrid"));
      loadAnnouncements();
    } else if (page === "material") {
      renderMaterials($("#matGrid"));
      scrollToHashFromSearch();
    } else if (page === "fanfic") {
      renderFanfic($("#fanGrid"));
      scrollToHashFromSearch();
    }
  }
  async function boot() {
   window.__appBooted = true;   // 立即标记已启动：即便后续 await 卡顿也不误报警（根治移动端红条）
   prefillFromCache();          // 先用缓存填全局变量，网络差也能秒开内容（根治移动端空白）
   try {
    // 同人大图预览：全局仅绑定一次，点击带 data-zoom 的图片打开 lightbox。Esc 关闭大图
    if (!window.__fanZoomBound) {
      window.__fanZoomBound = true;
      document.addEventListener("click", (e) => {
        const img = e.target.closest("img[data-zoom]");
        if (img) {
          let list = null, idx = 0;
          try { list = img.dataset.zoomList ? JSON.parse(img.dataset.zoomList) : null; } catch (e) { list = null; }
          idx = parseInt(img.dataset.zoomIndex || "0", 10) || 0;
          openFanImageLightbox((list && list.length) ? list : (img.currentSrc || img.src), img.alt, idx);
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          ["fanImgLightbox"].forEach((id) => { const el = document.getElementById(id); if (el) el.classList.remove("open"); });
        }
      });
    }
    initTheme(); initNav(); initFloatBar();
    initSiteTips();         // 后台站点提示横幅（按页面范围展示）

    const page = document.body.dataset.page;
    firstPaint(page);       // ① 首屏：用缓存立即渲染，秒开、不空白

    const SOFT_MS = window.__SOFT_TIMEOUT || 12000;   // 超时阈值可调（移动端网络差时可经调试提高）
    const race = await softRace(Promise.all([initSession(), loadMaterials(), loadHero(), loadFanPosts()]), SOFT_MS);
    const timedOut = race && race.__timedOut;   // 超时不再中断渲染：用 prefill 缓存兜底，后台 fetch 自行完成
    initSearch();          // 搜索依赖 MATERIALS，要在 loadMaterials 后
    refreshPaint(page);    // ② 数据到达后补渲染一次（用最新数据刷新，无变化则视觉不变）

    initLazyAndWatermark(); initReveal();
    // 兜底：极端情况下若 IO 未触发，定时强制显示，避免内容永久隐藏
    setTimeout(() => { $$(".reveal:not(.in)").forEach((e) => e.classList.add("in")); }, 1500);
    // 仅「首次访问（无缓存）且数据加载超时」给温和提示，避免默默空白；有缓存时用户已看到内容，不弹
    if (timedOut && !_hadCache && window.__reportWarn) {
      window.__reportWarn("网络加载较慢或超时：当前为首次访问且无本地缓存，内容暂无法显示。请检查网络后刷新；成功后内容会被缓存，下次可离线秒开。");
    }
    } catch (err) {
      // 真实错误暴露出来，便于定位（而不是默默空白）
      try { if (window.__reportBootError) window.__reportBootError(err); else console.error("[boot] 启动出错：", err); } catch (_) {}
    } finally {
      // 无论如何都标记已启动，避免 load-guard 误报「未能正常启动」造成双重空白
      window.__appBooted = true;   // 标记主脚本已启动，供 load-guard.js 启动自检（空白页定位）
    }
  }

  window.__toast = toast; // 供同人音频试听等内联按钮调用

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
