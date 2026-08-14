# 贡献指南

感谢你对 DSH Desk 的兴趣！欢迎提交 Issue 与 PR。

## 开发环境

要求 Node.js ≥ 22.19（dsh 的 engines 要求 `^22.19.0 || >=24.0.0`）。

```bash
npm install
npm start          # 开发模式
npm run smoke      # 无 GUI 冒烟测试
```

更多细节见 [docs/development.md](docs/development.md)。

## 提交 PR 前的检查清单

- [ ] `npm run smoke` 通过；
- [ ] 涉及 GUI 行为时，跑过 `npx electron . --self-test`；
- [ ] 不修改 `@deepseek-ai/dsh` 的任何前端/源码（核心原则：不改前端）；
- [ ] 代码分层符合约定：路径解析在 `dsh-resolve.js`，端口/就绪在 `dsh-common.js`（纯模块，不依赖 Electron）；
- [ ] 更新相关文档（README / docs/）。

## 代码约定

- 纯逻辑放 `src/main/dsh-common.js` / `dsh-resolve.js`，保持不依赖 Electron，便于 smoke 测试复用；
- 启动参数、CLI flag 集中在 `dsh-runtime.js`；
- 上游版本统一由 `package.json → dsh.version` 管理（见 [docs/upstream-sync.md](docs/upstream-sync.md)）。

## 提交信息

建议遵循简洁的动词开头（如 `Add ...`、`Fix ...`、`Update ...`），可参考 git 历史：

```text
Add npm-release sync mechanism and robust readiness detection
ci: bump checkout/setup-node to v5
Prepare for open source: add LICENSE, CI, and repo metadata
```

## Issue 模板要点

- 描述预期行为与实际行为；
- 附上诊断信息（见 [docs/troubleshooting.md](docs/troubleshooting.md) 第 7 节）：dsh 版本、`version.json`、启动日志、`--self-test` 输出、平台信息；
- 如果是打包/发布问题，附上构建命令与产物路径。

## 代码风格

- ESM（`"type": "module"`），`import` 用带 `node:` 前缀的 Node 内置模块；
- 使用 JSDoc 注释关键函数与设计意图；
- 不引入额外运行时依赖（壳自身依赖面尽量小）。
