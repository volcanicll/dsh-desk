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

> 注意：应用图标源文件为 `assets/icon.png`，由 `scripts/gen-icon.mjs` 在打包前复制到 `build/icon.png`，electron-builder 会据此生成各平台 `.icns` / `.ico`。若改了图标记得重新生成。

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

| 工作流 | 触发 | 作用 |
|---|---|---|
| `.github/workflows/smoke.yml` | push/PR | ubuntu-latest 上 `npm ci`（`ELECTRON_SKIP_BINARY_DOWNLOAD=1`，smoke 不启动 GUI）→ `npm run smoke` |
| `.github/workflows/release.yml` | tag `v*` push / 手动触发 | 构建 mac/win/linux 安装包并自动发布 GitHub Release（见 §6） |

## 6. 自动发布（GitHub Actions Release）

`.github/workflows/release.yml` 在以下时机自动构建并发布：

- **tag push**：推送 `v*.*.*` 标签（如 `v0.1.0`）→ 校验标签与 `package.json → version` 一致后构建，直接发布 Release（非 draft）；
- **手动触发**：Actions → Release → Run workflow，可指定 draft / prerelease；tag 由 `package.json → version` 自动推导（`v<version>`，不存在则自动创建）。

### 6.1 构建矩阵

| Job | Runner | 产物 |
|---|---|---|
| `build-mac` | macos-latest | `DSH Desk-<ver>-arm64.dmg`、`DSH Desk-<ver>-x64.dmg` + blockmap + `latest-mac.yml` |
| `build-win` | windows-latest | `DSH Desk-<ver>-setup.exe` + blockmap + `latest.yml` |
| `build-linux` | ubuntu-latest | AppImage（x64/arm64）+ `latest-linux.yml` |

每个构建 Job 先 `npm ci` → `fetch-node`（按目标平台/架构捆绑 Node 运行时）→ `bundle-dsh`（捆绑 npm 发布版 dsh + 自动跑 packaged 冒烟门禁）→ `electron-builder --publish never` → 上传 artifacts；`release` Job 汇总后经 `softprops/action-gh-release` 发布。

### 6.2 签名与公证（可选，通过 Secrets 配置）

| Secret | 用途 |
|---|---|
| `MAC_CERT_BASE64` / `MAC_CERT_PASSWORD` | macOS 证书（base64 编码的 .p12/.pfx）与密码 |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | macOS 公证（notarization） |
| `WIN_CERT_BASE64` / `WIN_CERT_PASSWORD` | Windows 代码签名证书与密码 |

未配置时构建**不签名**照常发布，Release 说明会提示 macOS 首次打开需右键 → 打开（Gatekeeper）。

### 6.3 发布流程（发版清单）

1. 更新 `package.json → version`（并确认 `dsh.version` 为期望的 dsh 版本）；
2. 更新 `CHANGELOG.md`；
3. 提交并推送（`npm run smoke` 先通过）；
4. 打标签并推送：`git tag v0.1.0 && git push origin v0.1.0`；
5. Actions 自动构建三平台并发布 Release（含 `latest*.yml`，可直接支持后续自动更新接入）。

## 7. 常见发布问题

| 问题 | 处理 |
|---|---|
| `Node runtime not found` | 未执行 `npm run fetch:node` 或平台 key 不匹配（`darwin-arm64` 等） |
| `dsh bundle not found` | 未执行 `npm run bundle:dsh` 或版本未按 `dsh.version` 安装 |
| 打包体积异常大 | 检查 `resources/dsh/node_modules` 是否包含 dev 依赖（`bundle-dsh.mjs` 使用 `--omit=dev`） |
| AppImage 启动失败（Linux） | 目标发行版验证；确认 glibc 与 FUSE 环境 |
| 公证失败（macOS） | 确认 entitlements 包含 JIT 与网络权限；检查 hardenedRuntime |
