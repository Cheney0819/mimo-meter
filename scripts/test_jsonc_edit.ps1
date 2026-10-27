#Requires -Version 5.1
<#
  jsonc_edit.ps1 的回归测试（与 scripts/test_jsonc_edit.py 的用例对齐）

  用法：
    pwsh -NoLogo -File scripts/test_jsonc_edit.ps1
    powershell -ExecutionPolicy Bypass -File scripts/test_jsonc_edit.ps1

  实现说明：PowerShell 的 return 会把集合展开、[string]$null 会变空串，
  这两点都会让「单元素数组」的断言假通过或假失败。所以下面统一用
  $script: 变量承载数组，函数只返回标量（数量 / 布尔 / 字符串）。
#>

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "jsonc_edit.ps1")

$script:Passed = 0
$script:Failed = @()
$script:Items = @()

function Check([string]$Name, [bool]$Cond, [string]$Detail = "") {
  if ($Cond) {
    $script:Passed++
    Write-Host "  ok   $Name"
  } else {
    $script:Failed += $Name
    Write-Host "  FAIL $Name $Detail" -ForegroundColor Red
  }
}

function New-TempDir {
  param([string]$Content = "", [switch]$NoFile)
  $d = Join-Path ([System.IO.Path]::GetTempPath()) ("jsonc-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
  New-Item -ItemType Directory -Path $d -Force | Out-Null
  if (-not $NoFile) {
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText((Join-Path $d "mimocode.jsonc"), $Content, $utf8)
  }
  return $d
}

function Load-Config([string]$Dir) {
  $p = Join-Path $Dir "mimocode.jsonc"
  $raw = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
  if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }
  return ConvertFrom-Jsonc $raw
}

# 载入 plugin 到 $script:Items，返回条目数
function Load-Plugins([string]$Dir) {
  $cfg = Load-Config $Dir
  $script:Items = @($cfg.plugin)
  return $script:Items.Count
}

# 第 $i 条的 spec
function Spec-At([int]$i) {
  if ($i -ge $script:Items.Count) { return "" }
  return [string](Get-EntrySpec $script:Items[$i])
}

# 第 $i 条的 options
function Opts-At([int]$i) {
  if ($i -ge $script:Items.Count) { return $null }
  return Get-EntryOptions $script:Items[$i]
}

# 有多少条 spec 匹配
function Count-Specs([string]$Needle) {
  $n = 0
  foreach ($e in $script:Items) {
    $s = Get-EntrySpec $e
    if ($null -ne $s -and $s.Contains($Needle)) { $n++ }
  }
  return $n
}

$PluginFile = "mimo-meter.mjs"

# ------------------------------------------------------------------ 用例

Write-Host "[1] 纯 JSON，保留其它顶层键"
$d = New-TempDir '{"model":"mimo-v2","theme":"dark","plugin":[]}'
$rc = Install-MimoMeterPlugin $d (Join-Path $d $PluginFile)
$cfg = Load-Config $d
Check "exit 0" ($rc -eq 0) "rc=$rc"
Check "model 保留" ($cfg.model -eq "mimo-v2")
Check "theme 保留" ($cfg.theme -eq "dark")
Check "plugin 长度 1" ((Load-Plugins $d) -eq 1)
Check "spec 正确" ((Spec-At 0).Contains($PluginFile))
Remove-Item -Recurse -Force $d

Write-Host "[2] 行注释 jsonc"
$d = New-TempDir @"
{
  // 我的模型
  "model": "mimo-v2",
  "plugin": [["file:///other/p.mjs", {"x": 1}]]
}
"@
$rc = Install-MimoMeterPlugin $d (Join-Path $d $PluginFile)
$cfg = Load-Config $d
Check "exit 0" ($rc -eq 0) "rc=$rc"
Check "model 保留" ($cfg.model -eq "mimo-v2")
Check "条目数 2" ((Load-Plugins $d) -eq 2)
Check "他人插件保留" ((Count-Specs "other/p.mjs") -eq 1)
Check "他人 options 保留" ((Opts-At 0).x -eq 1)
Remove-Item -Recurse -Force $d

Write-Host "[3] 块注释 jsonc（旧版会静默失败）"
$d = New-TempDir @"
{
  /* 块注释
     跨多行 */
  "model": "mimo-v2",
  "plugin": []
}
"@
$rc = Install-MimoMeterPlugin $d (Join-Path $d $PluginFile)
Check "exit 0" ($rc -eq 0) "rc=$rc"
Check "model 保留" ((Load-Config $d).model -eq "mimo-v2")
Remove-Item -Recurse -Force $d

Write-Host "[4] 字符串里的 // 不被当注释"
$d = New-TempDir '{"url":"https://example.com/a//b","plugin":[]}'
$rc = Install-MimoMeterPlugin $d (Join-Path $d $PluginFile)
Check "exit 0" ($rc -eq 0) "rc=$rc"
Check "url 完整" ((Load-Config $d).url -eq "https://example.com/a//b")
Remove-Item -Recurse -Force $d

Write-Host "[5] 尾逗号"
$d = New-TempDir @"
{
  "model": "m",
  "plugin": [],
}
"@
$rc = Install-MimoMeterPlugin $d (Join-Path $d $PluginFile)
Check "exit 0" ($rc -eq 0) "rc=$rc"
Check "model 保留" ((Load-Config $d).model -eq "m")
Remove-Item -Recurse -Force $d

Write-Host "[6] 语法损坏 → 不写文件、返回 2"
$bad = "{`n  `"plugin`": [`n}`n"
$d = New-TempDir $bad
$rc = Install-MimoMeterPlugin $d (Join-Path $d $PluginFile)
Check "rc 2" ($rc -eq 2) "rc=$rc"
Check "文件未改" ([System.IO.File]::ReadAllText((Join-Path $d "mimocode.jsonc")) -eq $bad)
Check "未生成 .bak" (-not (Test-Path (Join-Path $d "mimocode.jsonc.bak")))
Remove-Item -Recurse -Force $d

Write-Host "[7] 重装继承 options（旧版会清零）"
$d = New-TempDir '{"plugin":[["file:///old/mimo-meter.mjs",{"fx":7.5,"showCny":false,"currency":"$"}]]}'
$rc = Install-MimoMeterPlugin $d (Join-Path $d $PluginFile)
Check "exit 0" ($rc -eq 0) "rc=$rc"
Check "条目数 1" ((Load-Plugins $d) -eq 1)
$opts = Opts-At 0
Check "fx 继承" ($opts.fx -eq 7.5) "fx=$($opts.fx)"
Check "showCny 继承" ($opts.showCny -eq $false)
Check "currency 继承" ($opts.currency -eq '$')
Remove-Item -Recurse -Force $d

Write-Host "[8] 旧名 mimo-stats + 本名重复 → 只留一条"
$d = New-TempDir '{"plugin":[["file:///a/mimo-stats.mjs",{}],["file:///b/mimo-meter.mjs",{}],["file:///c/other.mjs",{}]]}'
$rc = Install-MimoMeterPlugin $d (Join-Path $d $PluginFile)
Check "exit 0" ($rc -eq 0) "rc=$rc"
Check "只剩 2 条" ((Load-Plugins $d) -eq 2) "count=$(Load-Plugins $d)"
Check "other 保留" ((Count-Specs "other.mjs") -eq 1)
Check "无 mimo-stats" ((Count-Specs "mimo-stats") -eq 0)
Remove-Item -Recurse -Force $d

Write-Host "[9] .bak 只写一次"
$d = New-TempDir '{"model":"original","plugin":[]}'
Install-MimoMeterPlugin $d (Join-Path $d $PluginFile) | Out-Null
$first = [System.IO.File]::ReadAllText((Join-Path $d "mimocode.jsonc.bak"))
Check "首次 .bak 是原文" ($first.Contains('"original"'))
$cfg = Load-Config $d
$cfg.model = "changed"
Write-JsoncFile (Join-Path $d "mimocode.jsonc") $cfg
Install-MimoMeterPlugin $d (Join-Path $d $PluginFile) | Out-Null
$second = [System.IO.File]::ReadAllText((Join-Path $d "mimocode.jsonc.bak"))
Check ".bak 未被覆盖" ($first -eq $second)
Remove-Item -Recurse -Force $d

Write-Host "[10] 没有 mimocode.jsonc → 新建"
$d = New-TempDir -NoFile
$rc = Install-MimoMeterPlugin $d (Join-Path $d $PluginFile)
$cfg = Load-Config $d
Check "exit 0" ($rc -eq 0) "rc=$rc"
Check "有 plugin" ((Load-Plugins $d) -eq 1)
Check "有 schema" ($null -ne $cfg.PSObject.Properties['$schema'])
Check "无 .bak（原文不存在）" (-not (Test-Path (Join-Path $d "mimocode.jsonc.bak")))
Remove-Item -Recurse -Force $d

Write-Host "[11] plugin 是字符串（脏数据）→ 修成数组不崩"
$d = New-TempDir '{"model":"m","plugin":"oops"}'
$rc = Install-MimoMeterPlugin $d (Join-Path $d $PluginFile)
$cfg = Load-Config $d
Check "exit 0" ($rc -eq 0) "rc=$rc"
Check "plugin 变数组" ((Load-Plugins $d) -eq 1)
Check "model 保留" ($cfg.model -eq "m")
Remove-Item -Recurse -Force $d

Write-Host "[12] uninstall 只删自己，保留他人"
$d = New-TempDir '{"model":"m","plugin":[["file:///a/mimo-meter.mjs",{"fx":7.5}],["file:///b/other.mjs",{"y":2}]]}'
$rc = Uninstall-MimoMeterPlugin $d
Check "exit 0" ($rc -eq 0) "rc=$rc"
Check "model 保留" ((Load-Config $d).model -eq "m")
Check "只剩 other" ((Load-Plugins $d) -eq 1) "count=$(Load-Plugins $d)"
Check "other 完好" ((Spec-At 0).Contains("other.mjs") -and (Opts-At 0).y -eq 2)
Remove-Item -Recurse -Force $d

Write-Host "[13] uninstall 遇损坏文件 → 不动文件"
$bad = '{"plugin": [ oops ]}'
$d = New-TempDir $bad
$rc = Uninstall-MimoMeterPlugin $d
Check "rc 2" ($rc -eq 2) "rc=$rc"
Check "文件未改" ([System.IO.File]::ReadAllText((Join-Path $d "mimocode.jsonc")) -eq $bad)
Remove-Item -Recurse -Force $d

Write-Host "[14] uninstall 无本插件 → 不重写文件"
$original = "{`n  // 保留注释`n  `"plugin`": []`n}`n"
$d = New-TempDir $original
$rc = Uninstall-MimoMeterPlugin $d
Check "exit 0" ($rc -eq 0) "rc=$rc"
Check "文件字节未变" ([System.IO.File]::ReadAllText((Join-Path $d "mimocode.jsonc")) -eq $original)
Remove-Item -Recurse -Force $d

Write-Host "[15] 连续安装两次 → 结果一致"
$d = New-TempDir '{"model":"m","plugin":[]}'
Install-MimoMeterPlugin $d (Join-Path $d $PluginFile) | Out-Null
$a = [System.IO.File]::ReadAllText((Join-Path $d "mimocode.jsonc"))
Install-MimoMeterPlugin $d (Join-Path $d $PluginFile) | Out-Null
$b = [System.IO.File]::ReadAllText((Join-Path $d "mimocode.jsonc"))
Check "两次字节一致" ($a -eq $b)
Check "只有一条" ((Load-Plugins $d) -eq 1)
Remove-Item -Recurse -Force $d

Write-Host "[16] 含空格路径被正确 URL 编码"
$d = New-TempDir '{"plugin":[]}'
$rc = Install-MimoMeterPlugin $d "C:\Program Files\MiMo\mimo-meter.mjs"
Load-Plugins $d | Out-Null
$spec = Spec-At 0
Check "exit 0" ($rc -eq 0) "rc=$rc"
Check "空格编码为 %20" ($spec.Contains("%20") -and -not $spec.Contains(" ")) "spec=$spec"
Remove-Item -Recurse -Force $d

Write-Host "[17] 输出是无 BOM 的 UTF-8"
$d = New-TempDir '{"plugin":[]}'
Install-MimoMeterPlugin $d (Join-Path $d $PluginFile) | Out-Null
$bytes = [System.IO.File]::ReadAllBytes((Join-Path $d "mimocode.jsonc"))
$hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
Check "首字节不是 BOM" (-not $hasBom)
Remove-Item -Recurse -Force $d

Write-Host "[18] Get-MimoMeterVersion"
$d = New-TempDir '{}'
$p = Join-Path $d "x.mjs"
[System.IO.File]::WriteAllText($p, 'const VERSION = "2.0.1";' + "`n", (New-Object System.Text.UTF8Encoding $false))
Check "读到版本" ((Get-MimoMeterVersion $p) -eq "2.0.1")
Remove-Item -Recurse -Force $d

Write-Host "[19] 输入文件带 BOM 也能正确处理"
$d = New-TempDir '{}'
$bomPath = Join-Path $d "mimocode.jsonc"
$bomBytes = [byte[]](0xEF, 0xBB, 0xBF) + [System.Text.Encoding]::UTF8.GetBytes('{"model":"bom-model","plugin":[]}')
[System.IO.File]::WriteAllBytes($bomPath, $bomBytes)
$rc = Install-MimoMeterPlugin $d (Join-Path $d $PluginFile)
Check "exit 0" ($rc -eq 0) "rc=$rc"
Check "model 保留" ((Load-Config $d).model -eq "bom-model")
Remove-Item -Recurse -Force $d

# ------------------------------------------------------------------ 汇总

Write-Host ""
if ($script:Failed.Count -gt 0) {
  Write-Host ("FAILED {0} / {1}: {2}" -f $script:Failed.Count, ($script:Passed + $script:Failed.Count), ($script:Failed -join ", ")) -ForegroundColor Red
  exit 1
}
Write-Host ("ALL PASS ({0} checks)" -f $script:Passed) -ForegroundColor Green
exit 0
