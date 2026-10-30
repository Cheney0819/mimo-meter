/* mimo-meter overlay —— 注入 MiMo 渲染进程的统计浮层
 *
 * 两种形态：
 *   inline —— 优先：绝对定位嵌进 .composer-wrap，与「内容由 AI 生成」同一行，
 *             右边一段「2 轮 165 步 · 191 tok/s | 69.6M tok · 缓存命中 99%」。
 *   float  —— 兜底：找不到 composer 时退回右下角胶囊。
 *
 * 由 engine-config/mimo-meter.mjs 通过 webContents.executeJavaScript 注入；
 * 幂等：同版本重复注入直接返回（不动 DOM、不丢开合状态），版本变了才拆除重建。
 */
(function () {
  var VERSION = "2.0.4";
  var HOST_ID = "mimo-meter-host";

  /* 幂等：同版本 + host 还在 → 什么都不做，直接返回。
     这条必须先判：主进程在 did-navigate-in-page（SPA 换会话）、did-finish-load、
     窗口创建后 600ms 各注入一次，如果每次都重建 DOM，开着的卡片会被关掉。
     版本不同才走下面的拆除重建（热重载）。
     注意顺序不能反过来——导出对象恒有 destroy，"先判 destroy 再判版本"
     会让同版本分支永远不可达（v2.0.3 就是这样，实测每次注入都重建）。 */
  var prev = window.__MIMO_METER__;
  if (prev && prev.version === VERSION && document.getElementById(HOST_ID)) return;
  if (prev && typeof prev.destroy === "function") {
    try { prev.destroy(); } catch (e) {}
  }

  /* ---------------- 会话 id 捕获（备用信号；主信号在主进程桥拦截里） ---------------- */
  if (!window.__mimoMeterFetchPatched) {
    window.__mimoMeterFetchPatched = true;
    var origFetch = window.fetch;
    if (typeof origFetch === "function") {
      var patchedFetch = function (input) {
        try {
          var url = typeof input === "string" ? input : (input && input.url) || "";
          var m = /\/session\/([A-Za-z0-9_\-]+)/.exec(url);
          if (m && m[1] && m[1] !== window.__mimoMeterSid) {
            window.__mimoMeterSid = m[1];
            var api = window.__MIMO_METER__;
            if (api && api.onSid) api.onSid(m[1]);
          }
        } catch (e) {}
        return origFetch.apply(this, arguments);
      };
      /* 记下原函数，destroy 时好还原（避免每次热重载叠一层 wrapper） */
      patchedFetch.__mimoMeterOrig = origFetch;
      window.fetch = patchedFetch;
    }
  }

  /* ---------------- 工具 ---------------- */
  function fmt(n) {
    if (n == null || isNaN(n)) return "—";
    return Math.round(n).toLocaleString("en-US");
  }
  function compact(n) {
    if (n == null || isNaN(n)) return "—";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e8) return (n / 1e6).toFixed(0) + "M";
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
  }
  function fmtDur(ms) {
    if (ms == null || isNaN(ms) || ms <= 0) return "—";
    var sec = ms / 1000;
    if (sec < 1) return sec.toFixed(1) + "秒";
    if (sec < 60) return (sec < 10 ? sec.toFixed(1) : String(Math.round(sec))) + "秒";
    var min = Math.floor(sec / 60);
    var rs = Math.round(sec % 60);
    if (min < 60) return rs ? min + "分" + rs + "秒" : min + "分";
    var hr = Math.floor(min / 60);
    var rm = min % 60;
    return rm ? hr + "时" + rm + "分" : hr + "时";
  }
  function fmtSec(ms) {
    if (ms == null || isNaN(ms)) return "—";
    return (ms / 1000).toFixed(1) + "秒";
  }
  function pct(v) {
    if (v == null || isNaN(v)) return "—";
    return (v * 100).toFixed(v >= 0.995 ? 0 : 1) + "%";
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(paths) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 16 16");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.35");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    paths.forEach(function (d) {
      var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      s.appendChild(p);
    });
    return s;
  }

  /* ---------------- DOM ---------------- */
  var old = document.getElementById(HOST_ID);
  if (old) old.remove();

  var host = el("div");
  host.id = HOST_ID;
  host.dataset.mode = "float";

  /* --- 两张独立卡片：Token 用量 / 会话统计 ---
     各自挂在对应的底栏段里，点哪段开哪张，互斥展开避免两张 288px 卡片重叠。 */
  function makePanel(kind, label) {
    var p = el("div", "mm-panel mm-panel-" + kind);
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", label);
    return p;
  }

  function row(parent, label) {
    var r = el("div", "mm-row");
    r.appendChild(el("span", "mm-k", label));
    var v = el("span", "mm-v", "—");
    r.appendChild(v);
    parent.appendChild(r);
    return { row: r, v: v };
  }

  function panelHead(parent, title, extra) {
    var h = el("div", "mm-head");
    h.appendChild(el("span", "mm-ico", "◈"));
    h.appendChild(el("span", "mm-title", title));
    if (extra) h.appendChild(extra);
    parent.appendChild(h);
    return h;
  }

  /* ---- 卡片一：Token 用量 ---- */
  var panelTok = makePanel("tok", "Token 用量");
  var totalEl = el("span", "mm-total", "—");
  panelHead(panelTok, "Token 用量", totalEl);
  panelTok.appendChild(el("div", "mm-rule"));
  var rHit = row(panelTok, "缓存命中");
  var rIn = row(panelTok, "未缓存输入");
  var rRead = row(panelTok, "缓存读取");
  var rWrite = row(panelTok, "缓存写入");
  var rOut = row(panelTok, "输出");
  var rRea = row(panelTok, "推理（含在总量）");
  panelTok.appendChild(el("div", "mm-rule"));
  var footTok = el("div", "mm-foot");
  var footRight = el("span", "mm-foot-r", "—");
  footTok.appendChild(footRight);
  panelTok.appendChild(footTok);

  /* ---- 卡片二：会话统计 ---- */
  var panelStat = makePanel("stat", "会话统计");
  panelHead(panelStat, "会话统计");
  var subEl = el("div", "mm-sub", "");
  panelStat.appendChild(subEl);
  panelStat.appendChild(el("div", "mm-rule"));
  var tModel = row(panelStat, "模型用时");
  var tTool = row(panelStat, "工具调用用时");
  var tTtft = row(panelStat, "首 token 平均（TTFT）");
  var tTps = row(panelStat, "输出速度（TPS）");
  panelStat.appendChild(el("div", "mm-rule"));
  /* 底部一行：左边「N 轮 · M 步」，右边模型名。
     两者放同一个 flex 行里，靠 align-items: baseline 做基线对齐，
     不再让模型名单独占一行。 */
  var footStat = el("div", "mm-foot");
  var footLeft = el("span", "mm-foot-l", "—");
  var costLine = el("span", "mm-cost", "");
  footStat.appendChild(footLeft);
  footStat.appendChild(costLine);
  panelStat.appendChild(footStat);

  /* --- 底栏内嵌条：两段各自可点 --- */
  var bar = el("div", "mm-bar");

  var segRounds = el("span", "mm-seg mm-seg-stat");
  segRounds.setAttribute("role", "button");
  segRounds.setAttribute("tabindex", "0");
  segRounds.setAttribute("aria-expanded", "false");
  segRounds.title = "会话统计：轮 / 步 / 输出速度（点击展开）";
  var approxTag = el("span", "mm-approx", "最近");
  segRounds.appendChild(approxTag);
  segRounds.appendChild(svg(["M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z", "M8 5v3.2l2.2 1.4"]));
  var roundsTxt = el("span", "mm-seg-t", "—");
  segRounds.appendChild(roundsTxt);

  var segTok = el("span", "mm-seg mm-seg-tok");
  segTok.setAttribute("role", "button");
  segTok.setAttribute("tabindex", "0");
  segTok.setAttribute("aria-expanded", "false");
  segTok.title = "Token 用量：总量 / 缓存命中 / 费用（点击展开）";
  segTok.appendChild(svg(["M2.9 4.1c0-1.1 2.3-2 5.1-2s5.1.9 5.1 2-2.3 2-5.1 2-5.1-.9-5.1-2z", "M2.9 4.1v7.4c0 1.1 2.3 2 5.1 2s5.1-.9 5.1-2V4.1", "M2.9 7.8c0 1.1 2.3 2 5.1 2s5.1-.9 5.1-2"]));
  var tokTxt = el("span", "mm-seg-t", "—");
  segTok.appendChild(tokTxt);

  bar.appendChild(segRounds);
  bar.appendChild(segTok);

  /* --- 兜底胶囊 --- */
  var chip = el("button", "mm-chip");
  chip.type = "button";
  chip.title = "Token 用量 / 会话统计（点击展开）";
  var dot = el("span", "mm-dot");
  var chipText = el("span", "mm-chip-text", "Token 用量");
  chip.appendChild(dot);
  chip.appendChild(chipText);

  host.appendChild(bar);
  host.appendChild(panelStat);
  host.appendChild(panelTok);
  host.appendChild(chip);
  document.body.appendChild(host);

  /* ---------------- 挂载：优先塞进 composer 底部那一行 ---------------- */
  /* 缓存命中的 composer 元素。MutationObserver 在流式输出时每秒会叫醒好几次，
     每次都 querySelectorAll + 逐个 getBoundingClientRect 是白跑的；
     命中缓存时只剩一次 isConnected 属性读。
     元素被 React 换掉（isConnected 变 false）时自然重查。 */
  var wrapCache = null;
  function invalidateWrap() { wrapCache = null; }

  function pickComposerWrap() {
    if (wrapCache && wrapCache.isConnected) return wrapCache;
    var list = Array.prototype.slice.call(document.querySelectorAll(".composer-wrap"));
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (r.width > 240 && r.height > 40) best = list[i];
    }
    wrapCache = best;   /* 找不到就留 null，下次仍然重查 */
    return best;
  }

  function setPos(kind) {
    var st = host.style;
    st.transform = "";
    st.marginTop = "";
    if (kind === "disc") {
      /* 会话页：免责声明那一行的左边（免责声明本身保持居中） */
      st.position = "absolute";
      st.left = "28px";
      st.right = "auto";
      st.top = "auto";
      st.bottom = "6px";
      st.width = "auto";
    } else if (kind === "chips") {
      /* 首页视图：composer 下面那行是 .scope-chips，绝对居中靠右 */
      st.position = "absolute";
      st.left = "auto";
      st.bottom = "auto";
      st.right = "0px";
      st.top = "50%";
      st.transform = "translateY(-50%)";
    } else if (kind === "below") {
      st.position = "absolute";
      st.left = "auto";
      st.top = "100%";
      st.right = "0px";
      st.bottom = "auto";
      st.marginTop = "6px";
    } else {
      /* 兜底胶囊 */
      st.position = "fixed";
      st.transform = "";
      if (host.dataset.pinned === "1") {
        st.right = "auto";
        st.bottom = "auto";
      } else {
        st.left = "auto";
        st.top = "auto";
        st.right = "16px";
        st.bottom = "16px";
      }
    }
  }

  /* 顶栏文本扫描：只在「会话页 + 还没有 sid」时才需要（桥全挂时的最后兜底）。
     它要遍历全文档并逐节点 getBoundingClientRect，24k 节点的长会话实测 9ms，
     所以绝不能无条件调用。 */
  function headerTexts() {
    var out = [];
    var nodes = document.querySelectorAll("div,span,h1,h2,h3,a,p");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var r = n.getBoundingClientRect();
      if (r.height < 12 || r.height > 36) continue;
      if (r.top < 2 || r.top > 120) continue;
      if (r.left < 246) continue;
      if (r.width < 40) continue;
      if (n.children.length > 1) continue;
      var t = (n.textContent || "").trim();
      if (!t || t.length < 2 || t.length > 80) continue;
      if (out.indexOf(t) >= 0) continue;
      out.push(t);
      if (out.length >= 8) break;
    }
    return out;
  }

  var headerCache = { at: 0, texts: [] };

  function currentView() {
    var wrap = pickComposerWrap();
    if (!wrap) return "unknown";
    /* 会话页独有：composer 里有「内容由 AI 生成」那行 */
    if (wrap.querySelector(".composer-ai-disclaimer")) return "thread";
    /* 首页的三个独立信号，任一命中就算首页 */
    if (wrap.classList.contains("composer-home")) return "home";
    if (document.querySelector(".scope-chips")) return "home";
    var ta = document.getElementById("composer-input");
    var ph = (ta && ta.getAttribute("placeholder")) || "";
    if (ph.indexOf("描述任务") >= 0) return "home";
    return "unknown";
  }

  /* 形态切换后必须重排一次：档位降级依赖「可用宽度」，而 float 形态下
     没有免责声明可参照，fitBar 会直接返回。不重排的话，切到 inline 后
     文案会一直停在按 240px 估出来的紧凑档，甚至被截断。 */
  function afterAttach(prevMode) {
    if (prevMode === host.dataset.mode) return;
    invalidateFit();
    fitBar(true);
    if (state.data) render();
  }

  function attach() {
    var prevMode = host.dataset.mode;
    var wrap = pickComposerWrap();
    if (wrap) {
      host.dataset.layout = "inline";
      host.dataset.mode = "inline";
      var disc = wrap.querySelector(".composer-ai-disclaimer");
      if (disc) {
        /* 免责声明保持居中，统计条绝对定位到它左边 */
        if (disc.style.display === "flex") {
          disc.style.display = "";
          disc.style.alignItems = "";
          disc.style.gap = "";
        }
        if (host.parentElement !== wrap) wrap.appendChild(host);
        setPos("disc");
        afterAttach(prevMode);
        return true;
      }
      var holder = wrap.parentElement || wrap;
      var row = holder.nextElementSibling;
      if (row && row.classList && row.classList.contains("scope-chips")) {
        if (host.parentElement !== row) row.appendChild(host);
        row.style.position = "relative";
        setPos("chips");
        afterAttach(prevMode);
        return true;
      }
      if (host.parentElement !== holder) holder.appendChild(host);
      holder.style.position = "relative";
      setPos("below");
      afterAttach(prevMode);
      return true;
    }
    if (host.parentElement !== document.body) document.body.appendChild(host);
    host.dataset.mode = "float";
    setPos("float");
    afterAttach(prevMode);
    return false;
  }

  /* 所有需要显式解绑的东西都登记在这里（host 内部的监听器随 host 移除自动失效，
     但 window / document 上的不会）。 */
  var cleanups = [];
  function onWin(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanups.push(function () { target.removeEventListener(type, fn, opts); });
  }

  var reattachTimer = null;
  function scheduleAttach() {
    if (reattachTimer) return;
    reattachTimer = setTimeout(function () {
      reattachTimer = null;
      if (!host.isConnected) return attach();
      var wrap = pickComposerWrap();
      if (!wrap) {
        if (host.parentElement !== document.body) attach();
        return;
      }
      var disc = wrap.querySelector(".composer-ai-disclaimer");
      if (disc) {
        if (host.parentElement !== wrap) attach();
        return;
      }
      var holder = wrap.parentElement || wrap;
      var row = holder.nextElementSibling;
      var want = disc ? wrap : row && row.classList && row.classList.contains("scope-chips") ? row : holder;
      if (host.parentElement !== want) attach();
    }, 180);
  }
  var mo = null;
  try {
    mo = new MutationObserver(scheduleAttach);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    cleanups.push(function () {
      try { mo.disconnect(); } catch (e) {}
    });
  } catch (e) {}

  /* ---------------- 交互 ---------------- */
  /* which: null | "tok" | "stat" —— 两张卡片互斥，同时只开一张 */
  var state = { which: null, data: null, justDragged: false };

  function panelOf(which) {
    return which === "tok" ? panelTok : which === "stat" ? panelStat : null;
  }

  /* 卡片高度是内容决定的，但可用空间取决于分段在视口里的位置：
     优先向上展开；上方空间不足就翻到下方；两边都不够就取较大的一侧并内部滚动。
     这样无论窗口多矮、分段多靠上，卡片都不会跑出屏幕。 */
  var PANEL_GAP = 9;

  function placePanel(which) {
    var p = panelOf(which);
    if (!p) return;
    var seg = which === "tok" ? segTok : segRounds;
    var st = p.style;

    /* 卡片是 host 的直接子节点（不能塞进 .mm-seg，那里 overflow:hidden 会把
       绝对定位的卡片一起裁掉）。宽度先量出来，横向位置在下面按分段算。
       注意：这里只量一次 offsetWidth —— 曾经有过一版先按 absolute 算一遍、
       再改成 fixed 重算一遍，前半段的 rect/自然高度全是白读的（每次多 4 次
       强制布局），已删。 */
    var panelW = p.offsetWidth || 288;

    /* 用 position: fixed + 视口坐标：卡片挂在 host 上，但 host 在长页面里
       可能离视口很远（滚动后 rect.top 是几千像素），用 absolute/bottom 都会算歪。
       fixed 直接按视口定位，最稳。 */
    st.position = "fixed";
    st.transform = "none";
    st.marginTop = "";
    st.marginBottom = "";

    var segRect = seg.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;

    /* 横向：Token 卡右对齐到右段右缘，统计卡左对齐到左段左缘，再夹进视口 */
    var left = which === "tok" ? segRect.right - panelW : segRect.left;
    if (left < 8) left = 8;
    if (left + panelW > vw - 8) left = vw - 8 - panelW;
    st.left = Math.round(left) + "px";
    st.right = "auto";

    /* 纵向可用空间 */
    var above = segRect.top - PANEL_GAP - 8;
    var below = vh - segRect.bottom - PANEL_GAP - 8;

    st.maxHeight = "";
    st.overflowY = "";
    var natural = Math.max(p.scrollHeight || 0, Math.round(p.getBoundingClientRect().height) || 0);
    if (!natural) natural = 220;

    /* 选方向：优先选能完整放下的那侧；两边都放不下就选空间更大的那侧。
       绝不能因为「上方略大于下方」就选上方，那样会顶出屏幕。 */
    var fitsAbove = above >= natural;
    var fitsBelow = below >= natural;
    var up = fitsAbove ? true : (fitsBelow ? false : above >= below);
    /* 两侧都几乎没有空间（分段贴着视口顶/底）时，至少给个能看的高度 */
    var limit = Math.max(80, Math.floor(Math.max(0, up ? above : below)));

    /* 纵向贴着整条状态栏（bar）而不是单个分段：
       分段只有 17px 高且带 1px padding，按分段对齐会出现几像素偏差。 */
    var barRect = bar.getBoundingClientRect();
    /* top/bottom 与卡片自身高度无关，所以量高度前后各设一次是多余的，一次就够 */
    function applyFixed() {
      if (up) {
        st.top = "auto";
        st.bottom = (vh - barRect.top + PANEL_GAP) + "px";
      } else {
        st.top = (barRect.bottom + PANEL_GAP) + "px";
        st.bottom = "auto";
      }
    }

    st.top = "auto";
    st.bottom = "auto";
    applyFixed();
    var realH = Math.round(p.getBoundingClientRect().height) || natural;

    if (realH > limit) {
      st.maxHeight = limit + "px";
      st.overflowY = "auto";
    }

    /* 最终兜底：以实测 rect 为准，越界就拉回视口 */
    var fin = p.getBoundingClientRect();
    if (fin.top < 8) {
      st.top = "8px";
      st.bottom = "auto";
      var rest = vh - 16;
      if (fin.height > rest) {
        st.maxHeight = rest + "px";
        st.overflowY = "auto";
      }
    } else if (fin.bottom > vh - 8) {
      st.bottom = "8px";
      st.top = "auto";
      if (fin.height > vh - 16) {
        st.maxHeight = (vh - 16) + "px";
        st.overflowY = "auto";
      }
    }
  }

  function setOpen(which) {
    state.which = which || null;
    host.classList.toggle("mm-open", !!state.which);
    host.classList.toggle("mm-open-tok", state.which === "tok");
    host.classList.toggle("mm-open-stat", state.which === "stat");
    segTok.setAttribute("aria-expanded", state.which === "tok" ? "true" : "false");
    segRounds.setAttribute("aria-expanded", state.which === "stat" ? "true" : "false");
    chip.setAttribute("aria-expanded", state.which ? "true" : "false");
    if (state.which) placePanel(state.which);
  }

  function toggle(which) {
    setOpen(state.which === which ? null : which);
  }

  /* scroll 时把 placePanel 合并到下一帧，避免滚动期间每个事件都强制布局 */
  var placeRaf = 0;
  function schedulePlace() {
    if (placeRaf) return;
    placeRaf = requestAnimationFrame(function () {
      placeRaf = 0;
      if (state.which) placePanel(state.which);
    });
  }
  onWin(window, "resize", schedulePlace);
  onWin(document, "scroll", schedulePlace, true);

  /* 卡片能不能开：没有会话数据、或状态条本身是隐藏的（空会话 / 首页）时都不开。
     少了 mm-idle 这一条时，空会话按 ⌥⌘T 会拿一个 display:none 的分段去量矩形，
     量到的全是 0，卡片被夹到视口左上角飘着。 */
  function canOpen() {
    return !!(state.data && state.data.sid) && !host.classList.contains("mm-idle");
  }

  function bindToggle(node, which) {
    node.addEventListener("click", function (e) {
      e.stopPropagation();
      if (state.justDragged) {
        state.justDragged = false;
        return;
      }
      if (!canOpen()) return;
      toggle(which);
    });
    node.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        if (!canOpen()) return;
        toggle(which);
      }
    });
  }
  bindToggle(segTok, "tok");
  bindToggle(segRounds, "stat");
  /* 胶囊没有分段，点它默认展开 Token 卡片 */
  bindToggle(chip, "tok");

  /* 卡片内部的点击不要冒泡到文档（否则会被判成「点外面」立刻关掉） */
  panelTok.addEventListener("click", function (e) { e.stopPropagation(); });
  panelStat.addEventListener("click", function (e) { e.stopPropagation(); });

  onWin(document, "pointerdown", function (e) {
    if (state.which && !host.contains(e.target)) setOpen(null);
  }, true);
  onWin(document, "keydown", function (e) {
    if (e.key === "Escape" && state.which) {
      setOpen(null);
      return;
    }
    /* ⌥⌘T：开合 Token 卡片；⌥⌘Y：开合会话统计卡片 */
    if (e.altKey && e.metaKey && !e.ctrlKey) {
      var k = (e.key || "").toLowerCase();
      if (k === "t" || e.code === "KeyT") {
        if (!canOpen()) return;
        e.preventDefault();
        toggle("tok");
      } else if (k === "y" || e.code === "KeyY") {
        if (!canOpen()) return;
        e.preventDefault();
        toggle("stat");
      }
    }
  }, true);

  /* 拖动（仅 float 形态） */
  var POS_KEY = "mimo.meter.pos.v2";
  try {
    var saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");
    if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
      host.style.left = Math.max(8, Math.min(window.innerWidth - 60, saved.left)) + "px";
      host.style.top = Math.max(8, Math.min(window.innerHeight - 40, saved.top)) + "px";
      host.style.right = "auto";
      host.style.bottom = "auto";
      host.dataset.pinned = "1";
    }
  } catch (e) {}

  var drag = null;
  chip.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 || host.dataset.mode === "inline") return;
    var r = host.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, pointerId: e.pointerId };
    try { chip.setPointerCapture(e.pointerId); } catch (err) {}
  });
  chip.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var x = Math.max(8, Math.min(window.innerWidth - 60, e.clientX - drag.dx));
    var y = Math.max(8, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
    if (Math.abs(x - (parseFloat(host.style.left) || 0)) > 2) drag.moved = true;
    host.style.left = x + "px";
    host.style.top = y + "px";
    host.style.right = "auto";
    host.style.bottom = "auto";
    host.dataset.pinned = "1";
  });
  function endDrag() {
    if (!drag) return;
    var moved = drag.moved;
    var pid = drag.pointerId;
    drag = null;
    try { chip.releasePointerCapture(pid); } catch (err) {}
    if (moved) {
      state.justDragged = true;
      try {
        localStorage.setItem(POS_KEY, JSON.stringify({ left: parseFloat(host.style.left), top: parseFloat(host.style.top) }));
      } catch (err) {}
      /* 拖完不一定会收到 click（pointercancel / 拖出元素都会漏），
         所以到点自动复位，避免把下一次正常点击吞掉。 */
      setTimeout(function () { state.justDragged = false; }, 350);
    }
  }
  chip.addEventListener("pointerup", endDrag);
  chip.addEventListener("pointercancel", endDrag);
  onWin(window, "pointerup", endDrag, true);
  onWin(window, "blur", endDrag);
  chip.addEventListener("dblclick", function () {
    try { localStorage.removeItem(POS_KEY); } catch (e) {}
    delete host.dataset.pinned;
    attach();
  });

  /* 让底栏宽度刚好停在居中免责声明的左边缘之前 */
  /* 让底栏宽度刚好停在居中免责声明的左边缘之前。
     这里要量免责声明的 Range 和 host 的 rect（两次强制布局），
     而 render 的档位循环会连调 4 次，所以量出来的值缓存起来，
     只在布局真正可能变化时（resize / 重新 attach）才失效。 */
  var availCache = { value: 0, at: 0 };

  /* 可用宽度：取「免责声明左边缘」和「父容器可容纳」两者的较小值。
     免责声明居中，它的左边缘就是统计条能占到的最右边界；但父容器本身
     可能更窄（窄窗口 / 侧栏展开），所以两个约束都要考虑。 */
  function measureAvail() {
    var wrap = host.parentElement;
    if (!wrap) return 0;

    var byDisclaimer = 0;
    var disc = wrap.querySelector(".composer-ai-disclaimer");
    if (disc) {
      try {
        var range = document.createRange();
        range.selectNodeContents(disc);
        var tr = range.getBoundingClientRect();
        var hr = host.getBoundingClientRect();
        /* host 的左边可能因为绝对定位被拉到很远（比如 0），这时用 wrap 的左边界
           作为基准更可靠。取两者中更靠右的那个当起点。 */
        var wrapRect = wrap.getBoundingClientRect();
        var originLeft = Math.max(hr.left, wrapRect.left);
        if (tr.width > 0 && tr.left > originLeft) byDisclaimer = tr.left - originLeft - 14;
      } catch (e) {}
    }

    /* 父容器可用宽度：host 是 absolute 定位，宽度由 bar 的 maxWidth 决定，
       所以不能读 host.clientWidth（那是结果不是约束）。这里用 wrap 全宽减去
       右边距 28px 与左侧留白，得到 bar 最多能占多宽。 */
    var wrapW = wrap.clientWidth || 0;
    var byWrap = wrapW > 0 ? wrapW - 28 - 8 : 0;

    var avail = 0;
    if (byDisclaimer > 0 && byWrap > 0) avail = Math.min(byDisclaimer, byWrap);
    else avail = byDisclaimer || byWrap;

    /* 都没有就退回父容器的一半，保证不会算出 0 */
    if (!avail) avail = (wrapW || 700) * 0.55;

    availCache = { value: Math.max(120, Math.floor(avail)), at: Date.now() };
    return availCache.value;
  }

  function fitBar(force) {
    if (host.dataset.mode !== "inline") {
      bar.style.maxWidth = "";
      return;
    }
    var avail = force || !availCache.value ? measureAvail() : availCache.value;
    bar.style.maxWidth = avail + "px";
  }

  function invalidateFit() {
    availCache.value = 0;
  }

  onWin(window, "resize", function () {
    invalidateFit();
    invalidateWrap();   /* 视口变了，「哪个 composer 最合适」可能也变了 */
    fitBar(true);
  });
  var fitTimer = setTimeout(function () { fitBar(true); }, 400);
  cleanups.push(function () { clearTimeout(fitTimer); });

  /* 依次试档位，取第一个能塞进 budget 的。
     不能用 seg.scrollWidth <= seg.clientWidth 判断：bar 是 flex 容器，
     两个 seg 会被压缩，clientWidth 永远等于 scrollWidth，看起来「放得下」
     其实文字被 ellipsis 截断了。
     做法：临时把本段设为不收缩，量它真实需要的宽度，和 budget 比。 */
  /* 档位选择带记忆。文案每 400ms 变一次，但「该用第几档」几乎不变：
     每次都从最宽松那档开始量，等于每 tick 强制 7 次同步布局
     （24k 节点页面实测）。改成从上次的档位起步、只降不升，
     稳态下每段每帧只量 1 次；预算 / 形态 / 会话变化时由调用方重置记忆，
     退回全量搜索。 */
  var tierMemo = { budget: -1, mode: "", sid: null, stat: 0, tok: 0 };

  function measureTier(seg, textNode, tiers, i) {
    var tier = tiers[i];
    seg.classList.toggle("mm-compact", !!tier.cls);
    textNode.textContent = tier.text || "—";
    seg.style.flex = "0 0 auto";
    var need = seg.scrollWidth;      /* 唯一一次强制布局 */
    seg.style.flex = "";
    return need;
  }

  function applyTiers(seg, textNode, tiers, budget, key, fromZero) {
    var last = tiers.length - 1;
    var i = fromZero ? 0 : Math.min(Math.max(tierMemo[key] | 0, 0), last);
    var need = measureTier(seg, textNode, tiers, i);
    /* 连最紧凑的档都放不下时停在最后一档，靠 ellipsis 兜底 */
    while (need > budget && i < last) {
      i++;
      need = measureTier(seg, textNode, tiers, i);
    }
    tierMemo[key] = i;
    return need;
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    var d = state.data;
    var theme = (document.documentElement.getAttribute("data-theme") || "").toLowerCase();
    if (theme === "dark" || theme === "light") host.setAttribute("data-theme", theme);
    else host.removeAttribute("data-theme");

    if (!d || !d.sid) {
      host.classList.add("mm-idle");
      host.classList.remove("mm-busy");
      if (state.which) setOpen(null);
      return;
    }

    var t = d.tokens || {};
    var total = t.total || 0;

    /* 刚新建、还没开始聊的会话：引擎已经建了 session 记录（所以有 sid），
       但一条消息都没有。这时候显示「— / 0 tok」只是噪音，直接按空闲处理隐藏掉。
       判据用「轮 / 步 / token 全为 0」，只要用户发过一句话（轮>=1）
       或助手跑过一步（步>=1）就正常显示。 */
    var isEmpty = !d.rounds && !d.steps && !total;
    if (isEmpty) {
      host.classList.add("mm-idle");
      host.classList.remove("mm-busy");
      if (state.which) setOpen(null);
      return;
    }
    host.classList.remove("mm-idle");
    var rate = t.read != null && t.read + (t.input || 0) > 0 ? t.read / (t.read + (t.input || 0)) : null;
    host.classList.toggle("mm-busy", !!d.busy);
    approxTag.style.display = d.approx ? "" : "none";

    /* 底栏文案两档：宽松版放不下就切紧凑版（去图标 / 去空格 / 去「命中」） */
    var speed = d.tokPerSec ? (d.tokPerSecApprox ? "≈" : "") + Math.round(d.tokPerSec) + " tok/s" : "";
    var fullLeft = [];
    if (d.rounds) fullLeft.push(d.rounds + " 轮");
    if (d.steps) fullLeft.push(d.steps + " 步");
    var fullLeftTxt = fullLeft.join(" ");
    if (speed) fullLeftTxt += (fullLeftTxt ? " · " : "") + speed;
    var fullRightTxt = compact(total) + " tok" + (rate != null ? " · 命中 " + pct(rate) : "");

    var tightLeft = [];
    if (d.rounds) tightLeft.push(d.rounds + "轮");
    if (d.steps) tightLeft.push(d.steps + "步");
    var tightLeftTxt = tightLeft.join(" ");
    if (speed) tightLeftTxt += (tightLeftTxt ? " · " : "") + speed;
    var tightRightTxt = compact(total) + (rate != null ? " · " + pct(rate) : "");

    /* 两段各自降级：先宽松，放不下就切紧凑，再不行就只留最关键的数字。
       段与段独立，一段变窄不会拖累另一段的文案。 */
    /* 每段都从最宽松排到最紧凑，applyTiers 取第一个塞得下的。
       中间多留几档，避免一步从「6 轮 36 步 · ≈11 tok/s」跳到只剩「36步」。 */
    var statTiers = [
      { cls: "", text: fullLeftTxt },
      { cls: "mm-compact", text: tightLeftTxt },
      { cls: "mm-compact", text: (d.steps ? d.steps + "步" : String(d.rounds || 0) + "轮") + (speed ? " · " + speed : "") },
      { cls: "mm-compact", text: (d.steps ? d.steps + "步" : "") + (speed ? " · " + Math.round(d.tokPerSec) + "/s" : "") },
      { cls: "mm-compact", text: d.steps ? d.steps + "步" : "" },
    ];
    var tokTiers = [
      { cls: "", text: fullRightTxt },
      { cls: "mm-compact", text: tightRightTxt },
      { cls: "mm-compact", text: compact(total) + (rate != null ? " · " + pct(rate) : "") },
      { cls: "mm-compact", text: rate != null ? pct(rate) : compact(total) },
    ];

    /* 两段共享同一个可用宽度：先各按「一半预算」降级，若某段用不满就把余量
       让给另一段。fitBar 只读 availCache，本身不做测量。 */
    fitBar();
    var budget = availCache.value || 240;
    /* 预算 / 形态 / 会话变了，「该用第几档」才真的会变 —— 这时才重置记忆 */
    var fresh = tierMemo.budget !== budget ||
                tierMemo.mode !== host.dataset.mode ||
                tierMemo.sid !== d.sid;
    if (fresh) {
      tierMemo.budget = budget;
      tierMemo.mode = host.dataset.mode;
      tierMemo.sid = d.sid;
      tierMemo.stat = 0;
      tierMemo.tok = 0;
    }
    var gapW = 12;                       /* .mm-bar 的 gap */
    var usable = Math.max(120, budget - gapW);

    /* 第一轮：各给一半预算，让放不下的那一段降级 */
    var half = Math.max(56, Math.floor(usable / 2));
    var wStat = applyTiers(segRounds, roundsTxt, statTiers, half, "stat");
    var wTok = applyTiers(segTok, tokTxt, tokTiers, half, "tok");

    /* 第二轮：如果两段加起来还有余量，就让后一段升回更宽松的档。
       稳态下记忆已经收敛，这一步不可能改变结果，只在重置后跑一次。 */
    if (fresh && wStat + wTok < usable) {
      wTok = applyTiers(segTok, tokTxt, tokTiers, usable - wStat, "tok", true);
    }

    /* 胶囊（兜底形态） */
    var parts = [];
    if (d.steps) parts.push(d.steps + " 步");
    parts.push(compact(total) + " tok");
    parts.push(rate == null ? "—" : pct(rate));
    chipText.textContent = parts.join(" · ");

    /* 卡片 */
    totalEl.textContent = fmt(total) + " tok";
    if (d.title) {
      subEl.textContent = d.title;
      subEl.style.display = "";
    } else {
      subEl.style.display = "none";
    }
    rHit.v.textContent = pct(rate);
    rIn.v.textContent = fmt(t.input) + " tok";
    rRead.v.textContent = fmt(t.read) + " tok";
    rOut.v.textContent = fmt(t.output) + " tok";
    rWrite.row.style.display = t.write ? "" : "none";
    if (t.write) rWrite.v.textContent = fmt(t.write) + " tok";
    rRea.row.style.display = t.reasoning ? "" : "none";
    if (t.reasoning) rRea.v.textContent = fmt(t.reasoning) + " tok";

    footLeft.textContent = (d.rounds || 0) + " 轮 · " + (d.steps || 0) + " 步";
    /* 金额：优先用主进程换算好的 costCny；showCny=false 时退回引擎原值（美元）。
       两者都没有就整行留空。 */
    var sym = d.currency || "¥";
    var money = d.costCny != null ? d.costCny : (d.cost != null ? d.cost : null);
    footRight.textContent = money == null
      ? ""
      : sym + (Math.abs(money) >= 0.1 ? money.toFixed(2) : money.toFixed(3));

    var tm = d.timing || {};
    tModel.v.textContent = fmtDur(tm.modelMs);
    tTool.v.textContent = fmtDur(tm.toolMs);
    tTtft.v.textContent = fmtSec(tm.ttftMs);
    tTps.v.textContent = tm.tps
      ? (tm.tpsApprox ? "≈" : "") + Math.round(tm.tps) + " tok/s"
      : "—";

    costLine.textContent = d.model || "";
    costLine.style.display = d.model ? "" : "none";
  }

  /* ---------------- 拆除 ---------------- */
  var destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (reattachTimer) {
      clearTimeout(reattachTimer);
      reattachTimer = null;
    }
    if (placeRaf) {
      cancelAnimationFrame(placeRaf);
      placeRaf = 0;
    }
    for (var i = 0; i < cleanups.length; i++) {
      try { cleanups[i](); } catch (e) {}
    }
    cleanups.length = 0;
    try { host.remove(); } catch (e) {}
    /* 还原 fetch（只在顶层 wrapper 还是我们那次时还原，避免踩别人） */
    try {
      if (window.fetch && window.fetch.__mimoMeterOrig) {
        window.fetch = window.fetch.__mimoMeterOrig;
        window.__mimoMeterFetchPatched = false;
      }
    } catch (e) {}
  }

  /* ---------------- 对外 API ---------------- */
  window.__MIMO_METER__ = {
    version: VERSION,
    update: function (payload) {
      try {
        state.data = payload;
        render();
      } catch (e) {}
    },
    onSid: function (sid) {
      /* 备用信号：主进程会从 probe() 读到 window.__mimoMeterSid，
         这里只需要保证它被记录下来（fetch patch 已写入）。 */
      try {
        if (typeof sid === "string" && sid) window.__mimoMeterSid = sid;
      } catch (e) {}
    },
    destroy: destroy,
    probe: function () {
      var view = currentView();
      var sid = window.__mimoMeterSid || null;
      /* 顶栏文本只用于「有会话页但没有 sid」时的标题反查，
         其它情况一律不扫 DOM（24k 节点实测 9ms/次）。
         主进程每 900ms 探一次，这里再缓存 3s：这是最后兜底信号，
         晚几秒发现标题没有任何影响。 */
      var texts = [];
      if (!sid && view === "thread") {
        var now = Date.now();
        if (now - headerCache.at > 3000) {
          headerCache = { at: now, texts: headerTexts() };
        }
        texts = headerCache.texts;
      }
      return {
        version: VERSION,
        sid: sid,
        view: view,
        headerTexts: texts,
        open: !!state.which,
        openPanel: state.which,
        mounted: true,
      };
    },
  };

  render();
  /* 首次挂载必须显式调用：以前只靠 MutationObserver 触发，而 render() 写
     textContent 恰好会产生一条 childList 记录，于是"能跑"——但这是巧合。
     一旦某次 render 走 idle 分支（只改 class），就没有任何回调，
     浮层会一直停在右下角胶囊形态。 */
  attach();
})();
