/* =============================================================
   editor.js — 同人创作高级文本编辑器（纯前端逻辑 + 云端草稿）
   依赖：css/style.css（主题变量）、css/editor.css、后端 /api/editor/works
   原则：动效仅淡入淡出；弹窗磨砂玻璃；次要功能折叠在「⋯」菜单
   ============================================================= */
(function () {
  "use strict";

  // ---------- 小工具 ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const cid = () => (crypto.randomUUID ? crypto.randomUUID() : "c" + Date.now() + Math.random().toString(16).slice(2));
  const nowISO = () => new Date().toISOString();
  const fmtTime = (iso) => { const d = new Date(iso); if (isNaN(d)) return ""; const p = (n) => String(n).padStart(2, "0"); return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  async function api(path, opts = {}) {
    const res = await fetch(path, Object.assign({ method: "GET", headers: { "Content-Type": "application/json" }, credentials: "same-origin" }, opts));
    let data = {};
    try { data = await res.json(); } catch {}
    return { ok: res.ok && data.ok !== false, status: res.status, data };
  }
  let toastTimer = null;
  function toast(msg, warn) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (warn ? " warn" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = "toast"; }, 2200);
  }

  // ---------- 发布状态（纯静态站：无需登录，默认可直接发布到同人专区） ----------
  let isAdmin = true;           // 纯公开演示：编辑器默认即可发布，无登录门禁
  function updateLoginState() {
    const b = $("#btnLoginState");
    if (!b) return;
    b.textContent = "✅ 可直接发布";
    b.classList.add("ed-login-ok");
  }
  async function checkSession() {
    // 纯静态演示：无真实后台鉴权，编辑器默认以「可发布」身份运行
    isAdmin = true;
    updateLoginState();
  }

  // ---------- 状态 ----------
  let work = null;          // 当前作品 {id,ownerId,title,tags,chapters,createdAt,updatedAt}
  let curIdx = 0;           // 当前章节下标
  let autoTimer = null;     // 云端自动保存定时器
  let localTimer = null;    // 本地缓存写入定时器

  // ---------- 本地离线缓存 ----------
  const LS_PREFIX = "ed_work_";
  const LS_LAST = "ed_last_id";
  function writeLocal(w) { try { localStorage.setItem(LS_PREFIX + (w.id || "draft"), JSON.stringify(w)); } catch {} }
  function readLocal(id) { try { return JSON.parse(localStorage.getItem(LS_PREFIX + id)); } catch { return null; } }
  function setLastId(id) { try { localStorage.setItem(LS_LAST, id); } catch {} }
  function getLastId() { try { return localStorage.getItem(LS_LAST); } catch { return null; } }

  // ---------- DOM ----------
  const editor = $("#edEditor");
  const titleInput = $("#edTitle");
  const tagChips = $("#tagChips");
  const saveStatus = $("#saveStatus");
  const chapterList = $("#chapterList");
  const wordTotal = $("#wordTotal");
  const wordSel = $("#wordSel");
  const side = $("#edSide");
  const sideMask = $("#sideMask");
  const authorInput = $("#edAuthor");
  const serialSelect = $("#edSerial");
  const pairSelect = $("#edPair");

  // ============================================================
  //  作品读取 / 新建 / 保存
  // ============================================================
  async function openWork(id) {
    const local = readLocal(id);
    const res = await api(`/api/editor/works/${id}`, { method: "GET" });
    if (!res.ok || !res.data.work) {
      if (local) { work = local; toast("云端版本缺失，已用本地草稿"); }
      else { toast("作品不存在或已删除", true); return; }
    } else {
      const server = res.data.work;
      if (local && local.updatedAt && server.updatedAt && new Date(local.updatedAt) > new Date(server.updatedAt)) {
        work = local; toast("已恢复本地草稿（比云端更新）");
      } else {
        work = server; writeLocal(server);
      }
    }
    curIdx = 0;
    applyWorkToUI();
    setLastId(id);
    closeModal("worksModal");
  }

  function newBlankWork() {
    work = { id: null, ownerId: null, title: "", tags: [], chapters: [{ id: cid(), title: "第一章", content: "", hidden: false }], createdAt: nowISO(), updatedAt: nowISO(), authorName: "", serial: "single", pair: "", fanpostId: null };
    curIdx = 0;
    applyWorkToUI();
    closeModal("worksModal");
    toast("已新建空白作品");
  }

  function applyWorkToUI() {
    titleInput.value = work.title || "";
    if (authorInput) authorInput.value = work.authorName || "";
    if (serialSelect) {
      const v = work.serial || "single";
      serialSelect.value = ["serial", "completed", "single"].includes(v) ? v : "single";
    }
    if (pairSelect) {
      pairSelect.value = ["年上", "年下", "无差"].includes(work.pair) ? work.pair : "";
    }
    renderTagsChips();
    renderChapters();
    loadChapterIntoEditor();
  }

  function flushChapter() {
    if (!work) return;
    const c = work.chapters[curIdx];
    if (c) c.content = editor.innerHTML;
  }

  function serializeWork() {
    return { title: titleInput.value.trim(), tags: work.tags, chapters: work.chapters, authorName: authorInput ? authorInput.value.trim() : "", serial: serialSelect ? serialSelect.value : "single", pair: pairSelect ? pairSelect.value : "无差", fanpostId: work.fanpostId || null };
  }

  function setStatus(text, warn) {
    saveStatus.textContent = text;
    saveStatus.classList.add("show");
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(() => saveStatus.classList.remove("show"), 2600);
  }

  async function saveWork(manual) {
    if (!work) return;
    flushChapter();
    work.updatedAt = nowISO();
    setStatus(manual ? "保存中…" : "云端保存中…");
    try {
      let res;
      if (work.id) {
        res = await api(`/api/editor/works/${work.id}`, { method: "PUT", body: JSON.stringify(serializeWork()) });
      } else {
        res = await api(`/api/editor/works`, { method: "POST", body: JSON.stringify(serializeWork()) });
        if (res.ok && res.data.id) { work.id = res.data.id; setLastId(work.id); }
      }
      if (res.ok) { writeLocal(work); setStatus(manual ? "已保存 · " + fmtTime(work.updatedAt) : "已自动保存 · " + fmtTime(work.updatedAt)); }
      else setStatus("保存失败：" + (res.data.msg || "未知错误"), true);
    } catch (e) {
      writeLocal(work);
      setStatus("已存到本地缓存（离线）", true);
    }
  }

  function scheduleLocal() { clearTimeout(localTimer); localTimer = setTimeout(() => { flushChapter(); writeLocal(work); }, 400); }
  function scheduleAuto() { clearTimeout(autoTimer); autoTimer = setTimeout(() => saveWork(false), 2200); }
  function onEdit() { scheduleLocal(); scheduleAuto(); updateCounts(); }

  // ============================================================
  //  章节管理
  // ============================================================
  function renderChapters() {
    chapterList.innerHTML = "";
    work.chapters.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "ed-chapter" + (i === curIdx ? " active" : "") + (c.hidden ? " hidden-ch" : "");
      row.draggable = true;
      row.dataset.i = i;
      row.innerHTML = `
        <span class="grip" title="拖拽排序">⠿</span>
        <span class="c-title">${escapeHtml(c.title || "未命名章节")}</span>
        <button class="c-act hide" title="隐藏/显示">${c.hidden ? "🚫" : "👁"}</button>
        <button class="c-act del" title="删除">🗑</button>`;
      row.addEventListener("click", (e) => {
        if (e.target.closest(".c-act")) return;
        selectChapter(i);
      });
      row.querySelector(".hide").addEventListener("click", (e) => { e.stopPropagation(); toggleHidden(i); });
      row.querySelector(".del").addEventListener("click", (e) => { e.stopPropagation(); deleteChapter(i); });
      bindDrag(row, i);
      chapterList.appendChild(row);
    });
  }

  function selectChapter(i) {
    if (i === curIdx) return;
    flushChapter();
    curIdx = i;
    renderChapters();
    loadChapterIntoEditor();
    scheduleAuto();
  }

  function loadChapterIntoEditor() {
    const c = work.chapters[curIdx];
    editor.innerHTML = c ? (c.content || "") : "";
    editor.dataset.placeholder = "在这里开始你的同人创作……";
    updateCounts();
    if (window.innerWidth <= 860) closeSide();
  }

  function addChapter() {
    flushChapter();
    work.chapters.splice(curIdx + 1, 0, { id: cid(), title: "第" + "一二三四五六七八九十".charAt(work.chapters.length % 10) + "章", content: "", hidden: false });
    curIdx = curIdx + 1;
    renderChapters(); loadChapterIntoEditor(); onEdit();
  }

  function renameChapter(i) {
    const c = work.chapters[i];
    const name = prompt("章节名称（可留空）", c.title || "");
    if (name === null) return;
    c.title = name.trim();
    renderChapters(); onEdit();
  }

  function toggleHidden(i) {
    work.chapters[i].hidden = !work.chapters[i].hidden;
    renderChapters(); onEdit();
  }

  function deleteChapter(i) {
    if (work.chapters.length <= 1) { toast("至少保留一个章节", true); return; }
    if (!confirm(`确定删除章节「${work.chapters[i].title || ""}」？`)) return;
    work.chapters.splice(i, 1);
    if (curIdx >= work.chapters.length) curIdx = work.chapters.length - 1;
    renderChapters(); loadChapterIntoEditor(); onEdit();
  }

  // 双击章节名重命名
  chapterList.addEventListener("dblclick", (e) => {
    const row = e.target.closest(".ed-chapter"); if (!row) return;
    if (e.target.closest(".c-act")) return;
    renameChapter(+row.dataset.i);
  });

  // ---------- 拖拽排序 ----------
  let dragFrom = null;
  function bindDrag(row, i) {
    row.addEventListener("dragstart", (e) => { dragFrom = i; row.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
    row.addEventListener("dragend", () => { row.classList.remove("dragging"); $$(".ed-chapter").forEach((r) => r.classList.remove("drop-before", "drop-after")); });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const after = (e.clientY - r.top) > r.height / 2;
      row.classList.toggle("drop-after", after); row.classList.toggle("drop-before", !after);
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const to = i + ((e.clientY - row.getBoundingClientRect().top) > row.getBoundingClientRect().height / 2 ? 1 : 0);
      reorder(dragFrom, to);
    });
  }
  function reorder(from, to) {
    if (from === null || from === to) return;
    flushChapter();
    const arr = work.chapters;
    const [m] = arr.splice(from, 1);
    let t = to; if (from < to) t = to - 1;
    arr.splice(t, 0, m);
    curIdx = arr.indexOf(m);
    renderChapters(); loadChapterIntoEditor(); onEdit();
  }

  // ============================================================
  //  标签
  // ============================================================
  const TAG_LIB = {
    "题材": ["现代", "古风", "校园", "ABO", "末日", "架空", "日常", "治愈"],
    "结局": ["HE", "BE", "开放式"],
    "尺度": ["清水向", "微糖", "虐恋", "群像"],
    "类型": ["长篇", "短篇", "连载", "完结", "广播剧剧本", "同人图铺"],
  };
  function renderTagsChips() {
    tagChips.innerHTML = (work.tags || []).map((t) => `<span class="t">${escapeHtml(t)}</span>`).join("");
  }
  function renderTagGroups() {
    const box = $("#tagGroups");
    // 预设标签库分组
    const allPreset = new Set(Object.values(TAG_LIB).flat());
    let html = Object.entries(TAG_LIB).map(([g, items]) => `
      <div class="ed-tag-group">
        <h4>${g}</h4>
        <div class="ed-tag-cards">
          ${items.map((t) => `<span class="ed-tag-card ${work.tags.includes(t) ? "on" : ""}" data-t="${t}">${t}</span>`).join("")}
        </div>
      </div>`).join("");
    // 自定义标签（不在预设库中且已被选择的）
    const customTags = (work.tags || []).filter((t) => !allPreset.has(t));
    if (customTags.length) {
      html += `<div class="ed-tag-group"><h4 style="color:var(--m-orange-700)">自定义</h4><div class="ed-tag-cards">${
        customTags.map((t) => `<span class="ed-tag-card on" data-t="${t}">${t} <span class="ed-remove-tag" data-t="${t}" style="margin-left:4px;cursor:pointer;opacity:.6">✕</span></span>`).join("")
      }</div></div>`;
    }
    box.innerHTML = html;
    $$(".ed-tag-card", box).forEach((el) => el.addEventListener("click", (e) => {
      if (e.target.closest(".ed-remove-tag")) return;  // 点击 ✕ 不触发切换
      const t = el.dataset.t;
      const has = work.tags.includes(t);
      work.tags = has ? work.tags.filter((x) => x !== t) : work.tags.concat(t);
      el.classList.toggle("on", !has);
      renderTagsChips(); onEdit();
    }));
    // 自定义标签的 ✕ 删除
    $$(".ed-remove-tag", box).forEach((el) => el.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = el.dataset.t;
      work.tags = (work.tags || []).filter((x) => x !== t);
      renderTagsChips(); renderTagGroups(); onEdit();
      toast('已移除标签：' + t);
    }));
  }

  // ============================================================
  //  富文本命令
  // ============================================================
  function exec(cmd) {
    editor.focus();
    if (["bold", "italic", "justifyLeft", "justifyCenter", "justifyRight", "justifyFull", "indent", "outdent"].includes(cmd)) {
      document.execCommand(cmd, false, null);
    } else if (cmd === "h1" || cmd === "h2") {
      const tag = cmd.toUpperCase();
      const cur = (document.queryCommandValue("formatBlock") || "").toUpperCase();
      document.execCommand("formatBlock", false, cur === tag ? "P" : tag);
    } else if (cmd === "hr") {
      document.execCommand("insertHorizontalRule", false, null);
    }
    onEdit(); updateToolbarState();
  }
  function updateToolbarState() {
    const map = { bold: "bold", italic: "italic" };
    $$(".ed-tb").forEach((b) => {
      const c = b.dataset.cmd;
      if (map[c]) { try { b.classList.toggle("active", document.queryCommandState(map[c])); } catch {} }
    });
    // 对齐状态：用 queryCommandValue("justify") 判断当前块的对齐方式
    let just = "";
    try { just = (document.queryCommandValue("justify") || "").toLowerCase(); } catch {}
    const alignMap = {
      justifyLeft: ["left", ""],
      justifyCenter: ["center"],
      justifyRight: ["right"],
      justifyFull: ["full", "justify"],
    };
    $$('.ed-tb[data-cmd^="justify"]').forEach((b) => {
      const arr = alignMap[b.dataset.cmd] || [];
      b.classList.toggle("active", arr.includes(just));
    });
  }

  // ============================================================
  //  字数统计
  // ============================================================
  function updateCounts() {
    const total = (editor.innerText || "").replace(/\s/g, "").length;
    wordTotal.textContent = total;
    const sel = window.getSelection();
    let selN = 0;
    if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) selN = (sel.toString() || "").replace(/\s/g, "").length;
    wordSel.textContent = selN;
  }

  // ============================================================
  //  文本工具
  // ============================================================
  function isEmptyBlock(node) {
    if (node.nodeType === 3) return node.textContent.trim() === "";
    if (node.nodeName === "BR") return true;
    if (node.nodeType === 1) {
      if (node.querySelector("img,hr")) return false;
      return node.textContent.trim() === "";
    }
    return false;
  }
  function cleanEmptyLines() {
    const kids = Array.from(editor.childNodes);
    let run = 0;
    kids.forEach((k) => {
      if (isEmptyBlock(k)) { run++; if (run > 1) editor.removeChild(k); }
      else run = 0;
    });
    onEdit(); toast("已清理多余空行");
  }
  function formatOptimize() {
    const kids = Array.from(editor.childNodes);
    kids.forEach((k) => {
      if (k.nodeType === 3 && k.textContent.trim() !== "") {
        const p = document.createElement("p"); p.textContent = k.textContent; editor.replaceChild(p, k);
      }
    });
    onEdit(); toast("已优化排版");
  }
  function importTxt(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      if (editor.innerText.trim() && !confirm("导入将替换当前章节内容，确定继续？")) return;
      const paras = text.split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => `<p>${escapeHtml(l.trim())}</p>`);
      editor.innerHTML = paras.join("");
      onEdit(); toast("已导入 TXT（请仅使用你自己的文稿）");
    };
    reader.readAsText(file, "utf-8");
  }
  function exportTxt() {
    flushChapter();
    const lines = [];
    work.chapters.forEach((c) => {
      lines.push((c.title || "未命名章节") + (c.hidden ? "（隐藏）" : ""));
      lines.push("");
      const tmp = document.createElement("div"); tmp.innerHTML = c.content || "";
      lines.push((tmp.innerText || "").trim());
      lines.push(""); lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (work.title || "同人作品") + ".txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("已导出 TXT");
  }

  // ============================================================
  //  阅读预览
  // ============================================================
  function renderPreview() {
    flushChapter();
    $("#previewTitle").textContent = work.title || "未命名作品";
    const box = $("#previewContent");
    let html = `<h1>${escapeHtml(work.title || "未命名作品")}</h1>`;
    if (work.tags && work.tags.length) html += `<p style="text-align:center;color:var(--text-soft);font-size:13px">${work.tags.map(escapeHtml).join(" · ")}</p>`;
    work.chapters.forEach((c) => {
      const ct = (c.title || "").trim();
      html += `<div class="pv-ch">`;
      if (ct) html += `<h2>${escapeHtml(ct)}</h2>`;
      if (c.hidden) html += `<div class="pv-hidden">（本章已隐藏，正式阅读时不展示）</div>`;
      else html += (c.content || "<p style='color:var(--text-soft)'>（空）</p>");
      html += `</div>`;
    });
    box.innerHTML = html;
  }
  function openPreview() { renderPreview(); $("#previewOverlay").classList.add("open"); }
  function closePreview() { $("#previewOverlay").classList.remove("open"); }

  // ============================================================
  //  主题（夜间 / 浅色）
  // ============================================================
  function applyTheme(dark) {
    document.documentElement.classList.toggle("dark", dark);
    $("#btnTheme").textContent = dark ? "☀" : "🌙";
    try { localStorage.setItem("ed_theme", dark ? "dark" : "light"); } catch {}
  }
  function initTheme() {
    let saved; try { saved = localStorage.getItem("ed_theme"); } catch {}
    const dark = saved ? saved === "dark" : document.documentElement.classList.contains("dark");
    applyTheme(dark);
  }

  // ============================================================
  //  作品列表弹窗
  // ============================================================
  async function openWorksModal() {
    const res = await api("/api/editor/works", { method: "GET" });
    const list = res.ok ? res.data.works : [];
    const box = $("#worksList");
    if (!list.length) {
      box.innerHTML = `<div class="ed-empty">还没有作品，点击下方按钮新建第一篇吧～</div>`;
    } else {
      box.innerHTML = list.map((w) => `
        <div class="ed-work-item" data-id="${w.id}">
          <div class="wi-main">
            <div class="wi-title">${escapeHtml(w.title || "未命名作品")}</div>
            <div class="wi-meta">${w.chapterCount || 0} 章 · 更新 ${fmtTime(w.updatedAt)}</div>
          </div>
          <button class="wi-del" title="删除作品">🗑</button>
        </div>`).join("");
      $$(".ed-work-item", box).forEach((el) => {
        el.addEventListener("click", (e) => { if (e.target.closest(".wi-del")) return; openWork(el.dataset.id); });
        el.querySelector(".wi-del").addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!confirm("确定删除该作品？此操作不可恢复。")) return;
          const r = await api(`/api/editor/works/${el.dataset.id}`, { method: "DELETE" });
          if (r.ok) { toast("已删除"); openWorksModal(); }
          else toast("删除失败：" + (r.data.msg || ""), true);
        });
      });
    }
    openModal("worksModal");
  }

  // ============================================================
  //  弹窗 / 侧栏 显隐
  // ============================================================
  function openModal(id) { $("#" + id).classList.add("open"); }
  function closeModal(id) { $("#" + id).classList.remove("open"); }
  function openSide() { side.classList.add("open"); sideMask.classList.add("open"); }
  function closeSide() { side.classList.remove("open"); sideMask.classList.remove("open"); }

  // ============================================================
  //  事件绑定
  // ============================================================
  function bindEvents() {
    // 顶层命令按钮
    $("#edToolbar").addEventListener("click", (e) => { const b = e.target.closest(".ed-tb"); if (b) exec(b.dataset.cmd); });
    // 编辑区输入
    editor.addEventListener("input", onEdit);
    editor.addEventListener("keyup", updateToolbarState);
    editor.addEventListener("mouseup", updateCounts);
    document.addEventListener("selectionchange", () => { if (editor.contains((window.getSelection() || {}).anchorNode)) updateCounts(); });

    // 标题
    titleInput.addEventListener("input", () => { if (work) { work.title = titleInput.value; scheduleLocal(); scheduleAuto(); } });
    // 作者署名
    if (authorInput) authorInput.addEventListener("input", () => { if (work) { work.authorName = authorInput.value; scheduleLocal(); } });
    // 连载状态
    if (serialSelect) serialSelect.addEventListener("change", () => { if (work) { work.serial = serialSelect.value; scheduleLocal(); } });
    // 配对标签
    if (pairSelect) pairSelect.addEventListener("change", () => { if (work) { work.pair = pairSelect.value; scheduleLocal(); } });

    // 顶栏按钮
    $("#btnAddChapter").addEventListener("click", addChapter);
    $("#btnWorks").addEventListener("click", openWorksModal);
    $("#btnNewWork").addEventListener("click", newBlankWork);
    $("#btnTags").addEventListener("click", () => { renderTagGroups(); openModal("tagsModal"); });
    $("#btnTagClose").addEventListener("click", () => closeModal("tagsModal"));
    // 自定义标签：回车或点击 ＋ 按钮添加
    const customTagInput = $("#edCustomTag");
    const addCustomTag = $("#edAddCustomTag");
    function addCustomTagFromInput() {
      const val = customTagInput ? customTagInput.value.trim() : '';
      if (!val) return;
      if ((work.tags || []).includes(val)) { toast('标签已存在', true); return; }
      work.tags = (work.tags || []).concat(val);
      customTagInput.value = '';
      renderTagsChips();
      renderTagGroups();  // 刷新弹窗内标签列表
      onEdit();
      toast('已添加标签：' + val);
    }
    if (customTagInput) {
      customTagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTagFromInput(); } });
    }
    if (addCustomTag) addCustomTag.addEventListener('click', addCustomTagFromInput);
    $("#btnPreview").addEventListener("click", openPreview);
    $("#btnExitPreview").addEventListener("click", closePreview);
    $("#btnTheme").addEventListener("click", () => applyTheme(!document.documentElement.classList.contains("dark")));

    // 画圆角矩形（兼容无 ctx.roundRect 的环境）
    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    // 文章无插图时，由标题自动生成简单封面（暖色莫兰迪底 + 顶部连载状态药丸 + 居中题目 + 作者名 + 配对）
    function generateTitleCover(title, author, pair, serial) {
      const W = 800, H = 400;
      const cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      const ctx = cv.getContext("2d");
      // 渐变底（呼应站内配色）
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, "#efe7dd");
      grad.addColorStop(1, "#dcd0c4");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      // 点缀圆
      ctx.fillStyle = "rgba(217,166,121,0.16)";
      ctx.beginPath(); ctx.arc(W * 0.84, H * 0.20, 96, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(126,156,184,0.13)";
      ctx.beginPath(); ctx.arc(W * 0.16, H * 0.84, 130, 0, Math.PI * 2); ctx.fill();
      // 圆角矩形辅助
      function rr(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
      }
      // 全局居中
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // 顶部：连载状态药丸 + 配对小标（并排居中）
      const isSerial = (serial === true || serial === "serial");
      const isDone = (serial === "completed");
      const serialLabel = isSerial ? "连载中" : isDone ? "已完结" : "短篇";
      const pillFont = '600 22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.font = pillFont;
      const padX = 26, pillH = 40, pillY = 52;
      const pillW = ctx.measureText(serialLabel).width + padX * 2;
      const pairSmall = String(pair || "无差").slice(0, 12);
      const pairFont = '500 19px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.font = pairFont;
      const pairW = ctx.measureText(pairSmall).width;
      const gap = 14;
      const groupW = pillW + gap + pairW;
      const gx = (W - groupW) / 2;
      // 状态药丸
      rr(gx, pillY, pillW, pillH, pillH / 2);
      ctx.fillStyle = isSerial ? "rgba(217,166,121,0.94)" : isDone ? "rgba(94,122,150,0.94)" : "rgba(150,140,130,0.85)";
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = pillFont;
      ctx.fillText(serialLabel, gx + pillW / 2, pillY + pillH / 2 + 1);
      // 配对小标（药丸右侧）——加粗
      const pairFontBold = '700 20px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.font = pairFontBold;
      ctx.fillStyle = "rgba(74,100,130,0.95)";
      ctx.fillText(pairSmall, gx + pillW + gap + pairW / 2, pillY + pillH / 2 + 1);
      // 题目（标题）：大号，最多 2 行，居中于中上部
      ctx.fillStyle = "#3e3a34";
      ctx.font = '700 46px "PingFang SC","Microsoft YaHei",sans-serif';
      const maxW = W - 120, maxLines = 2, lineH = 60;
      let line = "", lines = [];
      const text = String(title || "未命名作品");
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ctx.measureText(line + ch).width > maxW) {
          lines.push(line); line = ch;
          if (lines.length >= maxLines - 1) { lines.push(text.slice(i)); break; }
        } else { line += ch; }
      }
      if (lines.length < maxLines) lines.push(line);
      const titleTop = 160;
      lines.slice(0, maxLines).forEach((ln, i) => ctx.fillText(ln, W / 2, titleTop + i * lineH + lineH / 2));
      // 作者名（居中）
      const authorText = String(author || "佚名").slice(0, 18);
      ctx.fillStyle = "rgba(94,122,150,0.95)";
      ctx.font = '500 26px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(authorText, W / 2, 282);
      return cv.toDataURL("image/jpeg", 0.9);
    }

    async function publishToFanfic() {
      // 纯静态站：无需登录态，直接以可发布身份发布到同人专区
      if (!work) { toast('请先创建作品', true); return; }
      flushChapter();
      if (!work.id) { await saveWork(true); }
      if (!work.id) { toast('请先保存作品再发布（云端保存失败，可稍后重试）', true); return; }
      const visible = work.chapters.filter((c) => !c.hidden);
      if (!visible.length || !visible.some((c) => (c.content || '').trim())) {
        toast('没有可发布的正文内容（隐藏章节不会发布）', true); return;
      }
      const pairVal = pairSelect ? pairSelect.value : '';
      if (!pairVal) { toast('请先在顶部选择「配对」标签（年上/年下/无差）再发布', true); return; }
      const content = visible.map((c) => {
        const t = (c.title || '').trim();
        const head = t ? '<h2 class="post-ch-title">' + escapeHtml(t) + '</h2>' : '';
        return head + (c.content || '');
      }).join('');
      const title = (work.title || '').trim() || (visible[0].title || '未命名作品');
      setStatus('发布中…');
      const authorName = (authorInput && authorInput.value.trim()) || '';
      const serial = (serialSelect && serialSelect.value) || 'single';
      const serialLabel = serial === 'serial' ? '连载中' : serial === 'completed' ? '已完结' : '短篇';
      let cover = '';
      try { cover = generateTitleCover(title, authorName, pairVal, serial); }
      catch (ce) { cover = ''; }   // 封面生成失败不阻断发布
      try {
        const payload = { title: title, kind: 'article', content: content, pair: pairVal, tags: work.tags || [], authorName, serial, cover };
        let r, isUpdate = false;
        if (work.fanpostId) {
          isUpdate = true;
          r = await api('/api/fanposts/' + work.fanpostId, { method: 'PUT', body: JSON.stringify(payload) });   // 已在同人专区有卡片 → 直接更新该卡片
        } else {
          r = await api('/api/fanposts', { method: 'POST', body: JSON.stringify(payload) });                    // 首次发布 → 新建一张卡片
        }
        const d = r.data || {};
        if (r.ok) {
          const pid = (d.post && d.post.id) || d.id;
          if (pid && pid !== work.fanpostId) { work.fanpostId = pid; await saveWork(true); }   // 记下卡片 id 并持久化到作品，下次发布即更新而非新建
          toast(isUpdate ? '已更新到同人专区（最新章已同步）✨' : '已发布到同人专区 · 文章类目 ✨');
        } else if (r.status === 404 && isUpdate) {
          // 关联的卡片已被删除：退回新建一张卡片
          const r2 = await api('/api/fanposts', { method: 'POST', body: JSON.stringify(payload) });
          const d2 = r2.data || {};
          if (r2.ok) { const pid2 = (d2.post && d2.post.id) || d2.id; if (pid2) { work.fanpostId = pid2; await saveWork(true); } toast('已发布到同人专区 · 文章类目 ✨'); }
          else { toast(d2.msg || '发布失败', true); }
        }
        else if (r.status === 403) { toast(d.msg || '发布被拒绝：权限不足或内容需调整', true); }
        else { toast(d.msg || ('发布失败（' + r.status + '）'), true); }
      } catch (e) { toast('网络错误：' + ((e && e.message) || '发布失败，请检查网络'), true); }
    }

    // 更多菜单
    const moreMenu = $("#moreMenu");
    $("#btnMore").addEventListener("click", (e) => { e.stopPropagation(); moreMenu.classList.toggle("open"); });
    document.addEventListener("click", (e) => { if (!moreMenu.contains(e.target) && e.target !== $("#btnMore")) moreMenu.classList.remove("open"); });
    moreMenu.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]"); if (!act) return;
      moreMenu.classList.remove("open");
      const a = act.dataset.act;
      if (a === "new") newBlankWork();
      else if (a === "works") openWorksModal();
      else if (a === "import") $("#importFile").click();
      else if (a === "export") exportTxt();
      else       if (a === "clean") cleanEmptyLines();
      else if (a === "format") formatOptimize();
      else if (a === "publish") publishToFanfic();
    });

    // 导入
    $("#importFile").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) importTxt(f); e.target.value = ""; });

    // 关闭弹窗（× 与遮罩）
    $$("[data-close]").forEach((b) => b.addEventListener("click", () => closeModal(b.dataset.close)));
    $$(".modal-mask").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); }));

    // 登录态提示：纯公开演示，编辑器默认可发布
    const btnLoginState = $("#btnLoginState");
    if (btnLoginState) btnLoginState.addEventListener("click", () => { toast("已可直接发布到同人专区 ✨"); });

    // 移动端侧栏
    $("#btnSideToggle").addEventListener("click", openSide);
    sideMask.addEventListener("click", closeSide);

    // 手动保存：Ctrl/Cmd+S
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveWork(true); }
    });
    // 离开前提示
    window.addEventListener("beforeunload", (e) => { if (autoTimer) { flushChapter(); writeLocal(work); } });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ============================================================
  //  初始化
  // ============================================================
  async function init() {
    bindEvents();
    initTheme();
    checkSession();   // 纯静态站：直接以可发布身份初始化编辑器
    // 优先载入最近作品，否则空白
    const res = await api("/api/editor/works", { method: "GET" });
    if (res.ok && res.data.works && res.data.works.length) {
      const last = getLastId();
      const target = (last && res.data.works.find((w) => w.id === last)) ? last : res.data.works[0].id;
      await openWork(target);
    } else {
      newBlankWork();
      toast("欢迎使用创作编辑器，开始你的同人故事吧 ✍️");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
