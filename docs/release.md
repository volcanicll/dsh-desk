# 发布与打包指南

> 配套阅读：[README](../README.md)（总览）、[架构设计](architecture.md)、[开发指南](development.md)。

## 1. 打包配置一览

`electron-builder.yml` 要点：

| 项 | 值 | 说明 |
|---|---|---|
| `appId` | `io.github.volcanicll.dsh-desk` | 正式发布前按需确认 |
| `productName` | `DSH Desk` | |
| 输出目录 | `release/` | 已在 `.gitignore` |
| 目标 | mac: DMG (arm64+x64) / win: NSIS (x64) / linux: AppImage (x64+arm64) | |
| 打包内容 | `src/**/*` + `package.json`；排除 `resources/**` 与 `node_modules/**/*` | dsh 依赖以 extraResources 带入 |
| `extraResources` | `resources/node → node`；`resources/dsh/node_modules → dsh/node_modules`；`resources/dsh/version.json → dsh/version.json` | 指向 `node_modules` 而非 `resources/dsh`，避免 electron-builder 把 npm --prefix 安装误当应用项目做依赖裁剪 |
| `npmRebuild` | `false` | dsh 依赖树已由 `bundle-dsh.mjs` 就绪 |
| macOS | `hardenedRuntime` + entitlements（JIT、网络） | 发布需签名与公证 |

> 注意：应用图标由 `icon.png`（项目根）在打包前复制到 `build/icon.png`（`scripts/gen-icon.mjs`），electron-builder 会据此生成各平台 `.icns` / `.ico`。若改了图标记得重新生成。

## 2. 构建安装包

```bash
npm run prepare:runtime   # 下载 Node 运行时 + 捆绑 @deepseek-ai/dsh（需网络）
npm run dist:mac          # macOS DMG（arm64 + x64）
npm run dist:win          # Windows NSIS 安装包（x64）
npm run dist:linux        # Linux AppImage（x64 + arm64）
npm run dist              # 当前平台
```

产物在 `release/`：

- macOS：`DSH Desk-<version>-arm64.dmg`（x64 同理）；
- Windows：NSIS 安装包（`oneClick: false`，可自选安装目录）；
- Linux：AppImage。

打包后的应用完全自包含：内置 Node 运行时与 dsh 依赖树，目标机器无需安装 Node 或联网。

### 2.1 交叉构建注意事项

| 平台 | 注意 |
|---|---|
| Windows | 建议在 Windows 上构建与验证；dsh 的 PowerShell 工具链（pwsh）随依赖树捆绑，但 PowerShell 本体需目标机器支持 |
| Linux | dsh 的 `landlock-run` 沙箱组件为 Linux 专用，已在依赖树中按平台安装；AppImage 建议在目标发行版验证 |
| macOS | 未签名/未公证构建首次运行会被 Gatekeeper 拦截 |

## 3. 正式发布清单（macOS 为例）

1. **版本号**：更新 `package.json → version`；
2. **签名与公证**：配置 Apple Developer 证书 + notarytool，或 CI 中配置 `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_ID` 等环境变量；
3. **构建**：`npm run prepare:runtime && npm run dist:mac`；
4. **验收**：在干净机器安装 DMG，确认：
   - 首次启动不被 Gatekeeper 拦截（已签名+公证）；
   - `--self-test` 通过（`"…app/Contents/MacOS/DSH Desk" --self-test`）；
   - 退出应用后 `pgrep -f 'lib/bin.js'` 无残留 dsh 进程；
5. **发布**：上传 DMG 与 `latest-mac.yml`（electron-builder 自动生成，供自动更新使用）到 GitHub Release。

## 4. CI

`.github/workflows/smoke.yml`：push/PR 时在 ubuntu-latest 上跑 `npm ci`（`ELECTRON_SKIP_BINARY_DOWNLOAD=1`，不下载 Electron 二进制，因为 smoke 不启动 GUI）→ `npm run smoke`。

## 5. 常见发布问题

| 问题 | 处理 |
|---|---|
| `Node runtime not found` | 未执行 `npm run fetch:node` 或平台 key 不匹配（`darwin-arm64` 等） |
| `dsh bundle not found` | 未执行 `npm run bundle:dsh` 或版本未按 `dsh.version` 安装 |
| 打包体积异常大 | 检查 `resources/dsh/node_modules` 是否包含 dev 依赖（`bundle-dsh.mjs` 使用 `--omit=dev`） |
| AppImage 启动失败（Linux） | 目标发行版验证；确认 glibc 与 FUSE 环境 |
| 公证失败（macOS） | 确认 entitlements 包含 JIT 与网络权限；检查 hardenedRuntime |
