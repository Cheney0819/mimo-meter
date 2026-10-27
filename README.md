<div align="center">

# mimo-meter

**给 MiMo Desktop 加一条常驻状态栏：Token 用量 · 步数 · 缓存命中率 · 费用**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.0.2-green.svg)](../../releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)](#-平台支持)
[![No Telemetry](https://img.shields.io/badge/telemetry-none-brightgreen.svg)](#-隐私与安全)

[这是什么](#-这是什么) · [功能](#-功能) · [截图](#-截图) · [一键安装](#-快速开始) · [配置](#配置) · [数据口径](#-数据口径) · [工作原理](#-工作原理) · [排错](#-排错) · [FAQ](#-faq)

</div>

---

> [!WARNING]
> **非官方项目**。本项目通过读取 MiMo Desktop 的本地运行时与 SQLite 数据库实现，
> 不修改 `app.asar`、不改运行时文件、不动代码签名。
> MiMo 升级后内部结构可能变化，届时需要跟随适配。请自行评估在正式环境使用的风险。

---

## 📖 这是什么

MiMo Desktop 不显示一个会话烧了多少 token、缓存命中了多少、花了多少钱。
**mimo-meter** 在输入框下方补一行常驻状态，点开还有明细卡片：

```
🕐 2 轮 21 步 · ≈96 tok/s   🗄 1.65M tok · 命中 86.7%      内容由 AI 生成，请注意核实
└──────────────── 状态栏 ────────────────┘                └──── app 原有文案保持居中 ────┘
```

它**只做三件事**：往 `engine-config/` 放 3 个文件、在 `mimocode.jsonc` 登记一行、注入一段浮层。
卸载就是删掉这些文件，应用完全还原。

## ✨ 功能

- **实时状态栏** —— 轮数、步数、输出速度、总 token、缓存命中率，随会话滚动更新（400ms 合并刷新）
- **两张独立明细卡** —— 左段点开是**会话统计**（模型用时 / 工具用时 / TTFT / TPS），右段点开是 **Token 用量**（缓存读写 / 未缓存输入 / 输出 / 推理 / 费用）；各开各的，互斥显示
- **按会话精确统计** —— 切会话数字跟着换，不会串号
- **首页不显示** —— 没有会话就没有数字，不在空页面上编造数据
- **三档自适应宽度** —— 窗口变窄自动降级文案，永远不会盖住 app 自己的居中免责声明
- **跟随主题** —— 浅色/深色自动切换
- **零依赖** —— 只用 Electron + Node 标准库，无原生模块、无需编译
- **零联网** —— 没有 fetch、没有上报、没有崩溃采集

## 📸 截图

<div align="center">

**状态栏**（嵌在输入框下方那一行，与 app 自己的免责声明同排）

<img src="docs/images/bar.png" width="582" alt="底栏状态条：轮数、步数、tok/s、总量、缓存命中率">

**明细卡片**（点状态栏对应那一段展开：左段看会话统计，右段看 Token 用量）

<img src="docs/images/panel.png" width="540" alt="Token 用量与会话统计卡片">

</div>

## 📋 环境要求

| 项目 | 要求 |
| --- | --- |
| MiMo Desktop | 已安装并能正常启动（实测 26.1023.231655） |
| 操作系统 | macOS / Windows（见[平台支持](#-平台支持)） |
| 权限 | 无需管理员 / 无需 sudo |
| 依赖 | 运行插件**零依赖**（只用 Electron + Node 标准库）。安装脚本需要 `python3` 或 `pwsh`/PowerShell 来安全地改 `mimocode.jsonc`；macOS 若没有可 `xcode-select --install` |

## 🚀 快速开始

### 方式一：让 AI 助手一键安装（推荐）

把下面这句话丢给任意能执行命令的 AI 助手（MiMo 自带助手 / Claude Code / Cursor 都行）：

```text
帮我安装 mimo-meter 插件：https://github.com/Cheney0819/mimo-meter.git
```

装完打开任意会话，输入框下方应出现状态条。

### 方式二：手动安装

**1. 克隆**

```bash
git clone https://github.com/Cheney0819/mimo-meter.git
cd mimo-meter
```

**2. 安装**

**macOS**

```bash
./install.sh
osascript -e 'quit app "Xiaomi MiMo"'; sleep 2
env -u ELECTRON_RUN_AS_NODE open -a 'Xiaomi MiMo'
```

**Windows**（PowerShell 5.1+）

在**仓库目录里打开 PowerShell 窗口**执行（不要直接双击 `.ps1`）：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
# 然后从托盘图标右键完全退出 MiMo，再从开始菜单重新打开
```

> [!IMPORTANT]
> **不要双击 `install.ps1`**。双击时脚本跑完窗口会立刻关闭，
> 出错信息一闪而过，看起来就是「闪退」。
> 如果已经双击了，脚本检测到双击启动时会在出错后停住等你按回车。
>
> 想看得更清楚，可以先 `cd` 到仓库目录，再执行上面的命令。

**3. 验证**

打开任意一个会话，输入框下方应出现状态条。点「轮 / 步」那一段展开**会话统计**卡，点「tok / 命中率」那一段展开 **Token 用量**卡。

日志位置：

| 平台 | 路径 |
| --- | --- |
| macOS | `~/Library/Logs/mimo-meter/mimo-meter.log` |
| Windows | `%LOCALAPPDATA%\mimo-meter\mimo-meter.log` |

正常启动应包含：

```
booted {"plugin":"2.0.2","overlay":"2.0.2","platform":"darwin",...}
```

**卸载**

```bash
./uninstall.sh              # macOS：只移除插件
./uninstall.sh --purge      # 额外删除日志与 metrics.json
```

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1           # Windows
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -Purge    # 连日志一起删
```

然后重启应用。`uninstall` 会同时清理旧版本（`mimo-stats`）的残留。

## 🖥 平台支持

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| **macOS** | ✅ 实机验证 | 截图与数据来自 macOS arm64，MiMo 26.1023.231655 |
| **Windows** | ✅ 实机验证 | Windows 版已实机跑通，状态栏与卡片正常显示 |

平台差异只在**路径**，核心逻辑（桥拦截 / SQLite / 注入）完全一致：

| 用途 | macOS | Windows |
| --- | --- | --- |
| Electron userData | `~/Library/Application Support/Xiaomi MiMo` | `%APPDATA%\Xiaomi MiMo` |
| 日志 / 指标 | `~/Library/Logs/mimo-meter` | `%LOCALAPPDATA%\mimo-meter` |
| 引擎数据库 | `~/.local/share/mimocode/mimocode.db` | `%LOCALAPPDATA%\mimocode\mimocode.db`（多候选） |
| 字体栈 | SF / PingFang | Segoe UI / 微软雅黑 |

### Windows 安装自检

装完如果状态条没出现，按顺序看日志（`%LOCALAPPDATA%\mimo-meter\mimo-meter.log`）：

| 日志内容 | 含义 |
| --- | --- |
| `db opened ...` | 数据库路径正确 |
| `bridge hooked {handlers:252}` | 桥拦截成功 |
| `booted {"platform":"win32",...}` | 插件加载成功 |
| `bridge module not found` | runtime 目录结构变化，请附日志提 issue |
| 完全没有日志文件 | 插件没被加载，检查 `mimocode.jsonc` 里的 `file://` 路径 |
| 脚本报错里全是乱码 | `.ps1` 文件缺少 UTF-8 BOM（PowerShell 5.1 会按 GBK 解码）。请用仓库原版文件 |

另外确认 `%APPDATA%\Xiaomi MiMo\engine-config` 存在（说明 userData 路径正确）。

## 配置

在 `engine-config/mimocode.jsonc` 里给插件传 options：

```json
{
  "plugin": [
    [
      "file:///path/to/mimo-meter.mjs",
      { "currency": "¥", "fx": 7.142857, "showCny": true }
    ]
  ]
}
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `currency` | `"¥"` | 金额前缀符号 |
| `fx` | `1 / 0.14` | 美元 → 人民币汇率（见[费用](#-费用是什么货币)） |
| `showCny` | `true` | `true` 显示换算后的人民币；`false` 显示引擎原值（美元） |

> [!NOTE]
> `currency` 只改前缀符号，不会做单位换算；要显示美元请同时设
> `"showCny": false, "currency": "$"`。重装不会清掉这些选项——
> 安装脚本会继承已有条目里的 `options`。

### 快捷键

| 按键 | 动作 |
| --- | --- |
| 点「轮 / 步 / tok/s」那段 | 展开 **会话统计** 卡（模型用时 / 工具用时 / TTFT / TPS） |
| 点「tok / 命中率」那段 | 展开 **Token 用量** 卡（缓存读写 / 输出 / 推理 / 费用） |
| `⌥⌘T` | 开合 Token 用量卡 |
| `⌥⌘Y` | 开合会话统计卡 |
| `Esc` | 收起当前卡片 |

两张卡片各自独立、互斥展开（同时只开一张）。

## 📊 数据口径

| 指标 | 来源 | 公式 |
| --- | --- | --- |
| **Token 总量** | `part.tokens.total` | `input + output + reasoning + cache.read + cache.write` |
| 缓存命中率 | 同上 | `cache.read / (cache.read + input)` |
| 未缓存输入 | 同上 | `tokens.input` |
| 缓存读取 | 同上 | `tokens.cache.read` |
| 输出 / 推理 | 同上 | `tokens.output` / `tokens.reasoning` |
| 轮 | `message` 表 | `role = 'user'` 的条数 |
| 步 | `part` 表 | `type = 'step-finish'` 的条数 |
| tok/s | `metrics.model_call` 事件 | `output / ((latency - ttft)/1000)`，最近 6 次均值 |
| 费用 | `message.cost` | 直接求和（引擎原值） |
| 模型用时 | `message.time` | `Σ(completed - created)`，仅 assistant |
| 工具调用用时 | `part.state.time` | `Σ(end - start)`，仅 `type=tool` |
| TTFT / TPS | 自记 `metrics.json` | 引擎不落库，插件按会话累计 |

> [!IMPORTANT]
> **总量必须含 `reasoning`**。引擎的 `tokens.total` 定义是
> `input + output + reasoning + cache.read + cache.write`，
> 漏掉 `reasoning` 会导致每个会话都少算（v1.6.4 修过一次）。

> [!NOTE]
> **费用为 0 时显示 `¥0.000`，不再整行隐藏**。v2.0.1 起区分「没有数据」和
> 「确实是 0 元」——后者（免费额度、本地模型）以前会被误当成缺失值。

### 刷新策略

面板每 400ms 尝试刷新，但**不会每次都查数据库**：

| 时机 | 行为 |
| --- | --- |
| 流式输出中（`message.part.delta`） | 只更新忙碌指示与 TPS，**不查库**（此时库还没落盘） |
| `message.updated` / `part.updated` / `session.idle` | 让缓存失效，下一 tick 重新聚合 |
| 切换会话 | 清掉该会话缓存后立即重算 |

统计结果按会话缓存（最多 8 个）。实测一个 1 万条消息的会话，完整聚合约
17ms，缓存命中为 0ms；流式回答期间主进程 CPU 从约 4.8% 降到接近 0。

### 当前会话是怎么定位的

不是拦 HTTP，而是在主进程 hook IPC 桥的 handler 注册表：

| 桥方法 | 抓法 | 优先级 |
| --- | --- | --- |
| **`mimo:engineStateWatch`** | `{ sessionID: "ses_xxx", ... }` | **主信号**，每次打开会话都触发 |
| `mimo:sessionMessages` | `{ id: "ses_xxx" }` | 非 workspace 会话 |
| `mimo:api` | path 命中 `/session/<sid>` | 兜底 |
| 会话页顶部标题 | 反查 `session.title` | 桥全挂时的最后兜底 |

## 🔬 工作原理

```
  IPC 桥 ────────────┐
  mimo:engineStateWatch ─► 取当前会话 sid（hook handler 注册表）
  ───────────────────┤
  引擎事件总线 ──────► │  mimo-meter.mjs（主进程）
  message.updated      │  · 400ms 合并刷新
  part.updated         │  · 读 mimocode.db 算总量
  metrics.model_call   │  · insertCSS + executeJavaScript
  session.idle         └──────────┬─────────────────┘
                                  │ window.__MIMO_METER__.update(payload)
                    ┌─────────────▼──────────────┐
                    │  overlay.js / overlay.css   │
                    │  状态栏 + 明细卡片           │
                    └─────────────────────────────┘
```

关键逆向结论（可复现）：

1. **Electron fuses**：`RunAsNode=enabled`、`EnableEmbeddedAsarIntegrityValidation=disabled`、
   `OnlyLoadAppFromAsar=disabled`
2. **`app.asar` 只是引导器**（335KB）：真界面在
   `runtime-res/releases/`，由 `app://-` 自定义协议加载（React + Vite）
3. **引擎跑在主进程里**：`main~*.mjs` 里 `await import("./engine-entry~*.mjs")`，
   所以引擎插件能直接 `import("electron")` 拿到 `BrowserWindow`
4. **插件宿主契约**：`plugin.server(input, options)` 返回 hook 对象，
   `hook.event` 通过 `bus.subscribeAll()` 收全部总线事件
5. **配置持久点**：`mimocode.json` 每次启动被 app 重写，但 `mimocode.jsonc` 只读不写
6. **会话消息走 IPC 不走 HTTP**：`loadConvoMessages()` → `Hn().watch()` →
   `mimo:engineStateWatch`，每次打开会话都重新 watch
7. **数据在 SQLite**：`mimocode.db` 的 `message` / `part` 表，WAL 模式，只读连接即可

## 💰 费用是什么货币

**引擎存的是美元**，面板换算成人民币显示。

用 **325 条** `step-finish` 做最小二乘，解出引擎单价（每百万 token）：

```
input 0.14 / output(+reasoning) 0.28 / cache_read 0.0028     残差 2.8e-17
```

MiMo 官方人民币价（实时推理 flash）：`1.00 / 2.00 / 0.02`。三项比值都是
**7.142857 = 1/0.14**：

```
1.00/0.14 = 2.00/0.28 = 0.02/0.0028 = 7.142857
```

即引擎把人民币价按 **1 USD ≈ 7.1428 CNY** 折成美元存入 `message.cost`。
所以 `cost × 7.142857` 就是官方人民币价（实测与官方表逐项相加一致）。

## 🧯 排错

<details>
<summary><b>状态条完全不出现</b></summary>

1. 看日志有没有 `booted` —— 没有就是插件没加载
2. 检查 `mimocode.jsonc` 里 `plugin` 数组的 `file://` URL 是否正确、是否被 URL 编码
3. 确认 MiMo 完全退出后重启（托盘右键退出，不是关窗口）
</details>

<details>
<summary><b>数字和反代 / 账单对不上</b></summary>

1. **先确认版本 ≥ 1.6.4** —— 早期版本漏算 `reasoning`
2. **同期是否还有别的会话** —— 反代按请求聚合，时间窗重叠会把别的会话算进来
3. 仍不符请附：会话名、两边数字、日志
</details>

<details>
<summary><b>数字不更新</b></summary>

引擎写库有延迟，卡片 400ms 合并刷新，最多滞后半秒。持续不动请检查日志有无 `db opened`。
</details>

<details>
<summary><b>应用更新后消失了</b></summary>

runtime 更新不影响 `engine-config/`，但**重装 app 会重置 userData**，重跑 `install.sh` 即可。
</details>

<details>
<summary><b>启动 MiMo 后窗口不出来</b></summary>

环境里可能有 `ELECTRON_RUN_AS_NODE=1`（很多 Electron 工具链会设），应用会以纯 Node 模式运行。

```bash
env -u ELECTRON_RUN_AS_NODE open -a 'Xiaomi MiMo'
```

从 Dock / 开始菜单启动不受影响。
</details>

## ❓ FAQ

<details>
<summary><b>会读取我的对话内容吗？</b></summary>

不会。只取 `tokens` / `cost` / `time` / `title` 字段，**不碰 message 正文**。
</details>

<details>
<summary><b>会联网吗？</b></summary>

不会。代码里没有 fetch、没有上报、没有崩溃采集。
</details>

<details>
<summary><b>会改 MiMo 的文件吗？</b></summary>

不修改 `app.asar`、不修改 `runtime-res`、不动代码签名。
只往 `engine-config/` 放 3 个文件 + 追加一条配置。
</details>

<details>
<summary><b>TTFT / TPS 为什么显示 —</b></summary>

引擎只在 `metrics.model_call` 事件里给 `ttft_ms` / `latency_ms`，**不写库**，历史会话无法反推。
装上之后跑过的会话才有这两项，跑一次就填上。
</details>

<details>
<summary><b>能统计所有会话的累计用量吗？</b></summary>

当前只统计**当前会话**。跨会话累计需要加会话选择器，尚未实现（欢迎 PR）。
</details>

<details>
<summary><b>支持其他 AI 客户端吗？</b></summary>

不支持。本项目深度依赖 MiMo 的 IPC 桥名、数据库 schema 与 DOM 结构，不具备通用性。
</details>

## 🔒 隐私与安全

**读什么**

| 目标 | 权限 | 用途 |
| --- | --- | --- |
| `mimocode.db` | **只读** | 算 token / 步数 / 耗时 |
| 主进程桥注册表 | 内存 hook | 拿当前 `sessionId` |
| 渲染进程 DOM | 注入浮层 | 插入状态条 |

**不做什么**

- ❌ 不联网 · ❌ 不读对话正文 · ❌ 不写数据库 · ❌ 不改签名

**写什么**

| 路径 | 内容 |
| --- | --- |
| `engine-config/` 3 个文件 | 插件本体 |
| `engine-config/mimocode.jsonc` | 追加一条登记（保留已有条目） |
| 日志目录 | 运行日志 + `metrics.json`（TTFT/TPS 累计） |

**审计建议**：全部逻辑在 `src/` 三个文件、约 2000 行，无压缩无混淆，可直接阅读。

> 日志与 `metrics.json` 默认**不随卸载删除**（便于排查残留问题）。
> 需要一起清掉请用 `./uninstall.sh --purge` 或 `uninstall.ps1 -Purge`。

## 📁 项目结构

```
src/
  mimo-meter.mjs          引擎插件（主进程）：事件订阅 / DB 统计 / 注入推送
  overlay.js              渲染进程浮层（幂等注入、开合、主题跟随）
  overlay.css             浮层样式（浅色/深色双主题）
scripts/
  jsonc_edit.py           mimocode.jsonc 的安全编辑器（macOS/Linux）
  jsonc_edit.ps1          同上（Windows / PowerShell）
  test_jsonc_edit.py      配置编辑回归测试（48 项）
  test_jsonc_edit.ps1     配置编辑回归测试（53 项）
  test_overlay.mjs        浮层行为测试（17 项，需 Chrome）
  check-version.mjs       版本号一致性检查
install.sh / uninstall.sh       macOS
install.ps1 / uninstall.ps1     Windows
docs/images/                    截图
```

安装后落点：

```
<userData>/engine-config/mimo-meter.mjs
<userData>/engine-config/mimo-meter-overlay.js
<userData>/engine-config/mimo-meter-overlay.css
<userData>/engine-config/mimocode.jsonc          ← plugin 数组登记
```

## 🗺 Roadmap

- [x] ~~Windows 实机验证与路径适配~~（v2.0.0 已验证通过）
- [ ] 跨会话累计用量（今日 / 本周 / 全部）
- [ ] 状态栏自定义：可选显示项、顺序、紧凑度
- [ ] 导出会话用量为 CSV / JSON

## 🤝 贡献

欢迎 issue 与 PR。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

```bash
node --check src/mimo-meter.mjs
node --check src/overlay.js
bash -n install.sh && bash -n uninstall.sh
node scripts/check-version.mjs
python3 scripts/test_jsonc_edit.py
node scripts/test_overlay.mjs        # 需要 Chrome
```

## 📄 License

[MIT](LICENSE) © mimo-meter contributors

## ⚠️ 免责声明

本项目与小米 / MiMo 官方**无任何关联**，未获官方授权或认可。
"MiMo"、"Xiaomi" 等名称与商标归其各自所有者。
使用本项目造成的任何后果由使用者自行承担。
