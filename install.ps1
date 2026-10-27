# mimo-stats 安装器（Windows / PowerShell 5.1+）
#
# 安装位置：%APPDATA%\Xiaomi MiMo\engine-config\
#   mimo-stats.mjs            引擎插件（跑在 Electron 主进程里）
#   mimo-stats-overlay.js     注入渲染进程的浮层逻辑
#   mimo-stats-overlay.css    浮层样式
# 登记位置：engine-config\mimocode.jsonc 的 plugin 数组（app 不会改写这个文件）
#
# 不改 app.asar、不改 runtime 文件、不动代码签名。
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src  = Join-Path $here "src"
$cfg  = Join-Path $env:APPDATA "Xiaomi MiMo\engine-config"

if (-not (Test-Path $cfg)) {
  Write-Host "找不到 engine-config 目录：" -ForegroundColor Red
  Write-Host "  $cfg" -ForegroundColor Red
  Write-Host "请先启动一次 MiMo Desktop（Windows 版），让它生成运行时，再重跑本脚本。"
  exit 1
}

$verText = Select-String -Path (Join-Path $src "mimo-stats.mjs") -Pattern 'const VERSION = "([^"]+)"' |
  Select-Object -First 1
$ver = if ($verText -and $verText.Matches.Count -gt 0) { $verText.Matches[0].Groups[1].Value } else { "unknown" }
Write-Host "安装 mimo-stats v$ver"

Copy-Item (Join-Path $src "mimo-stats.mjs")  (Join-Path $cfg "mimo-stats.mjs")          -Force
Copy-Item (Join-Path $src "overlay.js")      (Join-Path $cfg "mimo-stats-overlay.js")   -Force
Copy-Item (Join-Path $src "overlay.css")     (Join-Path $cfg "mimo-stats-overlay.css")  -Force
Write-Host "已复制 3 个文件到 $cfg"

$jsonc = Join-Path $cfg "mimocode.jsonc"
$data = $null
if (Test-Path $jsonc) {
  $raw = Get-Content $jsonc -Raw -Encoding UTF8
  try { $data = $raw | ConvertFrom-Json } catch { $data = $null }
}

$keep = New-Object System.Collections.ArrayList
if ($data -and $data.plugin) {
  foreach ($p in @($data.plugin)) {
    $spec = if ($p -is [System.Array]) { [string]$p[0] } else { [string]$p }
    if ($spec -like "*mimo-stats*") { continue }
    [void]$keep.Add($p)
  }
}

$target = Join-Path $cfg "mimo-stats.mjs"
$uri = ([System.Uri]$target).AbsoluteUri
[void]$keep.Add(@($uri, @{}))

# 注意：ConvertTo-Json 遇到单元素数组会退化成对象，这里手工拼 JSON 保证格式稳定
function ConvertTo-JsonString([string]$v) {
  return ($v | ConvertTo-Json -Compress)
}

$items = @()
foreach ($entry in $keep) {
  $spec = if ($entry -is [System.Array]) { [string]$entry[0] } else { [string]$entry }
  $items += ("    [" + (ConvertTo-JsonString $spec) + ", {}]")
}

$lines = @()
$lines += "{"
$lines += "  ""plugin"": ["
$lines += ($items -join ",`n")
$lines += "  ],"
$lines += "  ""`$schema"": ""https://mimo.xiaomi.com/mimocode/config.json"""
$lines += "}"
$lines -join "`n" | Set-Content -Path $jsonc -Encoding UTF8
Write-Host "已登记插件：$uri"

Write-Host ""
Write-Host "完成。完全退出 MiMo Desktop（托盘图标右键退出，不是关窗口）再重新打开即可生效。"
Write-Host "日志：$env:LOCALAPPDATA\Xiaomi MiMo Stats\mimo-stats.log"
Write-Host ""
Write-Host "注意：如果是从终端/PowerShell 启动 MiMo，请先清掉 ELECTRON_RUN_AS_NODE 环境变量，"
Write-Host "      否则 Electron 会以纯 Node 模式运行、窗口不会出现："
Write-Host '      Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue'
