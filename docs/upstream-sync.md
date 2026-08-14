# 上游同步与版本管理

> 配套阅读：[README](../README.md)（总览）、[发布指南](release.md)。

## 1. 同步模型

**同步源 = npm 发布的 `@deepseek-ai/dsh`**（官方包自带完整依赖树 + 构建好的前端 dist），不是克隆官方 git 源码。因此上游发版后，重新捆绑 + 验证即可获得最新 UI 与功能。

- 开发模式（`npm start`）使用本地 `node_modules/@deepseek-ai/dsh`（来自 `dependencies`）；
- 打包模式使用 `resources/dsh/node_modules/@deepseek-ai/dsh`（来自 `npm run bundle:dsh`）；
- 两者版本统一收敛在 `package.json → dsh.version`，避免漂移。

## 2. 版本管理机制

| 机制 | 位置 | 说明 |
|---|---|---|
| 版本单一来源 | `package.json → dsh.version` | dev 依赖与打包捆绑使用同一版本 |
| 捆绑版本记录 | `resources/dsh/version.json` | 记录 requested/installed/node/date，启动时打印 `dsh bundle version` |
| 上游更新检查 | `scripts/check-dsh-update.mjs` | 查询 npm latest 并对比当前版本 |
| 一键升级 | `npm run update:dsh` | 更新 package.json → `npm install` → 重新捆绑 → 自动跑验证门禁 |
| 自动验证门禁 | `bundle-dsh.mjs` | 每次捆绑后自动运行 packaged 布局冒烟测试（`--no-verify` 跳过） |

`resources/dsh/version.json` 示例：

```json
{
  "requested": "0.1.0-rc.6",
  "installed": "0.1.0-rc.6",
  "node": "v22.22.0",
  "platform": "darwin-arm64",
  "date": "2026-08-14T07:15:33.289Z"
}
```

## 3. 日常操作

```bash
# 只报告是否有新版（不会改动任何文件）
npm run check:update

# 有新版时：升级 package.json → npm install → 重新捆绑 → 验证门禁
# 幂等：已是最新则直接跳过
npm run update:dsh
```

`update:dsh` 执行序列（对应 `check-dsh-update.mjs --apply`）：

1. 请求 `https://registry.npmjs.org/@deepseek-ai/dsh/latest` 获取最新版本；
2. 与 `dsh.version`（及 `dependencies`）对比，一致则结束；
3. 写入新版本到 `dependencies.@deepseek-ai/dsh` 与 `dsh.version`；
4. `npm install` 同步本地依赖与 lockfile；
5. 执行 `bundle-dsh.mjs`：重新安装到 `resources/dsh/`、写 `version.json`、跑 packaged 冒烟门禁。

## 4. 就绪检测（对上游输出格式变化抗脆）

`src/main/dsh-common.js` 采用三层策略，避免上游改打印文案导致应用误判失败：

1. 官方就绪行 `dsh web: http://127.0.0.1:<port>`（首选）；
2. stdout 中任意 `http://127.0.0.1:<port>` 字面量（兜底）；
3. 自选端口 + HTTP 轮询（最后手段）——应用先向 OS 申请空闲端口再传给 `dsh web --port <port>`，即使输出格式全部变化也能探测就绪。

## 5. 上游迭代的影响与应对

| 上游变化 | 应对 |
|---|---|
| 正常迭代（新功能/UI） | `npm run update:dsh` 一键同步，壳零改动 |
| CLI flag 变化 | 验证门禁（smoke）会暴露；启动参数集中在 `dsh-runtime.js` |
| 就绪行文案变化 | 三层就绪检测已容错 |
| Node engines 变化 | `scripts/fetch-node.mjs` 的 `DSH_NODE_VERSION` 集中控制，升级一处即可 |
| 包结构变化 | `dsh-resolve.js` 路径解析集中在一处，便于按上游结构调整 |
| 官方只改源码未发 npm 包 | 体验滞后但不坏（同步源就是 npm 发布版，符合预期） |

## 6. 建议

- 升级上游后，先看 `npm run smoke` 是否通过，再跑一次 `--self-test`（GUI 自测）确认原版 UI 正常加载；
- 若上游行为有破坏性变化且短时间内无法适配，可在 `dsh.version` 锁定旧版本，等待上游修复后再升级；
- 发布新版本前，确认 `resources/dsh/version.json` 的 `installed` 与期望版本一致。
