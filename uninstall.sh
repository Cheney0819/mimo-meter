#!/bin/bash
# mimo-meter 卸载器 —— 干净移除统计浮层
#
# 用法：
#   ./uninstall.sh            只移除插件（配置、日志、metrics 保留）
#   ./uninstall.sh --purge    额外删除日志目录与 metrics.json
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EDITOR="$HERE/scripts/jsonc_edit.py"
CFG="$HOME/Library/Application Support/Xiaomi MiMo/engine-config"
STATE="$HOME/Library/Logs/mimo-meter"

PURGE=0
for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    -h|--help)
      echo "用法：$0 [--purge]"
      echo "  --purge  同时删除日志与 metrics.json"
      exit 0
      ;;
    *) echo "未知参数：$arg" >&2; exit 64 ;;
  esac
done

PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 &&
     "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 6) else 1)' 2>/dev/null; then
    PY="$cand"
    break
  fi
done

if [ -n "$PY" ] && [ -f "$EDITOR" ]; then
  set +e
  "$PY" "$EDITOR" uninstall "$CFG"
  RC=$?
  set -e
  if [ "$RC" -ne 0 ]; then
    echo "配置清理失败（退出码 ${RC}），配置文件未被破坏。插件文件仍未删除。" >&2
    exit "$RC"
  fi
else
  echo "警告：找不到 python3 或 scripts/jsonc_edit.py，跳过 plugin 登记清理。" >&2
  echo "      请手动从 mimocode.jsonc 的 plugin 数组里删掉 mimo-meter 那一条。" >&2
fi

rm -f "$CFG/mimo-meter.mjs" "$CFG/mimo-meter-overlay.js" "$CFG/mimo-meter-overlay.css"
rm -f "$CFG/mimo-stats.mjs" "$CFG/mimo-stats-overlay.js" "$CFG/mimo-stats-overlay.css"
echo "已删除插件文件。"

if [ "$PURGE" -eq 1 ]; then
  if [ -d "$STATE" ]; then
    rm -rf "$STATE"
    echo "已删除日志与指标：$STATE"
  else
    echo "日志目录不存在，无需清理：$STATE"
  fi
fi

echo "重启 MiMo 后浮层消失："
echo "  osascript -e 'quit app \"Xiaomi MiMo\"'; sleep 2; env -u ELECTRON_RUN_AS_NODE open -a 'Xiaomi MiMo'"
