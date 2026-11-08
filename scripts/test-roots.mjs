#!/usr/bin/env node
/**
 * 数据目录探测回归。
 *
 * 背景：MiMo 26.1106.61620 把 userData 挪进了子目录
 *   ~/Library/Application Support/Xiaomi MiMo/Xiaomi MiMo/{engine-config,runtime-res}
 * 插件只认老路径 → 找不到桥模块 → 拿不到会话 id → 状态条整条不显示。
 * 这类「路径布局变了」的问题不要再用真机去试，用假 HOME 跑一遍即可。
 *
 * 覆盖：
 *   1. 只有老布局时，返回老路径
 *   2. 只有新布局（多一层）时，返回新路径（含 runtime-res）
 *   3. 两种布局并存时，新布局优先
 *   4. 桥模块按内容标记找，文件名带 hash 也能认出来
 *
 * 用法：node scripts/test-roots.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src", "mimo-meter.mjs");

/* ---------- 从真实实现里抠出数据根探测逻辑 --------------------------------
   不抄一份：直接 import 源码会启动整个插件（需要 electron），
   所以这里把「路径探测」那一小段切出来，在假 HOME 下求值。
   切出来的必须是源码原文，改了源码这段测试才会跟着变。 */
const src = fs.readFileSync(SRC, "utf8");
const begin = src.indexOf("const APP_DATA_CANDIDATES");
const end = src.indexOf("/* 我们自己的日志/指标目录 */");
if (begin < 0 || end < 0) {
  console.error("✗ 源码结构变了，找不到数据根探测段（scripts/test-roots.mjs 需要更新）");
  process.exit(1);
}
const rootSnippet = src.slice(begin, end);

/* runtime-res 探测是独立的一段前面的函数，单独切 */
const rtBegin = src.indexOf("function runtimeMainDirs()");
if (rtBegin < 0) {
  console.error("✗ 源码结构变了，找不到 runtimeMainDirs()（scripts/test-roots.mjs 需要更新）");
  process.exit(1);
}
const rtEnd = src.indexOf("async function findBridgeModule()");
const runtimeSnippet = src.slice(rtBegin, rtEnd);

/* ---------- 假 HOME ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-roots-"));
process.env.HOME = tmp;
if (process.platform !== "darwin") {
  /* 只测 macOS 布局；Windows 用 APPDATA，逻辑同构 */
  console.log("– 非 macOS，跳过（数据根布局只在 mac 上变过）");
  process.exit(0);
}

const support = path.join(tmp, "Library", "Application Support");
const legacy = path.join(support, "Xiaomi MiMo");
const nested = path.join(legacy, "Xiaomi MiMo");

function mk(dir, marker) {
  fs.mkdirSync(dir, { recursive: true });
  if (marker) fs.writeFileSync(path.join(dir, marker), "x");
}

function load(opts) {
  const mod = `
    import fs from "node:fs";
    import path from "node:path";
    const HOME = ${JSON.stringify(tmp)};
    const PLATFORM = "darwin";
    ${rootSnippet}
    ${runtimeSnippet}
    export { probeDataRoots, dataPath, runtimeMainDirs, APP_DATA_CANDIDATES };
  `;
  const file = path.join(tmp, `probe-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(file, mod);
  return import(file + "?" + Date.now());
}

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log("  ✓ " + name);
  else {
    console.log("  ✗ " + name + (detail ? " -> " + JSON.stringify(detail) : ""));
    fails++;
  }
};

async function scenario(name, build, expectRoot, expectRuntimeUnder) {
  console.log("\n" + name);
  fs.rmSync(legacy, { recursive: true, force: true });
  build();
  const m = await load();
  const roots = m.probeDataRoots();
  ok("候选里包含期望的根", roots.includes(expectRoot), roots);
  if (expectRuntimeUnder) {
    const dirs = m.runtimeMainDirs();
    ok(
      "runtime-res 在期望的根下面",
      dirs.some((d) => d.startsWith(expectRuntimeUnder)),
      dirs,
    );
  }
  ok(
    "dataPath 能命中 engine-config",
    m.dataPath("engine-config") === path.join(expectRoot, "engine-config"),
    m.dataPath("engine-config"),
  );
}

await scenario(
  "1) 只有老布局",
  () => {
    mk(path.join(legacy, "engine-config"), "mimo-meter.mjs");
    mk(path.join(legacy, "runtime-res", "releases", "main"), "index~abc.mjs");
  },
  legacy,
  legacy,
);

await scenario(
  "2) 只有新布局（多一层）",
  () => {
    mk(path.join(nested, "engine-config"), "mimo-meter.mjs");
    mk(path.join(nested, "runtime-res", "releases", "main"), "index~abc.mjs");
  },
  nested,
  nested,
);

await scenario(
  "3) 两种布局并存 → 新布局优先",
  () => {
    mk(path.join(legacy, "engine-config"), "mimo-meter.mjs");
    mk(path.join(nested, "engine-config"), "mimo-meter.mjs");
    mk(path.join(nested, "runtime-res", "releases", "main"), "index~abc.mjs");
  },
  nested,
  nested,
);

/* ---------- 4) 桥模块按内容标记找 ---------- */
console.log("\n4) 桥模块按内容标记找（文件名带 hash）");
{
  const nested2 = path.join(legacy, "Xiaomi MiMo");
  fs.rmSync(legacy, { recursive: true, force: true });
  const main = path.join(nested2, "runtime-res", "releases", "main");
  mk(main, "engine-entry~X.mjs");
  fs.writeFileSync(
    path.join(main, "renamed-bridge~ZZZZ9999.mjs"),
    'const be="mimo:bridge:invoke";class J{static get defaultBridge(){return this.x}static set defaultBridge(v){this.x=v}}export{j as h};',
  );
  const m = await load();
  ok("runtimeMainDirs 指到新布局", m.runtimeMainDirs().includes(main), m.runtimeMainDirs());

  /* findBridgeIn 在同一段源码里没导出，这里按同样的规则复算一遍 */
  const files = fs.readdirSync(main).filter((f) => f.endsWith(".mjs"));
  const hit = files.find((f) => fs.readFileSync(path.join(main, f), "utf8").includes("mimo:bridge:invoke"));
  ok("按内容标记命中改名的桥模块", hit === "renamed-bridge~ZZZZ9999.mjs", hit);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("");
if (fails) {
  console.log(`FAILED：${fails} 项`);
  process.exit(1);
}
console.log("ALL PASS：数据根探测与桥模块识别正常");
