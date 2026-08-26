# 配置参考

[中文文档索引](./README.md) · [返回中文首页](../../README.zh-CN.md) · [English](../configuration.md)

Lane 是 deployment-owned policy。调用 `dispatch_task` 的模型只能选择已配置的 Lane id，不能提供 provider、model、token budget、tool、timeout、retry count 或 Worker 数量。

## Web Settings

打开 **Settings → Plugins → Task Dispatcher**，可以编辑 global default、Lane model route、tool allow-list、planning/retry budget、acceptance criteria、本地只读 orchestration、execution placement，以及 distributed role、pool 和 workspace mapping。

Save 会把 `dsh-task-dispatcher` user section 写入 Harness settings document（默认 `$DSH_HOME/settings.yaml`），但不会 hot-swap 正在运行的 dispatcher。所有保存都标记 **Restart required**：

- 必须重启 DSH Host 才会加载新 policy；
- 刷新 browser page 或 Web client bundle 无效；
- existing task、child Agent、Worker 和 claim loop 继续使用 process 启动时的 policy。

form 用最初加载的 revision 保存完整 effective policy。其他 tab、tool 或手工编辑先提交该 revision 时，本次保存会被拒绝，而不会静默覆盖。页面随后加载最新 Host snapshot，同时保留 local draft。

bundle/profile configuration 是 deployment-owned base。base Lane 可以 override 但不能删除；其 Planner 与 base workspace mapping 不能从 user layer 移除。base 已提供的 `planReviewer`、`replanner`、`finalVerifier` 可以编辑，但不能从 user layer 删除回 fallback。user-created Lane/mapping 可以删除；关闭 user-created Planner 会原子删除三个 specialized override。**Reset to profile defaults** 会暂存并恢复 profile base，在保存成功后清除 user override，而不是强制所有角色退回三路 fallback。

配置 channel 由 plugin 持有且只允许 loopback。页面只编辑 `databaseUrlEnv` 的环境变量名，不会返回 PostgreSQL URL、password 或其他环境值。`liveRoot`、`stagingRoot`、`workspaceMappings` 都是 privileged absolute path，Host 始终做最终验证。

object-shaped 但结构无效的存储配置不会激活；Host 以 disabled、repair-required fallback 启动，页面显示 validation error。namespace 若是 scalar/array，或 YAML syntax 本身损坏，可能在 editable scope 创建前失败，需要手工修复 settings document。

## 六个 Agent role

| UI role | 配置字段 | 必填/继承 | 工具集合 |
|---|---|---|---|
| Master Planner | `planner` | 可选；省略时使用 classic pipeline | `plannerTools` |
| Plan Reviewer | `planReviewer` | 可选；省略时继承 `verifier` | `verifierTools` |
| Replanner | `replanner` | 可选；省略时继承 `planner` | `plannerTools` |
| Executor | `executor` | 必填 | `executorTools` |
| Step Verifier | `verifier` | 必填 | `verifierTools` |
| Final Verifier | `finalVerifier` | 可选；省略时继承 `verifier` | `verifierTools` |

`planReviewer`、`replanner`、`finalVerifier` 只有在 `planner` 存在时才合法。为专用 role 选择不同模型不会扩大 tool allow-list。

对于 orchestration root，parent Lane 只直接使用自己的 Master Planner、Plan Reviewer、Replanner 和 Final Verifier。DAG node 的执行和逐步验证由固定 `childLane` 的完整 role 配置完成；parent Lane 的 Executor/Step Verifier 不直接执行 node。要改变 Worker model，应修改 `childLane`，而不是在 task objective 中写 model name。

通常应让 Executor 与 Verifier 使用不同模型，或至少保持独立 child run，以减少 correlated self-review。

## Plugin-level setting

| Field | Default | 含义 |
|---|---:|---|
| `lanes` | `{}` | 最多 16 个 deployment-owned Lane definition |
| `defaultRunInBackground` | `true` | tool 省略 `run_in_background` 时的默认执行模式 |
| `maxConsecutiveFailures` | `3` | local Lane circuit 打开前允许的连续 infrastructure error |
| `circuitCooldownMs` | `300000` | open circuit 拒绝新工作的时间 |
| `jobOutputLimitBytes` | `131072` | Harness 保留的最大 background Job output |
| `liveRoot` | empty | mutating Executor 要求的 protected absolute live root |
| `stagingRoot` | empty | self-improvement Lane 要求的 absolute staging root |
| `distribution` | `{ role: disabled }` | PostgreSQL whole-task distribution setting |

## Lane setting

| Field | Default | 含义 |
|---|---:|---|
| `name` | empty | 人类可读名称 |
| `description` | empty | 在 tool definition 中向模型展示的描述 |
| `kind` | `general` | `general` 或受保护的 `self-improvement` |
| `transport` | `spawn` | `spawn` 或 `fork` child-session transport |
| `execution` | `{ mode: local, pool: default, workspaceRef: "" }` | local execution，或 distributed pool/workspace reference |
| `orchestration` | `{ enabled: false }` | Host-owned local read-only recursive DAG policy |
| `executor` | required | `{ provider, model, maxTokens }` Executor route |
| `verifier` | required | Step Verifier route，也是 Reviewer role 默认值 |
| `planner` | omitted | Master Planner route；省略时保留 classic pipeline |
| `planReviewer` | omitted | independent plan-review route；继承 `verifier` |
| `replanner` | omitted | plan-adjustment route；继承 `planner` |
| `finalVerifier` | omitted | final whole-task verification route；继承 `verifier` |
| `plannerTools` | `[]` | Master Planner/Replanner allow-list，仅限内置 read-only tool |
| `maxPlanSteps` | `6` | planner-managed completed + pending step 上限，1-8 |
| `maxPlanPatches` | `4` | 可 commit 的 `replace_pending` revision 上限，0-8 |
| `maxTotalChildRuns` | `32` | 非递归 linear pipeline 的 child-session 总预算，5-32 |
| `taskTimeoutMs` | `3600000` | planner-enabled whole-pipeline deadline，1 秒至 6 小时 |
| `retryOnRevise` | `false` | 允许 Verifier `revise` 后再次运行 Executor |
| `maxAttempts` | `1` | Executor attempt，1-3 |
| `childTimeoutMs` | `900000` | 每个 child deadline，1 秒至 1 小时 |
| `requiredCriteria` | required | id 唯一、不可变的 Lane criterion |
| `executorTools` | omitted 时无 tool | 显式 Executor allow-list |
| `verifierTools` | `[]` | Reviewer/Verifier 共用 allow-list；空值为 model-only |

每个 route 接受 1-1,000,000 `maxTokens`，省略时默认 32,000。非递归 Master Plan 中，每次 Planner、Reviewer、Replanner、Executor、Verifier 启动都会消耗一个 `maxTotalChildRuns` slot；recursive orchestration 改用共享 `maxTotalModelRuns` ledger。

Planner 与 Verifier tool 只允许 `read`、`read_image`、`glob`、`grep`。Executor tool 中任何其他 capability 都被保守视为 mutating，并触发更严格的 workspace policy，参见[安全与运维](./security-and-operations.md#可写-lane)。

## Recursive orchestration setting

| Field | Default | 含义 |
|---|---:|---|
| `enabled` | `false` | 为该 Lane 启用 Host-owned recursive DAG planning |
| `childLane` | empty | 每个 immediate Worker node 使用的固定 Lane；启用时必填 |
| `maxDepth` | `2` | 共享 recursive depth 上限，1-4 |
| `maxTaskNodes` | `16` | 完整 tree 的 node budget，1-32 |
| `maxChildrenPerNode` | `4` | 一个 node 的 immediate fan-out 上限，1-8 |
| `maxConcurrentNodes` | `4` | 完整 tree 的 active node 与 in-flight pool 上限，1-8 |
| `maxTotalModelRuns` | `48` | 完整 tree 的共享 model-run credit，1-128 |
| `maxResultBytes` | `131072` | joined evidence/result 上限，4,096-1,048,576 bytes |
| `workspaceMode` | `read-shared` | v1 只接受 `read-shared`；拒绝 `isolated-write` |
| `failureMode` | `fail-fast` | `fail-fast` 或 `collect` |

启用 orchestration 要求：

- parent 与固定 child Lane 都是 local `spawn`；
- parent 有 `planner`；
- 全部 phase tool 都是 read-only；
- child `kind: general`；
- child 各 phase tool authority 不超过 parent；
- fixed-child graph 无 cycle；
- shared node/model-run budget 足以完成一条独立验证 leaf path。

`maxConcurrentNodes` 是上限，不是目标 Worker 数。只有 dependency-ready node 能 admission。rolling backfill、checkpoint 与 revision CAS 的语义见[架构与执行模型](./architecture.md#滚动回填与静止-checkpoint)。

## 启用动态只读 Master Plan

Web form 是推荐编辑器。YAML base 示例：

```yaml
dsh-task-dispatcher:
  lanes:
    analysis-leaf:
      name: Verified analysis leaf
      kind: general
      transport: spawn
      execution: { mode: local }
      executor: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 32000 }
      verifier: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
      executorTools: [read, glob, grep]
      verifierTools: [read, glob, grep]
      requiredCriteria:
        - id: leaf-evidence
          text: The assigned child objective is addressed with concrete evidence.

    analysis-orchestrator:
      name: Dynamic analysis DAG
      kind: general
      transport: spawn
      execution: { mode: local }
      planner: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
      planReviewer: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 16000 }
      replanner: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
      executor: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 32000 }
      verifier: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
      finalVerifier: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 16000 }
      plannerTools: [read, glob, grep]
      executorTools: [read, glob, grep]
      verifierTools: [read, glob, grep]
      maxPlanPatches: 2
      taskTimeoutMs: 3600000
      requiredCriteria:
        - id: requirements
          text: All root requirements are addressed with concrete evidence.
      orchestration:
        enabled: true
        childLane: analysis-leaf
        maxDepth: 2
        maxTaskNodes: 8
        maxChildrenPerNode: 4
        maxConcurrentNodes: 2
        maxTotalModelRuns: 32
        maxResultBytes: 131072
        workspaceMode: read-shared
        failureMode: fail-fast
```

保存后重启 Host，再用 `lane=analysis-orchestrator` dispatch。内置 `general-analysis` 只启用了 linear Planner，不会创建 concurrent Worker。

## Distribution setting

完整部署与 lease 语义见[分布式只读执行](./distributed.md)。process-level 字段如下：

| Field | Default | 含义 |
|---|---:|---|
| `role` | `disabled` | `disabled`、`coordinator`、`worker` 或 `hybrid` |
| `databaseUrlEnv` | `DSH_DISPATCHER_DATABASE_URL` | PostgreSQL connection string 的环境变量名 |
| `scopeId` | `default` | enqueue ownership 与 claim trust boundary |
| `workerId` | empty | lease 使用的稳定 node identity |
| `workerAgentPreset` | empty | temporary root Agent preset；空值使用 default |
| `pools` | `[default]` | Worker 可 claim 的 pool，最多 16 个 |
| `workspaceMappings` | `{}` | logical `workspaceRef` 到 local absolute path 的 mapping |
| `concurrency` | `1` | 每个 Worker 的 whole-task claim loop 数，1-16 |
| `leaseMs` | `45000` | lease duration，15 秒至 5 分钟 |
| `heartbeatMs` | `10000` | 1-60 秒且不超过 `leaseMs` 三分之一 |
| `pollMs` | `1000` | 100 ms 至 30 秒 |
| `maxDeliveryAttempts` | `3` | whole-task claim 上限，1-10 |

## 内置 `general-analysis`

内置 Lane 为 local、planner-enabled、read-only，未启用 orchestration：

- Planner：`deepseek-official/deepseek-v4-flash`，12,000 tokens；
- Executor：`deepseek-official/deepseek-v4-pro`；
- Verifier：`deepseek-official/deepseek-v4-flash`；
- Planner/Executor/Verifier tool：`read`、`glob`、`grep`；
- plan budget：6 steps、4 个 accepted patch、32 个 total child run；
- deadline：task 1 小时，每个 child 15 分钟；
- criteria：`requirements`、`tests`、`regression`。

provider name 只是 route；必须在 Harness profile 中提供可用凭据。可选 `dsh-ds4` mapping 需要单独安装、运行 local server 并提供 `DS4_LOCAL_API_KEY`，它不是本 package dependency。

## 进一步阅读

- [使用示例](./examples.md)
- [架构与执行模型](./architecture.md)
- [安全与运维](./security-and-operations.md)
- [开发、测试与发布](./development.md)
