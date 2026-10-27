#!/bin/bash
# mimo-stats 安装器 —— 把统计浮层装进 MiMo Desktop
#
# 安装位置：~/Library/Application Support/Xiaomi MiMo/engine-config/
#   mimo-stats.mjs            引擎插件（跑在 Electron 主进程里）
#   mimo-stats-overlay.js     注入渲染进程的浮层逻辑
#   mimo-stats-overlay.css    浮层样式
# 登记位置：engine-config/mimocode.jsonc 的 plugin 数组（app 不会改写这个文件）
#
# 不改 app.asar、不改 runtime 文件、不动代码签名。
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/src"
CFG="$HOME/Library/Application Support/Xiaomi MiMo/engine-config"

if [ ! -d "$CFG" ]; then
  echo "找不到 engine-config 目录：$CFG" >&2
  echo "请先启动一次 MiMo Desktop，让它生成运行时。" >&2
  exit 1
fi

VER=$(grep -o 'const VERSION = "[^"]*"' "$SRC/mimo-stats.mjs" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
echo "安装 mimo-stats v${VER:-unknown}"

cp "$SRC/mimo-stats.mjs"          "$CFG/mimo-stats.mjs"
cp "$SRC/overlay.js"              "$CFG/mimo-stats-overlay.js"
cp "$SRC/overlay.css"             "$CFG/mimo-stats-overlay.css"
echo "已复制 3 个文件到 engine-config/"

python3 - "$CFG" <<'PY'
import json, os, sys, urllib.parse

cfg = sys.argv[1]
path = os.path.join(cfg, "mimocode.jsonc")

data = {}
if os.path.exists(path):
    raw = open(path, encoding="utf-8").read()
    # 允许带注释的 jsonc：先尝试严格解析，失败就按行去掉 // 注释
    try:
        data = json.loads(raw)
    except Exception:
        cleaned = "\n".join(l for l in raw.splitlines() if not l.strip().startswith("//"))
        data = json.loads(cleaned)

plugins = data.get("plugin") or []
if not isinstance(plugins, list):
    plugins = []

spec = "file://" + urllib.parse.quote(os.path.join(cfg, "mimo-stats.mjs"))
plugins = [p for p in plugins if "mimo-stats" not in str(p)]
plugins.append([spec, {}])
data["plugin"] = plugins
data.setdefault("$schema", "https://mimo.xiaomi.com/mimocode/config.json")

with open(path, "w", encoding="utf-8") as f:
    f.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print("已登记插件：" + spec)
PY

echo
echo "完成。重启 MiMo Desktop 生效："
echo "  osascript -e 'quit app \"Xiaomi MiMo\"'; sleep 2; open -a 'Xiaomi MiMo'"
echo
echo "注意：如果是从终端/IDE 启动 MiMo，请确保环境里没有 ELECTRON_RUN_AS_NODE=1，"
echo "      否则 Electron 会以纯 Node 模式运行、窗口不会出现："
echo "      env -u ELECTRON_RUN_AS_NODE open -a 'Xiaomi MiMo'"
