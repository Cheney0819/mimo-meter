#Requires -Version 5.1
<#
  mimo-meter 卸载器（Windows / PowerShell 5.1+）

  用法：
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -Purge

    -Purge  额外删除日志目录与 metrics.json
#>

param(
  [switch]$Purge
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$editor = Join-Path $here "scripts\jsonc_edit.ps1"
$cfg = Join-Path $env:APPDATA "Xiaomi MiMo\engine-config"
$state = Join-Path $env:LOCALAPPDATA "mimo-meter"

if (Test-Path -LiteralPath $editor) {
  . $editor
  $rc = Uninstall-MimoMeterPlugin $cfg
  if ($rc -ne 0) {
    Write-Host "配置清理失败（退出码 $rc），配置文件未被破坏。插件文件仍未删除。" -ForegroundColor Red
    exit $rc
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

Write-Host "完全退出 MiMo Desktop 再打开，浮层就没了。"
