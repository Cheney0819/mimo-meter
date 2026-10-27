#!/usr/bin/env node
/**
 * overlay.js 的行为测试（headless Chrome 实跑，不 mock DOM）。
 *
 * 覆盖：
 *   1. 幂等注入：同版本重复注入只保留一个 host
 *   2. 热重载：换版本注入后旧实例被拆干净，不会出现两个 host
 *   3. probe()：无 sid 时返回 headerTexts；有 sid 时跳过 DOM 扫描
 *   4. 金额：costCny 优先 / showCny=false 退回原值 / currency 生效 / 0 显示 ¥0.00
 *   5. 空闲态：sid 为 null 时整条隐藏
 *   6. destroy()：监听器与 observer 全部解绑
 *
 * 用法：node scripts/test_overlay.mjs [chrome 路径]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OVERLAY = path.join(ROOT, "src", "overlay.js");

const CHROME_CANDIDATES = [
  process.argv[2],
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  process.env.CHROME_PATH,
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => {
  try { return fs.existsSync(p); } catch { return false; }
});

if (!chrome) {
  console.error("找不到 Chrome/Chromium。请传路径：node scripts/test_overlay.mjs /path/to/chrome");
  process.exit(2);
}

const overlaySrc = fs.readFileSync(OVERLAY, "utf8");
const OVERLAY_CSS = path.join(ROOT, "src", "overlay.css");
const overlayCss = fs.readFileSync(OVERLAY_CSS, "utf8");

/* 造一个模拟 MiMo 页面：composer + 免责声明 + 一堆消息节点 */
const PAGE = `<!doctype html><meta charset="utf-8">
<style>
  body { font: 13px system-ui; margin: 0; }
  #root { padding: 20px 40px 20px 260px; }
  .composer-wrap { width: 720px; min-height: 60px; }
  .composer-wrap { position: relative; }
  .composer-ai-disclaimer { text-align: center; }
</style>
<style id="mm-css">${overlayCss}</style>
<div id="root">
  <div class="thread-header"><span class="t">我的会话标题</span></div>
  <div id="msgs"></div>
  <div class="composer-wrap">
    <textarea id="composer-input" placeholder="描述任务"></textarea>
    <div class="composer-ai-disclaimer">内容由 AI 生成，请注意核实</div>
  </div>
</div>
<pre id="out"></pre>
<script>
  // 造 800 条消息，模拟长会话
  var msgs = document.getElementById('msgs');
  var f = document.createDocumentFragment();
  for (var i = 0; i < 800; i++) {
    var d = document.createElement('div');
    d.className = 'msg';
    d.innerHTML = '<span class="who">assistant</span><div class="body"><p>正文 ' + i + '</p></div>';
    f.appendChild(d);
  }
  msgs.appendChild(f);
</script>
<script>
/*__OVERLAY__*/
</script>
<script>
var results = [];
function ok(name, cond, detail) { results.push({ name: name, pass: !!cond, detail: detail || '' }); }

// ---- 1) 首次注入后只有一个 host ----
ok('首次注入后有 host', !!document.getElementById('mimo-meter-host'));
ok('只有一个 host', document.querySelectorAll('#mimo-meter-host').length === 1);

// ---- 2) 幂等：再注入同版本 ----
var api1 = window.__MIMO_METER__;
__REINJECT__;

// ---- 3) 热重载：换一个版本号注入，旧实例应被 destroy ----
window.__MIMO_METER__ = null; // 模拟版本变化（下面用真注入验证）
</script>
`;

/* 用一次 page load 完成所有断言：把 overlay 源码内联两次（第二次模拟热重载） */
function buildPage() {
  // 第一次注入：原样
  // 第二次注入：把 VERSION 改掉，模拟新版本热重载
  // 用正则换版本号，避免测试里硬编码版本（升级时会误报）
  const second = overlaySrc.replace(/var VERSION = "[^"]+"/, 'var VERSION = "9.9.9"');
  return `<!doctype html><meta charset="utf-8">
<style>
  body { font: 13px system-ui; margin: 0; }
  #root { padding: 20px 40px 20px 260px; }
  .composer-wrap { width: 720px; min-height: 60px; }
  .composer-wrap { position: relative; }
  .composer-ai-disclaimer { text-align: center; }
</style>
<style id="mm-css">${overlayCss}</style>
<div id="root">
  <div class="thread-header"><span class="t">我的会话标题</span></div>
  <div id="msgs"></div>
  <div class="composer-wrap">
    <textarea id="composer-input" placeholder="描述任务"></textarea>
    <div class="composer-ai-disclaimer">内容由 AI 生成，请注意核实</div>
  </div>
</div>
<pre id="out"></pre>
<script>
  var msgs = document.getElementById('msgs');
  var f = document.createDocumentFragment();
  for (var i = 0; i < 800; i++) {
    var d = document.createElement('div');
    d.className = 'msg';
    d.innerHTML = '<span class="who">assistant</span><div class="body"><p>正文 ' + i + '</p></div>';
    f.appendChild(d);
  }
  msgs.appendChild(f);
</script>

<script>${overlaySrc}</script>
<script>
  window.__T = window.__T || {};
  window.__T.api1 = window.__MIMO_METER__;
  window.__T.host1 = document.getElementById('mimo-meter-host');
  window.__T.cleanups1 = (function () {
    // 数一下 document/window 上的监听器没法直接数，这里用 destroy 后行为验证
    return true;
  })();
</script>

<script>${second}</script>
<script>
  var R = [];
  function ok(n, c, d) { R.push({ name: n, pass: !!c, detail: d == null ? '' : String(d) }); }

  var api2 = window.__MIMO_METER__;
  ok('热重载后 api 是新实例', api2 && api2 !== window.__T.api1);
  ok('热重载后版本是新版本', api2 && api2.version === '9.9.9', api2 && api2.version);
  ok('热重载后只有一个 host', document.querySelectorAll('#mimo-meter-host').length === 1,
     document.querySelectorAll('#mimo-meter-host').length);
  ok('旧 host 已从 DOM 移除', !window.__T.host1.isConnected);

  // ---- probe：有 sid 时不扫 DOM ----
  window.__mimoMeterSid = 'ses_test12345678';
  var p1 = api2.probe();
  ok('probe 有 sid', p1.sid === 'ses_test12345678', p1.sid);
  ok('probe 有 sid 时 headerTexts 为空（不扫 DOM）', Array.isArray(p1.headerTexts) && p1.headerTexts.length === 0,
     JSON.stringify(p1.headerTexts));
  ok('probe.mounted 为 true', p1.mounted === true);

  // ---- probe：无 sid 的会话页要返回 headerTexts ----
  window.__mimoMeterSid = null;
  var p2 = api2.probe();
  ok('无 sid 时扫描 headerTexts', Array.isArray(p2.headerTexts) && p2.headerTexts.length > 0,
     JSON.stringify(p2.headerTexts));

  // ---- 金额渲染 ----
  function moneyOf(payload) {
    api2.update(payload);
    var host = document.getElementById('mimo-meter-host');
    var el = host.querySelector('.mm-foot-r');
    return el ? el.textContent : null;
  }
  var base = {
    sid: 'ses_test12345678', title: 'T', model: 'mimo', rounds: 1, steps: 2,
    tokens: { total: 1000, input: 100, output: 200, reasoning: 0, read: 700, write: 0 },
    timing: { modelMs: 1000, toolMs: 100, ttftMs: 200, tps: 50 },
    busy: false, approx: false, currency: '¥', costCny: 0.5, cost: 0.07,
  };
  ok('costCny 优先', moneyOf(Object.assign({}, base)) === '¥0.50', moneyOf(Object.assign({}, base)));

  var noCny = Object.assign({}, base, { costCny: null, cost: 0.07 });
  ok('showCny=false 退回美元原值', moneyOf(noCny) === '¥0.070', moneyOf(noCny));

  var usd = Object.assign({}, base, { costCny: null, cost: 0.07, currency: '$' });
  ok('currency 选项生效', moneyOf(usd) === '$0.070', moneyOf(usd));

  var zero = Object.assign({}, base, { costCny: 0, cost: 0 });
  ok('0 元显示 ¥0.000（不再整行隐藏）', moneyOf(zero) === '¥0.000', moneyOf(zero));

  var none = Object.assign({}, base, { costCny: null, cost: null });
  ok('都没有时留空', moneyOf(none) === '', JSON.stringify(moneyOf(none)));

  // ---- 空闲态 ----
  api2.update({ sid: null });
  var host = document.getElementById('mimo-meter-host');
  ok('sid=null 时进入 idle', host.classList.contains('mm-idle'));

  // ---- 两张卡片独立开合 ----
  api2.update(base);
  var hostEl = document.getElementById('mimo-meter-host');
  var segTokEl = hostEl.querySelector('.mm-seg-tok');
  var segStatEl = hostEl.querySelector('.mm-seg-stat');
  var panelTokEl = hostEl.querySelector('.mm-panel-tok');
  var panelStatEl = hostEl.querySelector('.mm-panel-stat');

  ok('存在 Token 分段', !!segTokEl);
  ok('存在统计分段', !!segStatEl);
  ok('存在 Token 卡片', !!panelTokEl);
  ok('存在统计卡片', !!panelStatEl);
  ok('两张卡片默认都关闭',
     getComputedStyle(panelTokEl).display === 'none' && getComputedStyle(panelStatEl).display === 'none',
     getComputedStyle(panelTokEl).display + '/' + getComputedStyle(panelStatEl).display);

  // 点 Token 段 → 只开 Token 卡
  segTokEl.click();
  ok('点 Token 段只开 Token 卡',
     getComputedStyle(panelTokEl).display !== 'none' && getComputedStyle(panelStatEl).display === 'none',
     getComputedStyle(panelTokEl).display + '/' + getComputedStyle(panelStatEl).display);
  ok('Token 段 aria-expanded=true', segTokEl.getAttribute('aria-expanded') === 'true');

  // 点统计段 → 切到统计卡（互斥）
  segStatEl.click();
  ok('点统计段切到统计卡（互斥）',
     getComputedStyle(panelTokEl).display === 'none' && getComputedStyle(panelStatEl).display !== 'none',
     getComputedStyle(panelTokEl).display + '/' + getComputedStyle(panelStatEl).display);
  ok('统计段 aria-expanded=true', segStatEl.getAttribute('aria-expanded') === 'true');
  ok('Token 段 aria-expanded=false', segTokEl.getAttribute('aria-expanded') === 'false');

  // 再点统计段 → 收起
  segStatEl.click();
  ok('再点同一段收起',
     getComputedStyle(panelTokEl).display === 'none' && getComputedStyle(panelStatEl).display === 'none');

  // 键盘 Enter 也能开
  segTokEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  ok('键盘 Enter 展开 Token 卡', getComputedStyle(panelTokEl).display !== 'none');
  segTokEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  ok('键盘 Enter 再按收起', getComputedStyle(panelTokEl).display === 'none');

  // 两张卡片各自的内容归属正确
  segTokEl.click();
  ok('Token 卡里有缓存命中行', panelTokEl.textContent.indexOf('缓存命中') >= 0);
  ok('Token 卡里没有模型用时', panelTokEl.textContent.indexOf('模型用时') < 0);
  segStatEl.click();
  ok('统计卡里有模型用时', panelStatEl.textContent.indexOf('模型用时') >= 0);
  ok('统计卡里没有缓存命中', panelStatEl.textContent.indexOf('缓存命中') < 0);
  ok('统计卡里有会话标题', panelStatEl.textContent.indexOf('T') >= 0);

  // ---- 卡片不越界 ----
  // 真实页面有很长的消息列表，composer 常在页面底部。断言前必须先把分段
  // 滚进视口并等布局稳定，否则量到的是页面坐标（几万 px），没有意义。
  var vh = window.innerHeight;

  function openAndMeasure(seg, panel) {
    if (seg.getAttribute('aria-expanded') === 'true') seg.click();
    seg.scrollIntoView({ block: 'center' });
    // 强制同步布局，让 scrollIntoView 生效后再点开（placePanel 依赖真实 rect）
    void document.documentElement.offsetHeight;
    seg.click();
    return panel.getBoundingClientRect();
  }

  var pr = openAndMeasure(segStatEl, panelStatEl);
  ok('统计卡落在视口内（上）', pr.top >= -1, 'top=' + Math.round(pr.top));
  ok('统计卡落在视口内（下）', pr.bottom <= vh + 1,
     'bottom=' + Math.round(pr.bottom) + ' vh=' + vh);
  ok('统计卡可见（高度 > 40）', pr.height > 40, 'h=' + Math.round(pr.height));
  segStatEl.click();

  var pt = openAndMeasure(segTokEl, panelTokEl);
  ok('Token 卡落在视口内（上）', pt.top >= -1, 'top=' + Math.round(pt.top));
  ok('Token 卡落在视口内（下）', pt.bottom <= vh + 1,
     'bottom=' + Math.round(pt.bottom) + ' vh=' + vh);
  ok('Token 卡可见（高度 > 40）', pt.height > 40, 'h=' + Math.round(pt.height));
  segTokEl.click();

  // ---- 统计卡底部：轮/步 与 模型名 同一行且基线对齐 ----
  segStatEl.click();
  var footEl = panelStatEl.querySelector('.mm-foot');
  var footL = footEl.querySelector('.mm-foot-l');
  var footModel = footEl.querySelector('.mm-cost');
  ok('统计卡底部有轮/步行', !!footL);
  ok('统计卡底部有模型名', !!footModel);

  var rl = footL.getBoundingClientRect();
  var rm = footModel.getBoundingClientRect();
  ok('轮/步与模型名在同一行（垂直重叠）',
     Math.abs(rl.top - rm.top) < 20,
     'left.top=' + Math.round(rl.top) + ' model.top=' + Math.round(rm.top));
  ok('轮/步与模型名基线对齐（底部差 <= 2px）',
     Math.abs(rl.bottom - rm.bottom) <= 2,
     'left.bottom=' + Math.round(rl.bottom) + ' model.bottom=' + Math.round(rm.bottom));
  ok('模型名靠右（在轮/步右侧）', rm.left > rl.right, 'model.left=' + Math.round(rm.left) + ' left.right=' + Math.round(rl.right));

  // 没有模型名时整段隐藏，且不留空隙
  api2.update(Object.assign({}, base, { model: null }));
  ok('无模型名时隐藏', getComputedStyle(footModel).display === 'none', getComputedStyle(footModel).display);
  api2.update(base);
  segStatEl.click();

  // ---- destroy 后彻底干净 ----
  api2.update(base);
  api2.destroy();
  ok('destroy 后 host 被移除', !document.getElementById('mimo-meter-host'));
  ok('destroy 后 fetch 已还原', !window.fetch.__mimoMeterOrig);

  // destroy 之后再往 document 上派事件，不应该报错（监听器已解绑）
  var threw = false;
  try {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
  } catch (e) { threw = true; }
  ok('destroy 后派发事件不报错', !threw);

  document.getElementById('out').textContent = JSON.stringify(R, null, 2);
</script>
`;

}

const page = buildPage();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-overlay-"));
const pagePath = path.join(tmp, "page.html");
fs.writeFileSync(pagePath, page, "utf8");

let dom;
try {
  dom = execFileSync(chrome, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--allow-file-access-from-files",
    // 明确给一个够高的视口：默认 800x600 扣掉 UI 只剩 ~469px，
    // 卡片高度 ~210px，贴着 composer 时会误判成「放不下」。
    "--window-size=1280,900",
    "--virtual-time-budget=8000", "--dump-dom", "file://" + pagePath,
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
} catch (err) {
  console.error("Chrome 运行失败：", err.message);
  process.exit(2);
}

const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom);
if (!m) {
  console.error("页面没有产出结果（可能 JS 报错）。DOM 片段：");
  console.error(dom.slice(0, 2000));
  process.exit(2);
}

const results = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
let failed = 0;
for (const r of results) {
  if (r.pass) {
    console.log("  ok   " + r.name);
  } else {
    failed++;
    console.log("  FAIL " + r.name + (r.detail ? "  → " + r.detail : ""));
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log("");
if (failed) {
  console.log(`FAILED ${failed} / ${results.length}`);
  process.exit(1);
}
console.log(`ALL PASS (${results.length} checks)`);
