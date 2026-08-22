window.__ModuleLoader__.load({
	id: "dsh-task-dispatcher",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-task-dispatcher-css:src/client/TaskDispatcherAction.module.css.mjs
		const css = ".qeug4a_trigger{max-width:min(360px,42vw);min-height:28px;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:7px;align-items:center;gap:7px;padding:3px 7px;font-size:12px;line-height:18px;display:inline-flex}.qeug4a_trigger:hover,.qeug4a_trigger:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.qeug4a_trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.qeug4a_trigger>span:last-child{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.qeug4a_dialog{width:min(780px,100vw - 32px);max-height:calc(100vh - 48px)}.qeug4a_modalContent{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);min-height:0;overflow-y:auto}.qeug4a_notice{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-secondary);border-radius:9px;flex-direction:column;gap:3px;margin-bottom:12px;padding:10px 12px;font-size:12px;line-height:18px;display:flex}.qeug4a_noticeError{color:var(--dsw-alias-state-error-primary)}.qeug4a_noticeDetail{overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);font-size:11px}.qeug4a_empty{color:var(--dsw-alias-label-tertiary);text-align:center;flex-direction:column;align-items:center;gap:6px;padding:36px 16px 28px;font-size:13px;line-height:20px;display:flex}.qeug4a_empty strong{color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:510}.qeug4a_tasks,.qeug4a_workers,.qeug4a_steps{margin:0;padding:0;list-style:none}.qeug4a_tasks{flex-direction:column;gap:10px;display:flex}.qeug4a_task{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:12px;min-width:0;overflow:hidden}.qeug4a_taskHeader{box-sizing:border-box;align-items:center;gap:8px;min-height:42px;padding:7px 10px;display:flex}.qeug4a_taskHeader:hover{background:var(--dsw-alias-interactive-bg-hover)}.qeug4a_taskHeader:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.qeug4a_taskLeading{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;margin-right:0;display:inline-flex}.qeug4a_taskTitle{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:14px;font-weight:510;line-height:22px;overflow:hidden}.qeug4a_taskStatus{color:var(--dsw-alias-label-secondary);flex:none;font-size:12px;line-height:18px}.qeug4a_taskBody{flex-direction:column;gap:12px;min-width:0;padding:0 14px 14px 34px;display:flex}.qeug4a_taskMeta{min-width:0;color:var(--dsw-alias-label-tertiary);align-items:center;gap:9px;font-size:11px;line-height:17px;display:flex}.qeug4a_taskMeta code,.qeug4a_stepId{background:var(--dsw-alias-fill-l2);max-width:38%;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono);text-overflow:ellipsis;white-space:nowrap;border-radius:5px;flex:none;padding:1px 5px;font-size:11px;line-height:17px;overflow:hidden}.qeug4a_taskMeta span{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.qeug4a_distribution{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:8px;min-width:0;padding:9px 10px}.qeug4a_distributionHead{align-items:center;gap:8px;min-width:0;display:flex}.qeug4a_distributionHead strong{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:510;line-height:18px}.qeug4a_distributionState,.qeug4a_distributionCancellation{background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 6px;font-size:10px;line-height:16px}.qeug4a_distributionCancellation{margin-left:auto}.qeug4a_distributionCancellationRequested{color:var(--dsw-alias-state-error-primary);font-weight:510}.qeug4a_distributionFacts{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px 12px;margin:8px 0 0;display:grid}.qeug4a_distributionFacts>div{min-width:0}.qeug4a_distributionFacts dt,.qeug4a_distributionFacts dd{margin:0;font-size:10px;line-height:16px}.qeug4a_distributionFacts dt{color:var(--dsw-alias-label-tertiary)}.qeug4a_distributionFacts dd{color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono);overflow-wrap:anywhere}.qeug4a_distributionProgress{color:var(--dsw-alias-label-tertiary);margin:8px 0 0;font-size:10px;line-height:16px}.qeug4a_planHead{min-width:0;color:var(--dsw-alias-label-tertiary);justify-content:space-between;align-items:center;gap:12px;font-size:11px;line-height:18px;display:flex}.qeug4a_planHead>span:first-child{color:var(--dsw-alias-label-secondary);flex:none;align-items:center;gap:7px;font-weight:510;display:inline-flex}.qeug4a_planHead>span:last-child{min-width:0;font-family:var(--dsw-font-mono);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.qeug4a_planSummary,.qeug4a_noPlan,.qeug4a_emptySteps,.qeug4a_result p,.qeug4a_stepObjective,.qeug4a_workerError{margin:0}.qeug4a_planSummary,.qeug4a_noPlan,.qeug4a_emptySteps{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;font-size:13px;line-height:20px}.qeug4a_steps{flex-direction:column;display:flex}.qeug4a_step{grid-template-columns:18px minmax(0,1fr);gap:9px;min-width:0;display:grid}.qeug4a_stepRail{justify-content:center;padding-top:6px;display:flex;position:relative}.qeug4a_step:not(:last-child) .qeug4a_stepRail:after{z-index:0;background:var(--dsw-alias-border-l2);content:\"\";width:1px;position:absolute;top:18px;bottom:-6px;left:50%;transform:translate(-50%)}.qeug4a_stepRail>*{z-index:1;position:relative}.qeug4a_stepBody{min-width:0;padding:2px 0 17px}.qeug4a_stepHead{align-items:center;gap:7px;min-width:0;min-height:22px;display:flex}.qeug4a_stepHead strong{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:13px;font-weight:510;line-height:20px;overflow:hidden}.qeug4a_stepStatus{color:var(--dsw-alias-label-secondary);flex:none;font-size:11px;line-height:18px}.qeug4a_stepObjective{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;padding-top:5px;font-size:12px;line-height:18px}.qeug4a_stepMeta{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);flex-wrap:wrap;gap:3px 12px;padding-top:5px;font-size:10px;line-height:16px;display:flex}.qeug4a_workerSection{min-width:0;padding-top:7px}.qeug4a_workerSection h4,.qeug4a_result h4{color:var(--dsw-alias-label-tertiary);margin:0 0 6px;font-size:11px;font-weight:510;line-height:17px}.qeug4a_workers{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;display:grid}.qeug4a_worker{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:8px;min-width:0;padding:8px 9px}.qeug4a_workerHead{align-items:center;gap:6px;min-width:0;display:flex}.qeug4a_workerRole{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:1;align-items:center;gap:6px;font-size:12px;font-weight:510;line-height:18px;display:inline-flex;overflow:hidden}.qeug4a_workerStatus,.qeug4a_workerAttempt{color:var(--dsw-alias-label-tertiary);flex:none;font-size:10px;line-height:16px}.qeug4a_workerFacts{gap:2px;margin:7px 0 0;display:grid}.qeug4a_workerFacts>div{grid-template-columns:92px minmax(0,1fr);gap:7px;min-width:0;display:grid}.qeug4a_workerFacts dt,.qeug4a_workerFacts dd{font-family:var(--dsw-font-mono);margin:0;font-size:10px;line-height:16px}.qeug4a_workerFacts dt{color:var(--dsw-alias-label-tertiary)}.qeug4a_workerFacts dd{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.qeug4a_workerError{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;padding-top:5px;font-size:10px;line-height:16px}.qeug4a_result{background:var(--dsw-alias-fill-l2);border-radius:8px;padding:9px 11px}.qeug4a_result p{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;font-size:12px;line-height:18px}@media (width<=640px){.qeug4a_trigger{max-width:54vw}.qeug4a_dialog{border-radius:16px;width:calc(100vw - 16px);max-height:calc(100vh - 16px)}.qeug4a_taskBody{padding-left:26px;padding-right:10px}.qeug4a_workers{grid-template-columns:minmax(0,1fr)}.qeug4a_distributionFacts{grid-template-columns:repeat(2,minmax(0,1fr))}.qeug4a_planHead,.qeug4a_taskMeta{flex-direction:column;align-items:flex-start;gap:3px}.qeug4a_planHead>span:last-child,.qeug4a_taskMeta span{max-width:100%}.qeug4a_workerFacts>div{grid-template-columns:80px minmax(0,1fr)}}";
		const tagId = "dsh-task-dispatcher/TaskDispatcherAction.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-task-dispatcher";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var TaskDispatcherAction_module_css_default = {
			"dialog": "qeug4a_dialog",
			"distribution": "qeug4a_distribution",
			"distributionCancellation": "qeug4a_distributionCancellation",
			"distributionCancellationRequested": "qeug4a_distributionCancellationRequested",
			"distributionFacts": "qeug4a_distributionFacts",
			"distributionHead": "qeug4a_distributionHead",
			"distributionProgress": "qeug4a_distributionProgress",
			"distributionState": "qeug4a_distributionState",
			"empty": "qeug4a_empty",
			"emptySteps": "qeug4a_emptySteps",
			"modalContent": "qeug4a_modalContent",
			"noPlan": "qeug4a_noPlan",
			"notice": "qeug4a_notice",
			"noticeDetail": "qeug4a_noticeDetail",
			"noticeError": "qeug4a_noticeError",
			"planHead": "qeug4a_planHead",
			"planSummary": "qeug4a_planSummary",
			"result": "qeug4a_result",
			"step": "qeug4a_step",
			"stepBody": "qeug4a_stepBody",
			"stepHead": "qeug4a_stepHead",
			"stepId": "qeug4a_stepId",
			"stepMeta": "qeug4a_stepMeta",
			"stepObjective": "qeug4a_stepObjective",
			"stepRail": "qeug4a_stepRail",
			"stepStatus": "qeug4a_stepStatus",
			"steps": "qeug4a_steps",
			"task": "qeug4a_task",
			"taskBody": "qeug4a_taskBody",
			"taskHeader": "qeug4a_taskHeader",
			"taskLeading": "qeug4a_taskLeading",
			"taskMeta": "qeug4a_taskMeta",
			"taskStatus": "qeug4a_taskStatus",
			"taskTitle": "qeug4a_taskTitle",
			"tasks": "qeug4a_tasks",
			"trigger": "qeug4a_trigger",
			"worker": "qeug4a_worker",
			"workerAttempt": "qeug4a_workerAttempt",
			"workerError": "qeug4a_workerError",
			"workerFacts": "qeug4a_workerFacts",
			"workerHead": "qeug4a_workerHead",
			"workerRole": "qeug4a_workerRole",
			"workerSection": "qeug4a_workerSection",
			"workerStatus": "qeug4a_workerStatus",
			"workers": "qeug4a_workers"
		};
		//#endregion
		//#region src/client/TaskDispatcherAction.tsx
		const TASK_STATUS_KEYS = {
			running: "task.status.running",
			accepted: "task.status.accepted",
			rejected: "task.status.rejected",
			blocked: "task.status.blocked",
			cancelled: "task.status.cancelled",
			error: "task.status.error"
		};
		const PHASE_KEYS = {
			preparing: "phase.preparing",
			executor: "phase.executor",
			verifier: "phase.verifier",
			"initial-plan": "phase.initial-plan",
			"initial-plan-review": "phase.initial-plan-review",
			replan: "phase.replan",
			"plan-patch-review": "phase.plan-patch-review",
			"step-executor": "phase.step-executor",
			"step-verifier": "phase.step-verifier",
			"final-verification": "phase.final-verification",
			finished: "phase.finished"
		};
		const PLAN_STATUS_KEYS = {
			active: "plan.status.active",
			accepted: "plan.status.accepted",
			rejected: "plan.status.rejected",
			blocked: "plan.status.blocked",
			cancelled: "plan.status.cancelled",
			error: "plan.status.error"
		};
		const STEP_STATUS_KEYS = {
			pending: "step.status.pending",
			working: "step.status.working",
			completed: "step.status.completed"
		};
		const WORKER_ROLE_KEYS = {
			planner: "worker.role.planner",
			"plan-reviewer": "worker.role.plan-reviewer",
			executor: "worker.role.executor",
			verifier: "worker.role.verifier",
			replanner: "worker.role.replanner",
			"final-verifier": "worker.role.final-verifier"
		};
		const WORKER_STATUS_KEYS = {
			starting: "worker.status.starting",
			running: "worker.status.running",
			cleanup: "worker.status.cleanup",
			completed: "worker.status.completed",
			cancelled: "worker.status.cancelled",
			error: "worker.status.error"
		};
		const DISTRIBUTION_STATE_KEYS = {
			queued: "distribution.state.queued",
			running: "distribution.state.running",
			terminal: "distribution.state.terminal"
		};
		function taskDot(status) {
			switch (status) {
				case "running": return "ongoing";
				case "accepted": return "done";
				case "blocked":
				case "cancelled": return "warning";
				case "rejected":
				case "error": return "error";
			}
		}
		function planDot(status) {
			switch (status) {
				case "active": return "ongoing";
				case "accepted": return "done";
				case "blocked":
				case "cancelled": return "warning";
				case "rejected":
				case "error": return "error";
			}
		}
		function stepDot(status) {
			switch (status) {
				case "pending": return "warning";
				case "working": return "ongoing";
				case "completed": return "done";
			}
		}
		function workerDot(status) {
			switch (status) {
				case "starting":
				case "running": return "ongoing";
				case "cleanup":
				case "cancelled": return "warning";
				case "completed": return "done";
				case "error": return "error";
			}
		}
		function workerIsRunning(worker) {
			return worker.status === "starting" || worker.status === "running";
		}
		/** Aggregate plan progress and active child Agents for the supplied tasks. */
		function planProgress(tasks) {
			let done = 0;
			let total = 0;
			let agents = 0;
			for (const task of tasks) {
				const steps = task.masterPlan?.steps ?? [];
				total += steps.length;
				done += steps.filter((step) => step.status === "completed").length;
				agents += task.workers.filter(workerIsRunning).length;
			}
			return {
				done,
				total,
				agents
			};
		}
		function newestTask(tasks) {
			return tasks.reduce((latest, task) => latest === void 0 || task.updatedAt > latest.updatedAt ? task : latest, void 0);
		}
		function activeHeaderSummary(tasks, t) {
			const progress = planProgress(tasks);
			const newestUnplanned = newestTask(tasks.filter((task) => task.masterPlan === void 0));
			const phase = newestUnplanned === void 0 ? void 0 : newestUnplanned.distribution?.state === "running" && newestUnplanned.workers.length === 0 ? t("distribution.phase.unreported") : t(PHASE_KEYS[newestUnplanned.phase]);
			const agentKey = progress.agents === 1 ? "one" : "other";
			const detail = phase === void 0 ? t(`header.active.plan.${agentKey}`, progress) : progress.total === 0 ? t(`header.active.phase.${agentKey}`, {
				phase,
				agents: progress.agents
			}) : t(`header.active.phasePlan.${agentKey}`, {
				...progress,
				phase
			});
			const visible = tasks.length === 1 ? detail : t("header.active.multiple", {
				tasks: tasks.length,
				detail
			});
			return {
				accessible: t(tasks.length === 1 ? "header.active.aria.one" : "header.active.aria.other", {
					tasks: tasks.length,
					detail
				}),
				visible
			};
		}
		function terminalHeaderSummary(task, t) {
			const status = t(TASK_STATUS_KEYS[task.status]);
			const progress = planProgress([task]);
			const hasPlan = task.masterPlan !== void 0;
			return {
				visible: hasPlan ? t("header.terminal.plan", {
					status,
					done: progress.done,
					total: progress.total
				}) : t("header.terminal.noPlan", { status }),
				accessible: hasPlan ? t("header.terminal.aria.plan", {
					title: task.title,
					status,
					done: progress.done,
					total: progress.total
				}) : t("header.terminal.aria.noPlan", {
					title: task.title,
					status
				})
			};
		}
		function headerSummary(state, t) {
			const tasks = state.snapshot?.tasks;
			if (tasks !== void 0 && tasks.length > 0) {
				const active = tasks.filter((task) => task.status === "running");
				if (active.length > 0) return activeHeaderSummary(active, t);
				const latest = newestTask(tasks);
				if (latest !== void 0) return terminalHeaderSummary(latest, t);
			}
			const visible = state.phase === "loading" ? t("header.loading") : state.phase === "error" ? t("header.unavailable") : t("header.empty");
			return {
				accessible: visible,
				visible
			};
		}
		function connectionSummary(state, t) {
			if (state.snapshot === void 0 || state.phase === "ready") return void 0;
			if (state.phase === "loading") return t("connection.loading");
			if (state.phase === "reconnecting") return t("connection.reconnecting");
			return t("connection.error");
		}
		function ConnectionNotice({ state, t }) {
			if (state.phase === "ready") return null;
			const key = state.phase === "loading" ? "connection.loading" : state.phase === "reconnecting" ? "connection.reconnecting" : "connection.error";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: state.phase === "error" ? `${TaskDispatcherAction_module_css_default.notice} ${TaskDispatcherAction_module_css_default.noticeError}` : TaskDispatcherAction_module_css_default.notice,
				role: state.phase === "error" ? "alert" : "status",
				"aria-live": "polite",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(key) }), state.error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: TaskDispatcherAction_module_css_default.noticeDetail,
					children: t("connection.detail", { error: state.error })
				})]
			});
		}
		function distributionLease(distribution, t) {
			const { leaseGeneration: generation, leaseUntil: until } = distribution;
			if (generation !== void 0 && until !== void 0) return t("distribution.lease.generationUntil", {
				generation,
				until
			});
			if (generation !== void 0) return t("distribution.lease.generation", { generation });
			if (until !== void 0) return t("distribution.lease.until", { until });
			return t("distribution.lease.none");
		}
		function DistributionSummary({ distribution, t }) {
			const state = t(DISTRIBUTION_STATE_KEYS[distribution.state]);
			const node = distribution.nodeId ?? t("distribution.node.pending");
			const claims = t(distribution.claimCount === 1 ? "distribution.claimCount.one" : "distribution.claimCount.other", { count: distribution.claimCount });
			const lease = distributionLease(distribution, t);
			const cancellation = t(distribution.cancelRequested ? "distribution.cancel.requested" : "distribution.cancel.notRequested");
			const progress = t("distribution.progress.unreported");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: TaskDispatcherAction_module_css_default.distribution,
				"data-distribution-state": distribution.state,
				"aria-label": t("distribution.aria", {
					state,
					pool: distribution.pool,
					node,
					claims,
					lease,
					cancellation,
					progress
				}),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherAction_module_css_default.distributionHead,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("distribution.title") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: TaskDispatcherAction_module_css_default.distributionState,
								children: state
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: distribution.cancelRequested ? `${TaskDispatcherAction_module_css_default.distributionCancellation} ${TaskDispatcherAction_module_css_default.distributionCancellationRequested}` : TaskDispatcherAction_module_css_default.distributionCancellation,
								children: cancellation
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
						className: TaskDispatcherAction_module_css_default.distributionFacts,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("distribution.pool") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								title: distribution.pool,
								children: distribution.pool
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("distribution.node") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								title: node,
								children: node
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("distribution.claims") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: claims })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("distribution.lease") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								title: lease,
								children: lease
							})] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: TaskDispatcherAction_module_css_default.distributionProgress,
						children: progress
					})
				]
			});
		}
		function WorkerCard({ worker, t }) {
			const role = t(WORKER_ROLE_KEYS[worker.role]);
			const status = t(WORKER_STATUS_KEYS[worker.status]);
			const agent = worker.agentId ?? t("worker.agentPending");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: TaskDispatcherAction_module_css_default.worker,
				"data-worker-status": worker.status,
				"aria-label": `${role}, ${status}, ${agent}, ${worker.provider}/${worker.model}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherAction_module_css_default.workerHead,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: TaskDispatcherAction_module_css_default.workerRole,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: workerDot(worker.status) }), role]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: TaskDispatcherAction_module_css_default.workerStatus,
								children: status
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: TaskDispatcherAction_module_css_default.workerAttempt,
								children: t("worker.attempt", { attempt: worker.attempt })
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
						className: TaskDispatcherAction_module_css_default.workerFacts,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("worker.agentId") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								title: agent,
								children: agent
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("worker.model") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", {
								title: `${worker.provider}/${worker.model}`,
								children: [
									worker.provider,
									"/",
									worker.model
								]
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("worker.workerId") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								title: worker.workerId,
								children: worker.workerId
							})] })
						]
					}),
					worker.error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: TaskDispatcherAction_module_css_default.workerError,
						children: t("worker.error", { error: worker.error })
					})
				]
			});
		}
		function WorkerList({ label, scope, workers, t }) {
			if (workers.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: TaskDispatcherAction_module_css_default.workerSection,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: TaskDispatcherAction_module_css_default.workers,
					"aria-label": t("workers.aria", { scope }),
					children: workers.map((worker) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkerCard, {
						worker,
						t
					}, worker.workerId))
				})]
			});
		}
		function StepRow({ dependencyLabels, step, workers, t }) {
			const dependencies = dependencyLabels.join(", ");
			const dependencyText = dependencyLabels.length === 0 ? t("step.dependency.none") : t("step.dependency.some", { ids: dependencies });
			const dependencyAria = dependencyLabels.length === 0 ? t("step.dependency.aria.none", { step: step.id }) : t("step.dependency.aria.some", {
				step: step.id,
				ids: dependencies
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: TaskDispatcherAction_module_css_default.step,
				"data-step-status": step.status,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: TaskDispatcherAction_module_css_default.stepRail,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: stepDot(step.status) })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: TaskDispatcherAction_module_css_default.stepBody,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: TaskDispatcherAction_module_css_default.stepHead,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									className: TaskDispatcherAction_module_css_default.stepId,
									children: step.id
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: step.title }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: TaskDispatcherAction_module_css_default.stepStatus,
									children: t(STEP_STATUS_KEYS[step.status])
								})
							]
						}),
						step.objective === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: TaskDispatcherAction_module_css_default.stepObjective,
							children: step.objective
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: TaskDispatcherAction_module_css_default.stepMeta,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"aria-label": dependencyAria,
								children: dependencyText
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("step.attempts", { count: step.attempts }) })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkerList, {
							label: t("workers.step"),
							scope: step.title,
							workers,
							t
						})
					]
				})]
			});
		}
		function PlanBody({ plan, task, t }) {
			const stepTitles = new Map(plan.steps.map((step) => [step.id, step.title]));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: TaskDispatcherAction_module_css_default.planHead,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: planDot(plan.status) }), t(PLAN_STATUS_KEYS[plan.status])] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("task.planMeta", {
						planId: plan.planId,
						revision: plan.revision,
						patches: plan.patchCount
					}) })]
				}),
				plan.summary === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: TaskDispatcherAction_module_css_default.planSummary,
					children: plan.summary
				}),
				plan.steps.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: TaskDispatcherAction_module_css_default.emptySteps,
					children: t("steps.empty")
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
					className: TaskDispatcherAction_module_css_default.steps,
					"aria-label": t("steps.aria", { task: task.title }),
					children: plan.steps.map((step) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StepRow, {
						step,
						dependencyLabels: step.dependsOn.map((dependencyId) => {
							const title = stepTitles.get(dependencyId);
							return title === void 0 ? dependencyId : `${title} (${dependencyId})`;
						}),
						workers: task.workers.filter((worker) => worker.stepId === step.id),
						t
					}, step.id))
				})
			] });
		}
		function TaskCard({ task, t }) {
			const [open, setOpen] = (0, react.useState)(task.status === "running");
			const stepIds = new Set(task.masterPlan?.steps.map((step) => step.id) ?? []);
			const taskWorkers = task.workers.filter((worker) => worker.stepId === void 0 || !stepIds.has(worker.stepId));
			const status = t(TASK_STATUS_KEYS[task.status]);
			const phase = task.distribution?.state === "running" && task.workers.length === 0 ? t("distribution.phase.unreported") : t(PHASE_KEYS[task.phase]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
				className: TaskDispatcherAction_module_css_default.task,
				"data-task-status": task.status,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: taskDot(task.status) }),
					title: task.title,
					open,
					expandable: true,
					onToggle: () => {
						setOpen((value) => !value);
					},
					expandOnRowClick: true,
					previewChevron: false,
					keepContentWhenOpen: true,
					rowClassName: TaskDispatcherAction_module_css_default.taskHeader,
					leadingClassName: TaskDispatcherAction_module_css_default.taskLeading,
					titleClassName: TaskDispatcherAction_module_css_default.taskTitle,
					collapsedContent: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: TaskDispatcherAction_module_css_default.taskStatus,
						children: status
					}),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherAction_module_css_default.taskBody,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: TaskDispatcherAction_module_css_default.taskMeta,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: task.taskId }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("task.meta", {
									lane: task.lane,
									phase
								}) })]
							}),
							task.distribution === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DistributionSummary, {
								distribution: task.distribution,
								t
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkerList, {
								label: t("workers.task"),
								scope: task.title,
								workers: taskWorkers,
								t
							}),
							task.masterPlan === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: TaskDispatcherAction_module_css_default.noPlan,
								children: t(task.distribution === void 0 ? "task.noPlan" : "task.noPlan.distributed")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlanBody, {
								plan: task.masterPlan,
								task,
								t
							}),
							task.result === void 0 || task.result.message === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: TaskDispatcherAction_module_css_default.result,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("task.result") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: task.result.message })]
							})
						]
					})
				})
			});
		}
		/** Session-header trigger and its full execution-plan modal. */
		function TaskDispatcherAction({ useTaskDispatcher, t }) {
			const state = useTaskDispatcher((value) => value);
			const [open, setOpen] = (0, react.useState)(false);
			const tasks = state.snapshot?.tasks ?? [];
			const orderedTasks = (0, react.useMemo)(() => [...tasks].sort((left, right) => {
				if (left.status === "running" !== (right.status === "running")) return left.status === "running" ? -1 : 1;
				return right.updatedAt - left.updatedAt;
			}), [tasks]);
			const summary = headerSummary(state, t);
			const runningTasks = tasks.filter((task) => task.status === "running");
			const latestTerminal = newestTask(tasks);
			const connection = connectionSummary(state, t);
			const accessibleSummary = connection === void 0 ? summary.accessible : t("header.withConnection", {
				summary: summary.accessible,
				connection
			});
			const triggerState = runningTasks.length > 0 ? "ongoing" : state.phase === "error" ? "error" : state.phase === "reconnecting" ? "warning" : latestTerminal === void 0 ? "warning" : taskDot(latestTerminal.status);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: TaskDispatcherAction_module_css_default.trigger,
				"aria-label": t("header.open", { summary: accessibleSummary }),
				"aria-haspopup": "dialog",
				"aria-expanded": open,
				onClick: () => {
					setOpen(true);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: triggerState }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: summary.visible })]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open,
				onClose: () => {
					setOpen(false);
				},
				title: t("modal.title"),
				closeLabel: t("modal.close"),
				description: t("modal.description"),
				className: TaskDispatcherAction_module_css_default.dialog,
				contentClassName: TaskDispatcherAction_module_css_default.modalContent,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConnectionNotice, {
					state,
					t
				}), tasks.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: TaskDispatcherAction_module_css_default.empty,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("empty.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("empty.body") })]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: TaskDispatcherAction_module_css_default.tasks,
					"aria-label": t("tasks.aria"),
					children: orderedTasks.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCard, {
						task,
						t
					}, task.taskId))
				})]
			})] });
		}
		//#endregion
		//#region src/client/locales.ts
		/** Locale namespace owned by the Task Dispatcher visualization. */
		const NS = "taskDispatcher";
		const zh = {
			"header.loading": "计划加载中",
			"header.empty": "暂无执行计划",
			"header.unavailable": "执行计划不可用",
			"header.active.plan.one": "计划 {done}/{total} · {agents} 个 Agent 运行",
			"header.active.plan.other": "计划 {done}/{total} · {agents} 个 Agent 运行",
			"header.active.phase.one": "{phase} · {agents} 个 Agent 运行",
			"header.active.phase.other": "{phase} · {agents} 个 Agent 运行",
			"header.active.phasePlan.one": "{phase} · 计划 {done}/{total} · {agents} 个 Agent 运行",
			"header.active.phasePlan.other": "{phase} · 计划 {done}/{total} · {agents} 个 Agent 运行",
			"header.active.multiple": "{tasks} 个任务 · {detail}",
			"header.active.aria.one": "1 个任务进行中：{detail}",
			"header.active.aria.other": "{tasks} 个任务进行中：{detail}",
			"header.terminal.plan": "{status} · 计划 {done}/{total}",
			"header.terminal.noPlan": "{status}",
			"header.terminal.aria.plan": "最近任务“{title}”：{status}；计划 {done}/{total}",
			"header.terminal.aria.noPlan": "最近任务“{title}”：{status}；无分步计划",
			"header.withConnection": "{summary}；{connection}",
			"header.open": "打开任务执行计划：{summary}",
			"modal.title": "任务执行计划",
			"modal.close": "关闭任务执行计划",
			"modal.description": "查看任务依赖关系，以及当前负责规划、执行和验收的模型。",
			"connection.loading": "正在读取计划…",
			"connection.reconnecting": "连接中断，正在重连。下方保留的是最后一次可用状态。",
			"connection.error": "暂时无法读取执行计划。",
			"connection.detail": "详情：{error}",
			"empty.title": "这个会话还没有执行计划",
			"empty.body": "通过 task dispatcher 分发任务后，计划、依赖和工作模型会显示在这里。",
			"tasks.aria": "任务执行计划列表",
			"task.meta": "通道 {lane} · 阶段 {phase}",
			"distribution.title": "分布式执行",
			"distribution.aria": "分布式执行：{state}；队列 {pool}；远端节点 {node}；投递 {claims}；租约 {lease}；{cancellation}；{progress}",
			"distribution.state.queued": "排队中",
			"distribution.state.running": "远端执行中",
			"distribution.state.terminal": "远端已结束",
			"distribution.pool": "队列",
			"distribution.node": "远端节点",
			"distribution.node.pending": "等待领取",
			"distribution.claims": "投递次数",
			"distribution.claimCount.one": "{count} 次",
			"distribution.claimCount.other": "{count} 次",
			"distribution.lease": "租约",
			"distribution.lease.none": "无有效租约",
			"distribution.lease.generation": "第 {generation} 代",
			"distribution.lease.until": "至 {until}",
			"distribution.lease.generationUntil": "第 {generation} 代 · 至 {until}",
			"distribution.cancel.requested": "已请求取消",
			"distribution.cancel.notRequested": "未请求取消",
			"distribution.phase.unreported": "远端执行中（阶段未上报）",
			"distribution.progress.unreported": "分布式 v1 不持久上报当前子阶段、Agent 或模型；此处仅展示可验证的节点与租约。",
			"task.planMeta": "计划 {planId} · 版本 {revision} · 已调整 {patches} 次",
			"task.noPlan": "此任务尚无 master plan；task-level Agent / 模型仍显示在上方。",
			"task.noPlan.distributed": "此分布式任务尚无可用 master plan；v1 仅持久化任务、节点、租约和最终结果。",
			"task.result": "执行结果",
			"task.status.running": "执行中",
			"task.status.accepted": "已通过",
			"task.status.rejected": "未通过",
			"task.status.blocked": "已阻塞",
			"task.status.cancelled": "已取消",
			"task.status.error": "异常",
			"phase.preparing": "准备中",
			"phase.executor": "执行",
			"phase.verifier": "验收",
			"phase.initial-plan": "生成初始计划",
			"phase.initial-plan-review": "审核初始计划",
			"phase.replan": "调整计划",
			"phase.plan-patch-review": "审核计划调整",
			"phase.step-executor": "执行步骤",
			"phase.step-verifier": "验收步骤",
			"phase.final-verification": "最终验收",
			"phase.finished": "已结束",
			"plan.status.active": "进行中",
			"plan.status.accepted": "已通过",
			"plan.status.rejected": "未通过",
			"plan.status.blocked": "已阻塞",
			"plan.status.cancelled": "已取消",
			"plan.status.error": "异常",
			"steps.aria": "“{task}”的纵向依赖链",
			"steps.empty": "计划中还没有步骤。",
			"step.attempts": "尝试 {count} 次",
			"step.dependency.none": "依赖：无（起始步骤）",
			"step.dependency.some": "依赖：{ids}",
			"step.dependency.aria.none": "步骤 {step} 没有前置依赖",
			"step.dependency.aria.some": "步骤 {step} 依赖 {ids}",
			"step.status.pending": "等待中",
			"step.status.working": "执行中",
			"step.status.completed": "已完成",
			"workers.task": "参与任务的 Agent / 模型",
			"workers.step": "参与步骤的 Agent / 模型",
			"workers.aria": "{scope}的 Agent / 模型记录",
			"worker.role.planner": "规划",
			"worker.role.plan-reviewer": "计划审核",
			"worker.role.executor": "执行",
			"worker.role.verifier": "验收",
			"worker.role.replanner": "计划调整",
			"worker.role.final-verifier": "最终验收",
			"worker.status.starting": "启动中",
			"worker.status.running": "工作中",
			"worker.status.cleanup": "收尾中",
			"worker.status.completed": "已完成",
			"worker.status.cancelled": "已取消",
			"worker.status.error": "异常",
			"worker.agentId": "agentId",
			"worker.agentPending": "等待 agentId",
			"worker.model": "provider/model",
			"worker.workerId": "workerId",
			"worker.attempt": "第 {attempt} 次尝试",
			"worker.error": "错误：{error}"
		};
		const en = {
			"header.loading": "Loading plan",
			"header.empty": "No execution plan",
			"header.unavailable": "Execution plan unavailable",
			"header.active.plan.one": "Plan {done}/{total} · {agents} active Agent",
			"header.active.plan.other": "Plan {done}/{total} · {agents} active Agents",
			"header.active.phase.one": "{phase} · {agents} active Agent",
			"header.active.phase.other": "{phase} · {agents} active Agents",
			"header.active.phasePlan.one": "{phase} · Plan {done}/{total} · {agents} active Agent",
			"header.active.phasePlan.other": "{phase} · Plan {done}/{total} · {agents} active Agents",
			"header.active.multiple": "{tasks} tasks · {detail}",
			"header.active.aria.one": "1 task running: {detail}",
			"header.active.aria.other": "{tasks} tasks running: {detail}",
			"header.terminal.plan": "{status} · Plan {done}/{total}",
			"header.terminal.noPlan": "{status}",
			"header.terminal.aria.plan": "Latest task “{title}”: {status}; Plan {done}/{total}",
			"header.terminal.aria.noPlan": "Latest task “{title}”: {status}; no step plan",
			"header.withConnection": "{summary}; {connection}",
			"header.open": "Open task execution plan: {summary}",
			"modal.title": "Task execution plan",
			"modal.close": "Close task execution plan",
			"modal.description": "See task dependencies and the models currently planning, executing, and verifying work.",
			"connection.loading": "Loading the plan…",
			"connection.reconnecting": "Connection lost; reconnecting. The last available state is kept below.",
			"connection.error": "The execution plan is temporarily unavailable.",
			"connection.detail": "Details: {error}",
			"empty.title": "No execution plan in this session yet",
			"empty.body": "After Task Dispatcher receives work, its plan, dependencies, and working models will appear here.",
			"tasks.aria": "Task execution plan list",
			"task.meta": "Lane {lane} · Phase {phase}",
			"distribution.title": "Distributed execution",
			"distribution.aria": "Distributed execution: {state}; pool {pool}; remote node {node}; delivered {claims}; lease {lease}; {cancellation}; {progress}",
			"distribution.state.queued": "Queued",
			"distribution.state.running": "Running remotely",
			"distribution.state.terminal": "Remote run finished",
			"distribution.pool": "Pool",
			"distribution.node": "Remote node",
			"distribution.node.pending": "Awaiting assignment",
			"distribution.claims": "Delivery attempts",
			"distribution.claimCount.one": "{count} attempt",
			"distribution.claimCount.other": "{count} attempts",
			"distribution.lease": "Lease",
			"distribution.lease.none": "No active lease",
			"distribution.lease.generation": "Generation {generation}",
			"distribution.lease.until": "Until {until}",
			"distribution.lease.generationUntil": "Generation {generation} · until {until}",
			"distribution.cancel.requested": "Cancellation requested",
			"distribution.cancel.notRequested": "No cancellation requested",
			"distribution.phase.unreported": "Running remotely (phase unreported)",
			"distribution.progress.unreported": "Distributed v1 does not persist the current child phase, Agent, or model; this view shows only verified node and lease data.",
			"task.planMeta": "Plan {planId} · revision {revision} · adjusted {patches} times",
			"task.noPlan": "This task has no master plan yet; task-level agents and models remain visible above.",
			"task.noPlan.distributed": "This distributed task has no available master plan yet; v1 persists only the task, node, lease, and terminal result.",
			"task.result": "Result",
			"task.status.running": "Running",
			"task.status.accepted": "Accepted",
			"task.status.rejected": "Rejected",
			"task.status.blocked": "Blocked",
			"task.status.cancelled": "Cancelled",
			"task.status.error": "Error",
			"phase.preparing": "Preparing",
			"phase.executor": "Executing",
			"phase.verifier": "Verifying",
			"phase.initial-plan": "Creating initial plan",
			"phase.initial-plan-review": "Reviewing initial plan",
			"phase.replan": "Replanning",
			"phase.plan-patch-review": "Reviewing plan update",
			"phase.step-executor": "Executing step",
			"phase.step-verifier": "Verifying step",
			"phase.final-verification": "Final verification",
			"phase.finished": "Finished",
			"plan.status.active": "Active",
			"plan.status.accepted": "Accepted",
			"plan.status.rejected": "Rejected",
			"plan.status.blocked": "Blocked",
			"plan.status.cancelled": "Cancelled",
			"plan.status.error": "Error",
			"steps.aria": "Vertical dependency chain for “{task}”",
			"steps.empty": "The plan has no steps yet.",
			"step.attempts": "{count} attempts",
			"step.dependency.none": "Depends on: none (starting step)",
			"step.dependency.some": "Depends on: {ids}",
			"step.dependency.aria.none": "Step {step} has no prerequisite",
			"step.dependency.aria.some": "Step {step} depends on {ids}",
			"step.status.pending": "Pending",
			"step.status.working": "Working",
			"step.status.completed": "Completed",
			"workers.task": "Task agents / models",
			"workers.step": "Step agents / models",
			"workers.aria": "Agent and model records for {scope}",
			"worker.role.planner": "Planner",
			"worker.role.plan-reviewer": "Plan reviewer",
			"worker.role.executor": "Executor",
			"worker.role.verifier": "Verifier",
			"worker.role.replanner": "Replanner",
			"worker.role.final-verifier": "Final verifier",
			"worker.status.starting": "Starting",
			"worker.status.running": "Working",
			"worker.status.cleanup": "Cleaning up",
			"worker.status.completed": "Completed",
			"worker.status.cancelled": "Cancelled",
			"worker.status.error": "Error",
			"worker.agentId": "agentId",
			"worker.agentPending": "Waiting for agentId",
			"worker.model": "provider/model",
			"worker.workerId": "workerId",
			"worker.attempt": "Attempt {attempt}",
			"worker.error": "Error: {error}"
		};
		//#endregion
		//#region src/client/types.ts
		/** Browser-safe Task Dispatcher wire and view contracts. */
		const TASK_STATUSES = [
			"running",
			"accepted",
			"rejected",
			"blocked",
			"cancelled",
			"error"
		];
		const RESULT_STATUSES = [
			"accepted",
			"rejected",
			"blocked",
			"cancelled",
			"error"
		];
		const TASK_PHASES = [
			"preparing",
			"executor",
			"verifier",
			"initial-plan",
			"initial-plan-review",
			"replan",
			"plan-patch-review",
			"step-executor",
			"step-verifier",
			"final-verification",
			"finished"
		];
		const PLAN_STATUSES = [
			"active",
			"accepted",
			"rejected",
			"blocked",
			"cancelled",
			"error"
		];
		const STEP_STATUSES = [
			"pending",
			"working",
			"completed"
		];
		const WORKER_ROLES = [
			"planner",
			"plan-reviewer",
			"executor",
			"verifier",
			"replanner",
			"final-verifier"
		];
		const WORKER_PHASES = [
			"executor",
			"verifier",
			"initial-plan",
			"initial-plan-review",
			"replan",
			"plan-patch-review",
			"step-executor",
			"step-verifier",
			"final-verification"
		];
		const WORKER_STATUSES = [
			"starting",
			"running",
			"cleanup",
			"completed",
			"cancelled",
			"error"
		];
		const DISTRIBUTION_STATES = [
			"queued",
			"running",
			"terminal"
		];
		//#endregion
		//#region src/client/decode.ts
		/** A wire response failed the plugin's exact v1 contract. */
		var DispatcherDecodeError = class extends TypeError {};
		function fail(path, expected) {
			throw new DispatcherDecodeError(`${path} must be ${expected}`);
		}
		function record(value, path) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(path, "an object");
			return value;
		}
		function exact(value, path, required, optional = []) {
			const allowed = /* @__PURE__ */ new Set([...required, ...optional]);
			for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "present");
			for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, "absent");
		}
		function string(value, path, empty = false) {
			if (typeof value !== "string" || !empty && value.length === 0) return fail(path, empty ? "a string" : "a non-empty string");
			return value;
		}
		function boolean(value, path) {
			if (typeof value !== "boolean") return fail(path, "a boolean");
			return value;
		}
		function integer(value, path, minimum = 0) {
			if (!Number.isSafeInteger(value) || value < minimum) return fail(path, `a safe integer >= ${minimum}`);
			return value;
		}
		function enumeration(value, path, values) {
			if (typeof value !== "string" || !values.includes(value)) return fail(path, `one of ${values.join(", ")}`);
			return value;
		}
		function optional(value, key, read, path) {
			return Object.hasOwn(value, key) ? read(value[key], `${path}.${key}`) : void 0;
		}
		function array(value, path, read) {
			if (!Array.isArray(value)) return fail(path, "an array");
			return value.map((item, index) => read(item, `${path}[${index}]`));
		}
		function decodeStep(value, path) {
			const item = record(value, path);
			exact(item, path, [
				"id",
				"title",
				"objective",
				"status",
				"attempts",
				"dependsOn"
			]);
			return {
				id: string(item["id"], `${path}.id`),
				title: string(item["title"], `${path}.title`),
				objective: string(item["objective"], `${path}.objective`, true),
				status: enumeration(item["status"], `${path}.status`, STEP_STATUSES),
				attempts: integer(item["attempts"], `${path}.attempts`),
				dependsOn: array(item["dependsOn"], `${path}.dependsOn`, (entry, entryPath) => string(entry, entryPath))
			};
		}
		function decodePlan(value, path) {
			const item = record(value, path);
			exact(item, path, [
				"planId",
				"revision",
				"patchCount",
				"status",
				"summary",
				"steps"
			]);
			return {
				planId: string(item["planId"], `${path}.planId`),
				revision: integer(item["revision"], `${path}.revision`),
				patchCount: integer(item["patchCount"], `${path}.patchCount`),
				status: enumeration(item["status"], `${path}.status`, PLAN_STATUSES),
				summary: string(item["summary"], `${path}.summary`, true),
				steps: array(item["steps"], `${path}.steps`, decodeStep)
			};
		}
		function decodeWorker(value, path) {
			const item = record(value, path);
			exact(item, path, [
				"workerId",
				"role",
				"phase",
				"attempt",
				"transport",
				"provider",
				"model",
				"maxTokens",
				"status",
				"startedAt",
				"updatedAt"
			], [
				"agentId",
				"stepId",
				"planRevision",
				"finishedAt",
				"error"
			]);
			return {
				workerId: string(item["workerId"], `${path}.workerId`),
				...optional(item, "agentId", string, path) === void 0 ? {} : { agentId: optional(item, "agentId", string, path) },
				role: enumeration(item["role"], `${path}.role`, WORKER_ROLES),
				phase: enumeration(item["phase"], `${path}.phase`, WORKER_PHASES),
				...optional(item, "stepId", string, path) === void 0 ? {} : { stepId: optional(item, "stepId", string, path) },
				...optional(item, "planRevision", integer, path) === void 0 ? {} : { planRevision: optional(item, "planRevision", integer, path) },
				attempt: integer(item["attempt"], `${path}.attempt`, 1),
				transport: enumeration(item["transport"], `${path}.transport`, ["spawn", "fork"]),
				provider: string(item["provider"], `${path}.provider`),
				model: string(item["model"], `${path}.model`),
				maxTokens: integer(item["maxTokens"], `${path}.maxTokens`, 1),
				status: enumeration(item["status"], `${path}.status`, WORKER_STATUSES),
				startedAt: integer(item["startedAt"], `${path}.startedAt`),
				updatedAt: integer(item["updatedAt"], `${path}.updatedAt`),
				...optional(item, "finishedAt", integer, path) === void 0 ? {} : { finishedAt: optional(item, "finishedAt", integer, path) },
				...optional(item, "error", (entry, entryPath) => string(entry, entryPath, true), path) === void 0 ? {} : { error: optional(item, "error", (entry, entryPath) => string(entry, entryPath, true), path) }
			};
		}
		function decodeResult(value, path) {
			const item = record(value, path);
			exact(item, path, [
				"status",
				"message",
				"modelVerified",
				"workspaceQuarantined",
				"failureClass"
			]);
			return {
				status: enumeration(item["status"], `${path}.status`, RESULT_STATUSES),
				message: string(item["message"], `${path}.message`, true),
				modelVerified: boolean(item["modelVerified"], `${path}.modelVerified`),
				workspaceQuarantined: boolean(item["workspaceQuarantined"], `${path}.workspaceQuarantined`),
				failureClass: enumeration(item["failureClass"], `${path}.failureClass`, [
					"none",
					"task",
					"infrastructure"
				])
			};
		}
		function decodeDistribution(value, path) {
			const item = record(value, path);
			exact(item, path, [
				"pool",
				"state",
				"claimCount",
				"cancelRequested"
			], [
				"nodeId",
				"leaseGeneration",
				"leaseUntil"
			]);
			const nodeId = optional(item, "nodeId", string, path);
			const leaseGeneration = optional(item, "leaseGeneration", string, path);
			const leaseUntil = optional(item, "leaseUntil", string, path);
			return {
				pool: string(item["pool"], `${path}.pool`),
				state: enumeration(item["state"], `${path}.state`, DISTRIBUTION_STATES),
				...nodeId === void 0 ? {} : { nodeId },
				...leaseGeneration === void 0 ? {} : { leaseGeneration },
				...leaseUntil === void 0 ? {} : { leaseUntil },
				claimCount: integer(item["claimCount"], `${path}.claimCount`),
				cancelRequested: boolean(item["cancelRequested"], `${path}.cancelRequested`)
			};
		}
		function decodeTask(value, path) {
			const item = record(value, path);
			exact(item, path, [
				"taskId",
				"lane",
				"title",
				"status",
				"phase",
				"startedAt",
				"updatedAt",
				"workers"
			], [
				"jobId",
				"finishedAt",
				"distribution",
				"masterPlan",
				"result"
			]);
			const jobId = optional(item, "jobId", string, path);
			const finishedAt = optional(item, "finishedAt", integer, path);
			const distribution = optional(item, "distribution", decodeDistribution, path);
			const masterPlan = optional(item, "masterPlan", decodePlan, path);
			const result = optional(item, "result", decodeResult, path);
			return {
				taskId: string(item["taskId"], `${path}.taskId`),
				...jobId === void 0 ? {} : { jobId },
				lane: string(item["lane"], `${path}.lane`),
				title: string(item["title"], `${path}.title`),
				status: enumeration(item["status"], `${path}.status`, TASK_STATUSES),
				phase: enumeration(item["phase"], `${path}.phase`, TASK_PHASES),
				startedAt: integer(item["startedAt"], `${path}.startedAt`),
				updatedAt: integer(item["updatedAt"], `${path}.updatedAt`),
				...finishedAt === void 0 ? {} : { finishedAt },
				...distribution === void 0 ? {} : { distribution },
				...masterPlan === void 0 ? {} : { masterPlan },
				workers: array(item["workers"], `${path}.workers`, decodeWorker),
				...result === void 0 ? {} : { result }
			};
		}
		/** Decode one exact v1 success value and bind it to the requested session. */
		function decodeDispatcherSnapshot(value, expectedSessionId) {
			const item = record(value, "snapshot");
			exact(item, "snapshot", [
				"protocolVersion",
				"revision",
				"sessionId",
				"generatedAt",
				"tasks"
			]);
			if (item["protocolVersion"] !== 1) fail("snapshot.protocolVersion", "1");
			const sessionId = string(item["sessionId"], "snapshot.sessionId");
			if (expectedSessionId !== void 0 && sessionId !== expectedSessionId) fail("snapshot.sessionId", JSON.stringify(expectedSessionId));
			return {
				protocolVersion: 1,
				revision: integer(item["revision"], "snapshot.revision"),
				sessionId,
				generatedAt: integer(item["generatedAt"], "snapshot.generatedAt"),
				tasks: array(item["tasks"], "snapshot.tasks", decodeTask)
			};
		}
		//#endregion
		//#region src/client/source.ts
		const DEFAULT_RETRY_DELAY_MS = 1e3;
		const DEFAULT_IDLE_TTL_MS = 3e5;
		const DEFAULT_MAX_IDLE_SOURCES = 64;
		function failureText(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function rpcFailure(endpoint, error) {
			return /* @__PURE__ */ new Error(`${endpoint} failed: ${error.code}: ${error.message}`);
		}
		/** One stable, ref-counted observable for a single conversation session. */
		var DispatcherSessionSource = class {
			listeners = /* @__PURE__ */ new Map();
			rpc;
			retryDelayMs;
			sessionId;
			onSubscriberActivity;
			state = { phase: "loading" };
			subscribers = 0;
			generation = 0;
			controller;
			disposed = false;
			constructor(rpc, sessionId, retryDelayMs = DEFAULT_RETRY_DELAY_MS, onSubscriberActivity) {
				this.rpc = rpc;
				this.sessionId = sessionId;
				this.retryDelayMs = retryDelayMs;
				this.onSubscriberActivity = onSubscriberActivity;
			}
			getSnapshot = () => this.state;
			subscribe = (listener) => {
				if (this.disposed) return () => {};
				this.listeners.set(listener, (this.listeners.get(listener) ?? 0) + 1);
				this.subscribers += 1;
				if (this.subscribers === 1) {
					this.onSubscriberActivity?.(true);
					this.start();
				}
				let active = true;
				return () => {
					if (!active) return;
					active = false;
					if (this.disposed) return;
					const count = this.listeners.get(listener) ?? 0;
					if (count <= 1) this.listeners.delete(listener);
					else this.listeners.set(listener, count - 1);
					this.subscribers -= 1;
					if (this.subscribers === 0) {
						this.stop();
						this.onSubscriberActivity?.(false);
					}
				};
			};
			/** Abort the physical watch and permanently retire this source. */
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				this.stop();
				this.listeners.clear();
				this.subscribers = 0;
			}
			start() {
				const generation = ++this.generation;
				const controller = new AbortController();
				this.controller = controller;
				this.publish({
					phase: this.state.snapshot === void 0 ? "loading" : "reconnecting",
					...this.state.snapshot === void 0 ? {} : { snapshot: this.state.snapshot }
				});
				this.run(generation, controller.signal);
			}
			stop() {
				this.generation += 1;
				this.controller?.abort();
				this.controller = void 0;
			}
			active(generation, signal) {
				return !this.disposed && this.subscribers > 0 && this.generation === generation && !signal.aborted;
			}
			async run(generation, signal) {
				let needsSnapshot = true;
				while (this.active(generation, signal)) try {
					const endpoint = needsSnapshot ? "snapshot" : "watch";
					const payload = needsSnapshot ? { sessionId: this.sessionId } : {
						sessionId: this.sessionId,
						afterRevision: this.state.snapshot?.revision ?? 0
					};
					const result = await this.rpc.call("/task-dispatcher", endpoint, payload, signal);
					if (!this.active(generation, signal)) return;
					if (!result.ok) throw rpcFailure(endpoint, result.error);
					const snapshot = decodeDispatcherSnapshot(result.value, this.sessionId);
					const previous = this.state.snapshot;
					if (!needsSnapshot && previous !== void 0 && snapshot.revision < previous.revision) {
						needsSnapshot = true;
						continue;
					}
					this.accept(snapshot, needsSnapshot);
					needsSnapshot = false;
				} catch (error) {
					if (!this.active(generation, signal)) return;
					this.publish({
						phase: this.state.snapshot === void 0 ? "error" : "reconnecting",
						...this.state.snapshot === void 0 ? {} : { snapshot: this.state.snapshot },
						error: failureText(error)
					});
					needsSnapshot = true;
					await this.waitToRetry(signal);
				}
			}
			accept(snapshot, baseline) {
				const previous = this.state.snapshot;
				const accepted = baseline || previous === void 0 || snapshot.revision > previous.revision ? snapshot : previous;
				this.publish({
					phase: "ready",
					snapshot: accepted
				});
			}
			publish(state) {
				if (this.sameState(this.state, state)) return;
				this.state = state;
				const listeners = Array.from(this.listeners.keys());
				for (const listener of listeners) try {
					listener();
				} catch (error) {
					console.error("[task-dispatcher] snapshot listener threw:", error);
				}
			}
			sameState(left, right) {
				return left.phase === right.phase && left.snapshot === right.snapshot && left.error === right.error;
			}
			waitToRetry(signal) {
				return new Promise((resolve) => {
					if (signal.aborted) {
						resolve();
						return;
					}
					const timer = setTimeout(done, this.retryDelayMs);
					signal.addEventListener("abort", done, { once: true });
					function done() {
						clearTimeout(timer);
						signal.removeEventListener("abort", done);
						resolve();
					}
				});
			}
		};
		/** Stable per-session source registry owned by one client plugin apply fiber. */
		var DispatcherSourceRegistry = class {
			idle = /* @__PURE__ */ new Map();
			idleTtlMs;
			maxIdleSources;
			rpc;
			retryDelayMs;
			sessions = /* @__PURE__ */ new Map();
			disposed = false;
			constructor(rpc, options = {}) {
				this.rpc = rpc;
				this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
				this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
				this.maxIdleSources = options.maxIdleSources ?? DEFAULT_MAX_IDLE_SOURCES;
			}
			forSession(sessionId) {
				const current = this.sessions.get(sessionId);
				if (current !== void 0) {
					this.touchIdle(sessionId, current);
					return current;
				}
				if (this.disposed) throw new Error("task dispatcher source registry is disposed");
				const source = new DispatcherSessionSource(this.rpc, sessionId, this.retryDelayMs, (active) => {
					this.handleSubscriberActivity(sessionId, source, active);
				});
				this.sessions.set(sessionId, source);
				this.markIdle(sessionId, source);
				return source;
			}
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				for (const entry of this.idle.values()) clearTimeout(entry.timer);
				this.idle.clear();
				for (const source of this.sessions.values()) source.dispose();
				this.sessions.clear();
			}
			handleSubscriberActivity(sessionId, source, active) {
				if (this.disposed || this.sessions.get(sessionId) !== source) return;
				if (active) this.clearIdle(sessionId, source);
				else this.markIdle(sessionId, source);
			}
			touchIdle(sessionId, source) {
				if (this.idle.get(sessionId)?.source !== source) return;
				this.markIdle(sessionId, source);
			}
			markIdle(sessionId, source) {
				if (this.disposed || this.sessions.get(sessionId) !== source) return;
				this.clearIdle(sessionId, source);
				const timer = setTimeout(() => {
					const current = this.idle.get(sessionId);
					if (current?.source !== source || current.timer !== timer) return;
					this.evictIdle(sessionId, source);
				}, this.idleTtlMs);
				this.idle.set(sessionId, {
					source,
					timer
				});
				while (this.idle.size > this.maxIdleSources) {
					const oldest = this.idle.entries().next().value;
					if (oldest === void 0) break;
					this.evictIdle(oldest[0], oldest[1].source);
				}
			}
			clearIdle(sessionId, source) {
				const current = this.idle.get(sessionId);
				if (current?.source !== source) return;
				clearTimeout(current.timer);
				this.idle.delete(sessionId);
			}
			evictIdle(sessionId, source) {
				const current = this.idle.get(sessionId);
				if (current?.source !== source) return;
				clearTimeout(current.timer);
				this.idle.delete(sessionId);
				if (this.sessions.get(sessionId) !== source) return;
				this.sessions.delete(sessionId);
				source.dispose();
			}
		};
		//#endregion
		//#region src/client/index.ts
		/** Required services for the header slot, dictionaries, and generic RPC transport. */
		const inject = [
			"connection",
			"slots",
			"locale"
		];
		/** Register bilingual copy and one session-header execution-plan action. */
		function apply(ctx) {
			const sources = new DispatcherSourceRegistry(ctx.get("connection").rpc);
			ctx.effect(() => () => {
				sources.dispose();
			}, "task-dispatcher: session snapshot watchers");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "task-dispatcher: dictionaries");
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "task-dispatcher-plan",
				order: 30,
				locale: NS,
				inject: (sessionId) => ({ hooks: { taskDispatcher: sources.forSession(sessionId) } })
			}, TaskDispatcherAction));
		}
		//#endregion
		exports.DispatcherDecodeError = DispatcherDecodeError;
		exports.DispatcherSessionSource = DispatcherSessionSource;
		exports.DispatcherSourceRegistry = DispatcherSourceRegistry;
		exports.TaskDispatcherAction = TaskDispatcherAction;
		exports.apply = apply;
		exports.decodeDispatcherSnapshot = decodeDispatcherSnapshot;
		exports.inject = inject;
		exports.planProgress = planProgress;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map