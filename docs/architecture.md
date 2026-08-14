# 架构设计

> 配套阅读：[README](../README.md)（总览）、[开发指南](development.md)、[发布指南](release.md)。

本文档详解 DSH Desk 的运行时架构、进程模型、安全边界与容错设计，是理解本仓库代码的入口。

## 1. 核心原则

**不改动 dsh 的任何前端代码。** DSH Desk 是一个 Electron 薄壳：

- 桌面端启动官方 `dsh web` 运行时（Node 子进程）；
- `BrowserWindow` 通过 HTTP 加载原版 Web UI（`http://127.0.0.1:<随机端口>`）；
- 所有原始界面与交互（会话、工作区、工具调用、审批、插件管理、模型配置等）100% 原样保留。

前端与桌面壳的通信走 **HTTP + WebSocket（官方 RPC 协议）**，壳本身不注入、不拦截任何页面逻辑。

## 2. 进程模型

```
┌─────────────────────────── Electron 主进程 ───────────────────────────┐
│  src/main/index.js       应用入口：生命周期、窗口、错误恢复、--self-test │
│  src/main/dsh-runtime.js dsh 子进程管理（spawn/就绪/优雅退出）          │
│  src/main/dsh-resolve.js 运行时路径解析（纯模块，dev/prod 共用）        │
│  src/main/dsh-common.js  空闲端口选择 + 三层就绪检测（纯模块）          │
│  src/main/menu.js        原生菜单                                       │
└───────────────┬──────────────────────────────────────────────────────┘
                │ spawn: <node> <dsh>/lib/bin.js web --port <空闲端口>
                ▼
┌─────────────────────────── dsh 运行时子进程 ──────────────────────────┐
│  官方 @deepseek-ai/dsh（含完整依赖树 + 构建好的前端 dist）              │
│  数据目录：$DSH_HOME（默认 ~/.dsh），与 CLI 完全共享                    │
└───────────────┬──────────────────────────────────────────────────────┘
                │ HTTP + WebSocket（官方 RPC 协议）
                ▼
┌─────────────────────────── BrowserWindow ────────────────────────────┐
│  src/preload/index.js    最小化安全桥（仅错误页使用）                   │
│  src/renderer/error.html 启动失败时的友好错误页（可一键重启）           │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 主进程职责

| 模块 | 职责 |
|---|---|
| `index.js` | 单实例锁、应用生命周期、创建窗口、错误恢复（错误页）、`--self-test` 自测模式 |
| `dsh-runtime.js` | 启动/停止 dsh 子进程、三层就绪检测、日志转发、SIGTERM→SIGKILL 优雅退出 |
| `dsh-resolve.js` | 解析 `(nodeBin, dshBin)` 二元组；dev/prod 共用同一套逻辑 |
| `dsh-common.js` | 纯 Electron 无关工具：空闲端口选择 + 就绪检测（被 runtime 与 smoke 测试共用） |
| `menu.js` | 原生菜单：标准 role 保证 Web UI 内复制/粘贴/缩放可用；`File → Restart dsh Server` |

### 2.2 运行时来源（dev vs prod）

| 模式 | Node | dsh |
|---|---|---|
| 开发（`npm start`） | 系统 Node（≥22.19，可用 `DSH_NODE_BIN` 覆盖） | 本地 `node_modules/@deepseek-ai/dsh` |
| 打包（`app.isPackaged`） | `resources/node/<platform>-<arch>/bin/node` | `resources/dsh/node_modules/@deepseek-ai/dsh` |

路径解析统一收敛在 `dsh-resolve.js`，便于按上游包结构调整。缺失时抛出带修复提示（`npm run fetch:node` / `npm run bundle:dsh`）的明确错误。

## 3. 启动时序

```
app.whenReady()
  └─ boot()
      ├─ 注册 IPC handler（runtime:restart / app:version）
      ├─ new DshRuntime()，挂载 ready/error/exit/log 监听
      ├─ runtime.start()
      │    ├─ resolveRuntimePaths()          → (nodeBin, dshBin)
      │    ├─ pickFreePort()                 → 向 OS 申请空闲端口
      │    ├─ spawn(nodeBin, [dshBin, 'web', '--port', port])
      │    └─ 三层就绪检测（见 §4）
      ├─ ready 事件 → buildMenu() + createMainWindow(url)
      └─ error/exit 异常 → showFatal() → 加载错误页
```

窗口创建时：

- `1280×860`（最小 900×600），深色背景 `#0d1117`，`ready-to-show` 后才显示，避免白屏闪烁；
- `webPreferences`：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；
- `setWindowOpenHandler`：`target=_blank`/`window.open` 一律交给系统浏览器；
- `will-navigate`：仅允许同源（dsh）导航，跨源导航交给系统浏览器。

## 4. 端口选择与就绪检测

### 4.1 端口

不用 `--port 0`（依赖输出解析），而是**应用先向 OS 申请空闲端口，再显式传给 `dsh web --port <port>`**。这样：

- 避免与用户自建的 `dsh web` 冲突；
- 就绪探测永远知道该往哪里探，不依赖任何输出格式；
- 存在极小 TOCTOU 窗口（端口被占用），`EADDRINUSE` 会以错误页暴露并支持一键重启，优于依赖 stdout 文案。

### 4.2 三层就绪检测（`dsh-common.js`）

| 优先级 | 策略 | 说明 |
|---|---|---|
| 1 | 官方就绪行 `dsh web: http://127.0.0.1:<port>` | 首选，`URL_LINE` 正则 |
| 2 | stdout 中任意 `http://127.0.0.1:<port>` 字面量 | 兜底，`ANY_LOOPBACK_URL` 正则 |
| 3 | 自选端口 HTTP 轮询（500ms 间隔，60s 超时） | 最后手段，即使输出格式全部变化也能探测 |

超过 `60s + 2s` 未就绪则报错，错误页附带最近 2KB stderr 便于排查。

## 5. 生命周期与优雅退出

- **单实例**：`requestSingleInstanceLock`，二次启动聚焦已有窗口；
- **窗口关闭**：非 macOS 平台 `window-all-closed` 退出；macOS 保持常驻（`activate` 重建窗口）；
- **退出**：`before-quit` 拦截 → `runtime.stop()`（SIGTERM，5s 后 SIGKILL 兜底）→ 再真正退出，保证 dsh 子进程干净回收；
- **异常**：dsh 非预期退出（非退出流程中）→ 错误页；错误页提供 `Restart dsh`（IPC `runtime:restart`）与 `Quit`。

## 6. 安全设计

| 项 | 配置 |
|---|---|
| `contextIsolation` | `true` |
| `nodeIntegration` | `false`（关闭） |
| `sandbox` | `true` |
| preload | 最小化：仅暴露 `desktopAPI.{restart, version, platform}`，仅供错误页使用 |
| 外链 | `window.open` / 跨源导航 → 系统浏览器 |
| 遥测 | 子进程注入 `DSH_TELEMETRY_DISABLED=1` |
| macOS 沙盒 | `build/entitlements.mac.plist`（JIT、网络 client/server） |

Web UI 本身加载的是官方前端，无需 Node 能力；preload 只服务本地错误页。

## 7. `--self-test` 自测模式

无人工介入的 GUI 冒烟：完整走通启动管线 → 等待窗口加载完成 → 打印耗时与 DOM 诊断 → 可选截图 → 优雅退出。

```
npx electron . --self-test                          # 开发模式
npx electron . --self-test --screenshot /tmp/s.png  # 附带截图
```

输出示例：

```
[self-test] window loaded in 505ms: http://127.0.0.1:53421
[self-test] dom: {"title":"...","text":1234,"root":true,"html":...}
```

45s 内窗口未加载完成则 `process.exit(1)`，供 CI 判定失败。

## 8. 目录结构

```
dsh-desk/
├── src/
│   ├── main/
│   │   ├── index.js        # 应用入口：生命周期、窗口、错误恢复、--self-test
│   │   ├── dsh-runtime.js  # dsh 子进程管理（spawn/就绪/优雅退出）
│   │   ├── dsh-resolve.js  # 运行时路径解析（纯模块，dev/prod 共用）
│   │   ├── dsh-common.js   # 空闲端口选择 + 三层就绪检测（纯模块）
│   │   └── menu.js         # 原生菜单
│   ├── preload/index.js    # 最小化安全桥（仅错误页使用）
│   └── renderer/error.html # 启动失败时的友好错误页（可一键重启）
├── scripts/
│   ├── fetch-node.mjs      # 下载 Node 运行时 → resources/node/<platform>-<arch>/
│   ├── bundle-dsh.mjs      # 安装 @deepseek-ai/dsh → resources/dsh/（含版本记录+验证门禁）
│   ├── check-dsh-update.mjs# 查询 npm latest 并对比/升级 dsh 版本
│   ├── gen-icon.mjs        # 生成应用图标 build/icon.png
│   └── smoke.mjs           # 无 GUI 冒烟测试（dev/packaged 两种布局）
├── build/                  # 图标、entitlements
├── docs/                   # 项目文档
├── .github/workflows/      # CI（smoke）
├── electron-builder.yml    # 三平台打包配置
└── package.json            # 单一版本来源（dsh.version）
```

## 9. 二期演进（Plan B，官方预留形态）

deepseek-harness 官方架构笔记已为 Electron 预留设计：`AbstractApiClient` 只需实现 `doFetch` 即可接入新载体，前端 `file://` 加载 + IPC fetch 桥。二期可去掉本地端口与子进程，将 dsh host 侧直接运行在 Electron 主进程内（见官方 `packages/host/webserver/src/index.ts` 注释与架构笔记 `gui-layering-and-rpc-protocol`）。届时壳仍需保持“不改前端”原则，仅替换传输层。
