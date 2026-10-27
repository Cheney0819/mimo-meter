#!/bin/bash
# mimo-meter 卸载器 —— 干净移除统计浮层
set -u

CFG="$HOME/Library/Application Support/Xiaomi MiMo/engine-config"

python3 - "$CFG" <<'PY'
import json, os, sys

cfg = sys.argv[1]
path = os.path.join(cfg, "mimocode.jsonc")
if not os.path.exists(path):
    print("没有 mimocode.jsonc，跳过登记清理")
    raise SystemExit(0)

try:
    data = json.loads(open(path, encoding="utf-8").read())
except Exception:
    raw = open(path, encoding="utf-8").read()
    data = json.loads("\n".join(l for l in raw.splitlines() if not l.strip().startswith("//")))

before = len(data.get("plugin") or [])
data["plugin"] = [p for p in (data.get("plugin") or [])
                  if "mimo-meter" not in str(p) and "mimo-stats" not in str(p)]
after = len(data["plugin"])
open(path, "w", encoding="utf-8").write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print(f"已从 plugin 数组移除 {before - after} 项")
PY

rm -f "$CFG/mimo-meter.mjs" "$CFG/mimo-meter-overlay.js" "$CFG/mimo-meter-overlay.css"
rm -f "$CFG/mimo-stats.mjs" "$CFG/mimo-stats-overlay.js" "$CFG/mimo-stats-overlay.css"
echo "已删除插件文件。重启 MiMo 后浮层消失："
echo "  osascript -e 'quit app \"Xiaomi MiMo\"'; sleep 2; env -u ELECTRON_RUN_AS_NODE open -a 'Xiaomi MiMo'"
