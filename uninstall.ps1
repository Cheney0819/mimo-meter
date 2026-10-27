# mimo-meter 卸载器（Windows / PowerShell 5.1+）
$ErrorActionPreference = "Stop"

$cfg   = Join-Path $env:APPDATA "Xiaomi MiMo\engine-config"
$jsonc = Join-Path $cfg "mimocode.jsonc"

if (Test-Path $jsonc) {
  $data = $null
  try { $data = (Get-Content $jsonc -Raw -Encoding UTF8) | ConvertFrom-Json } catch { $data = $null }
  if ($data) {
    $keep = New-Object System.Collections.ArrayList
    $removed = 0
    foreach ($p in @($data.plugin)) {
      $spec = if ($p -is [System.Array]) { [string]$p[0] } else { [string]$p }
      if ($spec -like "*mimo-meter*" -or $spec -like "*mimo-stats*") { $removed++; continue }
      [void]$keep.Add($p)
    }
    $out = [ordered]@{
      plugin    = @($keep)
      '$schema' = "https://mimo.xiaomi.com/mimocode/config.json"
    }
    $out | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonc -Encoding UTF8
    Write-Host "已从 plugin 数组移除 $removed 项"
  }
} else {
  Write-Host "没有 mimocode.jsonc，跳过登记清理"
}

Remove-Item (Join-Path $cfg "mimo-meter.mjs")         -ErrorAction SilentlyContinue
Remove-Item (Join-Path $cfg "mimo-stats.mjs")         -ErrorAction SilentlyContinue
Remove-Item (Join-Path $cfg "mimo-stats-overlay.js")  -ErrorAction SilentlyContinue
Remove-Item (Join-Path $cfg "mimo-stats-overlay.css") -ErrorAction SilentlyContinue
Remove-Item (Join-Path $cfg "mimo-meter-overlay.js")  -ErrorAction SilentlyContinue
Remove-Item (Join-Path $cfg "mimo-meter-overlay.css") -ErrorAction SilentlyContinue
Write-Host "已删除插件文件。完全退出 MiMo Desktop 再打开，浮层就没了。"
