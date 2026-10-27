#Requires -Version 5.1
<#
  mimo-meter 卸载器（Windows / PowerShell 5.1+）

  用法：
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -Purge

    -Purge  额外删除日志目录与 metrics.json

  注意：本文件必须保存为「UTF-8 带 BOM」，否则 PowerShell 5.1 会把中文读成乱码。
#>

param(
  [switch]$Purge
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------- 双击运行保护
$script:InvokedByDoubleClick = $false
try {
  $myPid = $PID
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $myPid" -ErrorAction SilentlyContinue
  if ($parent) {
    $ppid = $parent.ParentProcessId
    $pproc = Get-CimInstance Win32_Process -Filter "ProcessId = $ppid" -ErrorAction SilentlyContinue
    if ($pproc -and $pproc.Name -eq "explorer.exe") { $script:InvokedByDoubleClick = $true }
  }
} catch { }

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

trap {
  Write-Host ""
  Write-Host "卸载过程中出现未预期的错误：" -ForegroundColor Red
  Write-Host ("  " + $_.Exception.Message) -ForegroundColor Red
  Write-Host ("  " + $_.InvocationInfo.PositionMessage) -ForegroundColor DarkGray
  Pause-IfDoubleClick
  exit 1
}

# ---------------------------------------------------------------- 主流程

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$editor = Join-Path $here "scripts\jsonc_edit.ps1"
$cfg = Join-Path $env:APPDATA "Xiaomi MiMo\engine-config"
$state = Join-Path $env:LOCALAPPDATA "mimo-meter"

Write-Host "mimo-meter 卸载器" -ForegroundColor Cyan
Write-Host ("  PowerShell 版本：" + $PSVersionTable.PSVersion.ToString())
Write-Host ""

if (Test-Path -LiteralPath $editor) {
  try {
    . $editor
  } catch {
    Fail ("加载配置编辑器失败：`n  " + $_.Exception.Message)
  }

  if (Get-Command Uninstall-MimoMeterPlugin -ErrorAction SilentlyContinue) {
    try {
      $rc = Uninstall-MimoMeterPlugin $cfg
    } catch {
      Fail ("清理配置时出错：`n  " + $_.Exception.Message + "`n配置文件未被破坏。")
    }
    if ($rc -ne 0) {
      Fail ("配置清理失败（退出码 " + $rc + "），配置文件未被破坏。插件文件仍未删除。") $rc
    }
  } else {
    Write-Host "警告：jsonc_edit.ps1 里没有 Uninstall-MimoMeterPlugin 函数。" -ForegroundColor Yellow
    Write-Host "      请手动从 mimocode.jsonc 的 plugin 数组里删掉 mimo-meter 那一条。"
  }
} else {
  Write-Host "警告：找不到 scripts\jsonc_edit.ps1，跳过 plugin 登记清理。" -ForegroundColor Yellow
  Write-Host "      请手动从 mimocode.jsonc 的 plugin 数组里删掉 mimo-meter 那一条。"
}

foreach ($name in @(
    "mimo-meter.mjs",
    "mimo-meter-overlay.js",
    "mimo-meter-overlay.css",
    "mimo-stats.mjs",
    "mimo-stats-overlay.js",
    "mimo-stats-overlay.css"
  )) {
  Remove-Item (Join-Path $cfg $name) -Force -ErrorAction SilentlyContinue
}
Write-Host "已删除插件文件。"

if ($Purge) {
  if (Test-Path -LiteralPath $state) {
    Remove-Item -LiteralPath $state -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "已删除日志与指标：$state"
  } else {
    Write-Host "日志目录不存在，无需清理：$state"
  }
}

Write-Host ""
Write-Host "卸载完成。" -ForegroundColor Green
Write-Host "完全退出 MiMo Desktop 再打开，浮层就没了。"

Pause-IfDoubleClick
exit 0
