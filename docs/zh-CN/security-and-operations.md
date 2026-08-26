# 安全与运维

[中文文档索引](./README.md) · [返回中文首页](../../README.zh-CN.md) · [English](../security-and-operations.md)

本 plugin 的核心原则是：model proposal 不是 authority；权限来自 Host 已激活、deployment-owned Lane policy。任何无法确定的状态都 fail closed。

## 验收与 authority

对每个 `dispatch_task`，Host：

1. 根据配置 Lane 验证输入；
2. 选择固定 model route、tool、workspace 与 budget；
3. 把执行和验证放在不同 child Session；
4. 只接受 structured protocol result；
5. 要求独立 Verifier 覆盖所有 immutable criterion；
6. 只有每项结果都是 `pass` 且 evidence 非空时返回 `accepted` + `modelVerified: true`。

Executor self-report 只是 evidence，不是 acceptance。模型验收也不是形式化证明、安全认证或 human approval。

## Root-only dispatch

raw `dispatch_task` 只接受确切在线 root Session。orchestration child 不能自行递归 dispatch；只有 Host 能根据 validated DAG 创建 descendant，并生成受预算约束的 grant。

以下工具永远不能加入 Executor allow-list：

- `dispatch_task`
- `dispatch_status`
- `dispatch_cancel`
- `subagent`
- `subagent_fork`
- `workflow`
- `ralph`
- `prompt_rewrite_rules`
- `trigger_rules`

Host orchestration 也不会把这些权限暴露给 child。objective 中请求 model、tool、Worker 数、sandbox 或 global rule change 不会扩大 authority。

## Tool policy

Planner 与 Verifier allow-list 永远限制为：

- `read`
- `read_image`
- `glob`
- `grep`

空 list 表示 model-only。不同 role 使用不同 model 不会改变 tool authority。

Executor tool 中任何不属于上述集合的 capability 都被保守视为可能 mutation，即使它通常只读。这样的 Lane 必须满足可写 Lane 的全部条件。

## Workspace lock

本地执行在同一个 DSH process 中，对重叠 workspace tree 只允许一个 active task。canonical parent/child path 会冲突；reservation 存在于 process-global state，所以 plugin hot reload 不会与旧 task 重叠。

distributed v1 只因所有 admitted tool 都是 read-only 才允许并发访问。除非 external scheduler 提供 distributed lease，不要运行多个 writable dispatcher process 操作同一 workspace。

task id 由 Host 生成；caller 不能指定。mandatory Lane criterion 不能被 tool call 删除或替换，caller 只能添加使用新 id 的更严格 criterion。

## 可写 Lane

只有显式 local Lane 的 Executor 可以配置 non-read-only tool。必须同时满足：

- 配置 absolute `liveRoot`；
- task workspace 与 `liveRoot` 不重叠；
- parent Session 使用 `workspace-write` sandbox；
- resolved sandbox root 精确等于 Session workspace；
- workspace 已存在且 canonical path 验证通过。

`danger-full-access`、更宽的 sandbox root、缺少 workspace 或与 `liveRoot` 重叠都会在 child 创建前 fail closed。该规则保护 filesystem scope，但不是 command、signal、network 或 resource-exhaustion 的 OS isolation。

`retryOnRevise` 默认 false，因为第二次 Executor run 可能重复 shell、network、publish 或 external side effect。只有完整任务幂等时才开启，不能只因为 file edit 通常可重复。

recursive orchestration v1 和 distributed v1 都不可写。`isolated-write` 是保留配置值，active Host 会拒绝。

## Safe self-improvement

self-improvement 是 staging-only capability，不是 hot self-modification。plugin 可以评估 Harness candidate，但不能部署或重写当前运行的 live Harness。

创建两个既存、互不重叠的 absolute root，例如 live checkout 与 staging worktree：

```yaml
- id: dsh-task-dispatcher
  config:
    liveRoot: /srv/dsh/live
    stagingRoot: /srv/dsh/staging
    lanes:
      harness-improvement:
        name: Harness improvement candidate
        description: Change and verify Harness only in the staging worktree.
        kind: self-improvement
        transport: spawn
        executor:
          provider: deepseek-official
          model: deepseek-v4-pro
          maxTokens: 32000
        verifier:
          provider: deepseek-official
          model: deepseek-v4-flash
          maxTokens: 12000
        retryOnRevise: false
        maxAttempts: 1
        childTimeoutMs: 900000
        requiredCriteria:
          - id: requirements
            text: The candidate implements the approved improvement specification.
          - id: tests
            text: The staging test and health-check evidence passes.
          - id: rollback
            text: The candidate preserves a tested rollback path to last-known-good.
        executorTools: [read, write, edit, glob, grep, bash]
        verifierTools: [read, glob, grep]
```

dispatch 时：

- parent Session `cwd` 必须存在并解析到 `stagingRoot` 下；
- Session 使用 `workspace-write`；
- sandbox root 等于 staging workspace；
- task 始终 background；
- workspace 不得在 `liveRoot` 内，也不得包含 `liveRoot`；
- `stagingRoot` 与 `liveRoot` 双向不包含；
- symlink alias 在比较前解析。

Harness `workspace-write` 还允许 platform temporary directory，因此 mutating Lane 会拒绝位于 `/tmp` 或 `os.tmpdir()` 下的 `liveRoot`。每次 Executor attempt 前重新检查 exact sandbox policy，background revision 不能继承后来被扩大的 policy。

配置 `liveRoot` 后，保护也适用于普通 Lane：只要 Executor allow-list 含 non-read-only capability，Session workspace 在 `liveRoot` 内就会被拒绝，避免把 live self-edit 重命名为 general task。

推荐 promotion flow：

```text
feedback/specification
  -> staging-only dispatcher task
  -> independent model verification
  -> isolated tests and canary health checks
  -> human or external promotion controller
  -> atomic activation, with last-known-good rollback
```

plugin 只实现 staging dispatch 与 model verification。feedback scheduling、isolated Worker、canary、promotion、rollback 和 health monitoring 属于 external control plane。不要把 self-improvement Lane 指向 running checkout，也不要加载未验证 candidate code。

## 实验性 mutation module

- `dsh-task-dispatcher/workspace-isolation` 提供 write-scope、path-lease 和 Git workspace command-planning primitive；active dispatcher 不实例化、不创建 worktree、不集成或 promote candidate。
- `dsh-task-dispatcher/config-proposals` 提供 proposal、approval、CAS、audit、rollback primitive；未连接 `dispatch_task`、Settings save path 或 active Lane policy。

仅 import 或 package 这些 module 不会赋予模型工具、workspace 或 configuration mutation authority。

## Cleanup 与 quarantine

child start、result、timeout、cancellation 和 cleanup failure 都会成为 structured non-accepted result。

无法确认 local child cleanup 时：

- result 设置 `workspaceQuarantined: true`；
- workspace lock 保留到 process 结束；
- hot-reloaded dispatcher 也不能在那里开始新 local task；
- background Job 为 `failed`，不是 `killed`。

即使后续 cleanup 看似成功，lock 也不会自动释放，因为 plugin 不会猜测不确定 child 已退出。应从 last-known-good release 重启 DSH 后再 dispatch。

distributed Worker cleanup uncertainty 同样发布 infrastructure error 与 `workspaceQuarantined: true`。v1 虽然只读，仍应检查或替换 Worker process。

## Failure class 与 Job 语义

| Task result | Local background Job |
|---|---|
| `accepted`、`rejected`、`blocked`、task-class `error` | wrapper 正常停止，通常为 completed |
| infrastructure error / quarantine | failed |
| cooperative `cancelled` | killed |

Job `completed` 只代表 wrapper 停止。semantic success 必须检查 task `status: "accepted"` 和 `modelVerified: true`。`job_output`/`job_kill` 使用 Harness `jobId`，不能使用 dispatcher `taskId`。

## Circuit 与 bounded failure

invalid input、unavailable model、refusal、token exhaustion、child timeout、malformed structured output、Job registration failure、cancellation 与 unexpected pipeline exception 都被转换为 bounded non-accepted result，不会授权 mutation，也不会有意逃逸为 unhandled Promise rejection。

local Lane 连续 infrastructure error 后打开 process-local circuit，并在 `circuitCooldownMs` 内拒绝新工作。circuit 和 workspace lock 能跨 plugin hot reload 保留，但不能跨 process restart 恢复。

Loader schema 有意宽松，让 invalid dispatcher policy 到达 plugin containment boundary，而不是让整个 plugin tree composition 失败。object-shaped invalid user section 会进入 disabled、repair-required fallback，并可在 Web page 修复。scalar/array namespace、invalid YAML、missing core service 或 composition 其他错误仍可能要求手工修复。

## Process 与 machine failure

Executor/Verifier 是不同 Session，但当前在同一个 Node process。这是逻辑隔离，不是 OS process isolation。blocking native call、event-loop deadlock、OOM、runtime crash、`SIGKILL`、kernel failure、power loss 或 machine loss 不能由同进程 JavaScript containment。

用 systemd、launchd、Docker/Kubernetes 或其他 supervisor 运行 DSH，并配置：

- automatic restart 与 bounded backoff；
- startup health/readiness check；
- last-known-good immutable release；
- atomic activation 与 failed-health rollback；
- out-of-process log/alert；
- machine-failure coverage 所需的 alternate scheduling/replication。

supervisor 不能在 isolated test 与 health check 通过前把新 candidate 设为 restart target。高风险 self-improvement 应使用独立 OS process/container，配合 kill deadline 与 process-tree cleanup。

## 状态持久性

local background Job、Master Plan、workspace lock、child-run budget、circuit 和 Web read-model 都是 process-local。Host restart 后不会恢复。

distributed mode 只持久保存 task envelope、lease、cancellation flag 与 terminal result；不会持久 Planner checkpoint 或恢复 child。reclaimed task 从头重跑完整 read-only pipeline。

Settings 保存同样不是 hot update。existing task、child、Worker 与 claim loop 保持启动时 policy；必须重启 DSH Host 激活新 policy。

## 运行限制

- 最多 16 个 Lane；Lane/criterion/deliverable/step id 为 1-64 字符；
- title 200、objective 16,384、context 32,768 字符；
- 最多 16 个 deliverable，每项 description 4,000 字符；
- 最多 24 个 task criterion，每项 2,000、合计 24,000 字符；
- 每个 tool allow-list 最多 64 项；
- route token budget 为 1-1,000,000；Executor attempt 为 1-3；
- plan 为 1-8 个 completed + pending step；每 step 1-12 criterion；
- accepted pending-suffix patch 为 0-8；linear child-run budget 为 5-32；
- recursive depth 1-4、node 1-32、fan-out 1-8、concurrency 1-8、model-run 1-128；
- `taskTimeoutMs` 为 1 秒至 6 小时，`childTimeoutMs` 为 1 秒至 1 小时；
- structured child/plan-review report 最大 64,000 serialized character；
- Job output 可配置 4,096-1,048,576 bytes；
- circuit failure threshold 为 1-20，cooldown 为 1 秒至 24 小时；
- Web read-model 每个 Session 32 个 recent terminal task，全局一小时 200 个；
- Web long poll 每个 Session 8 个、每 process 256 个；
- terminal PostgreSQL row 不自动 prune。

## 运维检查表

- 确认 caller 是 intended workspace 的 exact live root Session；
- 确认 provider route 与 credential 在当前 Harness profile 可用；
- tool allow-list 足够但不过宽；
- mutation work 使用 exact `workspace-write` 与 protected `liveRoot`；
- Settings 已保存，并已重启 Host；
- DSH/Worker 由 external supervisor 管理；
- distributed deployment 使用 PostgreSQL TLS、backup、HA 和 scoped role；
- cleanup uncertainty 后替换 process，不要继续复用 workspace。

## 进一步阅读

- [架构与执行模型](./architecture.md)
- [配置参考](./configuration.md)
- [分布式只读执行](./distributed.md)
