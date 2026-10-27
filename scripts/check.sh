#!/bin/bash
# 一键跑完所有本地检查。提交前跑这个就够了。
#
# 用法：./scripts/check.sh
#
# 有 Chrome 就跑浮层行为测试，没有就跳过（不算失败）。
# 有 pwsh 就跑 PowerShell 配置编辑测试，没有就跳过。
set -uo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

FAIL=0
SKIP=0

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
skip() { printf '  \033[33m–\033[0m %s\n' "$*"; SKIP=$((SKIP+1)); }

step "1/8 语法检查"
for f in src/mimo-meter.mjs src/overlay.js scripts/check-version.mjs scripts/test_overlay.mjs; do
  if node --check "$f" 2>/dev/null; then ok "$f"; else bad "$f 语法错误"; fi
done
for f in install.sh uninstall.sh scripts/check.sh; do
  if bash -n "$f" 2>/dev/null; then ok "$f"; else bad "$f 语法错误"; fi
done

step "2/8 版本号一致性"
if node scripts/check-version.mjs; then ok "版本号一致"; else bad "版本号不一致"; fi

step "3/8 PowerShell 文件必须带 UTF-8 BOM"
# PS 5.1 读无 BOM 的 UTF-8 文件会按 ANSI(GBK) 解码，中文全变乱码。
bom_bad=0
for f in install.ps1 uninstall.ps1 scripts/jsonc_edit.ps1 scripts/test_jsonc_edit.ps1; do
  if [ "$(head -c 3 "$f" | od -An -tx1 | tr -d ' \n')" = "efbbbf" ]; then
    ok "$f 有 BOM"
  else
    bad "$f 缺少 UTF-8 BOM（PS 5.1 会把中文读成乱码）"
    bom_bad=1
  fi
done

step "4/8 配置编辑回归（Python）"
if command -v python3 >/dev/null 2>&1; then
  if python3 scripts/test_jsonc_edit.py >/tmp/mm-jsonc-py.log 2>&1; then
    ok "$(tail -1 /tmp/mm-jsonc-py.log)"
  else
    bad "见 /tmp/mm-jsonc-py.log"
  fi
else
  skip "没有 python3"
fi

step "5/8 配置编辑回归（PowerShell）"
if command -v pwsh >/dev/null 2>&1; then
  if pwsh -NoLogo -NoProfile -File scripts/test_jsonc_edit.ps1 >/tmp/mm-jsonc-ps.log 2>&1; then
    ok "$(tail -1 /tmp/mm-jsonc-ps.log)"
  else
    bad "见 /tmp/mm-jsonc-ps.log"
  fi
elif command -v powershell >/dev/null 2>&1; then
  if powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_jsonc_edit.ps1 >/tmp/mm-jsonc-ps.log 2>&1; then
    ok "$(tail -1 /tmp/mm-jsonc-ps.log)"
  else
    bad "见 /tmp/mm-jsonc-ps.log"
  fi
else
  skip "没有 pwsh/powershell（Windows 相关改动请在有 PowerShell 的机器上验证）"
fi

step "6/8 浮层行为测试"
if node scripts/test_overlay.mjs >/tmp/mm-overlay.log 2>&1; then
  ok "$(tail -1 /tmp/mm-overlay.log)"
else
  if grep -q "找不到 Chrome" /tmp/mm-overlay.log 2>/dev/null; then
    skip "没有 Chrome/Chromium"
  else
    bad "见 /tmp/mm-overlay.log"
  fi
fi

step "7/8 统计口径回归（SQL）"
# 有真机库就用真的，没有就用合成库；两者都应通过
if node scripts/test-sql.mjs >/tmp/mm-sql.log 2>&1; then
  ok "$(tail -1 /tmp/mm-sql.log)"
else
  bad "见 /tmp/mm-sql.log"
fi

step "8/8 未跟踪的敏感文件"
for f in metrics.json mimo-meter.log; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    bad "$f 被提交进仓库了"
  else
    ok "$f 未被跟踪"
  fi
done

printf '\n'
if [ "$FAIL" -gt 0 ]; then
  printf '\033[31m失败 %d 项\033[0m' "$FAIL"
  [ "$SKIP" -gt 0 ] && printf '（跳过 %d 项）' "$SKIP"
  printf '\n'
  exit 1
fi
printf '\033[32m全部通过\033[0m'
[ "$SKIP" -gt 0 ] && printf '（跳过 %d 项）' "$SKIP"
printf '\n'
