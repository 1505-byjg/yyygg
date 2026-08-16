/* =============================================================
   static-api.js — 纯静态站 API 垫片（无后台）
   -------------------------------------------------------------
   重写 window.fetch，把所有 /api/* 请求转成本地 data/*.json：
     • GET  → 读取本地 data/<资源>.json（按要求包装成 {key:[...]}）
     • 写操作（POST/PUT/DELETE/PATCH） → 返回成功，但不落盘
   本站为纯公开站，无登录 / 注册 / 登出（localStorage 会员模拟已移除）。
   原站点（main.js / reader.js / editor.js / admin.html）无需改动即可运行。
   注意：本站需通过 http(s) 提供服务（如 python -m http.server），
   直接双击 file:// 打开会因浏览器安全策略无法 fetch 本地数据。
   ============================================================= */
(function () {
  "use strict";
  if (window.__staticApiPatched) return;
  window.__staticApiPatched = true;

  const realFetch = window.fetch ? window.fetch.bind(window) : function () { return Promise.reject(new Error("no fetch")); };

  // 纯公开站：所有访客以「公开访客」身份浏览与收藏（无登录态）
  const PUBLIC_USER = {
    id: "public",
    nickname: "",
    email: "",
    role: "访客",
    status: "",
    canPost: false,
    canFavorite: true,
    isAdmin: false,
  };

  // 公开资源：endpoint 段 → {文件, 包装键}
  const PUBLIC = {
    hero:          { file: "hero.json",          wrap: null },
    materials:     { file: "materials.json",     wrap: "materials" },
    tips:          { file: "tips.json",          wrap: "tips" },
    announcements: { file: "announcements.json", wrap: "announcements" },
    rules:         { file: "rules.json",         wrap: "rules" },
    works:         { file: "works.json",         wrap: "works" },
  };
  // 后台资源：/api/admin/<sub> → {文件, 包装键}
  const ADMIN = {
    materials:     { file: "materials.json",     wrap: "materials" },
    announcements: { file: "announcements.json", wrap: "announcements" },
    rules:         { file: "rules.json",         wrap: "rules" },
    tips:          { file: "tips.json",          wrap: "tips" },
    hero:          { file: "hero.json",          wrap: null },
  };

  /* ---------- 工具 ---------- */
  function json(body, status) {
    return new Response(JSON.stringify(body == null ? {} : body), {
      status: status || 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  async function loadData(file) {
    try {
      // 加时间戳防缓存：data/*.json 无版本号，GitHub Pages/浏览器会缓存，
      // 导致"重新部署后内容仍不更新"（同人页提示/物料等数据 JSON 同病）。
      // 查询串对静态托管与本地 serve.cjs（已剥查询串）均无害。
      const sep = file.indexOf("?") === -1 ? "?" : "&";
      const r = await realFetch("data/" + file + sep + "_=" + Date.now());
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  function respFromDataUrl(dataUrl) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
    if (!m) return json({ error: "bad data url" }, 400);
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, { status: 200, headers: { "Content-Type": m[1], "Cache-Control": "no-store" } });
  }
  function bodyOf(init) {
    try { return init && init.body ? JSON.parse(init.body) : {}; } catch (e) { return {}; }
  }
  function getSession() {
    return PUBLIC_USER; // 公开站无登录态
  }
  // 写操作统一成功响应（不持久化）
  function writeOk() {
    return json({
      ok: true, faved: true, id: "static-" + Date.now(),
      msg: "静态演示：操作未持久化", post: { id: "static" }, user: getSession(),
    });
  }

  /* ---------- fetch 拦截 ---------- */
  window.fetch = async function (input, init) {
    let url;
    try {
      url = typeof input === "string" ? new URL(input, location.href) : new URL(input.url, location.href);
    } catch (e) {
      return realFetch(input, init);
    }
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith("/api/")) return realFetch(input, init);

    const method = (init && init.method ? init.method : (input && input.method ? input.method : "GET")).toUpperCase();
    const seg = pathname.split("/").filter(Boolean).slice(1); // 去掉 "api"
    const head = seg[0];

    /* ---- 会话（公开站：恒为公开访客） ---- */
    if (head === "me") {
      return json({ user: getSession() });
    }

    /* ---- 已彻底移除：登录 / 注册 / 登出 / 昵称查重 / 邮箱查重 ---- */
    if (head === "login" || head === "register" || head === "logout" || head === "check-nickname" || head === "check-email") {
      return json({ error: "removed", msg: "本站为纯公开站，已彻底移除登录/注册/登出" }, 410);
    }
    /* ---- hero 图片 ---- */
    if (head === "hero" && seg[1] && seg[2] === "image") {
      const items = ((await loadData("hero.json")) || {}).items || [];
      const it = items.find((x) => x.id === seg[1]);
      if (it && it.image && String(it.image).startsWith("data:")) return respFromDataUrl(it.image);
      return json({ error: "not found" }, 404);
    }

    /* ---- 同人投稿 ---- */
    if (head === "fanposts") {
      if (seg[1] && (seg[2] === "image" || seg[2] === "video")) {
        const posts = (await loadData("fanposts.json")) || [];
        const p = posts.find((x) => x.id === seg[1]);
        const f = p && (p.file || (p.files && p.files[0]));
        if (f && typeof f === "string" && f.startsWith("data:")) return respFromDataUrl(f);
        return json({ error: "not found" }, 404);
      }
      if (method === "GET") {
        if (seg[1]) {
          const posts = (await loadData("fanposts.json")) || [];
          const p = posts.find((x) => x.id === seg[1]);
          return json(p || {}, p ? 200 : 404);
        }
        return json({ posts: (await loadData("fanposts.json")) || [] });
      }
      return writeOk();
    }

    /* ---- 后台 /api/admin/* ---- */
    if (head === "admin") {
      const sub = seg[1];
      const info = ADMIN[sub];
      if (!info) return writeOk();
      if (method === "GET") {
        const arr = (await loadData(info.file)) || [];
        if (seg[2]) {
          const item = arr.find((x) => x.id === seg[2]);
          return json(item || {}, item ? 200 : 404);
        }
        return json(info.wrap ? { [info.wrap]: arr } : (arr || {}));
      }
      return writeOk();
    }

    /* ---- 编辑器 /api/editor/* ---- */
    if (head === "editor") {
      const sub = seg[1];
      if (sub === "works") {
        if (method === "GET") {
          if (seg[2]) {
            const arr = (await loadData("works.json")) || [];
            const w = arr.find((x) => x.id === seg[2]);
            return json(w || {}, w ? 200 : 404);
          }
          return json({ works: (await loadData("works.json")) || [] });
        }
        return writeOk();
      }
      return writeOk();
    }

    /* ---- 其他公开资源 ---- */
    const info = PUBLIC[head];
    if (info) {
      if (method === "GET") {
        const arr = (await loadData(info.file)) || [];
        return json(info.wrap ? { [info.wrap]: arr } : (arr || {}));
      }
      return writeOk();
    }

    // 兜底：未知 /api 写操作 → 成功
    return writeOk();
  };

  console.log("[static-api] 已启用：/api/* 由本地 data/ 提供（纯公开站，写操作不持久化）");
})();
