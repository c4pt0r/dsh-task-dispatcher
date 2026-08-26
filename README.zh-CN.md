# dsh-task-dispatcher

[English](./README.md) | **简体中文**

一个独立的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件包，用于把有明确边界的工作发送到隔离的子 Session，并要求独立模型完成验证。一个 Lane 可以使用原始的 Executor → Verifier 流水线，也可以加入只读 Planner 来维护受预算和评审约束的动态计划，还可以启用分层编排：Master Planner 提出粗粒度语义 DAG，Host 选择依赖已就绪且符合预算的工作，每个 Worker 只聚焦一个节点。每个 Lane 独立拥有所有模型路由、工具白名单、重试与规划预算、超时和强制验收标准。默认在本地执行；可选的分布式只读模式通过 PostgreSQL 把完整任务租约给远程 DSH Worker。

父 Session 始终是控制平面。执行与验证发生在子 Session 中，因此多个竞争模型不会并发向同一个父 Session 追加内容。

**从这里开始：** [Quickstart](#quickstart) · [核心理念](#核心理念) ·
[架构](#架构) · [使用指南](#使用指南) · [使用示例](#使用示例) ·
[Lane 配置参考](#配置-lane) · [可用性与故障边界](#可用性与故障边界)

## Quickstart

### 1. 将公开插件添加到 Web profile

前置条件：Node.js `^22.19.0` 或 `>=24.0.0`、pnpm 11，以及可工作的 DeepSeek Harness Web profile。该 profile 必须已经提供标准的 agents、jobs、settings、subagents、tools 服务，以及 Lane 所使用的模型路由。

```sh
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add github:c4pt0r/dsh-task-dispatcher
pnpm dsh --profile web --dump-config
```

配置输出中必须存在一个名为 `dsh-task-dispatcher` 的根行。插件安装以 profile 为单位；安装到其他 profile 不会让 `web` profile 获得 Web client 或 Settings 页面。

### 2. 启动或重启 Web Host

端口 8317 只是显式示例，不是 DSH 默认端口：

```sh
pnpm dsh web --port 8317
```

打开 <http://127.0.0.1:8317>。添加插件后必须启动或重启 Host；只刷新浏览器不会激活 Host policy 变更。如果 8317 已被占用，请选择另一个明确端口。

### 3. 在 Web UI 中检查 policy

打开 DSH 输出的 URL，然后进入 **Settings → Plugins → Task Dispatcher**。内置的 `general-analysis` Lane 在本地执行、启用 Planner、默认后台运行，并且有意限制为只读。它假定当前 Harness profile 中存在内置的 DeepSeek provider 名称。首次 dispatch 前，请为这些路由配置可用凭据（通常为 `DEEPSEEK_API_KEY`，或等价的 Models 设置）；只有 provider 名称并不能让模型调用成功。

### 4. Dispatch 一个带验证的任务

在确切的在线根 Session 中用自然语言提出：

```text
Use dispatch_task with lane=general-analysis and run_in_background=true.
Title: Review pagination.
Objective: Review the audit-log pagination, identify concrete gaps, and verify
the findings independently. Do not modify the workspace.
```

工具返回 dispatcher `taskId` 和 Harness `jobId`。本地后台任务使用 `job_output({ job_id })` 查看。Job 显示完成只代表流水线已停止；必须检查任务结果本身是 `accepted`、`rejected`、`blocked`、`cancelled` 还是 `error`。

### 5. 按需启用动态 DAG 规划

动态递归编排必须显式开启。先创建一个不启用 orchestration 的只读 child Lane，再在 parent Lane 上启用 **Safe subtask orchestration** 并选择该 child Lane。保持 `maxPlanPatches > 0`，提供足够的共享节点与 model-run 预算，保存后重启 DSH。当执行中的 Worker pool 到达静止边界时，Host 才可以修改 DAG 中从未启动的部分；运行中和已完成节点保持不可变。精确的 v1 边界参见[由 Host 持有的递归编排](#由-host-持有的递归编排v1)。

内置 `general-analysis` Lane 已启用 Planner，但**未**启用递归编排。除非 operator 在另一个 Lane 上显式启用 `orchestration`，否则它只运行一份自适应线性 Master Plan，不会创建并发 Worker。

## 核心理念

1. **模型提出建议，Host 持有权限。** 模型可以提出 plan、patch、child DAG 或证据；只有 Host 能选择路由、工具、workspace、预算、lease、plan revision 和终态。
2. **规划是分层的。** Master 描述结果、依赖、contract、覆盖关系与调度提示。Worker 只接收一个节点，并只为该节点规划。两个角色都不拥有调度权限。
3. **成功必须通过独立验证。** Executor 的自我报告只是证据，不代表验收。独立 Verifier 必须覆盖每一个不可变 criterion，并为每个通过项给出非空证据。
4. **Policy 的权限高于 prompt 文本。** Objective 不能选择模型、添加工具、扩大 sandbox、切换 Lane 或生成递归权限；这些只能来自部署方拥有的 Lane 配置。
5. **计划可以变化，但副作用必须被隔离。** 线性计划只能替换待执行后缀。递归 DAG 只能在没有 Worker 仍在执行的静止调度边界，经独立 patch review 与 revision compare-and-set 后替换从未启动的节点。
6. **预算只会单调减少。** 深度、节点数、fan-out、并发、model-run、attempt、deadline、输出和 lease 限制都在发布工作前检查。已经启动的工作不会退还模型权限。
7. **不确定时默认拒绝。** 缺失结构化输出、过期 lease、无效证据、cleanup 状态不确定、policy drift 或预算耗尽都不能变成 `accepted`。本地 cleanup 不确定时会隔离 workspace。
8. **持久性必须明确声明，不能推断。** 本地 plan 和 Job 是进程内状态。分布式 v1 会持久租赁一项完整只读任务，但不会 checkpoint 单独的 planner/executor/verifier 阶段。

## 架构

```mermaid
flowchart TB
  User["根 Session / 人类请求"]
  Approval["Harness 审批边界"]
  Settings["Settings UI<br/>重启后生效的 policy"]
  Host["Dispatcher Host 控制平面<br/>Lane policy · 预算 · 锁 · revision"]
  Telemetry["Session 级 telemetry<br/>plan · workers · results"]
  Web["会话卡片 + Settings 页面"]

  User -->|"dispatch_task"| Approval --> Host
  Settings -->|"重启时加载已验证 policy"| Host
  Host --> Telemetry --> Web

  subgraph Local["本地分层执行"]
    LocalShape{"配置的本地 Lane 形态"}
    Classic["经典流水线<br/>executor → 独立 verifier"]
    Adaptive["自适应线性 plan<br/>规划/评审 → 逐步执行 → final verifier"]
    Master["Master Planner<br/>粗粒度结果 + 语义 DAG"]
    PlanReview["独立宏观 plan reviewer"]
    Plan["Host 持有的 Master DAG<br/>contract · revision · 不可变历史"]
    Scheduler["Host Ready Queue<br/>关键路径 · 解锁价值 · 全局容量"]
    GrantA["Worker envelope A<br/>节点 A + 直接验证证据 + Host grant"]
    GrantB["Worker envelope B<br/>节点 B + 直接验证证据 + Host grant"]
    ChildA["Worker A<br/>节点内 plan → execute → verify"]
    ChildB["Worker B<br/>节点内 plan → execute → verify"]
    Settled["Worker 已结算<br/>记录 accepted evidence · 释放 slot"]
    InFlight{"仍有其他 Worker 在执行？"}
    Backfill["立即回填 ready work"]
    Checkpoint{"仍有未启动节点<br/>且有安全 patch 预算？"}
    Drain["关闭新 admission<br/>等待当前 pool 排空"]
    Barrier["静止调度边界<br/>in-flight pool 为空"]
    Final["最终独立 verifier"]
    LocalResult["由 criterion 门控的本地结果"]

    LocalShape -->|"未配置 planner"| Classic --> LocalResult
    LocalShape -->|"配置 planner，关闭 orchestration"| Adaptive --> LocalResult
    LocalShape -->|"启用 orchestration"| Master
    Master --> PlanReview --> Plan
    Plan --> Scheduler
    Scheduler --> GrantA --> ChildA --> Settled
    Scheduler --> GrantB --> ChildB --> Settled
    Settled --> InFlight
    InFlight -->|"是"| Backfill --> Checkpoint
    Checkpoint -->|"否：吞吐优先滚动执行"| Scheduler
    Checkpoint -->|"是：最终进入 replan checkpoint"| Drain --> Barrier
    InFlight -->|"否：grant 已结算且 cleanup 完成"| Barrier
    Barrier -->|"accepted，Host 已封存证据"| Plan
    Plan -->|"保留 / 经评审替换未启动 DAG"| Scheduler
    Plan -->|"没有 pending 节点"| Final --> LocalResult
  end

  subgraph Distributed["分布式只读执行 v1"]
    Store[("PostgreSQL 持久任务 + lease ledger")]
    Worker["远程 DSH worker<br/>临时 root + 完整任务流水线"]
    Store -->|"claim · heartbeat · fenced completion"| Worker
    Worker -->|"terminal result"| Store
  end

  Host -->|"local lane"| LocalShape
  Host -->|"distributed lane：入队完整任务"| Store
  LocalResult -->|"accepted / rejected / blocked / error"| Host
  Store -->|"持久 status / cancel"| Host
```

本地与分布式路径有意采用不同恢复模型。本地执行能够公开实时 phase、Agent、依赖与动态 plan revision，但进程终止会丢失这些内存状态。分布式 v1 通过 PostgreSQL lease 承受 coordinator 或 worker 替换；但是 worker 丢失后会重新运行整项只读任务，而不是从 plan 中途恢复。可写的递归 worktree primitive 目前只是实验性 Host library，尚未接入活动 Lane 或远程 Worker。

架构区分三类知识。Master Planner 能看到根 objective 并构建宏观 DAG，但不写命令或实现步骤。Host 能看到完整、已验证的 DAG 与全部资源状态，并且是唯一 scheduler。Worker 只看到当前节点 contract、直接需要的 accepted evidence、全局不变量和弱化后的 Host grant；它看不到 sibling 或未来节点。

| 模式 | Plan 形态 | Revision 时机 | 并行度 | 持久状态 |
|---|---|---|---|---|
| Local classic | 无 plan：executor 后接 verifier | 仅可选 executor retry | 每次一个 child phase | 进程内 |
| Local adaptive | 有序 Master Plan | 一个 step 验证后，只替换 pending 后缀 | 每次一个 plan step | 进程内 |
| Local orchestration | 带 contract 的宏观 DAG；Worker 内可有节点局部 plan | 自然或有界的最终静止 checkpoint，只替换未启动节点 | 有优先级的滚动回填和受限 replan checkpoint | 进程内 |
| Distributed v1 | 一个 worker 运行完整 classic 或 adaptive pipeline | 在该 worker 内；禁用递归 DAG | 在完整任务/worker 之间并行，不在单项任务内跨机器 | Envelope、lease、cancellation 和 terminal result |

### 内部代码边界

`dispatcher.js` 保持兼容 facade 和 composition root。大型控制平面职责拆到以下模块中，公开入口不变：

| Module | 职责 |
|---|---|
| `dispatcher-child-runner.js` | 有界 child 启动、结构化输出捕获、cancellation 和 exactly-once cleanup |
| `dispatcher-contracts.js` | 单一来源的 model、task-result 和 tool JSON Schema |
| `dispatcher-policy.js` | Lane policy、跨字段验证、Settings 持久化和重启生效的配置 RPC |
| `dispatcher-telemetry.js` | Session projection、retention、watch、revision 和 loopback telemetry RPC |
| `dispatcher-shared.js` | 无副作用 guard、clipping、路径包含关系和受控诊断日志 |
| `dispatcher-tools.js` | 面向模型的 dispatch、持久 status 和 cancellation tool adapter |
| `dispatcher.js` | 规划/执行状态机、runtime 生命周期、Cordis `apply` 和兼容 re-export |

依赖方向是单向的：聚焦模块可以依赖 shared leaf，但没有模块反向导入 `dispatcher.js` facade。package root 与 `/dispatcher` 的 export 会按名称和 object identity 测试，避免未来重构静默破坏 consumer。

## 它保证什么

对每一次 `dispatch_task` 调用，插件会：

1. 根据部署方拥有的 Lane 验证任务。
2. Lane 没有 `planner` 路由时，使用原始的隔离 Executor → Verifier 流水线。
3. 配置 `planner` 后，要求结构化初始 plan，把 proposal 发给独立 plan-review child，并且只执行已通过的 plan。如果初始只读 Planner 输出普通文本而没有记录所需结构化结果，且 child-run 预算足以支持评审、一个可执行 step、其 verifier 和 final verification，Host 可以启动一次全新的 protocol retry。普通文本永远不会被解析或当作 plan 接受。
4. 一次只为一个 plan step 运行 Executor 和独立 Verifier。只有 Host 可以把该 step 标记完成。
5. step 完成后，如果还有 pending work 和 patch 预算，Planner 可以保留剩余 plan、报告 blocker，或只替换 pending 后缀。每次替换 proposal 都必须再经独立 plan review 后才能提交。
6. 所有 step 完成后，针对不可变的原始任务和全部原始 acceptance criteria 运行最终全局 Verifier。
7. 仅当适用的 Verifier 为每个 criterion 恰好返回一个结果、所有结果均为 `pass` 且每个通过项证据非空时，才接受任务。
8. 只有部署 policy 显式启用 `retryOnRevise`，且相关 attempt、patch、child-run 和 deadline 预算仍允许时，才重复 Executor 或允许 final-review remediation。
9. 对启用 orchestration 的 Lane，Host 从依赖就绪队列维护受限的 in-flight pool。Host 先按 critical-path cost、即时 unlock value 和 downstream reach 排序，再应用配置容量。某个 Worker 结算而其他 Worker 仍在执行时，Host 立即把新就绪工作填入空 slot。如果回填后仍有未启动节点且存在安全 patch 预算，Host 会关闭新 admission 并排空当前 pool，从而保证最终到达静止 checkpoint，不让动态 planning 永久饥饿。没有安全 replan 预算时继续滚动执行以保证吞吐。只有在静止 checkpoint，Master 才能保留剩余 DAG、报告 blocker，或替换从未启动的节点；替换须独立评审，并通过 compare-and-set plan revision 提交。运行中和已完成节点永远不是 patch target。

`accepted` 表示结果已通过**模型验证**；它不是形式化证明、安全认证或人工批准。Executor 的自我成功声明永远不足以验收。

其他安全属性：

- 只有确切的在线根 Session 可以发起原始 `dispatch_task`。orchestration child 不能自行递归 dispatch；只有 Host 能根据已验证的 orchestration proposal 创建 descendant。
- 本地 Lane 在当前 DSH 进程中对有重叠关系的 workspace tree 只允许一个活动任务。规范化后的父/子路径会冲突；reservation 存在于进程全局状态，因此 plugin hot reload 也不会与旧任务重叠。分布式 v1 只因所有 Worker tool 都是只读才允许并发访问。
- task id 由 Host 生成，caller 不能指定。
- Master Plan 的 identity、revision、status、evidence 与不可变 history 均由 Host 持有。Planner child 只能提出 typed data，不能修改 plan state。revision patch 必须匹配当前 Host revision。已完成线性 step 是不可变前缀，已完成 orchestration node 是不可变集合；二者都不能被替换，历史上移除的 id 不能复用，plan review 会拒绝重复已完成 effect 的 proposal。
- Lane 的强制 criteria 不能被 tool call 删除或替换；caller 只能用新 id 添加更严格的 criteria。
- task text、criteria、deliverables、attempt、plan size、plan patch、总 child run、整项任务时间、per-child 时间、输出、cleanup 和 Job output 都有界。
- child tool 使用白名单；空 `verifierTools` 表示 model-only Verifier。
- Executor Lane 禁止原始递归和全局规则能力：`dispatch_task`、`dispatch_status`、`dispatch_cancel`、`subagent`、`subagent_fork`、`workflow`、`ralph`、`prompt_rewrite_rules` 和 `trigger_rules` 不能加入 Executor 白名单。Host orchestration 也不会把这些工具暴露给 child。
- Planner 与 Verifier 只能使用内置只读集合 `read`、`read_image`、`glob`、`grep`，不能修改候选结果。
- child start、result、timeout、cancellation 和 cleanup 失败都会成为结构化任务失败。
- 如果无法确认本地 child cleanup，结果会设置 `workspaceQuarantined: true`，进程会继续保留该 workspace；任何替换或 hot-reloaded dispatcher 都不能在那里启动新本地任务。分布式 cleanup 失败也不会被接受，并要求 operator 检查或替换该 worker。
- 意外 pipeline exception 会被隔离并记录，不会变成 unhandled Promise rejection。
- 本地 Lane 连续发生基础设施错误后会打开进程内 circuit，并在 cooldown 期间拒绝新工作。
- Dispatch 始终需要普通 Harness **Allow once** 审批。

推荐使用 `spawn` transport，因为 task specification 是独立的。`fork` 还会把父 Session 已完成的历史提供给 child，但不会包含当前正在执行的 dispatch tool call。

## 执行模式与 Master Plan

省略 `planner` 时保留原始流水线：一次完整任务范围的 Executor 运行生成结构化证据，然后由单独的 Verifier 评估完整任务。`retryOnRevise` 可以让 Executor 最多重复 `maxAttempts` 次；不会创建 Master Plan。

当 Lane 配置 `planner` 且未启用递归 orchestration 时，流水线如下：

```text
initial planner -> independent plan review
  -> step executor -> independent step verifier
  -> keep plan | independently review and replace pending suffix
  -> ...
  -> final independent verifier over the original task
```

初始 plan 必须覆盖每一个原始 criterion 与 deliverable。Host 分配 plan id，持有单调递增 revision 和 append-only history，并且是唯一能够更改 step status 或记录 evidence 的组件。Planner patch 针对当前 revision 做 compare-and-set；可以返回 `keep`、`blocked` 或 `replace_pending`，但不能编辑 completed prefix。已经从历史中移除的 step id 不能复用，替换也不能削弱不可变任务的覆盖范围。

accepted step 会先成为不可变 completed prefix 的一部分，然后才能 replan。当不存在 pending step 后，Final Verifier 必须基于证据独立接受原始任务的所有 criterion。如果 Final Verifier 要求 revise 且 retry policy 允许，Planner 可以在仍可用的 plan 后缀中提出受预算约束的 remediation step；否则任务会被 rejected 或 blocked。

Master Plan 状态是执行任务的进程内状态。它会包含在最终任务结果中供检查，但当前版本没有持久 phase/plan journal，进程重启后不能恢复 plan、child run、budget 或 pending suffix。本地任务随进程丢失。分布式 task envelope 和最终 terminal result 是持久的，但 Worker 失败会让完整任务流水线被重新租赁并重跑，而不是恢复中断的 plan。

## 由 Host 持有的递归编排（v1）

递归 orchestration 是 Lane 的 opt-in 属性。v1 有意只支持**本地 + `spawn` + 只读**，并要求 `workspaceMode: read-shared`。内置 `general-analysis` Lane 没有启用该功能。orchestration Lane 与固定 `childLane` 都必须在本地运行、使用 `spawn`，且只暴露 `read`、`read_image`、`glob`、`grep`。child Lane 由部署配置选定，必须是 `general` Lane，并且 planner、executor、verifier 各阶段的工具权限不能超过 parent Lane。`isolated-write` 只是保留配置值；启用 orchestration 时 Host 会拒绝它。

v1 动态 DAG 生命周期：

```mermaid
flowchart TD
  P["Master Planner<br/>提出粗粒度、带 contract 的 DAG"] --> R["独立宏观 DAG 评审"]
  R --> V["Host 验证依赖 · contract · 覆盖 · 预算"]
  V --> W["Host 从 Ready Queue 填充受限 in-flight pool<br/>关键路径 · 解锁价值 · 容量"]
  W --> EA["Envelope A<br/>当前节点 + 直接验证证据 + Host grant"]
  W --> EB["Envelope B<br/>当前节点 + 直接验证证据 + Host grant"]
  EA --> CA["Worker A<br/>节点局部 plan → execute → verify"]
  EB --> CB["Worker B<br/>节点局部 plan → execute → verify"]
  CA --> S["结算一个 Worker<br/>完成 cleanup · 封存 accepted evidence · 释放 slot"]
  CB --> S
  S --> I{"仍有 Worker 在执行？"}
  I -->|"是"| BF["立即回填一个 ready slot"]
  BF --> CP{"仍有未启动节点<br/>且存在安全 patch 预算？"}
  CP -->|"否：继续吞吐优先滚动"| W
  CP -->|"是"| D["请求 checkpoint<br/>关闭新 admission · 排空当前 pool"]
  D --> Q
  I -->|"否：静止调度边界"| Q{"存在 pending 节点？"}
  Q -->|"否"| F["最终独立 root verifier"]
  Q -->|"是，但没有安全 replan 预算"| W
  Q -->|"是，状态 accepted 且有 replan 预算"| RP{"Master replanner 决策"}
  RP -->|"keep"| W
  RP -->|"blocked"| B["Blocked result"]
  RP -->|"replace_pending"| PR["评审 + revision CAS<br/>只替换未启动节点"]
  PR -->|"accepted"| W
  PR -->|"rejected / blocked"| X["未接受结果"]
```

### Master、Host 与 Worker 的信息边界

**Master Planner** 提出 typed node id、outcome、dependency、input/output contract、逻辑 deliverable scope、局部 acceptance criteria、不可变根 criterion 的覆盖，以及 resource-class/estimated-cost hint。它应按可独立验证的 outcome 边界拆解项目。它不能规定命令、具体编辑、model call、tool、provider、working directory、child Lane、budget、grant 或要启动多少 Worker；这些属于实现与权限决策，不是宏观 plan data。

**Host Scheduler** 持有完整已验证 DAG 与实时真相。它从 accepted dependency 推导 ready set，按 critical path、即时 unlock count 与 downstream reach 排名，然后在生成 grant 前应用 active capacity。公开 scheduler core 还可以执行 per-provider、model、resource-class、workspace 和 conflict-key quota。活动 dispatcher 在 Worker 结算时会反复调用该 core，直到它为了进入最终 replan checkpoint 而主动关闭 admission。当前 Lane runtime 主要使用全树 `maxConcurrentNodes`、固定 child-Lane/workspace context 和 FIFO Host grant ledger；更宽泛的 quota surface 供受信 Host integration 使用，目前未作为 Lane runtime 配置暴露。

**Worker** 获得最小上下文 envelope：当前节点 outcome、本地 input/output 与 acceptance contract、与该节点相关的 global invariant、直接引用 dependency 的受限 verified evidence，以及有界 Host grant。它看不到完整 DAG、sibling objective、未来节点，也无权编辑 Master Plan。拥有自己的 Planner 的 child Lane 可以创建节点局部 mini-plan，但该 mini-plan 留在 Worker pipeline 内，不能自行成为 global DAG patch。

每个 Worker 都运行固定 Lane 的完整流水线，只有独立 accepted 后才能满足 dependency。accepted child report 会被封存为下游节点和最终 root verifier 的受限 dependency evidence；它们不会自动证明根任务成功。

当前 DAG 归 Host 所有。滚动执行以吞吐优先开始：某个 Worker 结算且至少一个其他 Worker 仍在执行时，scheduler 重新计算 Ready Queue，并可立即启动刚刚解锁的关键后继节点。它不会为了一个无关的慢 sibling 而闲置释放的 slot。

滚动过程有明确边界，避免动态 planning 永久饥饿。完成一次回填后，如果仍有未启动节点、所有已记录 outcome 都是 accepted，且 patch/model-run 预算足够安全 replan 与 review，Host 会请求 checkpoint。它关闭新 admission，但不会取消当前 Worker；各 child deadline 保证现有 pool 最终排空。若安全 replan 条件不满足，Host 不会制造无意义的吞吐空洞，而是继续滚动 admission。

只有当 in-flight pool 完全排空、所有 child grant 已结算且 cleanup 完成后，Master 才能更改 DAG；这就是**静止调度边界**。Replanner 接收受限结构化 evidence，而不是原始 child stream。`keep` 不改变 revision；`replace_pending` 提供完整的新未启动 DAG，并接受独立 plan review。Host 会逐字节保留 completed node，绝不把 running node 放入可 patch 集合，拒绝修改保留 pending id，禁止复用任何已移除 id，重新验证 dependency 以及不可变 criterion/deliverable coverage，并且仅在 `baseRevision` 仍匹配时提交。原子 plan 决策完成后才允许新 admission，因此已移除节点不可能用旧权限启动。patch 不能修改 running 或 completed node。

动态 patch 由 `maxPlanPatches` 和共享 model-run ledger 共同约束。可选 replan 前会优先为强制 pending child 和 Final Verifier 预留预算。没有安全余量时，Host 继续执行已评审 DAG，而不启动 Replanner。v1 只根据静止边界前积累的 accepted evidence replan；failed work 会按 `failureMode` 终止任务或让依赖节点 blocked，Final Verifier gap 不会生成新 DAG。

整个递归树共享一份 Host authority ledger。不透明 grant 会单调弱化配置的 depth、总 task-node、per-node fan-out、concurrent-node、model-run 和 deadline budget。child reservation 要么全部成功要么全部失败，model run 启动前计费，descendant 仍持有权限时 ancestor 不能结算。cancellation 会撤销 grant tree；budget exhaustion、replay、expiry、policy drift 或无效 proposal 都会 fail closed，生成非 accepted task result。配置的 child Lane 自身也可以启用 orchestration，但必须处于同一组共享限制和静态验证的 fixed-lane graph 内。

该功能不会放宽 root-only tool boundary。child 永远不会得到原始 `dispatch_task`、`dispatch_status`、`dispatch_cancel`、`subagent`、`subagent_fork`、`workflow`、`ralph`、`prompt_rewrite_rules` 或 `trigger_rules` 权限。模型可以提出工作，只有 Host 能生成有界 child grant 并启动工作。

与其他本地 Master Plan 一样，DAG、grant、live child state 和 progress journal 都是进程内状态。v1 不会把一棵递归树拆到远程 Worker，也不能在 Host 重启后恢复它。

### 公开的 Host-side planning module

package 导出两个用于该分层边界的纯 planning/scheduling module。它们不运行模型、不启动 child，也不发放工具：

- `dsh-task-dispatcher/macro-planning` 导出 `normalizeMacroPlan`、`validateMacroPlan` 和 `buildWorkerEnvelope`。它严格验证带 contract 的宏观 DAG，拒绝实现/权限字段，检查 dependency、root coverage、contract reference、historical id 和 repository-relative scope proposal，然后生成一份深度冻结、且不包含完整 DAG 的 Worker envelope。活动 dispatcher 使用相同层次和兼容 orchestration contract；这个独立 module 是后续 Host integration 可复用的精确边界。
- `dsh-task-dispatcher/ready-scheduler` 导出 `validateReadySchedulerDag` 和 `scheduleReadyNodes`。它是确定性、无副作用的 admission core，支持 critical-path/unlock prioritization、全局与 per-resource capacity、conflict key、failure propagation 和 diagnostics。除非 Host 已关闭 admission 以进入受限 replan checkpoint，否则 dispatcher 会反复调用它，在其他 Worker 仍执行时回填释放的 slot。per-provider、model、resource-class、workspace 和 conflict-key limit 仍是公开 Host-core input，而不是活动 Lane runtime setting。

package 还导出两个实验性 mutation-oriented Host building block。它们是经过测试的 library，不是活动 dispatcher capability：

- `dsh-task-dispatcher/workspace-isolation` 验证 repository-relative write scope，并包含 path-lease 与 Git workspace command-planning primitive。dispatcher 不会实例化它，不会把 child Session 放入其 worktree，也不会集成或 promote 候选结果，因此可写递归 orchestration 仍不可用。
- `dsh-task-dispatcher/config-proposals` 包含受限 configuration proposal、approval、compare-and-set、audit 和 rollback primitive。它没有连接 `dispatch_task`、Settings save path 或活动 Lane policy。dispatch task 不能用它持久修改配置或全局规则。

所有四个 module 都要求受信 Host 提供实时状态并执行其决策。前两个是纯 contract/scheduling boundary；后两个在 mutation workflow 仍为实验状态时可能变化。仅 import 或打包 module 不会给模型增加任何 tool、workspace 或 mutation authority。尤其是，用 `macro-planning` 验证 `workspace-write` proposal 并不会使可写 orchestration 可用：活动 orchestration 仍会拒绝除只读 `read-shared` 外的 workspace mode。

## 分布式只读执行（v1）

分布式模式把一项**完整任务**放到一个 Worker 上。Worker 创建临时本地根 Agent，并在那里运行现有 Planner、Executor、Reviewer 和 Verifier 流水线。多项任务可分散到不同 Worker process，每个 Worker 最多 claim 自己配置的 `concurrency` 数量；此版本不会把一项任务的 step 拆到多台机器。

原始 Session 仍是 authorization 与 control boundary。持久 envelope 包含受限 task specification、所选 Lane、Lane-policy digest 和不透明 `workspaceRef`，不会传输原始 absolute workspace path、parent Agent object、abort signal、environment 或 credential。每个受信 Worker 把该引用映射到自己的既存 absolute directory，并使用自己的模型、凭据、sandbox 和 Agent preset。Worker profile 必须提供 Harness `agentPresets` service；空 `workerAgentPreset` 会选择该 service 的 default preset。

### PostgreSQL 与 process role

在所有参与 process 的环境中设置连接字符串。`databaseUrlEnv` 是变量名，不是 URL 本身：

```sh
export DSH_DISPATCHER_DATABASE_URL='postgresql://dispatcher:REDACTED@db.example/dispatcher?sslmode=require'
```

plugin 启动时初始化带版本的 `dispatcher_tasks` schema。PostgreSQL advisory lock 串行化一次性 migration；稳定版本启动时只验证当前版本，不会重复旧 `ALTER`/`DROP`。migration statement 有独立五分钟 timeout，普通 ledger query 限制为五秒。因此 database role 在初始化期间需要 DDL 权限，之后需要 read/write 权限。不要把 URL 放入 YAML 或 source control；使用部署管理的 TLS，限制网络访问，并让该 role 只能访问 dispatcher database/schema。

可使用以下 role：

- `coordinator`：enqueue task，并注册 `dispatch_status` 与 `dispatch_cancel`，但不 claim work。
- `worker`：从配置 pool claim task，但不暴露持久 status/cancel tool。
- `hybrid`：在一个 process 中同时执行两种职责，适合单节点部署，之后可再添加 remote Worker。
- `disabled`：默认值，所有 Lane 保持 local。

同一个 pool 的 coordinator 与每个 Worker 必须保持分布式 Lane 配置完全一致。Worker 在执行前比较 envelope policy digest 与本地 Lane，出现 drift 时 fail closed。`scopeId` 和 pool 都是 scheduling 与 trust boundary：Worker 只 claim 同时匹配准确 scope 与已配置 pool 的 row。无关部署应使用不同 scope；同一 scope/pool 不要混用不兼容 Lane policy。

Coordinator 示例：

```yaml
- id: dsh-task-dispatcher
  name: dsh-task-dispatcher
  config:
    distribution:
      role: coordinator
      databaseUrlEnv: DSH_DISPATCHER_DATABASE_URL
      scopeId: production
      maxDeliveryAttempts: 3
    lanes:
      remote-analysis:
        kind: general
        transport: spawn
        execution:
          mode: distributed
          pool: analysis-production
          workspaceRef: project-main
        executor: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 32000 }
        verifier: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
        requiredCriteria:
          - { id: requirements, text: All explicit requirements are addressed. }
          - { id: evidence, text: Every conclusion includes concrete repository evidence. }
        executorTools: [read, glob, grep]
        verifierTools: [read, glob, grep]
```

Worker 示例。完整 `remote-analysis` Lane 必须与 coordinator 示例保持一致；只有 process-level `distribution` 设置不同：

```yaml
- id: dsh-task-dispatcher
  name: dsh-task-dispatcher
  config:
    distribution:
      role: worker
      databaseUrlEnv: DSH_DISPATCHER_DATABASE_URL
      scopeId: production
      workerId: analysis-west-01
      pools: [analysis-production]
      workspaceMappings:
        project-main: /srv/workspaces/project-main
      concurrency: 2
      leaseMs: 45000
      heartbeatMs: 10000
      pollMs: 1000
      maxDeliveryAttempts: 3
    lanes:
      remote-analysis:
        kind: general
        transport: spawn
        execution:
          mode: distributed
          pool: analysis-production
          workspaceRef: project-main
        executor: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 32000 }
        verifier: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
        requiredCriteria:
          - { id: requirements, text: All explicit requirements are addressed. }
          - { id: evidence, text: Every conclusion includes concrete repository evidence. }
        executorTools: [read, glob, grep]
        verifierTools: [read, glob, grep]
```

Hybrid 示例使用相同 Lane，并组合两种能力：

```yaml
- id: dsh-task-dispatcher
  name: dsh-task-dispatcher
  config:
    distribution:
      role: hybrid
      databaseUrlEnv: DSH_DISPATCHER_DATABASE_URL
      scopeId: development
      workerId: dev-node-01
      pools: [analysis-development]
      workspaceMappings:
        project-main: /Users/example/work/project
      concurrency: 1
    lanes:
      remote-analysis:
        kind: general
        transport: spawn
        execution: { mode: distributed, pool: analysis-development, workspaceRef: project-main }
        executor: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 32000 }
        verifier: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
        requiredCriteria:
          - { id: requirements, text: All explicit requirements are addressed. }
          - { id: evidence, text: Every conclusion includes concrete repository evidence. }
        executorTools: [read, glob, grep]
        verifierTools: [read, glob, grep]
```

`worker` 与 `hybrid` process 必须为它们可能执行的每个分布式 Lane 提供 `workspaceMappings`。不同 Worker 可以把同一个逻辑引用映射到不同的本地绝对路径，但这些目录应包含相同的预期只读候选内容。`workspaceRef` 由部署 policy 固定，模型不能提供或修改。

### Admission、delivery、lease 与 cancellation

分布式 v1 只接受同时满足以下条件的 Lane：

- `kind: general`，不能是 `self-improvement`；
- `transport: spawn`；
- `execution.mode: distributed`；
- Planner、Executor 和 Verifier 白名单都只包含 `read`、`read_image`、`glob`、`grep`。

分布式 dispatch 始终在后台。设置 `run_in_background: true`，或在 `defaultRunInBackground` 为 true 时省略。显式 false 会被拒绝。与本地后台任务不同，它不会创建 Harness Job，也不会返回 `jobId`；`dispatch_task` 返回持久 `taskId` 和初始 queue state。从准确的 origin Session 查看：

```json
{ "task_id": "THE_DURABLE_TASK_ID" }
```

使用 `dispatch_status`，或请求取消：

```json
{ "task_id": "THE_DURABLE_TASK_ID", "reason": "No longer needed" }
```

Status 由 `scopeId` 和 origin Session id 共同限制 owner。Cancellation 使用普通 Harness approval gate。queued task 会立即关闭；running task 通过下一次成功 heartbeat 观察到请求，然后中止本地 pipeline。Cancellation 是协作式的，因此 wedged runtime 仍需要外部 process supervision。

Delivery 是 **at least once**，不是 exactly once。Claim 使用带 `SKIP LOCKED` 的 PostgreSQL row lock；Worker 续订受限 lease，crash 或 network partition 后，任务在 lease 过期时可被重新 claim，直到耗尽 `maxDeliveryAttempts`。每次 claim 递增单调 lease generation，并获得一个新的随机 bearer token；PostgreSQL 只保存 token hash。heartbeat 或 terminal write 必须同时匹配当前 worker、generation 与 token，旧 Worker 不能覆盖新 lease。对当前 lease 重放相同 completion 是幂等的；冲突 completion 会 fail closed。

`heartbeatMs` 不得超过 `leaseMs` 的三分之一。Claim 与 heartbeat response 会携带作为 lease 基准的 PostgreSQL clock snapshot。Worker 把 server-owned 剩余时长映射到本地 monotonic clock，并保守扣除 request latency，因此普通机器时钟偏移不能延长其权限。如果 renewal 未能完成，Worker 会在 lease 到期前一个 heartbeat interval 请求中止 pipeline，并拒绝从该 claim 发布；最终由 PostgreSQL 时钟约束 heartbeat 和 completion。不可变 task deadline 在 coordinator enqueue 时由数据库时钟创建，lease 不得越过它；Worker 到时 abort，store 拒绝迟到 completion。这些机制可以阻止 stale acceptance，但无法撤销 crash 前已经发生的 model call，也无法强制不合作 child 退出。因此 v1 只读、需要外部 supervisor，并且不承诺 side effect exactly-once。

### 重启与可用性语义

- coordinator restart 不会删除已 commit task。Worker 可以继续执行，terminal result 保留在 PostgreSQL。进程内 monitor 与 Web snapshot 不会自动恢复；`dispatch_status` 仍限制于相同 `scopeId` 和准确 origin Session id。
- Worker restart 不会恢复其 Agent、child run 或 Master Plan。旧 lease 过期后，符合条件的 Worker 在新 generation 下从头运行完整 pipeline，并受 absolute deadline 与 delivery-attempt limit 约束。
- PostgreSQL 在启动时不可用时，coordinator/worker role 使用有界 exponential backoff，无需 Harness restart 即可恢复。running Worker 也会 retry polling，task monitor 会 retry transient read。无法续订 active lease 的 Worker 会在安全边界前 abort，并且不能 commit result。数据库不可达时，coordinator enqueue、status、cancellation call 都 fail closed；恢复后重新可用。
- plugin disposal 会停止本地 claim loop 和 monitor，但不会取消或删除持久任务。

每个 coordinator 与 Worker 都应运行在外部 supervisor 下，并配置有界 restart backoff、health check、进程外 log 和 last-known-good release。PostgreSQL durability 是 queue 的故障边界，应设置符合部署要求的 backup 与 HA。新增 Worker 时应使用不同且稳定的 `workerId`，保持 Lane policy 一致，赋予预期 pool 与本地 workspace mapping 的访问能力，并在该节点配置所需模型凭据。

## Web 执行视图

插件包含 Web client module。每个会话 header 会显示类似 `Plan 2/5 · 1 active Agent` 的紧凑摘要。摘要优先展示仍在运行的 root task：plan total 只统计其宏观或线性 step，Agent count 包含 active descendant，但不会通过每个 Worker-local plan 重复统计同一份工作。在本地 Master Plan 出现之前，它显示 root task 当前 phase，例如 `Creating initial plan`，而不会误导性地显示 `Plan 0/0`。没有运行中 root task 时，只显示最新 terminal root 的 status 和 plan progress，不会累积历史。打开视图可以看到：

- 当前确切 Session 中每一个最近或 active root dispatcher task；递归 Worker task 嵌套在所属 macro node 下；
- durable task 的 pool、queued/running/terminal placement state、remote node id、delivery count、lease generation/expiry 和 cancellation flag；
- local task 的 node-count state composition，以及 **working now**、**dependencies met**、**waiting on dependencies** 摘要；只有 Host `completed` step 才算完成，所以 accepted child 在 parent 封存 evidence 前仍是 `joining`；
- local linear task 中各 step 的 prerequisite vertical chain；macro DAG node 是语义列表，不能只因在 Planner array 中相邻就连线；
- orchestration parent 的明确 **Master Plan / macro DAG** 标签、递归 dependency-failure propagation，以及 Host 当前报告的 running local node task；
- orchestration child 的明确 **Worker node-local execution** 标签，不会把私有 pipeline 误当另一份 global plan；
- local task 中附着于各 step 的 Planner、Executor、Reviewer 或 Verifier，以及 child Agent id 和选中的 provider/model；
- reconnecting、blocked、rejected、cancelled、error 状态，同时使用文字与不依赖颜色的 status marker，并展示 terminal model-verification、failure-class 和 workspace-quarantine 信息。

progress composition 是已发布 node/step 的数量，不是加权百分比。`Dependencies met` 只意味着所有已发布 prerequisite 均由 Host 确认完成；它不表示 node 已通过 plan review、进入 Ready Queue、取得 execution slot 或将下一个运行。Web view 不会从当前 telemetry protocol 推测 queue order、critical path、slot capacity/utilization 或 ETA。

分布式 v1 也不会猜测。remote task 运行时，durable ledger 只能证明 task state、pool、node、claim generation、lease、delivery count 和 cancellation request，不持久保存 Worker 当前 planner/executor/verifier phase、child Agent id、所选 model 或 live Master Plan snapshot。因此卡片显示 `Running remotely (phase unreported)`，不会虚构 Agent。经过验证的 terminal result 可以包含最终 Master Plan；持久 phase/plan progress journal 是未来协议扩展。

普通 adaptive Master Plan contract 是线性的：Host 执行第一个 pending step，后续每个 step 依赖前一个 step。启用 orchestration 的本地 Lane 会发布已验证 DAG，并由 Host 并行维持受限的 dependency-ready Worker pool。视图按 Host 报告渲染 `dependsOn` edge、机械判断的 dependency-ready node、running node task 和 active Agent；不会捏造 queue rank、slot occupancy、dependency、Worker、admission 或 parallelism。

Host 通过 loopback-only RPC channel 发布受限、按 Session 过滤的 snapshot。browser 先取 baseline snapshot，再使用支持 cancellation 的 long poll。它会忽略 stale reply，在 Host restart 后接收新 baseline，并在 reconnect 时保留最后一份有效 view。visualization、listener、decode 和 transport failure 都会被隔离，不能改变任务执行或验收。snapshot 有意省略 task prompt、workspace path、criterion evidence 和其他大体积或敏感 payload。PostgreSQL task record 是持久的，Web read-model 不是；coordinator restart 后 live card 会清空。durable ledger 才是真相源时，应从确切 origin Session 使用 `dispatch_status`。

### Web 配置

打开 **Settings → Plugins → Task Dispatcher**，无需手写 YAML 即可编辑完整 dispatcher policy。页面覆盖 global default、Lane 模型路由和 tool allow-list、planning/retry budget、acceptance criteria、本地只读 orchestration、execution placement，以及 distributed role、pool 和 workspace mapping。保留的 `isolated-write` orchestration 选项会标记为不可用，Host 也拒绝激活。

页面为每个 runtime Agent role 提供独立模型卡片：

- **Master Planner** → `planner`（可选；开启后进入 planner pipeline）；
- **Plan Reviewer** → `planReviewer`，省略时继承 `verifier`；
- **Replanner** → `replanner`，省略时继承 `planner`；
- **Executor / Worker** → `executor`（必填）；
- **Step Verifier** → `verifier`（必填）；
- **Final Verifier** → `finalVerifier`，省略时继承 `verifier`。

`planReviewer`、`replanner`、`finalVerifier` 只有在 `planner` 存在时才合法。Master Planner 与 Replanner 共用 `plannerTools`；Plan Reviewer、Step Verifier 与 Final Verifier 共用 `verifierTools`。为专用角色选择不同模型不会扩大工具权限。

对于 orchestration root，parent Lane 只直接使用自己的 Master Planner、Plan Reviewer、Replanner 和 Final Verifier；DAG node 的实际执行与逐步验证由固定 `childLane` 的完整角色配置负责。parent Lane 的 Executor / Step Verifier 不会直接执行 DAG node。要改变 Worker 使用的模型，应修改 `childLane`，而不是把模型名写进 objective。

Save 会把 `dsh-task-dispatcher` user section 写入 Harness settings document（默认 `$DSH_HOME/settings.yaml`），但**不会**热替换正在运行的 dispatcher。每次保存都会标记 **Restart required**；新 policy 只在下一次 DSH 启动时读取。现有 task、child Agent、worker 和 claim loop 继续使用当前 process 启动时激活的 policy。刷新 browser page 或 Web client bundle 不是激活边界，必须重启 DSH Host process。

form 在 browser 中暂存 draft，并用最初加载时的 revision 保存完整 effective policy。若其他 tab、tool 或手动 settings edit 先提交了该 revision，本次保存会被拒绝而不是覆盖。页面随后加载最新 Host snapshot，同时保留本地 draft，方便用户 reconcile 或 discard。

bundle/profile configuration 是部署方拥有的 base。base Lane 可以 override 但不能删除；其 Planner 和 base workspace mapping 也不能从 user layer 移除。user-created Lane 与 mapping 可以删除。**Reset to profile defaults** 会暂存当前 base，并在成功保存后清除 plugin user override。

配置 channel 由 plugin 持有且仅限 loopback；安装此 out-of-tree bundle 不需要向 Harness core Settings API allow-list 添加 namespace。页面只编辑 `databaseUrlEnv` 中的环境变量名；PostgreSQL URL、password 和其他环境值不会返回 browser。`liveRoot`、`stagingRoot`、`workspaceMappings` 是 privileged absolute path；browser validation 只是早期辅助，Host 仍是最终 policy authority。

如果已存储的 `dsh-task-dispatcher` section 是 object 但结构无效，它绝不会被激活。plugin 会以 disabled、repair-required fallback 保持 Host 运行，页面显示 validation error，用户可修复 draft 或 reset 到 profile base。修复后的 policy 同样要重启 DSH 才生效。如果 namespace 本身是 scalar 或 array 而非 YAML mapping，core Settings 会在产生可编辑 scope 前拒绝 owner registration，必须手工修复。Malformed YAML syntax 是独立 document-level error，可能在 plugin 启动前就阻止 Settings service 加载，也必须手工修复。

## 使用指南

对于一次有界 Executor/Verifier 交换使用 classic Lane；对于步骤有序但剩余工作可能改变的任务使用 adaptive Lane；对于带滚动回填和受限 replan checkpoint 的本地只读 DAG 使用 orchestration Lane。只有完整只读任务需要 durable queue 或跨 Worker placement 时才使用 distributed mode。Lane selection 永远不会覆盖该 Lane 已配置 policy。

dispatch 前检查：

- caller 是目标 workspace 的确切在线根 Session；
- 所选 Lane 的 provider route 存在于当前 Harness profile；
- Lane tool allow-list 足够完成工作，但不应过宽；
- mutation work 使用精确的 `workspace-write` sandbox 和受保护 `liveRoot`；
- Settings change 已保存，并已重启 DSH Host。

### 何时使用宏观 DAG

只有根 objective 包含可以用 contract 表达 input/output 的独立可验证 branch 时，才启用 orchestration。合适示例包括并行 repository inspection、独立 subsystem analysis，或分别验证 research branch 后再运行 synthesis node。如果每一步严格依赖前一步的具体结果，或协调开销会超过工作本身，应保留 linear adaptive Lane。

配置决定物理权限：

- `orchestration.enabled` 把 parent 从 linear adaptive plan 切换成 Host-owned macro DAG；
- `childLane` 固定每一个 immediate Worker 使用的 policy；
- `maxConcurrentNodes` 是 Host admission 的上限，不是要求 Master 填满每个 slot；
- `maxTaskNodes`、`maxChildrenPerNode`、`maxDepth`、`maxTotalModelRuns` 约束完整树；
- `workspaceMode: read-shared` 是 v1 唯一活动 workspace mode。

Master 应通过 `dependsOn` 和明确 input/output contract 表达语义独立性，不应为了控制 capacity 增加虚假顺序，也不应把 command、model、tool 或 Worker count 写进 objective。Host 通常在 Worker 结算时重新计算 ready work，并在其他 Worker 仍在执行时立即回填空闲容量。完成一次回填后，如果仍有未启动工作且有安全 patch budget，Host 会暂时关闭 admission，让现有 pool 排空至有界最终 checkpoint，再由 Master 使用 revision CAS 保留或安全替换未启动 DAG。没有安全 replan budget 时继续滚动执行以保证吞吐。

### 本地安装

安装并测试项目，然后把绝对路径添加到已经提供标准 agents、jobs、settings、subagents、tools 服务的 DSH profile：

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

Host `settings` service 是 hard dependency，不是 optional enhancement。缺少该 service 的 profile 无法组合此 plugin；这与页面报告某个配置 provider read-only 或临时不可用不同。

dump 输出应包含 plugin name 为 package root `dsh-task-dispatcher` 的行。Harness 需要该 root row 来发现并服务 `lib/client.js`；兼容 export `dsh-task-dispatcher/dispatcher` 仍可 import，但不能作为 Cordis row name。

Harness 提供 bundle 指定的可选 Cordis 和 Web-client peer module。repository 提交生成的 `lib/client.js` artifact，因此 Git/file dependency 安装时不运行 package build，也不需要 compiler/dev dependency。DSH plugin-management command 自身会调用 pnpm，所以 `PATH` 中仍需存在 pnpm。maintainer commit 前必须运行 bundle command 与 test；`npm publish` 也会通过 `prepublishOnly` gate 重建 client。本地 `npm pack` 前运行文档中的 bundle command。

内置 `general-analysis` Lane 使用 `deepseek-official` provider 路由、启用 Master Plan pipeline，并有意保持只读。这些 route 可由普通 DeepSeek provider 提供。若要使用可选本地 `dsh-ds4` mapping，请单独安装并配置该 bundle，运行其 local server，并提供 nominal `DS4_LOCAL_API_KEY`；`dsh-ds4` 不是本 package dependency。内置 bundle 保持 `distribution` disabled，Lane 使用默认 local execution：

- Planner：`deepseek-official/deepseek-v4-flash`，12,000 tokens；
- Executor：`deepseek-official/deepseek-v4-pro`；
- Verifier：`deepseek-official/deepseek-v4-flash`；
- Planner tools：`read`、`glob`、`grep`；
- Executor tools：`read`、`glob`、`grep`；
- Verifier tools：`read`、`glob`、`grep`；
- plan budget：6 steps、4 次 accepted pending-suffix replacement、32 次 total child runs；
- deadline：完整任务 1 小时，每个 child 15 分钟；
- required criteria：`requirements`、`tests`、`regression`。

配置的 tool name 是上限。child execution 仍遵循 Harness sandbox 与 delegated-child approval policy；child 不能自行扩大权限。

### Dispatch 任务

从确切在线根 Session 自然提出，例如：

```text
Use the general-analysis dispatcher lane to review the audit-log pagination.
Identify concrete implementation gaps and focused tests. Also require the
acceptance criterion "empty-page": verify that requesting a page after the
last result returns an empty list.
Run it in the background.
```

对应 tool input：

```json
{
  "lane": "general-analysis",
  "title": "Audit log pagination review",
  "objective": "Review pagination for the audit log and identify concrete gaps and tests.",
  "context": "Preserve the existing response shape.",
  "deliverables": [
    { "id": "findings", "description": "Concrete review findings" },
    { "id": "test-plan", "description": "Focused test recommendations" }
  ],
  "acceptance_criteria": [
    { "id": "empty-page", "text": "A page after the final result returns an empty list." }
  ],
  "run_in_background": true
}
```

只有 `lane`、`title`、`objective` 必填。`run_in_background` 默认使用 deployment 的 `defaultRunInBackground`，内置 profile 中为 `true`。

#### 跟踪或取消任务

| Dispatch kind | 初始 identity | 查看进度/结果 | 取消 |
|---|---|---|---|
| Local foreground | 返回结果中的 `taskId` | tool 等待 terminal result | 取消调用 turn |
| Local background | `taskId` + Harness `jobId` | `job_list`，然后 `job_output({ job_id })` | `job_kill({ job_id })` |
| Distributed | 持久 `taskId` | `dispatch_status({ task_id })` | `dispatch_cancel({ task_id })` |

Cancellation 是协作式的：它撤销权限并启动受限 cleanup。再次读取 Job output 或 distributed status 以确认 terminal state；cancel request 不是立即 kill process。

Local foreground result 的 `kind: "foreground"`，task status 可能是 `accepted`、`rejected`、`blocked`、`cancelled` 或 `error`。它包含 `failureClass`（`none`、`task` 或 `infrastructure`）、Executor/Verifier child run id 和 report。Planner-enabled result 还包含 planner run、plan-review run 和由 Host 持有、带 revision/history 的 `masterPlan`。distributed dispatch 返回 `kind: "distributed"`，状态为 `queued`、`running` 或 `terminal`。

#### 解读结果

- `accepted` 且 `modelVerified: true` 表示适用的独立 Verifier 基于证据通过每项不可变 criterion。
- `rejected` 表示 Verifier 或 Plan Reviewer 拒绝 proposal、evidence 或 result；Executor 可能尚未启动。
- `blocked` 表示 pipeline 报告了具体 blocker。
- `cancelled` 表示 authority chain 已取消并 cleanup。
- `error` 表示 task 或 infrastructure boundary 失败；检查 `failureClass`、`message` 和 `workspaceQuarantined`。

在 Jobs 层，结束的 `rejected`、`blocked` 或 task-class error 仍可能显示 completed，因为 background wrapper 已停止；语义成功必须同时满足 `status: "accepted"` 与 `modelVerified: true`。infrastructure/quarantine failure 会让 Job failed，成功协作取消会让 Job killed。`job_output` 与 `job_kill` 使用 `jobId`，不能使用 dispatcher `taskId`。

### 使用示例

以下示例假定调用来自确切的在线根 Session。前两个示例适用于内置只读 `general-analysis` Lane。后续示例中的可选 Lane 必须先由 operator 在 **Settings → Plugins → Task Dispatcher** 创建、保存，并通过重启 DSH Host 激活。

#### 示例 1：后台运行聚焦的 repository review

适合只返回 finding、不修改文件的有界调查：

```json
{
  "lane": "general-analysis",
  "title": "Review retry cleanup",
  "objective": "Inspect the retry and cancellation paths. Identify any child Session, timer, workspace lock, or background job that can survive a terminal task result. Do not modify the workspace.",
  "context": "Prioritize dispatcher lifecycle code and tests. Cite concrete files and behaviors in the result.",
  "deliverables": [
    { "id": "findings", "description": "Ranked lifecycle findings with evidence" },
    { "id": "test-gaps", "description": "Focused regression tests for confirmed gaps" }
  ],
  "acceptance_criteria": [
    { "id": "cleanup-evidence", "text": "Every reported leak is tied to a concrete lifecycle path and a reproducible observation." }
  ],
  "run_in_background": true
}
```

即时 response 包含 dispatcher `taskId` 与 Harness `jobId`。稍后使用以下调用读取语义 task result：

```text
job_output({ "job_id": "subagent-1" })
```

把 `subagent-1` 替换成返回的 `jobId`。本地 Jobs tool 使用 `jobId`，不能使用 dispatcher `taskId`。Job `completed` 只代表 background wrapper 停止；task success 仍要求 output 中有 `status: "accepted"` 和 `modelVerified: true`。

取消任务：

```text
job_kill({ "job_id": "subagent-1" })
```

`job_kill` 是协作式 cancellation request；应再次读取 Job 确认它已结算。

#### 示例 2：等待一个小型 verified decision

当 caller 应等待 terminal task result 时设置 `run_in_background: false`：

```json
{
  "lane": "general-analysis",
  "title": "Choose a cache invalidation boundary",
  "objective": "Compare invalidating by session id, policy digest, or global revision for the current cache implementation. Recommend one boundary and explain the failure modes of the alternatives. Do not modify files.",
  "deliverables": [
    { "id": "recommendation", "description": "One evidence-backed recommendation" },
    { "id": "tradeoffs", "description": "Failure-mode comparison of all three options" }
  ],
  "acceptance_criteria": [
    { "id": "current-code", "text": "The recommendation is consistent with the cache keys and invalidation events present in the current workspace." }
  ],
  "run_in_background": false
}
```

该调用直接返回 foreground task record。因为内置 Lane 会规划、评审、执行并验证，可能产生多个 model run；foreground 不表示单模型或无验证。

#### 示例 3：让 Master Planner 识别可并行的只读工作

按[启用动态只读 Master Plan](#启用动态只读-master-plan)配置 `analysis-orchestrator` 与 `analysis-leaf` Lane 后，dispatch 一项包含独立可验证 outcome 的 objective：

```json
{
  "lane": "analysis-orchestrator",
  "title": "Cross-cutting reliability review",
  "objective": "Assess API pagination, database lease recovery, and cancellation cleanup as independently verifiable branches. Then synthesize the branch evidence into one prioritized reliability report. Do not modify the workspace.",
  "context": "Treat the checked-in implementation and tests as the source of truth. Distinguish confirmed defects from test gaps and design risks.",
  "deliverables": [
    { "id": "api", "description": "Verified API pagination findings" },
    { "id": "leases", "description": "Verified lease and recovery findings" },
    { "id": "cancellation", "description": "Verified cancellation and cleanup findings" },
    { "id": "synthesis", "description": "Prioritized cross-cutting report" }
  ],
  "acceptance_criteria": [
    { "id": "independent-evidence", "text": "Each subsystem conclusion is backed by evidence produced and verified for that branch." },
    { "id": "priority", "text": "The synthesis ranks confirmed risks separately from unverified hypotheses." }
  ],
  "run_in_background": true
}
```

Master Planner 提出 outcome 与 dependency，不选择 Worker count、model、tool 或 command。Host 在 `maxConcurrentNodes` 上限内 admission dependency-ready node，回填释放容量，并且只能在安全 scheduling checkpoint 修改 never-started node。Web execution view 显示 root Master Plan、running Worker node、dependencies met、dependency-blocked work 和 independently verified completion。`Dependencies met` 不代表 node 已获得 Host admission slot 或会下一个启动。

不要在 objective 中写“spawn four agents”“use model X”或“give the Worker shell access”。这些属于 deployment policy，作为权限请求会被忽略。

#### 示例 4：查看或取消 durable distributed task

对于 `execution.mode: distributed` Lane，任务必须在后台执行：显式设置 `run_in_background: true`，或依赖 `defaultRunInBackground: true` 的 deployment。初始 dispatch 返回 durable task id，而不是 local Job id。查看状态：

```text
dispatch_status({ "task_id": "task-01234567-89ab-cdef-0123-456789abcdef" })
```

请求协作式取消并给出可审计 reason，然后重复查看直到 terminal：

```text
dispatch_cancel({
  "task_id": "task-01234567-89ab-cdef-0123-456789abcdef",
  "reason": "The source snapshot was superseded."
})

dispatch_status({ "task_id": "task-01234567-89ab-cdef-0123-456789abcdef" })
```

`distribution.role` 为 `coordinator` 或 `hybrid` 时会注册 `dispatch_status` 与 `dispatch_cancel`；两者限制于创建 task 的同一个确切 root Session。它们不能查看或取消 local background Job，cancellation 是受 fencing 的 request，不是立即 kill process。

#### 示例 5：仅通过显式 write Lane dispatch 本地写任务

以下 Lane id 仅为示例，内置配置**没有**它。operator 必须先创建本地 `repo-development` Lane，把所需 mutation tool 加到 Executor allow-list，配置受保护 `liveRoot`，并使用精确 `workspace-write` sandbox 启动 caller：

```json
{
  "lane": "repo-development",
  "title": "Implement the empty pagination state",
  "objective": "Implement the empty result returned when a requested page begins after the final audit-log item. Add focused tests and preserve the existing response shape.",
  "deliverables": [
    { "id": "implementation", "description": "Workspace changes implementing the empty-page behavior" },
    { "id": "tests", "description": "Focused passing regression tests" }
  ],
  "acceptance_criteria": [
    { "id": "empty-page", "text": "A page beginning after the final item returns an empty list without changing the response schema." }
  ],
  "run_in_background": true
}
```

只改 objective 不能获得 write access。把该任务发送到内置 `general-analysis` Lane 时，每个 Worker 仍是只读；如果 Executor 声称已创建文件，Verifier 无法观察到它们并会拒绝结果。递归 orchestration v1 同样只读：它可以并发运行 analysis Worker，但不能运行并发 writer。在 isolated worktree、Host-observed diff、serial integration 与 promotion fencing 接入 runtime 前，可写递归执行不可用。

### 配置 Lane

Lane 是 deployment policy，不是 model-controlled input。调用 `dispatch_task` 的模型只能选择已配置 Lane id，不能提供 provider、model、token budget、tool、timeout 或 retry count。

交互式部署推荐使用 **Settings → Plugins → Task Dispatcher**；以下表格是该 form 的字段参考。直接 YAML 仍适合组合 deployment-owned base 或自动安装。Settings user layer 作为最小 override 存储在 base 上，两种编辑方式都需要重启 DSH 才能激活新 policy。

完整 plugin-level setting：

| Field | Default | 含义 |
|---|---:|---|
| `lanes` | `{}` | 最多 16 个 deployment-owned Lane definition。 |
| `defaultRunInBackground` | `true` | tool 省略 `run_in_background` 时的默认执行模式。 |
| `maxConsecutiveFailures` | `3` | 本地 Lane process-local circuit 打开前允许的连续 infrastructure error。 |
| `circuitCooldownMs` | `300000` | open circuit 拒绝新工作的时间。 |
| `jobOutputLimitBytes` | `131072` | Harness 保留的最大 background Job output。 |
| `liveRoot` | empty | Executor allow-list 含有 `read`、`read_image`、`glob`、`grep` 之外 tool 时必填的受保护绝对 live root；task workspace 必须与其分离。 |
| `stagingRoot` | empty | self-improvement Lane 要求的绝对 staging root。 |
| `distribution` | `{ role: disabled }` | PostgreSQL whole-task distribution setting。 |

Distribution setting：

| Field | Default | 含义 |
|---|---:|---|
| `role` | `disabled` | `disabled`、`coordinator`、`worker` 或 `hybrid`。 |
| `databaseUrlEnv` | `DSH_DISPATCHER_DATABASE_URL` | 保存 PostgreSQL connection string 的环境变量名。 |
| `scopeId` | `default` | enqueue idempotency、origin-Session ownership 和 Worker claim 使用的 tenant/deployment boundary。 |
| `workerId` | empty | lease 发布的稳定 node identity；空值为该 process 生成新 id。 |
| `workerAgentPreset` | empty | 临时 worker root 使用的 Agent preset；空值选择 `agentPresets.defaultId`。 |
| `pools` | `[default]` | Worker/hybrid 可 claim 的 pool；每项 1-64 字符，最多 16 项。 |
| `workspaceMappings` | `{}` | 不可变逻辑 `workspaceRef` 到当前 Worker 既存 absolute path 的映射。 |
| `concurrency` | `1` | 一个 Worker 内并发 whole-task claim loop 数，1-16。 |
| `leaseMs` | `45000` | lease 时长，15 秒至 5 分钟。 |
| `heartbeatMs` | `10000` | renewal interval，1-60 秒且不超过 `leaseMs` 三分之一。 |
| `pollMs` | `1000` | empty-queue 和 transient-failure polling interval，100 ms 至 30 秒。 |
| `maxDeliveryAttempts` | `3` | enqueue/lease loss 后最多 whole-task claim 次数，1-10；与 model revision attempt 无关。 |

每个 Lane 支持：

| Field | Default | 含义 |
|---|---:|---|
| `name` | empty | 人类可读名称。 |
| `description` | empty | 在 tool definition 中向模型展示的描述。 |
| `kind` | `general` | `general` 或受保护的 `self-improvement`。 |
| `transport` | `spawn` | `spawn` 或 `fork` child-session transport。 |
| `execution` | `{ mode: local, pool: default, workspaceRef: "" }` | local execution，或 distributed pool 与不可变 Worker workspace reference。 |
| `orchestration` | `{ enabled: false }` | 可选的 Host-owned local read-only recursive DAG policy。 |
| `executor` | required | `{ provider, model, maxTokens }` Executor route。 |
| `verifier` | required | `{ provider, model, maxTokens }` step/attempt Verifier route，也是 Reviewer role 默认值。 |
| `planner` | omitted | 可选 `{ provider, model, maxTokens }` Master Planner route；省略则保留原始 Executor → Verifier pipeline。 |
| `planReviewer` | omitted | 可选 independent plan-review route；省略时继承 `verifier`，且要求存在 `planner`。 |
| `replanner` | omitted | 可选 plan-adjustment route；省略时继承 `planner`，且要求存在 `planner`。 |
| `finalVerifier` | omitted | 可选 final whole-task verification route；省略时继承 `verifier`，且要求存在 `planner`。 |
| `plannerTools` | `[]` | Master Planner 与 Replanner 共用 allow-list；仅允许 `read`、`read_image`、`glob`、`grep`。空值表示 model-only。 |
| `maxPlanSteps` | `6` | planner-managed plan 中 completed + pending step 上限，1-8。 |
| `maxPlanPatches` | `4` | linear plan 或 orchestration DAG 可 commit 的 `replace_pending` revision 上限，0-8。 |
| `maxTotalChildRuns` | `32` | 非递归 linear Master Plan 的 child-session 总预算，包括 planning、review、adjustment、execution、step verification 和 final verification，5-32。recursive orchestration 改用 `orchestration.maxTotalModelRuns`。 |
| `taskTimeoutMs` | `3600000` | planner-enabled whole-pipeline deadline，1 秒至 6 小时；legacy Lane 保留 per-child deadline。 |
| `retryOnRevise` | `false` | 允许 Verifier 的 `revise` 决策再次运行 Executor；只应对幂等工作开启。 |
| `maxAttempts` | `1` | Executor attempt 数，1-3；只在 retry 开启时使用。 |
| `childTimeoutMs` | `900000` | 每个 Planner、Reviewer、Executor 或 Verifier child deadline，1 秒至 1 小时。 |
| `requiredCriteria` | required, non-empty | 具有唯一 id 的不可变 Lane criterion。 |
| `executorTools` | omitted 时无 tool | 显式 Executor tool allow-list。 |
| `verifierTools` | `[]` | Plan Reviewer、Step Verifier 和 Final Verifier 共用 allow-list；空值表示 model-only。 |

Recursive orchestration setting：

| Field | Default | 含义 |
|---|---:|---|
| `enabled` | `false` | 为该 Lane 启用 Host-owned recursive DAG planning。 |
| `childLane` | empty | 每个 immediate Worker node 使用的固定 deployment-owned Lane；开启时必填。 |
| `maxDepth` | `2` | 共享 recursive depth 上限，1-4。 |
| `maxTaskNodes` | `16` | 完整 tree 的共享 node budget，1-32。 |
| `maxChildrenPerNode` | `4` | 一个 node 的 immediate fan-out 上限，1-8。 |
| `maxConcurrentNodes` | `4` | 完整 tree 的 active node 上限和 rolling in-flight pool 宽度，1-8；checkpoint drain 可有意闲置 capacity。 |
| `maxTotalModelRuns` | `48` | 所有 Planner、Reviewer、child pipeline 和 Final Verifier 共享 model-run credit，1-128；enabled Lane 必须能负担完整 minimum verified path。 |
| `maxResultBytes` | `131072` | joined child evidence 和 orchestration result 上限，4,096-1,048,576 bytes。 |
| `workspaceMode` | `read-shared` | v1 只接受 `read-shared`；`isolated-write` 为保留值且会被拒绝。 |
| `failureMode` | `fail-fast` | `fail-fast` 在失败后取消剩余 in-flight sibling；`collect` 继续独立 ready work 并报告 failed/dependency-blocked work。 |

启用 orchestration 要求 Planner route。parent 与固定 child Lane 必须都是 local `spawn` Lane，所有工具必须只读；child 必须为 `general`，且各 phase tool authority 不能比 parent 更广。Host 还拒绝 fixed-child cycle，以及无法为完整 verified leaf path 提供足够 node/model-run budget 的配置。这些都是 activation-time policy check，Planner 指令不能覆盖。

#### 启用动态只读 Master Plan

推荐使用 Web form 编辑。对于 deployment-owned base 或严格管理的 `$DSH_HOME/settings.yaml`，以下配置展示两个 Lane role。Worker Lane 执行一个 verified node，也可以建立节点局部 plan。parent 拥有 macro DAG，且只能在 in-flight pool 到达成功静止调度边界时替换 never-started node。

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
      finalVerifier: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 16000 }
      executor: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 32000 }
      verifier: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
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

Save 并重启 Host，然后使用 `lane=analysis-orchestrator` dispatch。fixed child-Lane graph 必须保持 acyclic；v1 的所有 orchestration phase 都是 local、`spawn`、read-only。

provider 与 model name 必须匹配所安装 Harness profile 中可用 route。Settings 页面为所有六个 runtime Agent role 提供模型卡片：Master Planner、Plan Reviewer、Replanner、Executor / Worker、Step Verifier、Final Verifier。三个专用 planning route 是 optional override，所以既有配置保持原行为。Recursive Worker node 运行配置的 `childLane` 完整 policy；要改变 Worker execution，应修改该 Lane 的 role model，而不是向 task objective 添加 model instruction。通常应为 Executor 与 Verifier 选择不同模型，或至少保持独立 child run，以降低相关性 self-review。

model route 与 tool authority 是两套独立控制。Master Planner/Replanner 始终共享 `plannerTools`；Plan Reviewer/Step Verifier/Final Verifier 始终共享 `verifierTools`。把专用 role 切换到另一模型不会扩展其 tool allow-list。

每个 route 接受 1-1,000,000 `maxTokens`，省略时默认 32,000。在非递归 linear Master Plan 中，每次 Planner、Plan Reviewer、Replanner、patch Reviewer、Executor、Step Verifier 和 Final Verifier 启动都会消耗一个 `maxTotalChildRuns` slot。递归 orchestration tree 则使用共享 `maxTotalModelRuns` ledger。预算耗尽会 fail closed，返回非 accepted result。

policy validation 会把 Executor tool 中除 `read`、`read_image`、`glob`、`grep` 外的任何能力保守视为可能 mutation。这样的 Lane 必须配置 `liveRoot`，task workspace 必须解析到该受保护 root 之外，否则 policy validation fail closed。revision retry 默认关闭，因为第二次 Executor run 可能重复 shell、network、publish 或其他 external side effect。仅当完整任务幂等时才开启 `retryOnRevise`，不能只因为 file edit 通常可重复。

任何 mutating Lane 还要求 parent Session 使用 `workspace-write`，sandbox workspace root 必须精确解析为 Session workspace。`danger-full-access`、更宽的 sandbox root 或缺少 workspace 都会在创建 child 前失败。它保护的是 filesystem scope，不是 command、signal、network 或 resource exhaustion 的 process isolation。

## 安全的 self-improvement

plugin 可以评估 Harness improvement candidate，但有意不能重写或部署当前正在运行它的 live Harness。self-improvement 是 staging-only capability，不是热 self-modification。

创建两个既存、互不重叠的 absolute root，例如 live checkout 和独立 staging worktree，然后配置专用 Lane：

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

dispatch 时，确切 parent Session 的 `cwd` 必须已存在并解析到 `stagingRoot` 下。Session 必须使用 `workspace-write` sandbox，解析后的 sandbox root 必须等于 staging workspace。self-improvement 始终是 background task。plugin 解析既存 workspace 与 root，拒绝 staging 外或同时位于 `liveRoot` 内的 workspace，并验证配置路径 nesting。model 不能提供其他 workspace。Executor prompt 也把 live restart、signalling、modification 和 deployment 标记为 forbidden。

canonical path protection 是双向的：task workspace 或 `stagingRoot` 都不能包含 `liveRoot`，也不能被它包含；symlink alias 会在比较前解析。由于 Harness `workspace-write` 还允许 platform temporary directory，mutating Lane 会拒绝位于 `/tmp` 或 `os.tmpdir()` 下的 `liveRoot`。每次 Executor attempt 前都会重新检查 exact sandbox policy，因此 revision 不能继承 background task 运行期间被扩大的 policy。

配置 `liveRoot` 后，该保护也适用于普通 Lane：只要 Executor allow-list 包含 `read`、`read_image`、`glob`、`grep` 之外的 capability，当 Session workspace 解析到 `liveRoot` 内时就会被拒绝，防止把 live self-edit 伪装为 general task。

安全 continuous-improvement system 应分开以下 stage：

```text
feedback/specification
  -> staging-only dispatcher task
  -> independent model verification
  -> isolated tests and canary health checks
  -> human or external promotion controller
  -> atomic activation, with last-known-good rollback
```

本 plugin 实现 staging dispatch 与 model verification。配置的 Executor 可以使用 allow-list 内工具运行 staging test，但 feedback scheduling、isolated Worker provisioning、canary、promotion、rollback 和 health monitoring 属于 external control plane。永远不要让 self-improvement Lane 指向 running checkout，也不要把未经验证的 candidate code 加载进当前 Host process。

## 配置与安全边界

权限来自已激活 Lane policy，而不是 task objective：

- objective 不能选择 provider/model、添加 tool、要求 Worker 数量、改变 sandbox 或启用 recursive dispatch；
- Planner/Verifier tool 永远限制为内置只读集合；
- raw `dispatch_task`/`dispatch_status`/`dispatch_cancel`、`subagent`、`subagent_fork`、`workflow`、`ralph`、`prompt_rewrite_rules`、`trigger_rules` 始终不能进入 Executor allow-list；
- 只有显式 local Lane 的 Executor 可以配置非只读 capability，并且必须满足 `liveRoot`、精确 `workspace-write` 与不重叠 workspace 规则；
- recursive orchestration 与 distributed v1 都是只读；`isolated-write` 是保留值，Host 会拒绝；
- `workspace-isolation` 和 `config-proposals` 只是实验 library，没有连接 `dispatch_task` 或 Settings save path。

常见误区：

- 可读 Markdown Planner output 不是 protocol result；缺少所需 structured output 时不会启动 Executor。
- `Dependencies met` 不代表 node 已进入队列、取得 slot 或会下一个执行。
- accepted child 仍需 parent Host seal evidence；root task 只有通过 Final Verifier 才能 accepted。
- local Job `completed` 不是 semantic success；应读取 task `status` 与 `modelVerified`。
- Settings save 不是 hot reload；browser refresh 无效，必须重启 DSH Host。

## 可用性与故障边界

“Harness 永不退出”需要区分两种保证。

### Task-level 逻辑隔离

plugin 在自身边界 fail closed。无效 tool input、unavailable model、refusal、token exhaustion、child timeout、malformed structured output、cleanup failure、Job registration failure、cancellation 和意外 pipeline exception 都会返回受限的非 accepted result。它们不会授权变更，也不会被有意允许逃逸为 unhandled rejection。

导出的 Loader schema 有意保持宽松，让错误 dispatcher policy 到达 plugin containment boundary，而不是让整个 plugin tree 在 composition 阶段终止。plugin 会记录 validation error、移除请求的 Lane，并只暴露 repair-required fallback policy。已经成功解析为 object、但字段无效的 `dsh-task-dispatcher` user section 仍会出现在 Web configuration page 供修复/reset，绝不会用于 active dispatcher。若 namespace mapping 被写成 scalar/array、YAML syntax 无效、缺少 core service，或 composition 其他部分故障，仍可能在 editable scope 创建前失败；应手工修复 settings document，并在激活前用 `--dump-config` 验证 composition。

Executor 与 Verifier child 是不同 Session，但目前运行在同一个 Node process。这是逻辑隔离，不是操作系统进程边界。blocking native call、event-loop deadlock、OOM、runtime crash、`SIGKILL`、kernel failure、power loss 或 machine loss 无法由同进程 JavaScript containment。

### Process- 与 machine-level 可用性

使用 systemd、launchd、Docker/Kubernetes 或其他 external supervisor 运行 DSH，并配置：

- automatic restart 与有界 backoff；
- startup health/readiness check；
- last-known-good immutable release；
- atomic activation，以及 health check 失败后的 automatic rollback；
- DSH process 外的 log 与 alert；
- 如需覆盖 machine failure，在另一台机器调度或使用 replicated control plane。

supervisor 不能在 isolated test 与 health check 通过前，把新生成 candidate 作为 restart target。高风险 self-improvement 应使用带 kill deadline 与 process-tree cleanup 的独立 OS process/container，而不是只依赖同进程 child Session。

Local background Job、active Master Plan、workspace lock、child-run budget 和 circuit state 都是**进程内**状态。lock 与 circuit 能跨 plugin hot reload 保留在同一 process，但 DSH process restart 后没有任何一项恢复。distributed mode 添加 durable PostgreSQL task envelope、lease、cancellation flag 和 terminal result，但不添加 durable Planner checkpoint，也不恢复中断 child；reclaimed task 会从头运行完整只读 pipeline。

Web read-model 同样是 process-local。它保留所有 active task 和受限的最近 terminal history，Host restart 后重置为新 baseline。它是 placement/lease operational view，不是 PostgreSQL recovery ledger。

local cleanup failure 比普通 task error 更保守：因为 child 可能仍存活，workspace lock 会在进程剩余生命周期中保持 quarantine。cancellation/deadline 在 child startup 完成前获胜时也如此，因为 child 仍可能晚到发布。local background Job 会报告 `failed` 而不是 `killed`，detail 包含 `workspaceQuarantined: true`。distributed Worker cleanup 不确定也会以 infrastructure error 和 `workspaceQuarantined: true` 发布；v1 虽只读，仍应检查或替换 Worker process。再次 dispatch 前，从 last-known-good release 重启 DSH。即使稍后 cleanup 看似成功，本地 lock 仍保持保守状态，plugin 不会猜测不确定 child 已退出。

这些层次让 task failure 不致命，并允许 supervisor 恢复 process/host failure。任何 in-process plugin 都无法诚实保证在所有故障下存活。

## 运行限制

- 每个 plugin instance 最多 16 个 Lane；Lane id 以及 criterion、deliverable、step id 为 1-64 个符合支持语法的字符。
- task input 上限：title 200 字符、objective 16,384 字符、context 32,768 字符；最多 16 个 deliverable，每个 description 4,000 字符。
- 最多 24 个 task criterion，每项 2,000 字符，总计 24,000 字符。
- 每个 child tool allow-list 最多 64 个 name；Planner/Verifier list 进一步限制为 `read`、`read_image`、`glob`、`grep`。
- route token budget 为 1-1,000,000；Executor attempt 为 1-3。
- planner-enabled plan 包含 1-8 个 completed + pending step；每 step 1-12 个 acceptance criterion；plan 生命周期最多使用 `maxPlanSteps` 两倍的 distinct step id。plan summary 最多 2,000 字符，step title 200，step objective 4,000，每个 step criterion 2,000，plan text 合计 32,000。
- accepted pending-suffix replacement 上限为 0-8。planner-enabled task 的所有 child start 共享 5-32 的 hard budget；内置 Lane 使用上限 32。patch rationale 最多 4,000 字符，plan review 最多报告 8 个 issue。
- recursive orchestration v1 为 local/read-only：depth 1-4、完整树 node budget 1-32、per-node fan-out 1-8、完整树 concurrency 1-8、model-run budget 1-128、joined result 4,096-1,048,576 bytes。激活还要求 node/model-run 数足以支持完整独立验证 leaf path。
- 活动 orchestration runtime 使用 prioritized dependency-ready queue 对 in-flight pool 滚动回填。完成一次回填后，若仍有未启动 node 且存在安全 patch budget，则进入有界最终 checkpoint：关闭 admission、排空当前 Worker，然后 Master 才能做 revision CAS。没有安全 replan budget 时继续滚动执行。Ready Queue core 支持 per-resource quota，但 Lane runtime 配置目前主要使用全树 `maxConcurrentNodes` 与 FIFO Host grant ledger。
- `taskTimeoutMs` 为 1 秒至 6 小时；`childTimeoutMs` 为 1 秒至 1 小时，分别应用到每个 Planner、Reviewer、Executor 与 Verifier child。
- structured child report 与 plan-review report 最多 64,000 serialized character；background Job output 可配置为 4,096-1,048,576 bytes。
- circuit policy 允许 1-20 次连续 infrastructure failure，cooldown 为 1 秒至 24 小时。
- 一个 DSH process 对每个 resolved workspace 只允许一个 active local task，包括 plugin hot reload 前后。distributed Worker 只可重叠只读访问。
- circuit、writable-workspace lock、active Job、child run 与 Master Plan checkpoint 不跨 DSH process 分布。distributed v1 只读，只协调 whole-task ownership 与 terminal publication。
- distributed envelope 最多 131,072 serialized character。Worker 最多订阅 16 个 pool、并发执行 1-16 个 whole task；每项 task delivery 最多 claim 1-10 次。
- terminal PostgreSQL row 持久存在，plugin 不会自动 prune。只有对应 Session 不再需要 status lookup 后，才应用 operator-owned retention/archive policy。
- Web read-model 对每个 Session 保留最多 32 个 recent terminal task，全局一小时内最多 200 个；active task 永不 eviction。
- 一个 coordinator process 最多 live-monitor 32 个 distributed task。超出 live-view limit 的 task 仍持久存在，可由 owner 用 `dispatch_status` 查询；该限制避免 database outage 产生无限 polling loop。
- Web long polling 对每个 Session 最多 8 个 outstanding watch，每个 DSH process 最多 256 个。capacity、cancellation、timeout 和 hot-reload path 都会释放 reservation；单个 malformed retained task 会被隔离丢弃，不会清空 Session 其余 view。

除非 external scheduler 提供 distributed lease，否则不要让多个可写 dispatcher process 同时操作同一 workspace。

## 测试与打包

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm lint
pnpm test
pnpm run bundle
pnpm run publint
pnpm pack --dry-run
```

## License

[MIT](./LICENSE)
