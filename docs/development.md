# 开发指南

> 配套阅读：[README](../README.md)（总览）、[架构设计](architecture.md)、[发布指南](release.md)。

## 1. 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 22.19（`^22.19.0 \|\| >=24.0.0`） | dsh 的 engines 要求；本机开发用 |
| npm | 随 Node | 建议 ≥ 10 |
| Electron | `^37.2.0`（当前锁定 37.x） | devDependency，`npm install` 自动安装 |

首次安装（会下载 Electron 二进制，需要网络）：

```bash
npm install
```

## 2. 开发循环

```bash
npm start    # 启动桌面应用：自动拉起 dsh web --port <空闲端口> 并加载原版 UI
```

常用操作：

- **重启后端**：菜单 `File → Restart dsh Server`（⌘⇧R / Ctrl+Shift+R），无需重启应用；
- **看 dsh 日志**：启动终端的 stdout 会以 `[dsh]` 前缀转发子进程日志；
- **数据目录**：默认 `~/.dsh`（`$DSH_HOME`），与 `npx @deepseek-ai/dsh web` 完全共享。

## 3. 脚本参考

| npm script / 命令 | 等价调用 | 作用 |
|---|---|---|
| `npm start` | `electron .` | 启动开发模式 |
| `npm run fetch:node` | `node scripts/fetch-node.mjs` | 下载当前平台 Node 运行时到 `resources/node/` |
| `npm run bundle:dsh` | `node scripts/bundle-dsh.mjs` | 按 `package.json → dsh.version` 捆绑 dsh 到 `resources/dsh/` 并跑验证门禁 |
| `npm run prepare:runtime` | `fetch:node` + `bundle:dsh` | 准备打包所需的全部运行时 |
| `npm run smoke` | `node scripts/smoke.mjs` | 无 GUI 冒烟测试（dev 布局） |
| `npm run check:update` | `node scripts/check-dsh-update.mjs` | 查询 npm latest 并对比当前版本 |
| `npm run update:dsh` | `check-dsh-update.mjs --apply` | 有新版时升级 + 重捆绑 + 验证 |
| `npm run pack` | `prepare:runtime` + `electron-builder --dir` | 产出未打包目录（调试用） |
| `npm run dist[:mac\|win\|linux]` | `prepare:runtime` + `electron-builder [--mac\|--win\|--linux]` | 产出安装包 |
| — | `node scripts/gen-icon.mjs` | 复制 `assets/icon.png` → `build/icon.png` |
| — | `node scripts/fetch-node.mjs --all` | 下载全部平台 Node 运行时 |

### 直接调用脚本的额外用法

```bash
# bundle 指定版本 / 跳过验证门禁
node scripts/bundle-dsh.mjs 0.1.0-rc.6
node scripts/bundle-dsh.mjs --no-verify

# 指定 Node 版本下载（默认 DSH_NODE_VERSION=v22.22.0）
DSH_NODE_VERSION=v22.22.0 node scripts/fetch-node.mjs

# dev 模式指定 node 可执行文件（默认取 PATH 中的 node）
DSH_NODE_BIN=/path/to/node npm start
```

## 4. 验证

### 4.1 无 GUI 冒烟（CI 也在用）

```bash
# dev 布局：系统 node + 本地 dsh
node scripts/smoke.mjs

# packaged 布局：捆绑 node + 捆绑 dsh（resources 需先 prepare:runtime）
node scripts/smoke.mjs --packaged /path/to/resources-root
```

覆盖链路：路径解析 → 空闲端口 → `dsh web --port <port>` → 三层就绪 → HTTP GET 首页 200 + SPA 路由 200 → 优雅退出。

### 4.2 GUI 自测

```bash
# 开发模式：启动 → 加载原版 UI → 自动退出
npx electron . --self-test

# 附带截图（可选）
npx electron . --self-test --screenshot /tmp/shot.png

# 打包产物
"./release/mac-arm64/DSH Desk.app/Contents/MacOS/DSH Desk" --self-test
```

### 4.3 手工验收清单

- [ ] `npm start` 窗口正常加载原版 UI，无白屏；
- [ ] `⌘⇧R` 重启后端后页面可重新加载；
- [ ] 打开一个外链，确认落在系统浏览器而非应用内新窗口；
- [ ] 杀掉 dsh 子进程（或 `pkill -f 'lib/bin.js'`），确认出现错误页并可一键重启；
- [ ] `npm run smoke` 通过；
- [ ] `--self-test` 打印 `window loaded in <N>ms` 后以 0 退出。

## 5. 调试技巧

- **主进程日志**：全部走终端 stdout（`[desktop]` / `[dsh-runtime]` / `[dsh]` 前缀）；
- **渲染进程**：打包/开发窗口 `Cmd+Alt+I` 打开 DevTools（`viewMenu` 自带 `toggleDevTools` role）；
- **dsh 行为差异排查**：先在终端单独跑 `npx @deepseek-ai/dsh web --port 0` 对比行为；
- **打包布局问题**：用 `npm run pack` 产出 `release/mac*/…`（或对应平台 `--dir` 目录）检查 `resources/node` 与 `resources/dsh` 是否齐备。

## 6. 代码约定

- `src/main/dsh-common.js`、`src/main/dsh-resolve.js` 是**纯模块**（不依赖 Electron），可被 `scripts/smoke.mjs` 复用——新增逻辑尽量保持这一分层；
- 运行时路径解析只改 `dsh-resolve.js`，端口/就绪只改 `dsh-common.js`；
- 提交前请通过 `npm run smoke`。
