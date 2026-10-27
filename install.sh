#!/bin/bash
# mimo-meter 安装器 —— 把统计浮层装进 MiMo Desktop
#
# 安装位置：~/Library/Application Support/Xiaomi MiMo/engine-config/
#   mimo-meter.mjs            引擎插件（跑在 Electron 主进程里）
#   mimo-meter-overlay.js     注入渲染进程的浮层逻辑
#   mimo-meter-overlay.css    浮层样式
# 登记位置：engine-config/mimocode.jsonc 的 plugin 数组（app 不会改写这个文件）
#
# 不改 app.asar、不改 runtime 文件、不动代码签名。
#
# 退出码：
#   0 成功 / 1 环境问题 / 2 配置解析失败（原文件未改动） / 3 写入失败（已回滚）
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/src"
EDITOR="$HERE/scripts/jsonc_edit.py"
CFG="$HOME/Library/Application Support/Xiaomi MiMo/engine-config"

die() { echo "错误：$*" >&2; exit 1; }

# ---------------------------------------------------------------- 环境检查

[ -d "$CFG" ] || die "找不到 engine-config 目录：$CFG
请先启动一次 MiMo Desktop，让它生成运行时，再重跑本脚本。"

for f in mimo-meter.mjs overlay.js overlay.css; do
  [ -f "$SRC/$f" ] || die "源文件缺失：$SRC/$f
请在仓库根目录运行本脚本。"
done

[ -f "$EDITOR" ] || die "缺少 scripts/jsonc_edit.py（配置编辑器）"

# 选一个可用的 python 解释器
PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 &&
     "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 6) else 1)' 2>/dev/null; then
    PY="$cand"
    break
  fi
done
[ -n "$PY" ] || die "需要 Python 3.6+ 来安全地编辑 mimocode.jsonc，但没找到 python3。
macOS 上装一下 Xcode 命令行工具即可：xcode-select --install"

# ---------------------------------------------------------------- 复制文件

VER="$("$PY" "$EDITOR" version "$SRC/mimo-meter.mjs" 2>/dev/null || echo unknown)"
echo "安装 mimo-meter v$VER"

install -m 0644 "$SRC/mimo-meter.mjs" "$CFG/mimo-meter.mjs"
install -m 0644 "$SRC/overlay.js"     "$CFG/mimo-meter-overlay.js"
install -m 0644 "$SRC/overlay.css"    "$CFG/mimo-meter-overlay.css"
echo "已复制 3 个文件到 engine-config/"

# ---------------------------------------------------------------- 登记插件

# jsonc_edit.py 会：保留其它顶层键、保留本插件已有 options、只改 plugin、
# 首次安装才写 .bak、原子写 + 回读校验、失败自动回滚。
# 这里临时关掉 errexit，好让退出码能传给用户而不是被 shell 吞掉。
set +e
"$PY" "$EDITOR" install "$CFG" "$CFG/mimo-meter.mjs"
RC=$?
set -e
if [ "$RC" -ne 0 ]; then
  echo >&2
  echo "登记插件失败（退出码 ${RC}）。配置文件未被破坏，可直接重试。" >&2
  exit "$RC"
fi

# ---------------------------------------------------------------- 收尾

echo
echo "完成。重启 MiMo Desktop 生效："
echo "  osascript -e 'quit app \"Xiaomi MiMo\"'; sleep 2; env -u ELECTRON_RUN_AS_NODE open -a 'Xiaomi MiMo'"
echo
echo "注意：如果是从终端/IDE 启动 MiMo，请确保环境里没有 ELECTRON_RUN_AS_NODE=1，"
echo "      否则 Electron 会以纯 Node 模式运行、窗口不会出现："
echo "      env -u ELECTRON_RUN_AS_NODE open -a 'Xiaomi MiMo'"
echo
echo "日志：$HOME/Library/Logs/mimo-meter/mimo-meter.log"
