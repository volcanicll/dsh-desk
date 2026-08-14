# 故障排查

> 配套阅读：[开发指南](development.md)、[发布指南](release.md)。

按症状索引常见问题与处理方式。

## 1. 应用启动即报错页

### `Node runtime not found: … (run npm run fetch:node)`

打包布局下缺少捆绑 Node。执行：

```bash
npm run fetch:node
```

若平台 key 不符（如 `linux-x64` 与 `darwin-arm64`），确认目标平台已执行对应下载（`node scripts/fetch-node.mjs --all` 可一次拉全）。

### `dsh bundle not found: … (run npm run bundle:dsh)`

打包布局下缺少捆绑 dsh。执行：

```bash
npm run bundle:dsh
```

### `dsh server did not become ready within 60s`

- 打开错误页可看到最近 2KB stderr；
- 先单独跑 `npx @deepseek-ai/dsh web --port 0` 确认 dsh 本机可用；
- 确认 127.0.0.1 未被代理/防火墙拦截；
- 若是性能极差的机器，可临时调大 `dsh-runtime.js` 的 `READY_TIMEOUT_MS` 验证是否为超时问题。

### 端口冲突（EADDRINUSE）

极小概率的 TOCTOU 窗口。重启 dsh（`⌘⇧R`）或重启应用即可；若反复出现，检查是否有其他进程占用随机端口（一般不会）。

## 2. 启动后白屏 / 页面加载异常

- 用 `--self-test` 观察 DOM 诊断（`[self-test] dom: …` 中 `root: true` 表示 React 挂载成功）；
- 检查终端日志中 `[desktop] dsh ready at <url>` 是否出现；
- 若 dsh 版本异常，`npm run check:update` 查看版本，必要时 `npm run update:dsh` 同步上游；
- 强制刷新：`⌘⇧R` 重启后端（不是浏览器刷新）。

## 3. 外链没有在系统浏览器打开

确认外链是以 `http://`/`https://` 开头的完整 URL；应用内只允许同源（dsh）导航，`target=_blank` 与跨源导航会交给系统浏览器。

## 4. 退出后 dsh 进程残留

正常流程是 `before-quit` → SIGTERM → 5s 后 SIGKILL 兜底。若残留：

```bash
# 查看残留
pgrep -fl 'lib/bin.js'
# 手动清理
pkill -f 'lib/bin.js'
```

若频繁复现，检查是否在强制杀掉应用（如 `kill -9`）后退出——此时无法保证子进程回收；正常退出（Cmd+Q / 关闭窗口）不会残留。

## 5. 打包后目标机器无法运行

| 症状 | 排查 |
|---|---|
| macOS Gatekeeper 拦截 | 未签名/未公证；发布前完成签名与公证（见 [发布指南](release.md)） |
| Linux AppImage 打不开 | 目标发行版缺 FUSE 或 glibc 过旧；在目标发行版验证 |
| Windows 工具链报错 | dsh 依赖 pwsh；确认目标机器安装 PowerShell |
| 提示缺 Node | 确认 `resources/node/<platform>-<arch>/bin/node` 存在（`npm run fetch:node`） |

## 6. 开发环境常见问题

### `npm install` 失败 / Electron 二进制下载慢

- 使用镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install`；
- CI 场景可 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`（仅当不启动 Electron，如 smoke）。

### `npm start` 报 engines 不满足

本机 Node 需 ≥ 22.19（dsh 要求 `^22.19.0 || >=24.0.0`）。用 nvm/fnm 切换：

```bash
nvm use 22
```

### 冒烟测试失败

```bash
npm run smoke
```

- dev 布局失败：确认 `npm install` 完成、`@deepseek-ai/dsh` 在 `node_modules`；
- packaged 布局失败：先 `npm run prepare:runtime`。

## 7. 收集诊断信息

提 Issue 时附上：

- `npm run check:update` 输出（当前/最新 dsh 版本）；
- `resources/dsh/version.json` 内容；
- 启动终端日志（含 `[desktop]` / `[dsh-runtime]` / `[dsh]` 前缀）；
- `--self-test` 输出（含 `dom` 诊断）；
- 平台信息（`uname -a` / Windows 版本 / 发行版与内核）。
