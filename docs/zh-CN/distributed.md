# 分布式只读执行（v1）

[中文文档索引](./README.md) · [返回中文首页](../../README.zh-CN.md) · [English](../distributed.md)

分布式模式把一项**完整只读任务**租给一个 Worker。多项任务可以分散到多个 Worker process，每个 Worker 最多 claim `concurrency` 项任务；v1 不会把一项任务的 step 或一棵递归 DAG 拆到多台机器。

Worker 创建 temporary local root Agent，并在那里运行完整 Planner、Executor、Reviewer 和 Verifier pipeline。lease 丢失后，新 Worker 从头运行整条 pipeline，不会恢复中断的 phase 或 Master Plan。

## Trust boundary

origin Session 仍是 authorization/control boundary。durable envelope 包含：

- bounded task specification；
- selected Lane；
- Lane-policy digest；
- opaque `workspaceRef`。

它不传输 origin absolute workspace path、parent Agent object、abort signal、environment 或 credential。每个 trusted Worker 把 `workspaceRef` 映射到自己的既存 absolute directory，并使用本地 model route、credential、sandbox 和 Agent preset。

Worker profile 必须提供 Harness `agentPresets` service。空 `workerAgentPreset` 使用 `agentPresets.defaultId`。

## PostgreSQL

所有参与 process 都要设置连接字符串。`databaseUrlEnv` 是变量名，不是 URL：

```sh
export DSH_DISPATCHER_DATABASE_URL='postgresql://dispatcher:REDACTED@db.example/dispatcher?sslmode=require'
```

plugin 启动时初始化 versioned `dispatcher_tasks` schema。PostgreSQL advisory lock 串行化一次性 migration；稳定启动只验证当前版本。migration statement timeout 为五分钟，普通 ledger query timeout 为五秒。

database role 在初始化时需要 DDL 权限，之后需要 read/write 权限。不要把 URL 放进 YAML 或 source control；应使用 deployment-managed TLS、限制 network access，并只授予 dispatcher database/schema 权限。

## Process role

- `coordinator`：enqueue task，注册 `dispatch_status` 与 `dispatch_cancel`，但不 claim work。
- `worker`：从配置 pool claim task，但不暴露 durable status/cancel tool。
- `hybrid`：在一个 process 中完成两类工作，适合单节点起步。
- `disabled`：默认值，所有 Lane 保持 local。

同一 pool 的 coordinator 与每个 Worker 必须配置完全一致的 distributed Lane。Worker 会比较 envelope policy digest 与本地 policy；出现 drift 时 fail closed。

`scopeId` 和 pool 都是 scheduling/trust boundary。Worker 只 claim 同时匹配准确 scope 与配置 pool 的 row。无关 deployment 应使用不同 scope；不要在相同 scope/pool 混用不兼容 Lane policy。

## Coordinator 示例

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

## Worker 示例

完整 `remote-analysis` Lane 必须与 coordinator 保持一致；只有 process-level `distribution` 不同：

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

`worker` 和 `hybrid` process 必须为可能执行的每个 distributed Lane 提供 `workspaceMappings`。不同 Worker 可以把同一 logical reference 映射到不同 local absolute path，但这些目录应包含同一预期 read-only candidate。模型不能提供或修改 `workspaceRef`。

Hybrid 使用相同 Lane，同时配置 coordinator 与 Worker 所需字段即可。

## Admission 限制

distributed v1 只接受满足全部条件的 Lane：

- `kind: general`；
- `transport: spawn`；
- `execution.mode: distributed`；
- Planner、Executor、Verifier allow-list 都只含 `read`、`read_image`、`glob`、`grep`。

distributed dispatch 必须后台运行。设置 `run_in_background: true`，或在 `defaultRunInBackground: true` 时省略；显式 false 会被拒绝。

它不会创建 Harness Job，也不返回 `jobId`。`dispatch_task` 返回 durable `taskId` 与初始 queue state。使用：

```text
dispatch_status({ "task_id": "task-01234567-89ab-cdef-0123-456789abcdef" })
```

取消：

```text
dispatch_cancel({
  "task_id": "task-01234567-89ab-cdef-0123-456789abcdef",
  "reason": "The source snapshot was superseded."
})
```

status 由 `scopeId` 与 origin Session id owner-fence。cancellation 使用普通 Harness approval gate。queued task 立即关闭；running task 在下一次成功 heartbeat 观察请求并 abort local pipeline。cancellation 是协作式的，wedged runtime 仍需 external supervisor。

## At-least-once delivery

delivery 是 **at least once**，不是 exactly once：

1. claim 使用 PostgreSQL row lock 与 `SKIP LOCKED`；
2. 每次 claim 递增 monotonic lease generation；
3. 每次生成 random bearer token，database 只保存 hash；
4. heartbeat/terminal write 必须匹配 worker、generation、token；
5. current lease 的相同 completion replay 是幂等的；冲突 completion fail closed；
6. crash/partition 后 lease 到期，任务可重新 claim，直到 `maxDeliveryAttempts` 耗尽。

stale Worker 不能覆盖更新 lease 的结果。这能阻止 stale acceptance，但不能撤销 crash 前已经发生的 model call，因此 v1 只允许 read-only work，不承诺 side effect exactly-once。

## Lease clock 与 deadline

`heartbeatMs` 不得超过 `leaseMs` 三分之一。claim/heartbeat response 会携带 PostgreSQL clock snapshot。Worker 把 server-owned remaining duration 映射到 local monotonic clock，并保守扣除 request latency，普通 node clock skew 不能延长权限。

renewal 未及时完成时，Worker 会在 lease 到期前一个 heartbeat interval 请求 abort，并拒绝从该 claim 发布。PostgreSQL clock 最终约束 heartbeat 与 completion。

immutable task deadline 在 coordinator enqueue 时由 database clock 创建。lease 不得越过它；Worker 到时 abort，store 拒绝 late completion。外部 supervisor 仍需处理不合作 child 或 wedged process。

## Restart 与恢复

### Coordinator restart

已 commit task 不会删除。Worker 可以继续运行，terminal result 保留在 PostgreSQL。in-process monitor 与 Web snapshot 不自动恢复；`dispatch_status` 仍 owner-fence 到相同 `scopeId` 和准确 origin Session id。

### Worker restart

不会恢复 Agent、child run 或 Master Plan。旧 lease 到期后，eligible Worker 在新 generation 下从头运行完整 pipeline，并受 absolute deadline 与 delivery-attempt limit 约束。

### PostgreSQL 暂时不可用

coordinator/worker role 使用 bounded exponential backoff，无需 Harness restart 即可恢复。Worker retry polling，task monitor retry transient read。无法续订 active lease 的 Worker 在安全边界前 abort，不能 commit result。

database 不可达时，coordinator enqueue、status 与 cancellation fail closed；恢复后重新可用。

### Plugin disposal

停止 local claim loop 与 monitor，不取消或删除 durable task。

## Durable 与非 durable state

PostgreSQL 持久保存 task envelope、lease、cancellation flag 与 terminal result，但不保存：

- Worker 当前 Planner/Executor/Verifier phase；
- child Agent id；
- live Master Plan snapshot；
- node-level checkpoint。

因此 Web card 在运行时显示 `Running remotely (phase unreported)`。durable ledger 是 source of truth；Web read-model 不是恢复日志。

## 运维建议

每个 coordinator 与 Worker 都应由 external supervisor 管理：

- bounded restart backoff；
- health/readiness check；
- out-of-process log/alert；
- last-known-good release；
- stable unique `workerId`；
- identical Lane policy；
- intended pool/workspace mapping；
- 本地可用 model credential。

PostgreSQL durability 是 queue failure boundary，应配置适当 backup 与 HA。terminal row 不会自动 prune；只有对应 Session 不再需要 status lookup 后，才应用 operator-owned retention/archive policy。

## 关键限制

- v1 只读，不能运行 `self-improvement` 或 recursive write；
- 并行发生在 whole task 之间，不会把一个 DAG 跨机器拆分；
- Worker 最多订阅 16 个 pool，`concurrency` 为 1-16；
- delivery 上限为 1-10 次 claim；
- durable envelope 最大 131,072 serialized character；
- coordinator 最多 live-monitor 32 个 task；超过后仍可用 `dispatch_status` 查询；
- cleanup uncertainty 发布 infrastructure error 与 `workspaceQuarantined: true`，应检查或替换该 Worker。

## 进一步阅读

- [配置参考](./configuration.md#distribution-setting)
- [安全与运维](./security-and-operations.md)
- [分布式使用示例](./examples.md#示例-4查看或取消-durable-distributed-task)
