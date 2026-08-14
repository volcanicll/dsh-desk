# DeepSeek Desktop

将 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）封装为桌面端应用的 **Electron 薄壳**实现。

> 核心原则：**不改动 dsh 的任何前端代码**。桌面端启动官方 `dsh web` 运行时并加载原版 Web UI，所有原始界面与交互（会话、工作区、工具调用、审批、插件管理、模型配置等）100% 原样保留。

## 方案（第一期：Plan A）

```mermaid
flowchart TB
    subgraph "DeepSeek Desktop (Electron)"
        Main["Electron 主进程<br/>src/main/index.js<br/>生命周期/菜单/错误恢复"]
        Runtime["dsh 运行时子进程<br/>src/main/dsh-runtime.js"]
        Win["BrowserWindow<br/>加载 http://127.0.0.1:&lt;随机端口&gt;"]
        Main -- "spawn: node lib/bin.js web --port 0" --> Runtime
        Main -- "解析 stdout 就绪行后创建窗口" --> Win
        Win -- "HTTP + WebSocket（官方 RPC 协议）" --> Runtime
    end
    Data["用户数据 $DSH_HOME (~/.dsh)<br/>与 CLI 互通"] <--> Runtime
```

- **运行时来源**：开发模式用系统 Node（≥22.19）+ 本地 `@deepseek-ai/dsh`；打包模式用应用内捆绑的 Node 运行时 + 捆绑的 `@deepseek-ai/dsh`（含完整依赖树与官方前端 dist）。
- **端口**：`dsh web --port 0` 由 OS 分配随机端口，避免与用户自建的 `dsh web`（默认 3080）冲突。
- **就绪检测**：解析官方 stdout 行 `dsh web: http://127.0.0.1:<port>`（即官方 supervisor 约定的就绪信号）。
- **数据**：复用官方 `$DSH_HOME`，与 CLI 数据无缝互通。
- **安全**：`contextIsolation` + `sandbox` + 无 `nodeIntegration`；外链与跨源导航交由系统浏览器打开。

### 目录结构

```
deepseek-desktop/
├── src/
│   ├── main/
│   │   ├── index.js        # 应用入口：生命周期、窗口、错误恢复、--self-test
│   │   ├── dsh-runtime.js  # dsh 子进程管理（spawn/就绪/优雅退出）
│   │   ├── dsh-resolve.js  # 运行时路径解析（纯模块，dev/prod 共用）
│   │   └── menu.js         # 原生菜单
│   ├── preload/index.js    # 最小化安全桥（仅错误页使用）
│   └── renderer/error.html # 启动失败时的友好错误页（可一键重启）
├── scripts/
│   ├── fetch-node.mjs      # 下载 Node 运行时 → resources/node/<platform>-<arch>/
│   ├── bundle-dsh.mjs      # 安装 @deepseek-ai/dsh → resources/dsh/
│   ├── gen-icon.mjs        # 生成应用图标 build/icon.png
│   └── smoke.mjs           # 无 GUI 冒烟测试（dev/packaged 两种布局）
├── build/                  # 图标、entitlements
├── electron-builder.yml    # 三平台打包配置
└── docs/screenshot.png     # 运行效果截图
```

## 快速开始（开发模式）

要求：Node.js ≥ 22.19（dsh 的 engines 要求 `^22.19.0 || >=24.0.0`）。

```bash
npm install
npm start            # 启动桌面应用（自动拉起 dsh web --port 0 并加载原版 UI）
```

- 菜单 **File → Restart dsh Server**（⌘⇧R / Ctrl+Shift+R）可重启后端，无需重启应用。
- 默认数据目录为 `~/.dsh`（`$DSH_HOME`），与 `npx @deepseek-ai/dsh web` 完全共享。

## 构建安装包

```bash
npm run prepare:runtime   # 下载 Node 运行时 + 捆绑 @deepseek-ai/dsh（需网络）
npm run dist:mac          # macOS DMG（arm64 + x64）
npm run dist:win          # Windows NSIS 安装包（x64）
npm run dist:linux        # Linux AppImage（x64 + arm64）
npm run dist              # 当前平台
```

打包后的应用完全自包含：内置 Node 运行时与 dsh 依赖树，目标机器无需安装 Node 或联网。
发布前请在 `electron-builder.yml` 中配置正式 `appId`、开发者证书签名（macOS 公证）与图标。

## 验证

```bash
# 1) 无 GUI 冒烟：dev 布局
node scripts/smoke.mjs
# 2) 无 GUI 冒烟：packaged 布局（resources 需先 prepare:runtime）
node scripts/smoke.mjs --packaged /path/to/resources-root
# 3) GUI 自测（开发模式）：启动 → 加载原版 UI → 自动退出
npx electron . --self-test
# 4) GUI 自测（打包产物）：
"./release/mac-arm64/DeepSeek Desktop.app/Contents/MacOS/DeepSeek Desktop" --self-test
# 5) 附带截图（可选）
... --self-test --screenshot /tmp/shot.png
```

已验证（macOS arm64，dsh 0.1.0-rc.6 / Electron 37.10.3）：
- `dsh web --port 0` 启动、就绪行解析、首页与 SPA 路由 200 ✅
- 开发模式窗口 514ms 加载原版 UI ✅
- 打包模式（捆绑 Node + 捆绑 dsh）窗口 505ms 加载原版 UI，退出时 dsh 正常退出（code 0）✅

## 平台注意点

- **Windows**：dsh 的 PowerShell 工具链（pwsh）随依赖树捆绑，但 PowerShell 本体需目标机器支持；建议在 Windows 上跑一次 `scripts/smoke.mjs` 确认。
- **Linux**：dsh 的 `landlock-run` 沙箱组件为 Linux 专用，已在依赖树中按平台安装；AppImage 建议在目标发行版验证。
- **macOS**：首次运行未签名/未公证构建会被 Gatekeeper 拦截，发布前请完成签名与公证。

## 二期演进（Plan B，官方预留形态）

deepseek-harness 官方架构笔记已为 Electron 预留设计：`AbstractApiClient` 只需实现 `doFetch` 即可接入新载体，前端 `file://` 加载 + IPC fetch 桥。二期可去掉本地端口与子进程，将 dsh host 侧直接运行在 Electron 主进程内（见 `packages/host/webserver/src/index.ts` 注释与 `.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.zh.md`）。

## 许可

MIT。DeepSeek Harness 本体为 MIT（[LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/main/LICENSE)）。
