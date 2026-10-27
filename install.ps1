#Requires -Version 5.1
<#
  mimo-meter 安装器（Windows / PowerShell 5.1+）

  安装位置：%APPDATA%\Xiaomi MiMo\engine-config\
    mimo-meter.mjs            引擎插件（跑在 Electron 主进程里）
    mimo-meter-overlay.js     注入渲染进程的浮层逻辑
    mimo-meter-overlay.css    浮层样式
  登记位置：engine-config\mimocode.jsonc 的 plugin 数组（app 不会改写这个文件）

  不改 app.asar、不改 runtime 文件、不动代码签名。

  退出码：
    0 成功 / 1 环境问题 / 2 配置解析失败（原文件未改动） / 3 写入失败（已回滚）
#>

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here "src"
$editor = Join-Path $here "scripts\jsonc_edit.ps1"
$cfg = Join-Path $env:APPDATA "Xiaomi MiMo\engine-config"

function Fail([string]$Message, [int]$Code = 1) {
  Write-Host "错误：$Message" -ForegroundColor Red
  exit $Code
}

# ---------------------------------------------------------------- 环境检查

if (-not (Test-Path -LiteralPath $cfg)) {
  Write-Host "找不到 engine-config 目录：" -ForegroundColor Red
  Write-Host "  $cfg" -ForegroundColor Red
  Write-Host "请先启动一次 MiMo Desktop（Windows 版），让它生成运行时，再重跑本脚本。"
  exit 1
}

foreach ($f in @("mimo-meter.mjs", "overlay.js", "overlay.css")) {
  if (-not (Test-Path -LiteralPath (Join-Path $src $f))) {
    Fail "源文件缺失：$(Join-Path $src $f)`n请在仓库根目录运行本脚本。"
  }
}

if (-not (Test-Path -LiteralPath $editor)) {
  Fail "缺少 scripts\jsonc_edit.ps1（配置编辑器）"
}

. $editor

# ---------------------------------------------------------------- 复制文件

$ver = Get-MimoMeterVersion (Join-Path $src "mimo-meter.mjs")
Write-Host "安装 mimo-meter v$ver"

Copy-Item (Join-Path $src "mimo-meter.mjs") (Join-Path $cfg "mimo-meter.mjs") -Force
Copy-Item (Join-Path $src "overlay.js")     (Join-Path $cfg "mimo-meter-overlay.js") -Force
Copy-Item (Join-Path $src "overlay.css")    (Join-Path $cfg "mimo-meter-overlay.css") -Force
Write-Host "已复制 3 个文件到 $cfg"

# ---------------------------------------------------------------- 登记插件

# jsonc_edit.ps1 会：保留其它顶层键、保留本插件已有 options、只改 plugin、
# 首次安装才写 .bak、原子写 + 回读校验、失败自动回滚、写 UTF-8 无 BOM。
$rc = Install-MimoMeterPlugin $cfg (Join-Path $cfg "mimo-meter.mjs")
if ($rc -ne 0) {
  Write-Host ""
  Write-Host "登记插件失败（退出码 $rc）。配置文件未被破坏，可直接重试。" -ForegroundColor Red
  exit $rc
}

# ---------------------------------------------------------------- 收尾

Write-Host ""
Write-Host "完成。完全退出 MiMo Desktop（托盘图标右键退出，不是关窗口）再重新打开即可生效。"
Write-Host "日志：$env:LOCALAPPDATA\mimo-meter\mimo-meter.log"
Write-Host ""
Write-Host "注意：如果是从终端/PowerShell 启动 MiMo，请先清掉 ELECTRON_RUN_AS_NODE 环境变量，"
Write-Host "      否则 Electron 会以纯 Node 模式运行、窗口不会出现："
Write-Host '      Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue'
