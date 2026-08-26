# 使用示例

[中文文档索引](./README.md) · [返回中文首页](../../README.zh-CN.md) · [English](../examples.md)

所有示例都假定从 exact live root Session 调用。示例 1、2、3 使用内置 read-only `general-analysis` Lane。其他 Lane 必须先由 operator 在 **Settings → Plugins → Task Dispatcher** 创建、保存，并通过重启 DSH Host 激活。

## 最小 dispatch

只有 `lane`、`title`、`objective` 必填：

```json
{
  "lane": "general-analysis",
  "title": "Review pagination",
  "objective": "Review the audit-log pagination, identify concrete gaps, and verify the findings independently. Do not modify the workspace.",
  "run_in_background": true
}
```

`run_in_background` 省略时使用 deployment 的 `defaultRunInBackground`。内置 profile 默认为 `true`。

## 示例 1：后台 repository review

适合返回 finding 而不修改文件的有界调查：

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

immediate response 包含 dispatcher `taskId` 与 Harness `jobId`。稍后读取：

```text
job_output({ "job_id": "subagent-1" })
```

把 `subagent-1` 替换为返回的 `jobId`。local Jobs tool 使用 `jobId`，不是 dispatcher `taskId`。

Job `completed` 只代表 background wrapper 停止。semantic success 仍要求 output 中的 `status: "accepted"` 和 `modelVerified: true`。

取消：

```text
job_kill({ "job_id": "subagent-1" })
```

`job_kill` 是 cooperative cancellation request；再次读取 Job 确认它已 settle。

## 示例 2：等待 verified decision

caller 需要等待 terminal result 时设置 `run_in_background: false`：

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

该调用直接返回 foreground task record。内置 Lane 会执行 planning、review、execution 和 verification，可能产生多个 model run；foreground 不表示 single-model 或 unverified。

## 示例 3：总结一个实时网页

内置 Lane 的 executor 与 verifier 工具里已经列入 `web_fetch`，所以 objective 可以直接给 URL，**dispatcher 这边不需要额外配置**。但工具本身属于 Host：没有挂载
[`dsh-tool-web`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/web/tool-web)
（且开启 fetch）的部署会自动降级运行，缺失的工具名会写进每个子会话的
`deployment_capabilities_json.unavailableTools`，让 executor 返回 `blocked`，而不是凭空编造一个它从未读过的页面。

```json
{
  "lane": "general-analysis",
  "title": "总结 Hacker News 首页",
  "objective": "用 web_fetch 抓取 https://news.ycombinator.com/ 的实时首页，列出页面上可见的每条 story 及其排名、标题与链接，并写一段简短的中文总结。不要修改工作区。所有结论只能基于抓取到的页面。",
  "acceptance_criteria": [
    { "id": "fetch", "text": "首页是在本次任务中抓取的，而不是凭记忆回忆的。" },
    { "id": "stories", "text": "列出的每条 story 都出现在抓取到的页面上，排名与链接与页面一致。" }
  ],
  "run_in_background": false
}
```

实时数据源是 executor 与独立 verifier 会**诚实地互相矛盾**的唯一情形：verifier 重新抓取页面来核对，而此时首页已经翻动，executor 当初确实看到的条目消失了。
Verifier 被明确告知要把这种情况当作 drift 而非编造，只有当内容在任何时刻都不可能来自该数据源时才判失败。
但 drift 仍然会损伤准确度，所以这类任务要把流水线压短 —— `maxPlanSteps: 2`
能让 executor 的抓取和 final verifier 的复查相隔几分钟，而不是一刻钟。

## 示例 4：并发只读 DAG

先按[配置参考](./configuration.md#启用动态只读-master-plan)创建 `analysis-orchestrator` 与 `analysis-leaf`，再提交包含独立 outcome 的任务：

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

Master Planner 提出 outcome/dependency，不选择 Worker count、model、tool 或 command。Host 在 `maxConcurrentNodes` 上限内 admission dependency-ready node，滚动回填 released capacity，并且只能在 safe quiescent checkpoint 修改 never-started node。

Web view 显示 root Master Plan、running Worker node、dependencies met、dependency-blocked work 和 independently verified completion。`Dependencies met` 不代表 node 已取得 slot 或将下一个运行。

不要在 objective 中写“spawn four agents”“use model X”或“give the Worker shell access”；这些属于 deployment policy。

## 示例 5：查看或取消 durable distributed task

distributed Lane 必须后台运行。initial dispatch 返回 durable `taskId`，不返回 local `jobId`。

查看：

```text
dispatch_status({ "task_id": "task-01234567-89ab-cdef-0123-456789abcdef" })
```

取消并继续 polling：

```text
dispatch_cancel({
  "task_id": "task-01234567-89ab-cdef-0123-456789abcdef",
  "reason": "The source snapshot was superseded."
})

dispatch_status({ "task_id": "task-01234567-89ab-cdef-0123-456789abcdef" })
```

`dispatch_status`/`dispatch_cancel` 在 `distribution.role: coordinator|hybrid` 时注册，并 owner-fence 到创建 task 的 exact root Session。它们不管理 local background Job。详细 lease 语义见[分布式只读执行](./distributed.md)。

## 示例 6：显式 local write Lane

以下 `repo-development` 只是说明性 Lane id，内置配置没有它。operator 必须先创建 local Lane、为 Executor 添加 mutation tool、配置 protected `liveRoot`，并以 exact `workspace-write` sandbox 启动 caller：

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

只改 objective 不能获得 write access。把任务发给 `general-analysis` 时，Worker 仍只读；如果 Executor 声称创建了文件，Verifier 无法观察到文件并会拒绝结果。

recursive orchestration v1 同样只读，不能运行并发 writer。write policy 详见[安全与运维](./security-and-operations.md#可写-lane)。

## 自定义 criterion 与 deliverable

caller 可以添加更严格的 acceptance criterion，但不能移除 Lane 的 mandatory criterion。id 必须唯一：

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

## 跟踪与取消速查

| Dispatch kind | Initial identity | 查看 | 取消 |
|---|---|---|---|
| Local foreground | result 中的 `taskId` | tool 等待 terminal result | 取消 calling turn |
| Local background | `taskId` + `jobId` | `job_list`、`job_output({ job_id })` | `job_kill({ job_id })` |
| Distributed | durable `taskId` | `dispatch_status({ task_id })` | `dispatch_cancel({ task_id })` |

cancellation 是 cooperative：它撤销 authority 并开始 bounded cleanup，不是 immediate process kill。

## 结果解读

- `accepted` + `modelVerified: true`：独立 Verifier 基于 evidence 通过所有 criterion；
- `rejected`：Plan Reviewer 或 Verifier 拒绝 proposal/evidence/result；
- `blocked`：pipeline 报告具体 blocker；
- `cancelled`：authority chain 已取消并 cleanup；
- `error`：task 或 infrastructure boundary 失败；检查 `failureClass`、`message`、`workspaceQuarantined`。

Planner-enabled result 还包含 Planner/Reviewer run 和 Host-owned `masterPlan` revision/history。distributed initial result 的 `kind: "distributed"`，state 为 `queued`、`running` 或 `terminal`。

## 进一步阅读

- [配置参考](./configuration.md)
- [架构与执行模型](./architecture.md)
- [安全与运维](./security-and-operations.md)
