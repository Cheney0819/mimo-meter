# 参与开发

## 结构

```
src/mimo-meter.mjs    引擎插件（跑在 MiMo 的 Electron 主进程里）
src/overlay.js        注入渲染进程的浮层逻辑
src/overlay.css       浮层样式
install.sh / uninstall.sh      macOS
install.ps1 / uninstall.ps1    Windows
```

## 改动流程

1. 改 `src/` 里的文件
2. 部署到本机验证：
   ```bash
   ./install.sh
   osascript -e 'quit app "Xiaomi MiMo"'; sleep 2
   env -u ELECTRON_RUN_AS_NODE open -a 'Xiaomi MiMo'
   ```
3. 看日志确认加载成功：
   ```bash
   tail -5 ~/Library/Logs/Xiaomi MiMo\ Stats/mimo-meter.log
   ```
   应包含 `booted {"plugin":"x.y.z","overlay":"x.y.z","platform":"darwin",...}`

## 版本号规则

`src/mimo-meter.mjs` 的 `const VERSION` 与 `src/overlay.js` 的 `var VERSION`
**必须保持一致**。不一致时浮层不会重新挂载，日志里也会暴露出来。

## 数据口径（改动前务必理解）

总量必须与引擎的 `part.tokens.total` 同口径：

```
total = input + output + reasoning + cache.read + cache.write
```

`reasoning` **算在总量里**，不要漏（v1.6.4 修过一次这个 bug）。

## 提交前检查

```bash
node --check src/mimo-meter.mjs
node --check src/overlay.js
bash -n install.sh
```

并确认没有把个人路径、会话标题、`metrics.json`、日志文件带进提交。

## 报告问题

请附上：

1. `platform`（macOS / Windows）与 MiMo 版本号
2. 日志里的 `booted` 那一行
3. 面板截图（涉及数字对不上时，注明期望值来源）
