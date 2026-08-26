# dsh-task-dispatcher 中文文档

[返回中文首页](../../README.zh-CN.md) · [English documentation](../README.md)

这里收录中文首页之外的详细设计、配置和运维资料。建议先完成中文首页的 [Quickstart](../../README.zh-CN.md#quickstart)，再按需要阅读以下文档。

## 文档地图

| 文档 | 适合解决的问题 |
|---|---|
| [架构与执行模型](./architecture.md) | Master Planner、Host Scheduler、Worker 如何分工？动态 DAG 如何并发、回填和重规划？ |
| [配置参考](./configuration.md) | 如何设置六个角色的模型、Lane、预算、工具、orchestration 和 Web Settings？ |
| [分布式只读执行](./distributed.md) | 如何部署 coordinator/worker、配置 PostgreSQL、理解 lease 与恢复语义？ |
| [安全与运维](./security-and-operations.md) | 可写 Lane 有哪些前提？哪些工具永远禁止？重启、隔离和故障边界是什么？ |
| [使用示例](./examples.md) | 如何 dispatch、跟踪、取消、并行分析、分布式运行或安全执行写任务？ |
| [开发、测试与发布](./development.md) | 如何从源码安装、重建 Web client、运行完整检查并核对发布包？ |

## 阅读路径

- 第一次使用：中文首页 → [配置参考](./configuration.md) → [使用示例](./examples.md)
- 设计并发 Worker：中文首页 → [架构与执行模型](./architecture.md) → [配置参考](./configuration.md#启用动态只读-master-plan)
- 部署远程 Worker：[分布式只读执行](./distributed.md) → [安全与运维](./security-and-operations.md)
- 开放写工具或 self-improvement：[安全与运维](./security-and-operations.md)；不要只在 objective 中请求权限
- 修改或发布插件：[开发、测试与发布](./development.md)

## 版本边界

当前递归 orchestration 仅支持 local + `spawn` + `read-shared`。分布式 v1 以完整只读任务为租赁单位，不会把一棵 DAG 拆到多台机器。Settings 保存后必须重启 DSH Host，刷新浏览器不会激活新 policy。

英文首页与英文 `docs/` 树共同构成完整英文文档；中文首页与本目录对应相同运行语义。如发现差异，应以当前代码、测试和 deployment-owned Lane policy 为准。
