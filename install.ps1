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

  注意：本文件必须保存为「UTF-8 带 BOM」。PowerShell 5.1 读无 BOM 的 UTF-8
  文件时会按系统 ANSI 代码页（中文 Windows 是 GBK）解码，中文全变乱码。
#>

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------- 双击运行保护
# 双击 .ps1 时窗口会在脚本结束后立刻关闭，用户只看到「闪退」。
# 检测到是交互式双击（没有 -File 之外的父进程参数、且是最后一个窗口）时，
# 出错就停住等按键，让错误信息留在屏幕上。

$script:InvokedByDoubleClick = $false
try {
  $myPid = $PID
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $myPid" -ErrorAction SilentlyContinue
  if ($parent) {
    $ppid = $parent.ParentProcessId
    $pproc = Get-CimInstance Win32_Process -Filter "ProcessId = $ppid" -ErrorAction SilentlyContinue
    # 父进程是 explorer.exe → 说明是双击启动的
    if ($pproc -and $pproc.Name -eq "explorer.exe") { $script:InvokedByDoubleClick = $true }
  }
} catch {
  # 拿不到进程信息就算了，不影响安装
}

function Pause-IfDoubleClick {
  if ($script:InvokedByDoubleClick) {
    Write-Host ""
    Write-Host "按回车键关闭窗口……" -ForegroundColor Yellow
    try { [void](Read-Host) } catch { Start-Sleep -Seconds 30 }
  }
}

function Fail([string]$Message, [int]$Code = 1) {
  Write-Host ""
  Write-Host "错误：$Message" -ForegroundColor Red
  Pause-IfDoubleClick
  exit $Code
}

# 兜底：任何未捕获异常也要停住，别让窗口一闪而过
trap {
  Write-Host ""
  Write-Host "安装过程中出现未预期的错误：" -ForegroundColor Red
  Write-Host ("  " + $_.Exception.Message) -ForegroundColor Red
  Write-Host ""
  Write-Host "位置：" -ForegroundColor DarkGray
  Write-Host ("  " + $_.InvocationInfo.PositionMessage) -ForegroundColor DarkGray
  Pause-IfDoubleClick
  exit 1
}

# ---------------------------------------------------------------- 环境检查

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here "src"
$editor = Join-Path $here "scripts\jsonc_edit.ps1"
$cfg = Join-Path $env:APPDATA "Xiaomi MiMo\engine-config"

Write-Host "mimo-meter 安装器" -ForegroundColor Cyan
Write-Host ("  PowerShell 版本：" + $PSVersionTable.PSVersion.ToString())
Write-Host ("  脚本目录：" + $here)
Write-Host ""

if (-not (Test-Path -LiteralPath $cfg)) {
  Fail ("找不到 engine-config 目录：`n  " + $cfg + "`n请先启动一次 MiMo Desktop（Windows 版），让它生成运行时，再重跑本脚本。")
}

foreach ($f in @("mimo-meter.mjs", "overlay.js", "overlay.css")) {
  if (-not (Test-Path -LiteralPath (Join-Path $src $f))) {
    Fail ("源文件缺失：`n  " + (Join-Path $src $f) + "`n请在仓库根目录运行本脚本（src 目录要和 install.ps1 在一起）。")
  }
}

if (-not (Test-Path -LiteralPath $editor)) {
  Fail ("缺少配置编辑器：`n  " + $editor + "`n请确认 scripts 目录完整。")
}

# ---------------------------------------------------------------- 加载配置编辑器

try {
  . $editor
} catch {
  Fail ("加载配置编辑器失败：`n  " + $_.Exception.Message)
}

if (-not (Get-Command Install-MimoMeterPlugin -ErrorAction SilentlyContinue)) {
  Fail "配置编辑器没有提供 Install-MimoMeterPlugin 函数，scripts\jsonc_edit.ps1 可能不完整。"
}

# ---------------------------------------------------------------- 复制文件

$ver = Get-MimoMeterVersion (Join-Path $src "mimo-meter.mjs")
Write-Host "安装 mimo-meter v$ver"

try {
  Copy-Item (Join-Path $src "mimo-meter.mjs") (Join-Path $cfg "mimo-meter.mjs") -Force
  Copy-Item (Join-Path $src "overlay.js")     (Join-Path $cfg "mimo-meter-overlay.js") -Force
  Copy-Item (Join-Path $src "overlay.css")    (Join-Path $cfg "mimo-meter-overlay.css") -Force
} catch {
  Fail ("复制文件失败：`n  " + $_.Exception.Message + "`n可能是文件被占用，请先完全退出 MiMo Desktop 再试。")
}
Write-Host "已复制 3 个文件到 $cfg"

# ---------------------------------------------------------------- 登记插件

# jsonc_edit.ps1 会：保留其它顶层键、保留本插件已有 options、只改 plugin、
# 首次安装才写 .bak、原子写 + 回读校验、失败自动回滚、写 UTF-8 无 BOM。
try {
  $rc = Install-MimoMeterPlugin $cfg (Join-Path $cfg "mimo-meter.mjs")
} catch {
  Fail ("登记插件时出错：`n  " + $_.Exception.Message + "`n配置文件未被破坏，可直接重试。")
}

if ($rc -ne 0) {
  Fail ("登记插件失败（退出码 " + $rc + "）。配置文件未被破坏，可直接重试。") $rc
}

# ---------------------------------------------------------------- 收尾

Write-Host ""
Write-Host "安装完成。" -ForegroundColor Green
Write-Host "完全退出 MiMo Desktop（托盘图标右键退出，不是关窗口）再重新打开即可生效。"
Write-Host ""
Write-Host "日志：$env:LOCALAPPDATA\mimo-meter\mimo-meter.log"
Write-Host ""
Write-Host "注意：如果是从终端/PowerShell 启动 MiMo，请先清掉 ELECTRON_RUN_AS_NODE 环境变量，"
Write-Host "      否则 Electron 会以纯 Node 模式运行、窗口不会出现："
Write-Host '      Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue'

Pause-IfDoubleClick
exit 0
