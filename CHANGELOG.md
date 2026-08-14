# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- 完善项目文档：新增 `docs/`（架构、开发、发布、上游同步、故障排查）、`CONTRIBUTING.md`、`CHANGELOG.md`；
- 重写 `README.md`：完善方案第一期（已实现）/第二期（规划中）的功能说明与验收标准。

## [0.1.0] - 2026-08-14

首个开源版本。将 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）封装为桌面应用（Electron 薄壳），不改动任何 dsh 前端代码。

### 新增

- **Electron 薄壳**：启动官方 `dsh web` 运行时并加载原版 Web UI，界面与交互 100% 原样保留；
- **原生桌面体验**：独立窗口（1280×860）、原生菜单、错误恢复（友好错误页 + 一键重启）、单实例锁定；
- **自包含打包**：内置 Node 运行时与 dsh 依赖树，目标机器无需安装 Node 或联网（macOS DMG / Windows NSIS / Linux AppImage）；
- **数据互通**：复用官方 `$DSH_HOME`（默认 `~/.dsh`），与 CLI 数据无缝共享；
- **三层就绪检测**：官方就绪行 → stdout loopback URL 兜底 → 自选端口 HTTP 轮询，对上游输出格式变化抗脆；
- **npm 发布版同步机制**：`package.json → dsh.version` 单一版本来源 + `resources/dsh/version.json` 版本记录 + `check-dsh-update` / `update:dsh` 一键升级 + 捆绑后自动验证门禁；
- **安全**：`contextIsolation` + `sandbox` + 无 `nodeIntegration`，外链与跨源导航走系统浏览器，子进程禁用遥测；
- **自测**：`--self-test` GUI 自测模式（含可选截图与 DOM 诊断）、`scripts/smoke.mjs` 无 GUI 冒烟测试（dev/packaged 两种布局）；
- **CI**：GitHub Actions smoke 工作流。

### 技术细节

- 端口策略：应用先向 OS 申请空闲端口再显式传给 `dsh web --port <port>`，不依赖 `--port 0` 的输出解析；
- 优雅退出：SIGTERM → 5s 后 SIGKILL 兜底，保证 dsh 子进程干净回收；
- 路径解析收敛在 `dsh-resolve.js`（纯模块），便于按上游包结构调整。

### 已知限制

- 同步源为 npm 发布的 `@deepseek-ai/dsh`，官方只改源码未发 npm 包时体验滞后；
- Windows 依赖目标机器支持 PowerShell（pwsh）；Linux 需目标发行版验证。
