// mimo-meter.mjs — MiMo Desktop 「Token 用量 / 步数 / 缓存命中」浮层插件
//
// 挂载方式：在 engine-config/mimocode.jsonc 的 plugin 数组里登记本文件（file:// URL）。
// 运行位置：引擎被 desktop 主进程直接 import（runtime-res/releases/main/main~*.mjs），
//           所以本插件跑在 Electron 主进程里，可直接拿 electron 模块。
//
// 三件事：
//   1. 数据：读 mimocode.db（mac/Linux: ~/.local/share/mimocode/，Windows: %LOCALAPPDATA%\mimocode\；
//      message / part 表，WAL 只读），
//      统计当前会话的 轮 / 步 / token 分布 / 缓存命中率。
//   2. 实时：hook.event 订阅引擎总线（message.updated、message.part.updated、
//      metrics.model_call、session.idle…），脏标记 + 400ms 合并刷新。
//   3. UI：webContents.insertCSS + executeJavaScript 往窗口里注入浮层，
//      再用 window.__MIMO_METER__.update(payload) 推数据。
//
// 不改 app.asar、不改 runtime 文件、不动代码签名；卸载 = 删本文件 + 从 jsonc 移除登记。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const VERSION = "2.0.0";
const TICK_MS = 400;
const SID_POLL_MS = 900;

const HOME = os.homedir();
const PLATFORM = process.platform; // darwin / win32 / linux

/* Electron userData：mac ~/Library/Application Support、win %APPDATA%、linux ~/.config */
function appDataRoot() {
  if (PLATFORM === "win32") {
    return path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "Xiaomi MiMo");
  }
  if (PLATFORM === "darwin") return path.join(HOME, "Library", "Application Support", "Xiaomi MiMo");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, ".config"), "Xiaomi MiMo");
}

/* 我们自己的日志/指标目录 */
function logRoot() {
  if (PLATFORM === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local"), "mimo-meter");
  }
  if (PLATFORM === "darwin") return path.join(HOME, "Library", "Logs", "mimo-meter");
  return path.join(process.env.XDG_STATE_HOME || path.join(HOME, ".local", "state"), "mimo-meter");
}
const LOG_FILE = path.join(logRoot(), "mimo-meter.log");

function log(...args) {
  try {
    const dir = path.dirname(LOG_FILE);
    fs.mkdirSync(dir, { recursive: true });
    try {
      if (fs.statSync(LOG_FILE).size > 1_000_000) fs.renameSync(LOG_FILE, LOG_FILE + ".1");
    } catch {}
    const line = `[${new Date().toISOString()}] ${args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")}\n`;
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}

/* ------------------------------------------------------------------ 路径 */

function dbCandidates() {
  const out = [];
  const push = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };
  if (process.env.XDG_DATA_HOME) push(path.join(process.env.XDG_DATA_HOME, "mimocode", "mimocode.db"));
  if (process.env.XDG_STATE_HOME) push(path.join(process.env.XDG_STATE_HOME, "mimocode.db"));
  if (PLATFORM === "win32") {
    if (process.env.LOCALAPPDATA) push(path.join(process.env.LOCALAPPDATA, "mimocode", "mimocode.db"));
    if (process.env.APPDATA) push(path.join(process.env.APPDATA, "mimocode", "mimocode.db"));
    if (process.env.USERPROFILE) push(path.join(process.env.USERPROFILE, ".local", "share", "mimocode", "mimocode.db"));
  }
  push(path.join(HOME, ".local", "share", "mimocode", "mimocode.db"));
  push(path.join(appDataRoot(), "mimocode.db"));
  return out;
}

const METRICS_FILE = path.join(logRoot(), "metrics.json");

/* 引擎只在事件里给 TTFT / latency，不落库，所以自己记一份按会话聚合的 */
let metricStore = null;
let metricSaveTimer = null;

function loadMetrics() {
  if (metricStore) return metricStore;
  try {
    metricStore = JSON.parse(fs.readFileSync(METRICS_FILE, "utf8")) || {};
  } catch {
    metricStore = {};
  }
  return metricStore;
}

function saveMetricsSoon() {
  if (metricSaveTimer) return;
  metricSaveTimer = setTimeout(() => {
    metricSaveTimer = null;
    try {
      fs.mkdirSync(path.dirname(METRICS_FILE), { recursive: true });
      fs.writeFileSync(METRICS_FILE, JSON.stringify(metricStore));
    } catch {}
  }, 2000);
  if (metricSaveTimer.unref) metricSaveTimer.unref();
}

function addModelCall(sid, out, latencyMs, ttftMs, decodeMs) {
  const store = loadMetrics();
  const cur = store[sid] || { calls: 0, out: 0, latency: 0, ttft: 0, decode: 0, at: 0 };
  cur.calls += 1;
  cur.out += out;
  cur.latency += latencyMs;
  cur.ttft += ttftMs;
  cur.decode += decodeMs;
  cur.at = Date.now();
  store[sid] = cur;
  /* 只留最近 200 个会话，别让文件无限长 */
  const keys = Object.keys(store);
  if (keys.length > 200) {
    keys
      .sort((a, b) => (store[a].at || 0) - (store[b].at || 0))
      .slice(0, keys.length - 200)
      .forEach((k) => delete store[k]);
  }
  saveMetricsSoon();
}

const overlayJsPath = () => safePath("./mimo-meter-overlay.js");
const overlayCssPath = () => safePath("./mimo-meter-overlay.css");

function safePath(rel) {
  try {
    return fileURLToPath(new URL(rel, import.meta.url));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ 统计 */

let DatabaseSync = null;
async function getSqlite() {
  if (DatabaseSync) return DatabaseSync;
  try {
    const mod = process.getBuiltinModule?.("node:sqlite") ?? (await import("node:sqlite"));
    DatabaseSync = mod?.DatabaseSync ?? null;
  } catch (err) {
    log("sqlite unavailable", String(err?.message || err));
    DatabaseSync = null;
  }
  return DatabaseSync;
}

let db = null;
let dbPath = null;

async function openDb() {
  if (db) return db;
  const SQL = await getSqlite();
  if (!SQL) return null;
  for (const candidate of dbCandidates()) {
    try {
      if (!fs.existsSync(candidate)) continue;
      db = new SQL(candidate, { readOnly: true });
      dbPath = candidate;
      log("db opened", candidate);
      return db;
    } catch (err) {
      log("db open failed", candidate, String(err?.message || err));
    }
  }
  return null;
}

const Q_SESSION = `
SELECT
  s.title                              AS title,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='user' THEN 1 ELSE 0 END),0)      AS rounds,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant' THEN 1 ELSE 0 END),0)   AS assistants,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant'
               THEN json_extract(m.data,'$.tokens.input') END),0)      AS t_input,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant'
               THEN json_extract(m.data,'$.tokens.output') END),0)     AS t_output,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant'
               THEN json_extract(m.data,'$.tokens.reasoning') END),0)  AS t_reasoning,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant'
               THEN json_extract(m.data,'$.tokens.cache.read') END),0)  AS t_cache_read,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant'
               THEN json_extract(m.data,'$.tokens.cache.write') END),0) AS t_cache_write,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant'
               THEN json_extract(m.data,'$.cost') END),0)              AS cost,
  MAX(CASE WHEN json_extract(m.data,'$.role')='assistant'
           THEN json_extract(m.data,'$.modelID') END)                  AS model,
  COALESCE(SUM(CASE WHEN json_extract(m.data,'$.role')='assistant'
                     AND json_extract(m.data,'$.time.completed') IS NOT NULL
               THEN json_extract(m.data,'$.time.completed') - json_extract(m.data,'$.time.created')
               ELSE 0 END),0)                                        AS model_ms,
  MAX(m.time_created)                                                  AS last_at,
  MIN(m.time_created)                                                  AS first_at
FROM session s
LEFT JOIN message m ON m.session_id = s.id
WHERE s.id = ?
GROUP BY s.id
`;

const Q_RECENT = `
SELECT id FROM session
WHERE time_archived IS NULL
ORDER BY time_updated DESC
LIMIT 1
`;

const Q_TITLE = `
SELECT id FROM session
WHERE title = ?
ORDER BY time_updated DESC
LIMIT 1
`;

const Q_TOOLS = `
SELECT COALESCE(SUM(json_extract(data,'$.state.time.end') - json_extract(data,'$.state.time.start')),0) AS tool_ms
FROM part
WHERE session_id = ?
  AND json_extract(data,'$.type') = 'tool'
  AND json_extract(data,'$.state.time.end') IS NOT NULL
`;

const Q_STEPS = `
SELECT COUNT(*) AS steps
FROM part
WHERE session_id = ?
  AND json_extract(data,'$.type') = 'step-finish'
`;

function readSessionStats(sid) {
  if (!db || !sid) return null;
  try {
    const row = db.prepare(Q_SESSION).get(sid);
    if (!row) return null;
    let steps = 0;
    try {
      steps = db.prepare(Q_STEPS).get(sid)?.steps ?? 0;
    } catch (err) {
      log("steps query failed", String(err?.message || err));
    }
    if (!steps) steps = row.assistants || 0;

    let toolMs = 0;
    try {
      toolMs = num(db.prepare(Q_TOOLS).get(sid)?.tool_ms);
    } catch (err) {
      log("tool time query failed", String(err?.message || err));
    }
    const modelMs = num(row.model_ms);

    /* TTFT / TPS 只能来自我们自己记的 metrics（引擎不落库） */
    const m = loadMetrics()[sid] || null;
    const ttftMs = m && m.calls > 0 ? m.ttft / m.calls : null;
    const tps = null; /* 由 pickTps 统一填 */

    const input = num(row.t_input);
    const output = num(row.t_output);
    const reasoning = num(row.t_reasoning);
    const read = num(row.t_cache_read);
    const write = num(row.t_cache_write);
    return {
      sid,
      title: row.title ?? null,
      model: row.model ?? null,
      rounds: num(row.rounds),
      steps: num(steps),
      tokens: {
        /* 与引擎 tokens.total 完全同口径（59 条 step-finish 逐条验证，偏差 0）：
           input + output + reasoning + cache.read + cache.write */
        total: input + output + reasoning + read + write,
        input,
        output,
        reasoning,
        read,
        write,
      },
      cost: num(row.cost) || null,
      timing: { modelMs, toolMs, ttftMs, tps },
      firstAt: num(row.first_at) || null,
      lastAt: num(row.last_at) || null,
    };
  } catch (err) {
    log("stats query failed", String(err?.message || err));
    return null;
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------ 全局状态 */

const GLOBAL_KEY = "__MIMO_METER_ENGINE__";

function engineState() {
  if (globalThis[GLOBAL_KEY]) return globalThis[GLOBAL_KEY];
  const s = {
    version: VERSION,
    dirty: false,
    lastPushedSid: undefined,
    busy: new Map(), // sid -> bool
    rates: new Map(), // sid -> [{at, rate}]
    pageSid: null,     // 页面真实展示的会话（权威，来自桥拦截）
    pageView: null,    // home / thread / unknown
    currency: "¥",     // 面板主显示用人民币（引擎原值仍是美元）
    fx: 1 / 0.14,      // 官方人民币价 ÷ 0.14 → 换算回人民币
    showCny: true,
    bridgeHooked: false,
    activeSid: null, // 兼容旧字段，不再使用
    lastPush: 0,
    windows: new WeakMap(), // webContents -> { cssKey }
    pollTimer: null,
    tickTimer: null,
    electron: null,
    overlayJs: null,
    overlayCss: null,
    started: false,
    log: log,
  };
  globalThis[GLOBAL_KEY] = s;
  return s;
}

/* ------------------------------------------------------------------ Electron */

async function loadElectron() {
  const st = engineState();
  if (st.electron) return st.electron;
  try {
    const e = await import("electron");
    if (e?.BrowserWindow) {
      st.electron = e;
      return e;
    }
  } catch (err) {
    log("electron import failed", String(err?.message || err));
  }
  return null;
}

function readAsset(p, fallback) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (err) {
    log("asset read failed", p, String(err?.message || err));
    return fallback;
  }
}

async function ensureAssets(st) {
  if (!st.overlayJs) st.overlayJs = readAsset(overlayJsPath(), "");
  if (!st.overlayCss) st.overlayCss = readAsset(overlayCssPath(), "");
  if (!st.overlayVersion) {
    const m = /var VERSION = "([^"]+)"/.exec(st.overlayJs || "");
    st.overlayVersion = m ? m[1] : "unknown";
  }
}

function isAppWindow(win) {
  try {
    const url = win.webContents.getURL() || "";
    return url.includes("/renderer/static/index.html") || url.startsWith("app://");
  } catch {
    return false;
  }
}

async function injectWindow(st, win) {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (!isAppWindow(win)) return;
  try {
    const cur = st.windows.get(wc) || {};
    /* 每次文档重载 / 版本变化都要重新插样式（insertCSS 不跨导航存活） */
    if (st.overlayCss && cur.version !== st.overlayVersion) {
      if (cur.cssKey) await wc.removeInsertedCSS(cur.cssKey).catch(() => {});
      const key = await wc.insertCSS(st.overlayCss);
      st.windows.set(wc, { ...cur, cssKey: key, version: st.overlayVersion });
    }
    if (st.overlayJs) await wc.executeJavaScript(st.overlayJs, true);
    st.windows.set(wc, { ...(st.windows.get(wc) || {}), injectedAt: Date.now() });
  } catch (err) {
    log("inject failed", String(err?.message || err));
  }
}

async function injectAll(st) {
  const e = st.electron;
  if (!e) return;
  for (const win of e.BrowserWindow.getAllWindows()) await injectWindow(st, win);
}

async function pushPayload(st, payload) {
  const e = st.electron;
  if (!e) return;
  const js = `window.__MIMO_METER__ && window.__MIMO_METER__.update(${JSON.stringify(payload)});`;
  for (const win of e.BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (!isAppWindow(win)) continue;
    try {
      await win.webContents.executeJavaScript(js, true);
    } catch (err) {
      /* 页面正在导航/重载时忽略 */
    }
  }
}

async function pollSid(st) {
  const e = st.electron;
  if (!e) return;
  for (const win of e.BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || !isAppWindow(win)) continue;
    try {
      const r = await win.webContents.executeJavaScript(
        "window.__MIMO_METER__ ? window.__MIMO_METER__.probe() : null",
        true,
      );
      if (!r || !r.mounted) {
        st.pageSid = null;
        await injectWindow(st, win);
        continue;
      }
      if (r.view && r.view !== st.pageView) {
        st.pageView = r.view;
        if (r.view === "home") st.pageSid = null;
        st.dirty = true;
        await refresh(st, { force: true });
      }
      if (!r.sid && r.view === "thread" && r.headerTexts && r.headerTexts.length) {
        const byTitle = sidByTitle(st, r.headerTexts);
        if (byTitle && byTitle !== st.pageSid) {
          st.pageSid = byTitle;
          st.dirty = true;
          log("pageSid by title ->", byTitle);
          await refresh(st, { force: true });
        }
      }
      if (r.sid && r.sid !== st.pageSid) {
        st.pageSid = r.sid;
        st.dirty = true;
        await refresh(st, { force: true });
      }
    } catch {}
  }
}

/* ------------------------------------------------------------------ 实时指标 */

function noteModelCall(st, props) {
  const sid = props?.sessionID;
  if (!sid) return;
  const out = num(props.total_tokens_out);
  const latency = num(props.latency_ms);
  const ttft = num(props.ttft_ms);
  if (!out || !latency) return;
  const decodeMs = Math.max(latency - ttft, latency * 0.2, 1);
  const rate = out / (decodeMs / 1000);
  if (!Number.isFinite(rate) || rate <= 0) return;
  const list = st.rates.get(sid) || [];
  list.push({ at: Date.now(), rate });
  while (list.length > 6) list.shift();
  st.rates.set(sid, list);
  addModelCall(sid, out, latency, ttft, decodeMs);
  st.dirty = true;
}

/* TPS 取值链：实时采样 → 自己记的解码速度 → 总输出/模型总耗时（近似） */
function pickTps(st, sid, stats) {
  const live = currentRate(st, sid);
  if (live) return { value: live, approx: false };

  const m = loadMetrics()[sid];
  if (m && m.decode > 0 && m.out > 0) return { value: m.out / (m.decode / 1000), approx: false };

  const out = stats && stats.tokens ? stats.tokens.output : 0;
  const modelMs = stats && stats.timing ? stats.timing.modelMs : 0;
  if (out > 0 && modelMs > 0) return { value: out / (modelMs / 1000), approx: true };

  return { value: null, approx: false };
}

function currentRate(st, sid) {
  const list = st.rates.get(sid);
  if (!list || !list.length) return null;
  const now = Date.now();
  const fresh = list.filter((x) => now - x.at < 20_000);
  if (!fresh.length) return null;
  return fresh.reduce((a, x) => a + x.rate, 0) / fresh.length;
}

function sidOf(props) {
  return props?.sessionID || props?.info?.sessionID || props?.part?.sessionID || null;
}

/* ------------------------------------------------------------------ 刷新 */

function sidByTitle(st, texts) {
  if (!db || !Array.isArray(texts) || !texts.length) return null;
  const key = texts.join("|");
  if (st.titleCache && st.titleCache.key === key) return st.titleCache.sid;
  let sid = null;
  for (const text of texts) {
    if (typeof text !== "string" || !text.trim()) continue;
    try {
      const row = db.prepare(Q_TITLE).get(text.trim());
      if (row && row.id) {
        sid = row.id;
        break;
      }
    } catch {}
  }
  st.titleCache = { key, sid };
  return sid;
}

function displaySid(st) {
  /* 桥抓到会话 = 正在看会话，直接用（哪怕视图判定失败） */
  if (st.pageSid) return st.pageSid;
  /* 只有确认在会话页，才拿「最近会话」兜底；首页 / 未探测到视图一律不显示 */
  if (st.pageView !== "thread") return null;
  return recentSid(st);
}

function recentSid(st) {
  const now = Date.now();
  if (st.recentSidCache && now - st.recentSidCache.at < 5000) return st.recentSidCache.sid;
  let sid = null;
  try {
    sid = db?.prepare(Q_RECENT).get()?.id ?? null;
  } catch (err) {
    log("recent sid failed", String(err?.message || err));
  }
  st.recentSidCache = { at: now, sid };
  return sid;
}

async function refresh(st, { force = false } = {}) {
  const sid = displaySid(st);
  if (!sid) {
    /* 没有会话：推空载荷，让前端整条隐藏 */
    if (st.lastPushedSid !== null) {
      st.lastPushedSid = null;
      await pushPayload(st, { sid: null, ts: Date.now(), version: VERSION });
    }
    return;
  }
  if (st.lastPushedSid !== sid) st.lastPushedSid = sid;
  const approx = !st.pageSid;

  if (!force && !st.dirty && !currentRate(st, sid) && Date.now() - st.lastPush < 2500) return;
  st.dirty = false;
  st.lastPush = Date.now();

  const stats = readSessionStats(sid);
  const payload = stats
    ? { ...stats }
    : {
        sid,
        title: null,
        model: null,
        rounds: 0,
        steps: 0,
        tokens: { total: 0, input: 0, output: 0, reasoning: 0, read: 0, write: 0 },
        cost: null,
      };
  const tps = pickTps(st, sid, payload);
  payload.currency = st.currency;
  payload.costCny = st.showCny && payload.cost ? payload.cost * st.fx : null;
  payload.busy = !!st.busy.get(sid);
  payload.tokPerSec = tps.value;
  payload.tokPerSecApprox = tps.approx;
  if (payload.timing) {
    payload.timing = { ...payload.timing, tps: tps.value, tpsApprox: tps.approx };
  }
  payload.approx = approx; // true = 页面还没报会话 id，展示的是「最近会话」
  payload.ts = Date.now();
  payload.version = VERSION;
  await pushPayload(st, payload);
}

/* ---------------------------------------------------------------- 桥拦截

   MiMo 渲染进程加载会话消息**不走 HTTP**（实测 app 日志里只有
   GET /experimental/session、DELETE /session/<sid>），而是走 IPC 桥：
     mimo:sessionMessages  { id: "ses_xxx" }
     mimo:api              { method:"GET", path:"/session/ses_xxx/message" }
   所以拦 fetch 永远抓不到 sid —— 必须在主进程把桥的 handler 注册表包一层。
   桥实现：runtime-res/releases/main/canvas-client~*.mjs 里的 MimoBridge
   （export i），静态访问器 defaultBridge 指向单例，defaultHandlers 是
   Map<apiName, handler>。 */

const SID_IN_PATH = /(?:^|\/)session\/(ses_[A-Za-z0-9]+)/;
const SID_VALUE = /^ses_[A-Za-z0-9]{8,}$/;
const SID_KEYS = ["sessionID", "sessionId", "sid", "sessionKey", "id"];

function sidFromArgs(args) {
  const a0 = args && args[0];
  if (!a0 || typeof a0 !== "object") return null;
  /* 1) 明确的字段名 */
  for (const k of SID_KEYS) {
    const v = a0[k];
    if (typeof v === "string" && SID_VALUE.test(v)) return v;
  }
  /* 2) 路径里带 /session/<sid>（mimo:api） */
  if (typeof a0.path === "string") {
    const m = SID_IN_PATH.exec(a0.path);
    if (m) return m[1];
  }
  return null;
}

function maybeSid(st, api, args) {
  let sid = null;
  try {
    sid = sidFromArgs(args);
  } catch {}
  if (!sid) return;
  if (st.sidDebug !== api) {
    st.sidDebug = api;
    log("sid via", api, sid);
  }
  if (sid === st.pageSid) return;
  st.pageSid = sid;
  st.dirty = true;
  refresh(st, { force: true }).catch(() => {});
  log("pageSid ->", sid, "via", api);
}

function installBridgeHook(st, bridge) {
  if (!bridge || bridge.__mimoMeterHooked) return;
  bridge.__mimoMeterHooked = true;

  const wrap = (api, fn) =>
    function (event, ...args) {
      try {
        maybeSid(st, api, args);
      } catch {}
      return fn.call(this, event, ...args);
    };

  const map = bridge.defaultHandlers;
  if (map && typeof map.forEach === "function" && typeof map.set === "function") {
    for (const [api, fn] of [...map.entries()]) {
      if (typeof fn === "function") map.set(api, wrap(api, fn));
    }
  }

  const origRegister = bridge.registerHandle;
  if (typeof origRegister === "function") {
    bridge.registerHandle = function (handlers) {
      if (!handlers || typeof handlers !== "object") return origRegister.call(this, handlers);
      const out = {};
      for (const [api, fn] of Object.entries(handlers)) {
        out[api] = typeof fn === "function" ? wrap(api, fn) : fn;
      }
      return origRegister.call(this, out);
    };
  }
  log("bridge hooked", { handlers: map ? map.size : 0 });
}

async function findBridgeModule() {
  const base = path.join(appDataRoot(), "runtime-res", "releases", "main");
  if (!fs.existsSync(base)) return null;
  const files = fs.readdirSync(base).filter((f) => f.endsWith(".mjs"));
  const direct = files.find((f) => /^canvas-client~.*\.mjs$/.test(f));
  if (direct) return path.join(base, direct);
  for (const f of files) {
    try {
      const head = fs.readFileSync(path.join(base, f), "utf8");
      if (head.includes("mimo:bridge:invoke")) return path.join(base, f);
    } catch {}
  }
  return null;
}

async function hookBridge(st) {
  if (st.bridgeHooked) return;
  const file = await findBridgeModule();
  if (!file) {
    log("bridge module not found");
    return;
  }
  let mod;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (err) {
    log("bridge import failed", String(err?.message || err));
    return;
  }
  const Cls =
    (typeof mod.i === "function" && mod.i) ||
    Object.values(mod).find(
      (v) => typeof v === "function" && Object.getOwnPropertyDescriptor(v, "defaultBridge"),
    );
  if (!Cls) {
    log("bridge class not found", file);
    return;
  }
  st.bridgeHooked = true;

  let current = null;
  try {
    current = Cls.defaultBridge;
  } catch {}
  if (current) installBridgeHook(st, current);

  try {
    Object.defineProperty(Cls, "defaultBridge", {
      configurable: true,
      enumerable: true,
      get() {
        return current;
      },
      set(v) {
        current = v;
        try {
          installBridgeHook(st, v);
        } catch (err) {
          log("bridge install failed", String(err?.message || err));
        }
      },
    });
    log("bridge accessor hooked", file);
  } catch (err) {
    log("bridge accessor hook failed", String(err?.message || err));
    /* 退路：轮询已有的 defaultBridge */
    const timer = setInterval(() => {
      try {
        const b = Cls.defaultBridge;
        if (b) {
          installBridgeHook(st, b);
          clearInterval(timer);
        }
      } catch {}
    }, 500);
    if (timer.unref) timer.unref();
  }
}

/* ------------------------------------------------------------------ 启动 */

async function boot(st) {
  if (st.started) return;
  st.started = true;

  const e = await loadElectron();
  if (!e) {
    log("no electron, UI disabled");
    return;
  }
  await ensureAssets(st);
  await openDb();
  await hookBridge(st).catch((err) => log("hookBridge failed", String(err?.message || err)));

  e.app.on("browser-window-created", (_ev, win) => {
    try {
      win.webContents.on("did-finish-load", () => injectWindow(st, win));
      win.webContents.on("did-navigate-in-page", () => injectWindow(st, win));
      setTimeout(() => injectWindow(st, win), 600);
    } catch (err) {
      log("window hook failed", String(err?.message || err));
    }
  });

  if (e.app.isReady()) {
    setTimeout(() => injectAll(st), 300);
  } else {
    e.app.once("ready", () => setTimeout(() => injectAll(st), 300));
  }

  st.pollTimer = setInterval(() => {
    pollSid(st).catch(() => {});
  }, SID_POLL_MS);
  st.tickTimer = setInterval(() => {
    refresh(st).catch(() => {});
  }, TICK_MS);

  log("booted", {
    plugin: VERSION,
    overlay: st.overlayVersion,
    platform: PLATFORM,
    appData: appDataRoot(),
    logDir: logRoot(),
    db: dbPath,
  });
}

/* ------------------------------------------------------------------ 插件导出 */

export default async function mimoMeter(input, options) {
  const st = engineState();
  /* 费用单位：引擎的 message.cost 是**美元**。
     实测拟合（325 条 step-finish，残差 2.8e-17）：input 0.14 / output(+reasoning) 0.28 /
     cache_read 0.0028 每百万 —— 正好等于 MiMo 官方人民币价（1.00 / 2.00 / 0.02）÷ 7.142857。
     所以面板同时给出换算后的人民币（= cost × fx，默认 fx=1/0.14）。
     options 可覆盖：{ "currency": "$", "fx": 7.142857, "showCny": true } */
  if (options) {
    if (typeof options.currency === "string" && options.currency.trim()) st.currency = options.currency.trim();
    if (Number.isFinite(options.fx) && options.fx > 0) st.fx = options.fx;
    if (typeof options.showCny === "boolean") st.showCny = options.showCny;
  }
  st.hook = st.hook || {
    event: ({ event }) => {
      try {
        const type = event?.type;
        if (!type) return;
        const props = event?.properties || {};

        if (type === "metrics.model_call") {
          noteModelCall(st, props);
          return;
        }
        if (type === "message.part.delta") {
          const sid = sidOf(props);
          if (sid) {
            st.busy.set(sid, true);
            if (sid === displaySid(st)) st.dirty = true;
          }
          return;
        }
        if (type === "message.updated" || type === "message.part.updated") {
          const sid = sidOf(props);
          if (!sid) return;
          const role = props?.info?.role;
          const partType = props?.part?.type;
          if (role === "user" || role === "assistant") st.busy.set(sid, true);
          if (partType === "step-finish" || partType === "step-start") st.busy.set(sid, true);
          if (sid === displaySid(st)) st.dirty = true;
          return;
        }
        if (type === "session.idle") {
          const sid = sidOf(props);
          if (sid) {
            st.busy.set(sid, false);
            if (sid === displaySid(st)) st.dirty = true;
          }
          return;
        }
        if (type === "session.status") {
          const sid = sidOf(props);
          if (sid) {
            const status = props?.status?.type || props?.status;
            st.busy.set(sid, status === "busy" || status === "retry");
            if (sid === displaySid(st)) st.dirty = true;
          }
        }
      } catch (err) {
        log("event handler failed", String(err?.message || err));
      }
    },
  };

  boot(st).catch((err) => log("boot failed", String(err?.message || err)));

  return st.hook;
}
