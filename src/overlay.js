/* mimo-meter overlay —— 注入 MiMo 渲染进程的统计浮层
 *
 * 两种形态：
 *   inline —— 优先：绝对定位嵌进 .composer-wrap，与「内容由 AI 生成」同一行，
 *             右边一段「2 轮 165 步 · 191 tok/s | 69.6M tok · 缓存命中 99%」。
 *   float  —— 兜底：找不到 composer 时退回右下角胶囊。
 *
 * 由 engine-config/mimo-meter.mjs 通过 webContents.executeJavaScript 注入；
 * 幂等：重复注入只刷新版本，不堆 DOM。
 */
(function () {
  var VERSION = "2.0.0";
  var HOST_ID = "mimo-meter-host";

  var prev = window.__MIMO_METER__;
  if (prev && prev.version === VERSION && document.getElementById(HOST_ID)) return;

  /* ---------------- 会话 id 捕获（备用信号；主信号在主进程桥拦截里） ---------------- */
  if (!window.__mimoMeterFetchPatched) {
    window.__mimoMeterFetchPatched = true;
    var origFetch = window.fetch;
    if (typeof origFetch === "function") {
      window.fetch = function (input) {
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

  /* --- 卡片 --- */
  var panel = el("div", "mm-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Token 用量");

  var head = el("div", "mm-head");
  head.appendChild(el("span", "mm-ico", "◈"));
  head.appendChild(el("span", "mm-title", "Token 用量"));
  var totalEl = el("span", "mm-total", "—");
  head.appendChild(totalEl);

  var subEl = el("div", "mm-sub", "");
  var rule1 = el("div", "mm-rule");

  function row(label) {
    var r = el("div", "mm-row");
    r.appendChild(el("span", "mm-k", label));
    var v = el("span", "mm-v", "—");
    r.appendChild(v);
    panel.appendChild(r);
    return { row: r, v: v };
  }

  panel.appendChild(head);
  panel.appendChild(subEl);
  panel.appendChild(rule1);
  var rHit = row("缓存命中");
  var rIn = row("未缓存输入");
  var rRead = row("缓存读取");
  var rWrite = row("缓存写入");
  var rOut = row("输出");
  var rRea = row("推理（含在总量）");

  panel.appendChild(el("div", "mm-rule"));
  var foot = el("div", "mm-foot");
  var footLeft = el("span", "mm-foot-l", "—");
  var footRight = el("span", "mm-foot-r", "—");
  foot.appendChild(footLeft);
  foot.appendChild(footRight);
  panel.appendChild(foot);
  var costLine = el("div", "mm-cost", "");
  panel.appendChild(costLine);

  panel.appendChild(el("div", "mm-rule"));
  var head2 = el("div", "mm-head mm-head2");
  head2.appendChild(el("span", "mm-ico", "◈"));
  head2.appendChild(el("span", "mm-title", "会话统计"));
  panel.appendChild(head2);
  var tModel = row("模型用时");
  var tTool = row("工具调用用时");
  var tTtft = row("首 token 平均（TTFT）");
  var tTps = row("输出速度（TPS）");

  /* --- 底栏内嵌条 --- */
  var bar = el("div", "mm-bar");
  bar.setAttribute("role", "button");
  bar.setAttribute("tabindex", "0");
  bar.setAttribute("aria-expanded", "false");
  bar.title = "Token 用量 / 步数 / 缓存命中（点击或 ⌥⌘T 展开）";

  var segRounds = el("span", "mm-seg");
  segRounds.appendChild(svg(["M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z", "M8 5v3.2l2.2 1.4"]));
  var roundsTxt = el("span", "mm-seg-t", "—");
  segRounds.appendChild(roundsTxt);

  var segTok = el("span", "mm-seg");
  segTok.appendChild(svg(["M2.9 4.1c0-1.1 2.3-2 5.1-2s5.1.9 5.1 2-2.3 2-5.1 2-5.1-.9-5.1-2z", "M2.9 4.1v7.4c0 1.1 2.3 2 5.1 2s5.1-.9 5.1-2V4.1", "M2.9 7.8c0 1.1 2.3 2 5.1 2s5.1-.9 5.1-2"]));
  var tokTxt = el("span", "mm-seg-t", "—");
  segTok.appendChild(tokTxt);

  var approxTag = el("span", "mm-approx", "最近");

  segRounds.insertBefore(approxTag, segRounds.firstChild);
  bar.appendChild(segRounds);
  bar.appendChild(segTok);

  /* --- 兜底胶囊 --- */
  var chip = el("button", "mm-chip");
  chip.type = "button";
  chip.title = bar.title;
  var dot = el("span", "mm-dot");
  var chipText = el("span", "mm-chip-text", "Token 用量");
  chip.appendChild(dot);
  chip.appendChild(chipText);

  host.appendChild(panel);
  host.appendChild(bar);
  host.appendChild(chip);
  document.body.appendChild(host);

  /* ---------------- 挂载：优先塞进 composer 底部那一行 ---------------- */
  function pickComposerWrap() {
    var list = Array.prototype.slice.call(document.querySelectorAll(".composer-wrap"));
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (r.width > 240 && r.height > 40) best = list[i];
    }
    return best;
  }

  function setPos(kind) {
    var st = host.style;
    st.transform = "";
    st.marginTop = "";
    if (kind === "stack") {
      /* 侧栏底栏：静态流内，左对齐两行 */
      st.position = "static";
      st.left = "auto";
      st.right = "auto";
      st.top = "auto";
      st.bottom = "auto";
      st.transform = "";
      st.marginBottom = "2px";
      st.width = "100%";
    } else if (kind === "disc") {
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

  function pickSideFooter() {
    var list = Array.prototype.slice.call(document.querySelectorAll(".side-bottom"));
    for (var i = list.length - 1; i >= 0; i--) {
      var n = list[i];
      var r = n.getBoundingClientRect();
      if (r.width >= 150 && r.height >= 20 && n.offsetParent !== null) return n;
    }
    return null;
  }

  function attach() {
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
        return true;
      }
      var holder = wrap.parentElement || wrap;
      var row = holder.nextElementSibling;
      if (row && row.classList && row.classList.contains("scope-chips")) {
        if (host.parentElement !== row) row.appendChild(host);
        row.style.position = "relative";
        setPos("chips");
        return true;
      }
      if (host.parentElement !== holder) holder.appendChild(host);
      holder.style.position = "relative";
      setPos("below");
      return true;
    }
    if (host.parentElement !== document.body) document.body.appendChild(host);
    host.dataset.mode = "float";
    setPos("float");
    return false;
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
  try {
    var mo = new MutationObserver(scheduleAttach);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  /* ---------------- 交互 ---------------- */
  var state = { open: false, sid: null, data: null, justDragged: false };

  function placePanel() {
    /* 相对 host 定位（布局坐标系），避开页面 zoom / DPR 换算 */
    var st = panel.style;
    st.position = "absolute";
    st.left = "auto";
    st.top = "auto";
    if (host.dataset.mode === "inline") {
      st.left = "0";
      st.right = "auto";
    } else {
      st.left = "auto";
      st.right = "0";
    }
    st.bottom = "100%";
    st.marginBottom = "9px";
    /* 窗口矮的时候别把卡片顶出屏幕 */
    var avail = host.getBoundingClientRect().top - 16;
    if (avail > 160) {
      st.maxHeight = Math.min(avail, window.innerHeight - 40) + "px";
      st.overflowY = "auto";
    }
  }

  function setOpen(v) {
    state.open = !!v;
    if (state.open) placePanel();
    host.classList.toggle("mm-open", state.open);
    bar.setAttribute("aria-expanded", state.open ? "true" : "false");
    chip.setAttribute("aria-expanded", state.open ? "true" : "false");
  }

  window.addEventListener("resize", function () {
    if (state.open) placePanel();
  });
  document.addEventListener("scroll", function () {
    if (state.open) placePanel();
  }, true);

  function bindToggle(node) {
    node.addEventListener("click", function (e) {
      e.stopPropagation();
      if (state.justDragged) {
        state.justDragged = false;
        return;
      }
      if (!state.data || !state.data.sid) return;
      setOpen(!state.open);
    });
  }
  bindToggle(bar);
  bindToggle(chip);
  bar.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(!state.open);
    }
  });
  panel.addEventListener("click", function (e) {
    e.stopPropagation();
  });
  document.addEventListener("pointerdown", function (e) {
    if (state.open && !host.contains(e.target)) setOpen(false);
  }, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.open) {
      setOpen(false);
      return;
    }
    /* ⌥⌘T：开合统计卡片 */
    if (e.altKey && e.metaKey && !e.ctrlKey && (e.key === "t" || e.key === "T" || e.code === "KeyT")) {
      if (!state.data || !state.data.sid) return;
      e.preventDefault();
      setOpen(!state.open);
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
    }
  }
  chip.addEventListener("pointerup", endDrag);
  chip.addEventListener("pointercancel", endDrag);
  window.addEventListener("pointerup", endDrag, true);
  window.addEventListener("blur", endDrag);
  chip.addEventListener("dblclick", function () {
    try { localStorage.removeItem(POS_KEY); } catch (e) {}
    delete host.dataset.pinned;
    attach();
  });

  /* 让底栏宽度刚好停在居中免责声明的左边缘之前 */
  function fitBar() {
    if (host.dataset.mode !== "inline") {
      bar.style.maxWidth = "";
      return;
    }
    var wrap = host.parentElement;
    if (!wrap) return;
    var disc = wrap.querySelector(".composer-ai-disclaimer");
    var avail = 0;
    if (disc) {
      try {
        var range = document.createRange();
        range.selectNodeContents(disc);
        var tr = range.getBoundingClientRect();
        var hr = host.getBoundingClientRect();
        if (tr.width > 0 && tr.left > hr.left) avail = tr.left - hr.left - 14;
      } catch (e) {}
    }
    if (!avail) avail = (wrap.clientWidth || 700) * 0.55;
    bar.style.maxWidth = Math.max(120, Math.floor(avail)) + "px";
  }

  window.addEventListener("resize", fitBar);
  setTimeout(fitBar, 400);

  /* ---------------- 渲染 ---------------- */
  function render() {
    var d = state.data;
    var theme = (document.documentElement.getAttribute("data-theme") || "").toLowerCase();
    if (theme === "dark" || theme === "light") host.setAttribute("data-theme", theme);
    else host.removeAttribute("data-theme");

    if (!d || !d.sid) {
      host.classList.add("mm-idle");
      host.classList.remove("mm-busy");
      if (state.open) setOpen(false);
      return;
    }
    host.classList.remove("mm-idle");

    var t = d.tokens || {};
    var total = t.total || 0;
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

    /* 三档：宽松 → 紧凑（去图标/去空格）→ 极简（只留步数+命中率） */
    var tiers = [
      { cls: "", left: fullLeftTxt, right: fullRightTxt },
      { cls: "mm-compact", left: tightLeftTxt, right: tightRightTxt },
      {
        cls: "mm-compact",
        left: (d.steps ? d.steps + "步" : String(d.rounds || 0) + "轮") + (speed ? " · " + speed : ""),
        right: rate != null ? pct(rate) : compact(total),
      },
      {
        cls: "mm-compact",
        left: d.steps ? d.steps + "步" : "",
        right: rate != null ? pct(rate) : compact(total),
      },
    ];
    for (var ti = 0; ti < tiers.length; ti++) {
      host.classList.toggle("mm-compact", !!tiers[ti].cls);
      roundsTxt.textContent = tiers[ti].left || "—";
      tokTxt.textContent = tiers[ti].right || "";
      fitBar();
      if (bar.scrollWidth <= bar.clientWidth + 1) break;
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

    fitBar();
    footLeft.textContent = (d.rounds || 0) + " 轮 · " + (d.steps || 0) + " 步";
    footRight.textContent = d.costCny
      ? "¥" + (d.costCny >= 0.1 ? d.costCny.toFixed(2) : d.costCny.toFixed(3))
      : "";

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

  /* ---------------- 对外 API ---------------- */
  window.__MIMO_METER__ = {
    version: VERSION,
    update: function (payload) {
      try {
        if (payload && payload.sid) state.sid = payload.sid;
        state.data = payload;
        render();
      } catch (e) {}
    },
    onSid: function (sid) {
      state.sid = sid;
    },
    probe: function () {
      return {
        version: VERSION,
        sid: window.__mimoMeterSid || null,
        view: currentView(),
        headerTexts: headerTexts(),
        open: state.open,
        mounted: true,
      };
    },
  };

  render();
})();
