#Requires -Version 5.1
<#
  mimocode.jsonc 的稳健读写工具（Windows 侧，install.ps1 / uninstall.ps1 共用）

  与 scripts/jsonc_edit.py 行为对齐：
    * 支持 jsonc 注释（// 与 /* */，不误伤字符串里的 //）与尾逗号
    * 解析失败 → 抛异常，调用方负责中止，绝不写文件
    * 只改 plugin 一个键，其它顶层键（model / theme / ...）原样保留
    * 重装时继承已有 options（fx / showCny / currency），不清零
    * 首次安装才写 .bak，不覆盖用户最初那份备份
    * 原子写（temp + Move-Item），写后回读校验
    * 写 UTF-8 无 BOM（PS 5.1 的 -Encoding UTF8 会带 BOM）

  注意：PS 5.1 没有 ConvertFrom-Json 的注释支持，所以这里自带一个清洗器。
#>

$ErrorActionPreference = "Stop"

$script:SchemaUrl = "https://mimo.xiaomi.com/mimocode/config.json"
$script:OwnMarkers = @("mimo-meter", "mimo-stats")

function Remove-JsoncComments {
  <# 去掉 // 与 /* */ 注释，字符串内不动；换行保留以维持行号。 #>
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return "" }

  $sb = New-Object System.Text.StringBuilder ($Text.Length + 16)
  $i = 0
  $n = $Text.Length
  $inStr = $false

  while ($i -lt $n) {
    $ch = $Text[$i]
    if ($inStr) {
      [void]$sb.Append($ch)
      if ($ch -eq '\' -and ($i + 1) -lt $n) {
        [void]$sb.Append($Text[$i + 1])
        $i += 2
        continue
      }
      if ($ch -eq '"') { $inStr = $false }
      $i++
      continue
    }
    if ($ch -eq '"') {
      $inStr = $true
      [void]$sb.Append($ch)
      $i++
      continue
    }
    if ($ch -eq '/' -and ($i + 1) -lt $n) {
      $nxt = $Text[$i + 1]
      if ($nxt -eq '/') {
        while ($i -lt $n -and $Text[$i] -ne "`n") { $i++ }
        continue
      }
      if ($nxt -eq '*') {
        $i += 2
        while (($i + 1) -lt $n -and -not ($Text[$i] -eq '*' -and $Text[$i + 1] -eq '/')) {
          if ($Text[$i] -eq "`n") { [void]$sb.Append("`n") }
          $i++
        }
        $i += 2
        continue
      }
    }
    [void]$sb.Append($ch)
    $i++
  }
  return $sb.ToString()
}

function Remove-TrailingCommas {
  <# 去掉 } 或 ] 前的多余逗号，字符串内不动。 #>
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return "" }

  $sb = New-Object System.Text.StringBuilder ($Text.Length + 16)
  $i = 0
  $n = $Text.Length
  $inStr = $false

  while ($i -lt $n) {
    $ch = $Text[$i]
    if ($inStr) {
      [void]$sb.Append($ch)
      if ($ch -eq '\' -and ($i + 1) -lt $n) {
        [void]$sb.Append($Text[$i + 1])
        $i += 2
        continue
      }
      if ($ch -eq '"') { $inStr = $false }
      $i++
      continue
    }
    if ($ch -eq '"') {
      $inStr = $true
      [void]$sb.Append($ch)
      $i++
      continue
    }
    if ($ch -eq ',') {
      $j = $i + 1
      while ($j -lt $n -and ($Text[$j] -eq ' ' -or $Text[$j] -eq "`t" -or $Text[$j] -eq "`r" -or $Text[$j] -eq "`n")) {
        $j++
      }
      if ($j -lt $n -and ($Text[$j] -eq '}' -or $Text[$j] -eq ']')) {
        $i++
        continue
      }
    }
    [void]$sb.Append($ch)
    $i++
  }
  return $sb.ToString()
}

function ConvertFrom-Jsonc {
  <# 严格 JSON 优先；失败再按 jsonc 清洗。都不行就抛。 #>
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
  try {
    return $Text | ConvertFrom-Json
  } catch {
    $cleaned = Remove-TrailingCommas (Remove-JsoncComments $Text)
    return $cleaned | ConvertFrom-Json
  }
}

function Read-JsoncFile {
  <# 返回 @{ Data = 对象或 $null; Raw = 原文或 $null; Exists = 文件是否原本存在 }。
     Exists 单独给，是因为 PS 里 [string]$null 会被强制转成空串，
     用 $null 判断「文件不存在」并不可靠。 #>
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return @{ Data = $null; Raw = $null; Exists = $false }
  }
  $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  # 吃掉可能存在的 BOM
  if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }
  $data = ConvertFrom-Jsonc $raw
  return @{ Data = $data; Raw = $raw; Exists = $true }
}

function Write-JsoncFile {
  <# 原子写 UTF-8 无 BOM + 回读校验。 #>
  param([string]$Path, $Data)
  $json = $Data | ConvertTo-Json -Depth 100
  $tmp = "$Path.tmp"
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($tmp, $json + "`n", $utf8)
  Move-Item -LiteralPath $tmp -Destination $Path -Force

  # 回读校验
  $back = ConvertFrom-Jsonc ([System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8))
  if (-not $back -or -not ($back.PSObject.Properties.Name -contains 'plugin')) {
    throw "回读校验失败：plugin 键丢失"
  }
}

function Backup-JsoncOnce {
  <# 只在还没有 .bak 时备份，保住用户最初那份。
     注意：$Raw 为空串（原文是空文件）时仍然备份，只有「文件原本不存在」才跳过。 #>
  param([string]$Path, [string]$Raw, [bool]$Exists)
  if (-not $Exists) { return $null }
  $bak = "$Path.bak"
  if (Test-Path -LiteralPath $bak) { return $null }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($bak, $Raw, $utf8)
  return $bak
}

function Restore-JsoncFile {
  param([string]$Path, [string]$Raw, [bool]$Exists)
  if (-not $Exists) {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    return
  }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText("$Path.restore", $Raw, $utf8)
  Move-Item -LiteralPath "$Path.restore" -Destination $Path -Force
}

function Get-EntrySpec {
  <# 条目可能是 "spec" 或 ["spec", {options}]。取 spec。 #>
  param($Entry)
  if ($Entry -is [string]) { return $Entry }
  if ($Entry -is [System.Array] -and $Entry.Count -ge 1 -and $Entry[0] -is [string]) { return [string]$Entry[0] }
  return $null
}

function Get-EntryOptions {
  <# 取条目的 options 对象；没有就返回 $null。 #>
  param($Entry)
  if ($Entry -is [System.Array] -and $Entry.Count -ge 2 -and $null -ne $Entry[1] -and $Entry[1] -isnot [string]) {
    return $Entry[1]
  }
  return $null
}

function Test-OwnEntry {
  param([string]$Spec)
  if ([string]::IsNullOrEmpty($Spec)) { return $false }
  foreach ($m in $script:OwnMarkers) {
    if ($Spec.Contains($m)) { return $true }
  }
  return $false
}

function Get-PluginList {
  <# 把 $Data.plugin 规范成数组；非数组时按空数组处理。
     返回时用 ,@() 包一层：PS 的 return 会把集合展开，不包的话
     单元素 plugin 会被拆成它内部的两个字段，是最容易踩的坑。

     注意 @($string) 会得到 1 元素数组，所以必须先判类型，
     否则 "plugin": "oops" 会被当成一个合法字符串条目保留下来，
     与 Python 侧行为不一致。 #>
  param($Data)
  $list = New-Object System.Collections.ArrayList
  if ($null -eq $Data) { return ,@() }
  $prop = $Data.PSObject.Properties['plugin']
  if ($null -eq $prop -or $null -eq $prop.Value) { return ,@() }
  if ($prop.Value -isnot [System.Array]) { return ,@() }
  foreach ($e in $prop.Value) { [void]$list.Add($e) }
  return ,@($list.ToArray())
}

function Set-PluginList {
  <# 只改 plugin 键，其它顶层键原样保留。 #>
  param($Data, $List)
  $arr = @($List)
  if ($null -eq $Data) {
    $Data = [pscustomobject]@{}
  }
  if ($Data.PSObject.Properties['plugin']) {
    $Data.plugin = $arr
  } else {
    $Data | Add-Member -NotePropertyName 'plugin' -NotePropertyValue $arr
  }
  if (-not $Data.PSObject.Properties['$schema']) {
    $Data | Add-Member -NotePropertyName '$schema' -NotePropertyValue $script:SchemaUrl
  }
  return $Data
}

function Install-MimoMeterPlugin {
  <# 返回退出码：0 成功 / 2 解析失败（未改动） / 3 写入失败（已回滚） #>
  param([string]$ConfigDir, [string]$PluginPath)

  $path = Join-Path $ConfigDir "mimocode.jsonc"
  $read = $null
  try {
    $read = Read-JsoncFile $path
  } catch {
    Write-Host "解析 $path 失败，未做任何修改：$_" -ForegroundColor Red
    Write-Host "请先修好这个文件的语法（常见原因：单引号、重复键、未闭合括号）。" -ForegroundColor Red
    return 2
  }

  $data = $read.Data
  $raw = $read.Raw
  $exists = $read.Exists

  if ($null -ne $data -and $data -is [System.Array]) {
    Write-Host "配置顶层是数组而不是对象，未做任何修改。" -ForegroundColor Red
    return 2
  }

  $keep = New-Object System.Collections.ArrayList
  $inherited = $null
  $hasInherited = $false
  $removed = 0
  foreach ($entry in (Get-PluginList $data)) {
    $spec = Get-EntrySpec $entry
    if (Test-OwnEntry $spec) {
      $removed++
      $opts = Get-EntryOptions $entry
      if ($null -ne $opts) { $inherited = $opts; $hasInherited = $true }
      continue
    }
    [void]$keep.Add($entry)
  }

  $options = @{}
  if ($hasInherited) {
    foreach ($p in $inherited.PSObject.Properties) { $options[$p.Name] = $p.Value }
  }

  $spec = ConvertTo-FileUri $PluginPath
  [void]$keep.Add(@($spec, $options))

  $data = Set-PluginList $data $keep

  $bak = Backup-JsoncOnce $path $raw $exists
  try {
    Write-JsoncFile $path $data
  } catch {
    Write-Host "写入失败，正在回滚：$_" -ForegroundColor Red
    Restore-JsoncFile $path $raw $exists
    return 3
  }

  if ($bak) { Write-Host "已备份原配置：$bak" }
  if ($removed -gt 0) { Write-Host "已替换 $removed 条旧登记" }
  if ($hasInherited) {
    Write-Host ("已继承原有 options：" + ($inherited | ConvertTo-Json -Compress -Depth 10))
  }
  Write-Host "已登记插件：$spec"
  return 0
}

function Uninstall-MimoMeterPlugin {
  <# 返回退出码：0 成功或无操作 / 2 解析失败（未改动） / 3 写入失败（已回滚） #>
  param([string]$ConfigDir)

  $path = Join-Path $ConfigDir "mimocode.jsonc"
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Host "没有 mimocode.jsonc，跳过登记清理"
    return 0
  }

  $read = $null
  try {
    $read = Read-JsoncFile $path
  } catch {
    Write-Host "解析 $path 失败，未做任何修改：$_" -ForegroundColor Red
    return 2
  }

  $data = $read.Data
  $raw = $read.Raw
  $exists = $read.Exists
  if ($null -ne $data -and $data -is [System.Array]) {
    Write-Host "配置顶层是数组而不是对象，未做任何修改。" -ForegroundColor Red
    return 2
  }

  $keep = New-Object System.Collections.ArrayList
  $removed = 0
  foreach ($entry in (Get-PluginList $data)) {
    if (Test-OwnEntry (Get-EntrySpec $entry)) { $removed++; continue }
    [void]$keep.Add($entry)
  }

  if ($removed -eq 0) {
    Write-Host "plugin 数组里没有本插件的登记"
    return 0
  }

  $data = Set-PluginList $data $keep
  $bak = Backup-JsoncOnce $path $raw $exists
  try {
    Write-JsoncFile $path $data
  } catch {
    Write-Host "写入失败，正在回滚：$_" -ForegroundColor Red
    Restore-JsoncFile $path $raw $exists
    return 3
  }

  if ($bak) { Write-Host "已备份原配置：$bak" }
  Write-Host "已从 plugin 数组移除 $removed 项"
  return 0
}

function ConvertTo-FileUri {
  <# 绝对路径 → file:// URL。用 Uri 构造函数而不是 [Uri] 强制转换：
     PS 的 cast 在非 Windows 上对绝对路径会返回空 AbsoluteUri。 #>
  param([string]$Path)
  $u = New-Object System.Uri($Path)
  return $u.AbsoluteUri
}

function Get-MimoMeterVersion {
  param([string]$MjsPath)
  try {
    foreach ($line in [System.IO.File]::ReadLines($MjsPath)) {
      $t = $line.Trim()
      if ($t.StartsWith('const VERSION = ')) {
        $parts = $t.Split('"')
        if ($parts.Count -ge 2) { return $parts[1] }
      }
    }
  } catch { }
  return "unknown"
}
