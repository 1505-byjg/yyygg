/* =========================================================
   reader.js · 同人专区沉浸式阅读器
   - 拉取文章并按 id 渲染（标题/元信息/正文/媒体）
   - 解析章节标题生成目录，支持跳转与上下章切换
   - 字体 / 主题 / 行距 / 页宽设置（localStorage 持久化）
   - 顶栏滚动隐藏、阅读进度条
   - 防盗由 reader-guard.js 负责（滚动水印 + 防复制 + 截图提示）
   ========================================================= */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // 只放行 http/https，杜绝 javascript: 之类的危险协议
  const safeHref = (url) => {
    const s = String(url == null ? "" : url).trim();
    return /^https?:\/\//i.test(s) ? s : "";
  };

  // 作者署名：名字可点击筛选；填了主页链接额外显示「找到老师」外链
  const authorHtml = (name, url) => {
    const n = esc(name || "");
    if (!n) return "";
    const h = safeHref(url);
    const xp = "index.html?author=" + encodeURIComponent(name);
    const link = '<a class="author-filter" href="' + esc(xp) + '" title="查看 ' + n + ' 的全部作品">' + n + '</a>';
    const ext = h ? ' <a class="author-link" href="' + esc(h) + '" target="_blank" rel="noopener noreferrer" title="找到 ' + n + ' 老师（主页）">找到老师</a>' : '';
    return link + ext;
  };

  const STORE_KEY = "reader_settings_v1";
  const CONT_KEY = "reader_continuous_v1";
  const DEFAULTS = { theme: "light", fz: 18, ff: "sans", lh: 1.95, w: 720 };
  const FF = {
    sans: '"PingFang SC","Microsoft YaHei",sans-serif',
    serif: '"Noto Serif SC","Songti SC","SimSun",Georgia,serif',
  };

  let settings = loadSettings();
  let continuous = false; // 翻页模式(false) ↔ 连续阅读全部章节(true)，仅多章节文章可用，记忆到 localStorage
  try { continuous = localStorage.getItem(CONT_KEY) === "1"; } catch {}
  let post = null, neighbors = [], idx = -1, tocItems = [], currentChapter = 0, lastY = 0;
  let chapters = [], paged = false;

  function saveContinuous() { try { localStorage.setItem(CONT_KEY, continuous ? "1" : "0"); } catch {} }

  function loadSettings() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); }
    catch { return Object.assign({}, DEFAULTS); }
  }
  function saveSettings() { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch {} }

  function applySettings() {
    document.documentElement.setAttribute("data-theme", settings.theme);
    const art = $("#rArticle");
    if (art) {
      art.style.setProperty("--rf-fz", settings.fz + "px");
      art.style.setProperty("--rf-lh", settings.lh);
      art.style.setProperty("--rf-w", settings.w + "px");
      art.style.setProperty("--rf-ff", FF[settings.ff] || FF.sans);
    }
    $$(".seg[data-seg]").forEach((seg) => {
      const key = seg.dataset.seg;
      $$("button", seg).forEach((b) => b.classList.toggle("active", String(settings[key]) === String(b.dataset.v)));
    });
  }

  /* ---------- 轻量 toast ---------- */
  let toastTimer;
  function toast(msg, err) {
    let t = $("#rToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "rToast";
      t.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:120;padding:10px 18px;border-radius:999px;font-size:14px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.18);transition:opacity .25s ease,transform .25s ease;pointer-events:none";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = err ? "rgba(185,127,78,.96)" : "rgba(94,110,124,.96)";
    t.style.color = "#fff";
    t.style.opacity = "1";
    t.style.transform = "translateX(-50%) translateY(0)";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateX(-50%) translateY(8px)"; }, 1800);
  }

  /* ---------- 状态页 ---------- */
  function showState(type) {
    const s = $("#rState");
    const map = {
      missing: { em: "🔗", h: "缺少文章标识", p: "链接不完整，请从同人专区点开文章。" },
      error: { em: "⚠️", h: "载入失败", p: "网络异常，请刷新重试。" },
      notfound: { em: "📭", h: "未找到该文章", p: "文章可能已被删除或链接失效。" },
    };
    const m = map[type] || map.error;
    s.innerHTML = '<div class="em">' + m.em + '</div><h3>' + m.h + '</h3><p>' + m.p + '</p>' +
      '<a class="btn" href="fanfic.html">回到同人专区</a>';
    s.style.display = "block";
    $("#rShell").style.display = "none";
  }

  /* ---------- 主流程 ---------- */
  async function init() {
    applySettings();
    bindUI();
    const id = new URLSearchParams(location.search).get("id");
    if (!id) { showState("missing"); return; }
    let posts;
    try {
      const r = await fetch("/api/fanposts");
      if (!r.ok) { showState("error"); return; }
      const d = await r.json();
      posts = d.posts || [];
    } catch { showState("error"); return; }
    post = posts.find((p) => p.id === id);
    if (!post) { showState("notfound"); return; }
    neighbors = posts.slice().sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    idx = neighbors.findIndex((p) => p.id === id);
    renderPost();
  }

  // 取投稿的图片数组（多图优先，单图兼容，无图返回空数组）
  function postImages(p) {
    if (p && p.files && p.files.length) return p.files;
    if (p && p.file) return [p.file];
    return [];
  }

  function renderPost() {
    $("#rState").style.display = "none";
    $("#rShell").style.display = "block";
    $("#rFoot").style.display = "block";

    $("#rArticleTitle").textContent = post.title || "未命名文章";
    $("#rTitle").textContent = post.title || "同人专区";

    const meta = [];
    if (post.author) meta.push(authorHtml(post.author, post.authorUrl));
    if (post.date) meta.push(esc(post.date));
    if (post.pair) meta.push('<span class="pair">' + esc(post.pair) + "</span>");
    $("#rArticleMeta").innerHTML = meta.join('<span class="sep">·</span>');

    $("#rArticleTags").innerHTML = (post.tags && post.tags.length)
      ? post.tags.map((t) => '<span class="chip">' + esc(t) + "</span>").join("")
      : "";

    const coverBox = $("#rArticleCover");
    coverBox.innerHTML = "";
    if (post.kind === "image") {
      coverBox.innerHTML = '<p class="m-text-soft" style="padding:8px 0">（图片投稿，已隐藏）</p>';
    } else if (post.kind === "video") {
      coverBox.innerHTML = '<p class="m-text-soft" style="padding:8px 0">（视频功能已关闭）</p>';
    }

    const c = $("#rContent");
    c.innerHTML = post.content || '<p style="color:var(--r-text-soft)">（暂无正文内容）</p>';

    // 正文首行：题目 + 作者名
    const headEl = document.createElement("div");
    headEl.className = "reader-content-head";
    headEl.innerHTML = '<span class="rch-title">' + esc(post.title || "") + '</span>' +
      (post.author ? '<span class="rch-sep">·</span><span class="rch-author">' + authorHtml(post.author, post.authorUrl) + '</span>' : "");
    c.insertBefore(headEl, c.firstChild);

    // 移除正文中单独成行的连载状态标签（短篇/连载中/已完结）
    $$(".reader-content h2, .reader-content h3, .reader-content p, .reader-content div").forEach((el) => {
      const t = el.textContent.trim();
      if ((t === "短篇" || t === "连载中" || t === "已完结") && el.children.length === 0) el.remove();
    });

    const heads = $$("h2, h3", c);
    tocItems = heads.map((h, i) => { h.id = "ch-" + (i + 1); if (i === 0) h.classList.add("r-ch-first"); return { id: h.id, text: h.textContent, lv: h.tagName === "H3" ? 3 : 2, el: h }; });

    const ul = $("#rTocList");
    ul.innerHTML = tocItems.length
      ? tocItems.map((t) => '<li><a data-toc="' + t.id + '" class="' + (t.lv === 3 ? "lv3" : "") + '">' + esc(t.text) + "</a></li>").join("")
      : '<div class="toc-empty">本文暂无分章标题，可直接上下滑动阅读。</div>';

    // 分章：≥2 个标题启用翻页式阅读（点击“下一章”才跳转）
    chapters = heads.length >= 2 ? paginateChapters(c, heads) : [];
    paged = chapters.length >= 2;
    // 连载文章：默认定位到最新一章（当前章），而非第 1 章
    const isSerialPost = post.serial === true || post.serial === "serial";
    currentChapter = (paged && isSerialPost) ? chapters.length - 1 : 0;
    applyMode();
    renderModeBtn();

    renderChapterNav();
    renderChQuick();
    applySettings();
    if (paged && !continuous) {
      updatePagedHeading();
      window.scrollTo({ top: 0, behavior: "auto" });
    } else {
      updateActiveHeading();
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  /* ---------- 分章翻页 ---------- */
  // 将正文按 h2/h3 切分为独立章节区块，便于“点击下一章才跳转”的翻页阅读
  function paginateChapters(root, heads) {
    const out = [];
    heads.forEach((h, i) => {
      const sec = document.createElement("section");
      sec.className = "r-chapter";
      sec.dataset.chIndex = i;
      h.parentNode.insertBefore(sec, h);
      sec.appendChild(h);
      let n = sec.nextSibling;
      while (n && !(n.nodeType === 1 && /^(H2|H3)$/.test(n.tagName))) {
        const nx = n.nextSibling;
        sec.appendChild(n);
        n = nx;
      }
      out.push({ id: h.id, title: h.textContent, lv: h.tagName === "H3" ? 3 : 2, el: sec, head: h, index: i });
    });
    return out;
  }

  function goToChapter(i) {
    if (!paged || i < 0 || i >= chapters.length) return;
    chapters.forEach((ch, k) => { ch.el.style.display = k === i ? "" : "none"; });
    currentChapter = i;
    renderChapterNav();
    renderChQuick();
    updatePagedHeading();
    $$("#rTocList a").forEach((a, k) => a.classList.toggle("active", k === i));
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  /* ---------- 翻页 ↔ 连续阅读 切换 ---------- */
  function setDisp(sel, show) { const el = $(sel); if (el) el.style.display = show ? "" : "none"; }

  // 按当前 continuous 状态应用显示（翻页：只显示当前章；连续：全部章节）
  function applyMode() {
    if (!paged) {
      document.body.classList.remove("reader-paged");
      setDisp("#rChapters", false); setDisp("#rChQuick", false); setDisp("#rChIndicator", false);
      return;
    }
    if (continuous) {
      chapters.forEach((ch) => { ch.el.style.display = ""; });
      document.body.classList.remove("reader-paged");
      setDisp("#rChapters", false); setDisp("#rChQuick", false); setDisp("#rChIndicator", false);
      $("#rTitle").textContent = post.title || "同人专区";
    } else {
      chapters.forEach((ch, i) => { ch.el.style.display = i === currentChapter ? "" : "none"; });
      document.body.classList.add("reader-paged");
      setDisp("#rChapters", true); setDisp("#rChQuick", true); setDisp("#rChIndicator", true);
    }
  }

  function setMode(cont) {
    if (!paged) return;
    continuous = cont;
    saveContinuous();
    applyMode();
    if (continuous) {
      updateModeBtn();
      onScroll();
    } else {
      renderChapterNav();
      renderChQuick();
      updatePagedHeading();
      updateModeBtn();
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  // 顶栏“连续/翻页”开关；多章节文章才显示，旧版 reader.html 缓存缺失时动态创建
  function renderModeBtn() {
    let btn = $("#rModeBtn");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "rModeBtn";
      btn.className = "rtb-btn r-mode-btn";
      const right = $(".rtb-right");
      if (right) right.insertBefore(btn, right.firstChild);
    }
    if (!paged) { btn.style.display = "none"; return; }
    btn.style.display = "";
    btn.onclick = () => setMode(!continuous);
    updateModeBtn();
  }
  function updateModeBtn() {
    const btn = $("#rModeBtn"); if (!btn) return;
    btn.innerHTML = continuous ? "▤ <span class=\"lbl\">翻页</span>" : "📖 <span class=\"lbl\">连续</span>";
    btn.title = continuous ? "切换回逐章翻页模式" : "连续阅读全部章节";
    btn.classList.toggle("on", continuous);
  }

  /* ---------- 章节快捷跳转条（每章一个按钮，点击直达） ---------- */
  function renderChQuick() {
    let box = $("#rChQuick");
    if (!box) {
      box = document.createElement("div");
      box.id = "rChQuick";
      box.className = "reader-ch-quick";
      const chBox = $("#rChapters");
      if (chBox && chBox.parentNode) chBox.parentNode.insertBefore(box, chBox);
    }
    if (!paged || continuous) { box.style.display = "none"; box.innerHTML = ""; return; }
    box.style.display = "";
    box.innerHTML = chapters.map((ch, i) =>
      '<button type="button" class="cqp' + (i === currentChapter ? " active" : "") + '" data-cq="' + i + '">' +
        (i + 1) +
        (ch.title ? '<span class="cqpt">' + esc(ch.title) + "</span>" : "") +
      "</button>"
    ).join("");
  }

  function updatePagedHeading() {
    const ch = chapters[currentChapter];
    if (!ch) return;
    $("#rTitle").textContent = "第 " + (currentChapter + 1) + " / " + chapters.length + " 章 · " + (post.title || "同人专区");
    // 兼容旧版 reader.html（CDN 缓存未刷新时无该节点）：缺失则动态创建
    let ind = $("#rChIndicator");
    if (!ind) {
      ind = document.createElement("div");
      ind.id = "rChIndicator";
      ind.className = "reader-ch-indicator";
      const chBox = $("#rChapters");
      if (chBox && chBox.parentNode) chBox.parentNode.insertBefore(ind, chBox);
    }
    ind.textContent = "第 " + (currentChapter + 1) + " / " + chapters.length + " 章";
    $$("#rTocList a").forEach((a, k) => a.classList.toggle("active", k === currentChapter));
    const prog = $("#rProgress");
    if (prog) prog.style.width = ((currentChapter + 1) / chapters.length) * 100 + "%";
  }

  /* ---------- 底部上下章 / 上下篇 ---------- */
  function renderChapterNav() {
    const box = $("#rChapters");
    if (paged) {
      const prev = chapters[currentChapter - 1];
      const next = chapters[currentChapter + 1];
      const nextArt = !next && neighbors[idx + 1];
      box.innerHTML =
        '<div class="ch prev ' + (prev ? "" : "disabled") + '" ' + (prev ? 'data-ch-index="' + (currentChapter - 1) + '"' : "") + '>' +
          '<div class="lab">上一章</div><div class="ttl">' + (prev ? esc(prev.title) : "已经是第一章") + "</div></div>" +
        '<div class="ch next ' + (next ? "" : "disabled") + '" ' +
          (next ? 'data-ch-index="' + (currentChapter + 1) + '"'
                : (nextArt ? 'data-id="' + esc(nextArt.id) + '"' : "")) + '>' +
          '<div class="lab">' + (next ? "下一章" : (nextArt ? "下一篇" : "已经读完")) + '</div><div class="ttl">' +
          (next ? esc(next.title) : (nextArt ? esc(nextArt.title) : "已经是最后一章")) + "</div></div>";
    } else {
      const prev = neighbors[idx - 1], next = neighbors[idx + 1];
      box.innerHTML =
        '<div class="ch prev ' + (prev ? "" : "disabled") + '" ' + (prev ? 'data-id="' + esc(prev.id) + '"' : "") + '>' +
          '<div class="lab">上一篇</div><div class="ttl">' + (prev ? esc(prev.title) : "没有更早的文章") + "</div></div>" +
        '<div class="ch next ' + (next ? "" : "disabled") + '" ' + (next ? 'data-id="' + esc(next.id) + '"' : "") + '>' +
          '<div class="lab">下一篇</div><div class="ttl">' + (next ? esc(next.title) : "没有更新的文章") + "</div></div>";
    }
  }

  /* ---------- 滚动：进度 / 顶栏隐藏 ---------- */
  function onScroll() {
    const y = window.scrollY || window.pageYOffset || 0;
    const longMode = !paged || continuous; // 翻页模式之外（含连续阅读）走全文档进度
    if (longMode) {
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docH > 0 ? (y / docH) * 100 : 0;
      const prog = $("#rProgress"); if (prog) prog.style.width = pct + "%";
    }

    const topbar = $("#rTopbar");
    if (topbar) {
      if (y > 140 && y > lastY + 4) topbar.classList.add("hidden");
      else if (y < lastY - 4 || y < 80) topbar.classList.remove("hidden");
    }
    const title = $("#rTitle"); if (title) title.classList.toggle("dim", y < 140);

    lastY = y;
    if (longMode) updateActiveHeading();
  }

  function updateActiveHeading() {
    if (!tocItems.length) return;
    let cur = 0;
    for (let i = 0; i < tocItems.length; i++) {
      if (tocItems[i].el.getBoundingClientRect().top <= 96) cur = i;
    }
    $$("#rTocList a").forEach((a, i) => a.classList.toggle("active", i === cur));
    // 连续阅读时不重建翻页导航；仅更新高亮与当前章记忆
    if (!continuous && cur !== currentChapter) { currentChapter = cur; renderChapterNav(); }
  }

  /* ---------- 抽屉与控件 ---------- */
  function openPanel(which) {
    $("#rBackdrop").classList.add("open");
    if (which === "toc") $("#rTocPanel").classList.add("open");
    else $("#rSetPanel").classList.add("open");
  }
  function closePanels() {
    $("#rBackdrop").classList.remove("open");
    $("#rTocPanel").classList.remove("open");
    $("#rSetPanel").classList.remove("open");
  }

  function bindUI() {
    $("#rTocBtn").addEventListener("click", () => openPanel("toc"));
    $("#rSetBtn").addEventListener("click", () => openPanel("set"));
    $("#rBackdrop").addEventListener("click", closePanels);
    $$(".close[data-close]").forEach((b) => b.addEventListener("click", closePanels));

    $$(".seg[data-seg] button").forEach((b) => {
      b.addEventListener("click", () => {
        const seg = b.closest(".seg");
        const key = seg.dataset.seg;
        const raw = b.dataset.v;
        settings[key] = (key === "fz" || key === "w" || key === "lh") ? Number(raw) : raw;
        saveSettings();
        applySettings();
      });
    });

    $("#rTocList").addEventListener("click", (e) => {
      const a = e.target.closest("a[data-toc]"); if (!a) return;
      const el = document.getElementById(a.dataset.toc);
      if (!paged || continuous) {
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        const i = tocItems.findIndex((t) => t.id === a.dataset.toc);
        if (i >= 0) goToChapter(i);
      }
      closePanels();
    });

    $("#rChapters").addEventListener("click", (e) => {
      const ch = e.target.closest(".ch"); if (!ch || ch.classList.contains("disabled")) return;
      if (ch.dataset.chIndex != null) goToChapter(Number(ch.dataset.chIndex));
      else if (ch.dataset.id) location.href = "reader.html?id=" + encodeURIComponent(ch.dataset.id);
    });

    // 章节快捷跳转条（按钮为 JS 动态创建，使用事件委托）
    document.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("button[data-cq]");
      if (b && !continuous) goToChapter(Number(b.dataset.cq));
    });

    let ticking = false;
    window.addEventListener("scroll", () => {
      if (!ticking) { ticking = true; requestAnimationFrame(() => { onScroll(); ticking = false; }); }
    }, { passive: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
