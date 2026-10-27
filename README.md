# mimo-stats

**给 MiMo Desktop 加一条 Token / 步数 / 缓存命中 / 费用的常驻状态栏。**

MIT License · 无遥测 · 不上传任何数据 · 只读本地数据库

> ⚠️ **非官方项目**。通过读取 MiMo 本地运行时与 SQLite 数据库实现，不修改 `app.asar`、
> 不改运行时文件、不动代码签名。MiMo 升级后内部结构可能变化，届时需要跟随适配。
> 请自行评估在正式环境使用的风险。

给 MiMo Desktop 的底栏加一行常驻状态：`3 轮 16 步 · ≈20 tok/s ｜ 800.5K tok · 命中 96.2%`，
就贴在 composer 底下那行的**左侧**（「内容由 AI 生成，请注意核实」保持居中不动），
同一行、同一个 10px 灰调。点它（或 `⌥⌘T`）在正上方展开「Token 用量 / 会话统计」明细卡片。

支持 macOS（实机验证）与 Windows（代码已跨平台化，见「平台支持」）。

不改 app.asar、不改 runtime 文件、不动代码签名 —— 只往 `engine-config/` 放 3 个文件 + 登记一行配置。

```
   IPC 桥 ───────────┐
   mimo:sessionMessages ─► 取当前会话 sid（主进程 hook handler 注册表）
   ──────────────────┐
   引擎事件总线 ─────► │  mimo-stats.mjs (主进程)
   message.updated     │  · 400ms 合并刷新
   part.updated        │  · 读 mimocode.db 按 session_id 算总量
   metrics.model_call  │  · insertCSS + executeJavaScript
   session.idle        └───────────┬──────────────────┘
                                   │ window.__MIMO_STATS__.update(payload)
                     ┌─────────────▼─────────────────┐
                     │  overlay.js / overlay.css      │
                     │  底栏状态条 + 明细卡片          │
                     └───────────────────────────────┘
```

界面形态（自动选）：

显示条件：`pageView === "thread"`（composer 里有「内容由 AI 生成」那行）或桥已抓到当前会话 `sid`；
首页 / 视图未知一律不显示。

| 形态 | 挂载点 | 长相 |
| --- | --- | --- |
| inline | 会话页：`.composer-wrap` 里绝对定位 `left:28px; bottom:6px`，落在免责声明那行左侧<br>首页：`.composer-wrap` 下面那行 `.scope-chips` 靠右（首页本来就隐藏） | `3 轮 16 步 · ≈20 tok/s ｜ 800.5K tok · 命中 96.2%` |
| float | 找不到 composer 时 | 右下角胶囊 `16 步 · 800.5K tok · 96.2%` |

位置用**内联样式**写死（`position/right/bottom`），因为 MiMo 自带 CSS 会盖掉
`insertCSS` 里对同一元素的定位声明（实测 `bottom:6px` 被算成 `top:8px`、右边还溢出 29px）。

## 平台支持

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| macOS | ✅ 实机验证 | 本文所有截图与数据都来自 macOS（arm64, MiMo 26.1023.231655） |
| Windows | ⚠️ 代码已跨平台化，**未实机验证** | 前提是小米有发布 Windows 版 MiMo Desktop；插件只依赖 Electron + Node 标准库，无原生模块 |
| Linux | ❔ 未验证 | 若 MiMo 有 Linux 版，路径按 `~/.config/Xiaomi MiMo` 走 |

三个平台差异只在**路径**和**装法**，核心逻辑（桥拦截 / SQLite / 注入）完全一样：

| 用途 | macOS | Windows |
| --- | --- | --- |
| Electron userData（`engine-config`、`runtime-res`） | `~/Library/Application Support/Xiaomi MiMo` | `%APPDATA%\Xiaomi MiMo` |
| 我们的日志/指标 | `~/Library/Logs/Xiaomi MiMo Stats` | `%LOCALAPPDATA%\Xiaomi MiMo Stats` |
| 引擎数据库 | `~/.local/share/mimocode/mimocode.db` | `%LOCALAPPDATA%\mimocode\mimocode.db`（另有 `%USERPROFILE%\.local\share\mimocode\` 等候选） |
| 字体 | SF / PingFang | Segoe UI / 微软雅黑（已加进字体栈） |

代码里用 `process.platform` 分支处理，`fileURLToPath` 也换成了 `node:url` 的实现
（自写版在 Windows 上会多出前导斜杠、盘符解析错）。

## 安装

**macOS / Linux**

```bash
cd ~/Desktop/mimo插件
./install.sh
osascript -e 'quit app "Xiaomi MiMo"'; sleep 2; env -u ELECTRON_RUN_AS_NODE open -a 'Xiaomi MiMo'
```

**Windows**（PowerShell 5.1+）

```powershell
cd $HOME\Desktop\mimo插件
powershell -ExecutionPolicy Bypass -File .\install.ps1
# 然后从托盘完全退出 MiMo Desktop，再从开始菜单重新打开
```

卸载：macOS `./uninstall.sh`，Windows `powershell -ExecutionPolicy Bypass -File .\uninstall.ps1`，都需重启应用。

### Windows 上第一次装的验证清单

1. `%APPDATA%\Xiaomi MiMo\engine-config` 存在 → 说明 userData 路径对上了。
2. 重启后看 `%LOCALAPPDATA%\Xiaomi MiMo Stats\mimo-stats.log`：
   - 有 `db opened ...` → 数据库路径对上了；
   - 有 `bridge hooked {handlers:252}` → 桥拦截成功；
   - 有 `booted` → 插件加载成功。
3. 打开一个会话，底栏出现数字、点开卡片有明细 → 全链路通。
4. 若日志里出现 `bridge module not found` 或 `db missing`，把日志发我，
   那说明 Windows 版 runtime 目录/数据库位置与 mac 不同，我按日志改候选路径。

> ⚠️ 从终端 / IDE 里启动 MiMo 时，环境里若有 `ELECTRON_RUN_AS_NODE=1`（很多 Electron 工具链会设），
> 应用会以纯 Node 模式跑、窗口根本不出来。务必 `env -u ELECTRON_RUN_AS_NODE open -a 'Xiaomi MiMo'`。
> 从 Dock / Finder 双击启动不受影响。

## 用法

- **首页（新建任务）不显示任何统计** —— 那里根本没有会话。
- 进入会话后，composer 底下那行的**左侧**出现状态条，「内容由 AI 生成，请注意核实」保持原样居中：
  `3 轮 16 步 · ≈20 tok/s ｜ 800.5K tok · 命中 96.2%`　　`内容由 AI 生成，请注意核实`
  底栏宽度由 `fitBar()` 按免责声明文本左边缘动态算（留 14px 间隙），
  并有三档自适应，放不下就降级，**不会被那句居中的灰字压住**：

  | 档 | 文案 | 宽度 |
  | --- | --- | --- |
  | 宽松 | `🕐 25 轮 366 步 · 51 tok/s　🗄 128M tok · 命中 98.6%` | ~286px |
  | 紧凑 | 去图标、去空格：`25轮 366步 · 51 tok/s　128M · 98.6%` | ~230px |
  | 极简 | `366步 · 51 tok/s　98.6%` | ~150px |
- 还没拿到 sid 的瞬间会带一个 `最近` 小标（兜底最近会话），拿到就消失。
- 点状态条（或按 `⌥⌘T`）在它上方展开明细卡片；点空白处或 `Esc` 收起。
- 只有退回 float 兜底形态时才可拖动（记忆位置，双击复位）。

## 数据口径

| 字段 | 来源 | 公式 |
| --- | --- | --- |
| Token 总量 | `message.data.tokens` | `input + output + cache.read + cache.write` |
| 缓存命中率 | 同上 | `cache.read / (cache.read + input)` |
| 未缓存输入 | 同上 | `tokens.input` |
| 缓存读取 | 同上 | `tokens.cache.read` |
| 输出 / 推理 | 同上 | `tokens.output` / `tokens.reasoning` |
| 轮 | `message` 表 | `role = 'user'` 的条数 |
| 步 | `part` 表 | `type = 'step-finish'` 的条数（缺失时退回 assistant 条数） |
| tok/s | `metrics.model_call` 事件 | `total_tokens_out / ((latency_ms - ttft_ms)/1000)`，取最近 6 次均值，20s 无新样本归零 |
| 费用 | `message.data.cost` | 直接求和（引擎原值，见下） |
| 模型用时 | `message.data.time` | `Σ(completed - created)`，只统计 assistant |
| 工具调用用时 | `part.data.state.time` | `Σ(end - start)`，只统计 `type=tool` |
| 首 token 平均（TTFT） | 自记 `metrics.json` | `Σttft / calls`（引擎不落库） |
| 输出速度（TPS） | 自记 `metrics.json` | `Σoutput / (Σ(latency - ttft)/1000)`，即解码速度 |

当前会话的 `sessionID` **不是**靠拦 HTTP 拿的（踩过坑，见下），而是在主进程里
hook 了 IPC 桥的 handler 注册表，抓这两个调用：

| 桥方法 | 抓法 | 说明 |
| --- | --- | --- |
| **`mimo:engineStateWatch`** | 参数 `{ sessionID: "ses_xxx", convoId, subscriptionId }` | **主信号**：每打开一个会话都会 watch 一次 |
| `mimo:sessionMessages` | 参数 `{ id: "ses_xxx" }` | 非 workspace 会话走这条 |
| `mimo:api` | 参数 `{ method, path }`，path 命中 `/session/<sid>` | 兜底 |
| 会话页顶部标题 | 抓主区域顶部短文本 → `SELECT id FROM session WHERE title = ?` | 桥全挂时的最后兜底 |

一抓到就切会话并立刻刷新（`pageSid`）。还没抓到之前退回 DB 里 `time_updated` 最新的会话，
胶囊会带一个 `最近 ·` 前缀 —— 这样一眼能看出「这是最近会话，不是当前会话」。
卡片标题下方永远显示该会话标题，避免再看错。

## 为什么能这么做（逆向结论）

1. **Electron fuses**（`Frameworks/Electron Framework`，arm64 slice）：
   `RunAsNode=enabled`、`EnableNodeOptionsEnvironmentVariable=enabled`、
   `EnableNodeCliInspectArguments=enabled`、`EnableEmbeddedAsarIntegrityValidation=**disabled**`、
   `OnlyLoadAppFromAsar=disabled`。
2. **app.asar 只是引导器**：`Resources/app.asar` 335KB，真界面在
   `~/Library/Application Support/Xiaomi MiMo/runtime-res/releases/`
   （`renderer/static/index.html` + `assets/*.js`，由 `app://-` 自定义协议加载，React + Vite）。
3. **引擎跑在主进程里**：`runtime-res/releases/main/main~BmR9Wiqa.mjs` 里
   `const At = await import("./engine-entry~8LzR3mrv.mjs")`，也就是说 mimocode 引擎
   和 Electron 主进程是同一个进程 —— 所以引擎插件能直接 `import("electron")`、拿到 `BrowserWindow`。
4. **插件宿主契约**：`src/plugin/index.ts` 里 `applyPlugin()` 调
   `plugin.server(input, options)`，`input = { client, project, worktree, directory, serverUrl, $ }`；
   返回值是一个 hook 对象，支持
   `event / chat.message / chat.params / chat.headers / tool.execute.* / session.pre / session.post /
   session.userQuery.* / session.llm.request / experimental.chat.system.transform …`
   （`plugin.trigger("…")` 的完整清单见 `node~jxWpYCVa.mjs`）。
   `hook.event` 通过 `bus.subscribeAll()` 收到全部总线事件，形如 `{ type, properties }`。
5. **配置合并**：`engine-config/mimocode.json` 每次启动都会被 app 重写（只保留 desktop-tools-plugin），
   但同目录的 `mimocode.jsonc` 只读不写，两者按 `plugin` 数组拼接 —— 这就是插件的持久挂载点。
6. **会话消息不走 HTTP，走 IPC 桥**：实测 app 日志里渲染进程只对引擎发
   `GET /experimental/session`、`DELETE /session/<sid>`、`GET /mcp`，
   **没有** `GET /session/<sid>/message`。真正拉会话的是
   `store.loadConvoMessages()` → `Hn().watch(target)` →
   **`mimo:engineStateWatch`**（`{subscriptionId, convoId, sessionID}`），
   拿到一份 live snapshot；`loadConvoMessagesUncached` 里 `finally { b.release() }`
   意味着**每次打开会话都会重新 watch 一次**，所以它是可靠的「当前会话」信号。
   另外还有 `mimo:sessionMessages {id}` / `mimo:api {method,path}` 两条支路。桥实现在
   `releases/main/canvas-client~*.mjs` 的 `MimoBridge`（export `i`）：
   静态访问器 `defaultBridge` 是单例，`defaultHandlers` 是 `Map<apiName, handler>`。
   所以本插件在 boot 时 `import()` 同一个模块实例、重定义 `defaultBridge` 访问器，
   在 setter 里把 `registerHandle` 和已注册的 252 个 handler 全部包一层，从中取 `sid`。
7. **数据在 SQLite**：`~/.local/share/mimocode/mimocode.db`，
   `message(session_id, data JSON)` / `part(session_id, data JSON)`，
   `part.data.type ∈ {text, tool, step-start, step-finish, compaction, checkpoint…}`，
   `message.data.tokens = {input, output, reasoning, cache:{read, write}}`。
   WAL 模式，只读连接即可实时读。

## 费用那个数字是什么货币？

**引擎存的是美元**，面板直接换算成人民币显示：`¥3.18`（不再写 `$x ≈ ¥y`，省地方）。

推导过程（可复现）：

1. 引擎公式（`node~*.mjs` 的 `getUsage`）：
   `cost = input×单价.input/1e6 + (output+reasoning)×单价.output/1e6 + cache.read×单价.cache_read/1e6`
2. 拿库里 **325 条** `step-finish` 的 token 与 cost 做最小二乘，解出（每百万 token）：
   `input 0.14 / output(+reasoning) 0.28 / cache_read 0.0028`，
   **残差 2.8e-17**——不是近似，是精确解。
3. MiMo 官方人民币价（实时推理 flash）：`1.00 / 2.00 / 0.02`。
4. 三项比值都是 **7.142857 = 1/0.14**（50/7）：
   `1.00/0.14 = 2.00/0.28 = 0.02/0.0028 = 7.142857`。

也就是说引擎把人民币价按 **1 USD ≈ 7.1428 CNY** 折成美元存进了 `message.cost`。
所以 `cost × 7.142857` 就是官方人民币价（实测该会话 ¥3.18，与官方表逐项相加一致：
`80.655M×0.02 + 0.886M×1.00 + 0.339M×2.00 = 3.178`）。

显示可配（`mimocode.jsonc` 的插件 options）：

```json
[["file:///.../mimo-stats.mjs", { "currency": "$", "fx": 7.142857, "showCny": true }]]
```

- `currency`：`costCny` 拿不到时的兜底符号（默认 `¥`）
- `fx`：换算人民币的汇率（默认 `1/0.14`）
- `showCny`：是否显示人民币（默认 true；关掉就退回引擎原值）

## 卡片里的两块

```
◈ Token 用量            800,540 tok
  我的示例会话
──────────────────────────────
缓存命中                    96.2%
未缓存输入               30,584 tok
缓存读取                767,488 tok
输出                      2,468 tok
推理（含在总量）           1,033 tok
──────────────────────────────
6 轮 · 36 步                 ¥0.20
mimo-v2.6-flash
──────────────────────────────
◈ 会话统计
模型用时                   2分1秒
工具调用用时                0.8秒
首 token 平均（TTFT）        4.2秒
输出速度（TPS）            197 tok/s
```

**TTFT / TPS 为什么可能是 `—`**：引擎只在 `metrics.model_call` 事件里给 `ttft_ms` /
`latency_ms`，**不写库**，历史会话无法反推。所以插件自己按会话累计到
`~/Library/Logs/Xiaomi MiMo Stats/metrics.json`（`calls / out / latency / ttft / decode`，
最多 200 个会话）。装上之后跑过的会话才有这两项，跑一次就填上。

## 文件

```
src/mimo-stats.mjs          引擎插件（主进程）：事件订阅 / DB 统计 / 注入与推送
src/overlay.js              渲染进程浮层逻辑（幂等注入，含拖拽、开合、主题跟随）
src/overlay.css             浮层样式（浅色/深色双主题，跟随 <html data-theme>）
install.sh / uninstall.sh   安装 / 卸载
```

安装后落点：

```
~/Library/Application Support/Xiaomi MiMo/engine-config/mimo-stats.mjs
~/Library/Application Support/Xiaomi MiMo/engine-config/mimo-stats-overlay.js
~/Library/Application Support/Xiaomi MiMo/engine-config/mimo-stats-overlay.css
~/Library/Application Support/Xiaomi MiMo/engine-config/mimocode.jsonc   ← plugin 数组登记
```

运行日志：`~/Library/Logs/Xiaomi MiMo Stats/mimo-stats.log`
指标缓存：`~/Library/Logs/Xiaomi MiMo Stats/metrics.json`（TTFT / TPS，删掉只是回到 `—`）

## 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| 胶囊不出现 | 看 `mimo-stats.log` 是否有 `booted`；没有就是插件没被加载，检查 jsonc 里 `plugin` 的 file:// URL 是否被 URL 编码 |
| 胶囊显示「Token 用量」不变 | 没有活跃会话（DB 里也没有历史会话）；随便开一个会话即可 |
| 数字不动 | 引擎侧写库有延迟，正常；卡片 400ms 合并刷新，最多滞后半秒 |
| 想彻底停用 | `./uninstall.sh` + 重启；或只把 jsonc 里那一项注释掉 |
| 应用更新后消失 | runtime 更新不影响 `engine-config/`，但重装 app 会重置 userData；重跑 `install.sh` |

## 修复记录

- **v1.7.2** 撤掉「同期并发会话」提示（结论已确认，不需要常驻占位）。
- **v1.6.4** 修「插件比反代少一点」：旧公式漏了 `reasoning`，而引擎的 `tokens.total`
  本来就含它。逐条验证 59 条 step-finish，`total = input + output + reasoning +
  cache.read + cache.write`，偏差 **0**。修复后某会话从 2,165,506 → **2,169,047**，
  与引擎完全一致。面板里「推理」标注为「含在总量」。
- **v1.6.3** 面板底行改成「`6 轮 · 36 步` ／ `¥0.20`」，模型名单独一行；
  去掉原来那行的 `tok/s`（会话统计里已有 TPS），费用统一用 `¥`。
- **v1.6.2** 底栏三档自适应（宽松 → 紧凑 → 极简），`compact()` 对 ≥100M 不再带小数，
  窄窗口下也不会被居中的免责声明压住。
- **v1.6.0** 费用改成 `$X ≈ ¥Y`：用 325 条 step-finish 精确拟合出引擎单价
  （0.14/0.28/0.0028 每百万），证明引擎存的是美元、等于官方人民币价 ÷ 7.142857，
  于是同时显示换算后的人民币。`currency` / `fx` / `showCny` 可配。
- **v1.5.1** 费用符号从写死的 `$` 改成可配置（中间试过默认 ¥，被 v1.6.0 的证据推翻）。
- **v1.5.0** 跨平台：路径改成 `process.platform` 分支（macOS / Windows / Linux），
  `fileURLToPath` 换成 `node:url` 实现，字体栈加 Segoe UI / 微软雅黑，
  新增 `install.ps1` / `uninstall.ps1`。macOS 侧回归验证通过。
- **v1.4.3** 免责声明恢复原样居中，状态条改为它**左侧**（绝对定位 `left:28px`），
  宽度由 `fitBar()` 按文本左边缘动态算，不会压到那句灰字。
- **v1.4.1** 试过「塞进免责声明变 flex」和「侧栏底栏」两种方案：前者把灰字挤成左对齐、
  后者面板会被侧栏 `overflow` 裁掉，都回退了。
- **v1.3.1** 底栏/面板统一 TPS 取值链：实时采样 → 自记解码速度 → `总输出/模型总耗时`（前面加 `≈`）。
- **v1.3.0** 卡片新增「会话统计」分区：模型用时（`message.time.completed - created`）、
  工具调用用时（`part.state.time`）、首 token 平均 TTFT、输出速度 TPS（后两项自己落盘累计）。
- **v1.2.2** 修「两个会话数字一模一样」：之前只 hook 了 `mimo:sessionMessages` / `mimo:api`，
  但 MiMo 真正打开会话走的是 `mimo:engineStateWatch`，于是 `pageSid` 永远为空、
  一直吃「最近会话」兜底 → 两个会话显示同一份数字。现在按 `sessionID` 通用扫描
  （`sessionID / sessionId / sid / sessionKey / id` + 路径里的 `/session/<sid>`），
  并加了「顶部标题反查 DB」的第二道兜底。
- **v1.2.1** 首页不再显示统计：之前用「最近会话」兜底，导致没有会话也挂着 93.7K tok。
  现在按视图判定（`composer-ai-disclaimer` → 会话页；`composer-home` / `.scope-chips` /
  输入框 placeholder「描述任务」→ 首页），首页整条隐藏；回到首页时同时清掉记住的 sid，
  避免下次打开旧会话用错 id。

- **v1.2.0** 从「右下角浮胶囊」改成「嵌进底栏一行」：优先挂到 composer 下方那一行右侧，
  与 app 自己的灰字同一行同一字号（11px），左边 `轮/步/tok/s`、右边 `总量/缓存命中`；
  找不到 composer 才退回浮胶囊。位置改用内联样式，避开 app CSS 覆盖。

- **v1.1.1** 修「切会话数字不变」：原实现靠拦 `fetch` 抓 `/session/<sid>`，
  但 MiMo 加载会话消息走的是 IPC 桥而不是 HTTP，于是 `sid` 永远是空的、
  一直吃「最近会话」兜底值。现在改为在主进程 hook 桥的 handler 注册表取 `sid`；
  同时事件（`message.*` / `metrics.model_call`）不再反过来改写当前会话，
  避免后台子任务 / 起标题的小模型把显示劫持到别的会话。
- **v1.1.2** 卡片标题下方显示会话标题、胶囊加 `最近 ·` 前缀；拖拽加 `pointercancel`
  兜底 + 位置钳制，避免指针捕获丢失后卡片被粘在鼠标上。

## 隐私与安全

**它读什么**

| 目标 | 权限 | 用途 |
| --- | --- | --- |
| `mimocode.db` | **只读**（`readOnly: true`） | 查 `message` / `part` / `session` 表算 token、步数、耗时 |
| MiMo 主进程的桥注册表 | 内存内 hook | 拿「当前正在看哪个会话」的 `sessionId` |
| 渲染进程 DOM | 注入浮层 | 把状态条插到 composer 底下那行 |

**它不做什么**

- 不联网。没有 fetch、没有上报、没有崩溃采集。
- 不读取对话内容。只取 `tokens` / `cost` / `time` / `title` 这类字段，**不碰 message 正文**。
- 不写入数据库。`node:sqlite` 以只读模式打开。
- 不修改 `app.asar`、不修改 `runtime-res` 下的任何文件、不动代码签名。

**它写什么**

| 路径 | 内容 |
| --- | --- |
| `engine-config/` 下 3 个文件 | 插件本体 |
| `engine-config/mimocode.jsonc` | 追加一条 plugin 登记（保留你已有的条目） |
| 日志目录 `mimo-stats.log` | 运行日志（只含路径与事件名，不含对话内容） |
| 日志目录 `metrics.json` | 每个会话的 TTFT / 解码速度累计值 |

删掉这些文件 + 重启应用即完全还原，`./uninstall.sh` / `uninstall.ps1` 会代劳。

**审计建议**：全部逻辑在 `src/` 三个文件里，共约 1900 行，没有压缩混淆，可直接阅读。

## 已知限制

- 只统计**当前会话**；跨会话累计没有做（要做得加一个会话选择器）。
- 首页不显示（没有会话就没有数字）；只有确认在会话页、但桥还没报 sid 的瞬间，
  才会用「最近会话」兜底并打上 `最近` 小标。
- 步数按 `step-finish` 计；老会话若没有该 part 类型，会退回 assistant 消息数。
- tok/s 只在有 `metrics.model_call` 事件时才有值，历史会话不反推。
- 浮层是 `executeJavaScript` 注入的独立 DOM，不参与 React 渲染树；
  应用重载后由 `did-finish-load` 自动重注入。
- 主题跟随 `<html data-theme>`；应用没写该属性时退回 `prefers-color-scheme`。
