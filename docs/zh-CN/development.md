# 开发、测试与发布

[中文文档索引](./README.md) · [返回中文首页](../../README.zh-CN.md) · [English](../development.md)

本文面向从源码安装、修改或发布 `dsh-task-dispatcher` 的维护者。普通用户可直接使用中文首页的 public GitHub 安装命令。

## 前置条件

- Node.js `^22.19.0` 或 `>=24.0.0`；
- pnpm 11；
- 一个已提供 agents、jobs、settings、subagents、tools 服务的 DeepSeek Harness profile；
- Lane 配置所需的 model route 与 credential。

Host `settings` service 是 hard dependency，不是 optional enhancement。缺少该 service 的 profile 无法 compose plugin。

## 从源码安装

```sh
cd /path/to/dsh-task-dispatcher
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run bundle

cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /path/to/dsh-task-dispatcher
pnpm dsh --profile web --dump-config
```

dump 应包含一个 plugin name 为 package root `dsh-task-dispatcher` 的 row。Harness 依靠该 root row 发现并服务 `lib/client.js`。

`dsh-task-dispatcher/dispatcher` 是兼容 export，仍可 import，但不能作为 Cordis row name。

## Generated Web client

repository 提交生成的：

- `lib/client.js`
- `lib/client.js.map`

因此 Git/file dependency 安装时不会运行 package build，也不要求目标环境安装 compiler/dev dependency。DSH plugin-management command 本身会调用 pnpm，所以 `PATH` 中仍必须有 pnpm。

修改 `src/client` 后必须运行：

```sh
pnpm run bundle
```

并确认 generated artifact 与 source 同步后再 commit。

## 完整验证

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm lint
pnpm test
pnpm run bundle
pnpm run publint
pnpm pack --dry-run
```

各检查的目的：

| Command | 检查内容 |
|---|---|
| `pnpm run typecheck` | client TypeScript contract 与 UI type |
| `pnpm lint` | Host、client、test source 的静态问题 |
| `pnpm test` | Host unit/integration test，以及 bundle 后的 client test |
| `pnpm run bundle` | 生成发布用 Web client artifact |
| `pnpm run publint` | package export、entry point 与发布 metadata |
| `pnpm pack --dry-run` | 最终 npm tarball 文件清单 |

`pnpm test` 会依次运行 Host 与 client suite。client test 会先重建 bundle，因此测试后 generated artifact 可能产生预期 diff；应检查并提交该 diff。

## 发布前检查

1. 确认 `git status` 中没有意外文件或 credential。
2. 运行完整验证命令。
3. 检查 `git diff --check`。
4. 检查 `pnpm pack --dry-run` 输出包含：
   - `README.md`
   - `README.zh-CN.md`
   - `docs/zh-CN/` 文档（若 package `files` policy 包含 docs）
   - Host entry/module
   - `lib/client.js` 与 source map
5. 验证 package-root 与 `/dispatcher` export 兼容性。
6. 确认无 live credential、database URL 或 local absolute workspace 被打包。

`npm publish` 通过 package `prepublishOnly` gate 再次运行 bundle。即便如此，本地 `npm pack` 前也应显式运行 bundle 与 tests，避免直到 publish 才发现 generated client drift。

## 本地 Host 验收

安装 local path 后启动一个显式端口：

```sh
cd /path/to/deepseek-harness
pnpm dsh web --port 8317
```

打开 <http://127.0.0.1:8317>，检查：

- **Settings → Plugins → Task Dispatcher** 可打开；
- 六个 role model card 正确显示继承关系；
- Save 明确提示 **Restart required**；
- conversation header 能显示 dispatcher progress；
- profile 中的 provider route 和 credential 可用。

修改 Host policy 或保存 Settings 后必须 restart process；refresh browser 不是激活边界。

## Source module 边界

`dispatcher.js` 保持 compatibility facade/composition root。核心职责分散到：

- `dispatcher-child-runner.js`
- `dispatcher-contracts.js`
- `dispatcher-policy.js`
- `dispatcher-telemetry.js`
- `dispatcher-shared.js`
- `dispatcher-tools.js`

focused module 可以依赖 shared leaf，但不应反向 import `dispatcher.js` facade。package-root 与 `/dispatcher` export 会按 name 与 object identity 测试，防止 refactor 静默破坏 consumer。

## 文档维护

- public quickstart 与项目定位保留在 `README.md`/`README.zh-CN.md`；
- 中文详细设计位于 `docs/zh-CN/`；
- command、field、provider/model/tool name 不翻译；
- 修改 heading 后同步修复 relative link 与 anchor；
- 检查 fenced code block 数量与配对；
- 对 JSON/YAML example 做 syntax validation。

## 进一步阅读

- [架构与执行模型](./architecture.md)
- [配置参考](./configuration.md)
- [安全与运维](./security-and-operations.md)
