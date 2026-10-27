#!/usr/bin/env node
/**
 * 版本号一致性检查。
 *
 * 两处 VERSION 必须一致：src/mimo-meter.mjs 的 const VERSION 与
 * src/overlay.js 的 var VERSION。不一致时浮层不会重新挂载
 * （见 CONTRIBUTING.md），是很难查的问题，所以用脚本卡住。
 *
 * 用法：node scripts/check-version.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

function readVersion(file, re, label) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const m = re.exec(src);
  if (!m) {
    console.error(`✗ 在 ${file} 里找不到 ${label}`);
    process.exit(1);
  }
  return m[1];
}

const pluginVer = readVersion("src/mimo-meter.mjs", /const VERSION = "([^"]+)"/, "const VERSION");
const overlayVer = readVersion("src/overlay.js", /var VERSION = "([^"]+)"/, "var VERSION");

let bad = 0;
if (pluginVer !== overlayVer) {
  console.error(`✗ 版本号不一致：mimo-meter.mjs=${pluginVer} overlay.js=${overlayVer}`);
  bad++;
}

// README 的 badge 与日志示例也应跟上
const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const badge = /version-([0-9]+\.[0-9]+\.[0-9]+)-green/.exec(readme);
if (badge && badge[1] !== pluginVer) {
  console.error(`✗ README badge 版本 ${badge[1]} 与插件版本 ${pluginVer} 不一致`);
  bad++;
}

if (bad) process.exit(1);
console.log(`✓ 版本号一致：${pluginVer}`);
