window.__ModuleLoader__.load({
	id: "dsh-task-dispatcher",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/config-types.ts
		/** Browser-safe configuration contracts for the Task Dispatcher settings page. */
		const DISTRIBUTION_ROLES = [
			"disabled",
			"coordinator",
			"worker",
			"hybrid"
		];
		const LANE_KINDS = ["general", "self-improvement"];
		const LANE_TRANSPORTS = ["spawn", "fork"];
		const LANE_EXECUTION_MODES = ["local", "distributed"];
		const ORCHESTRATION_WORKSPACE_MODES = ["read-shared", "isolated-write"];
		const ORCHESTRATION_FAILURE_MODES = ["fail-fast", "collect"];
		/** Default for a user-created lane; the user must fill routes and criteria before saving. */
		function newDispatcherLane() {
			return {
				name: "",
				description: "",
				kind: "general",
				transport: "spawn",
				execution: {
					mode: "local",
					pool: "default",
					workspaceRef: ""
				},
				orchestration: {
					enabled: false,
					childLane: "",
					maxDepth: 2,
					maxTaskNodes: 16,
					maxChildrenPerNode: 4,
					maxConcurrentNodes: 4,
					maxTotalModelRuns: 48,
					maxResultBytes: 131072,
					workspaceMode: "read-shared",
					failureMode: "fail-fast"
				},
				executor: {
					provider: "",
					model: "",
					maxTokens: 32e3
				},
				verifier: {
					provider: "",
					model: "",
					maxTokens: 12e3
				},
				plannerTools: [],
				maxPlanSteps: 6,
				maxPlanPatches: 4,
				maxTotalChildRuns: 32,
				taskTimeoutMs: 36e5,
				retryOnRevise: false,
				maxAttempts: 1,
				childTimeoutMs: 9e5,
				requiredCriteria: [{
					id: "requirements",
					text: ""
				}],
				executorTools: [],
				verifierTools: []
			};
		}
		//#endregion
		//#region src/client/config-decode.ts
		/** Strict decoding for the plugin-owned configuration RPC. */
		var DispatcherConfigDecodeError = class extends Error {
			constructor(message) {
				super(`invalid Task Dispatcher configuration response: ${message}`);
				this.name = "DispatcherConfigDecodeError";
			}
		};
		function fail$1(path, expectation) {
			throw new DispatcherConfigDecodeError(`${path} must be ${expectation}`);
		}
		function record$1(value, path) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return fail$1(path, "an object");
			return value;
		}
		function exact$1(source, allowed, path) {
			const extras = Object.keys(source).filter((key) => !allowed.includes(key));
			if (extras.length > 0) fail$1(path, `an object containing only ${allowed.join(", ")} (unexpected ${extras.join(", ")})`);
		}
		function string$1(value, path) {
			return typeof value === "string" ? value : fail$1(path, "a string");
		}
		function boolean$1(value, path) {
			return typeof value === "boolean" ? value : fail$1(path, "a boolean");
		}
		function integer$1(value, path) {
			return Number.isSafeInteger(value) ? value : fail$1(path, "a safe integer");
		}
		function oneOf(value, choices, path) {
			return typeof value === "string" && choices.includes(value) ? value : fail$1(path, choices.join(" or "));
		}
		function strings(value, path) {
			if (!Array.isArray(value)) return fail$1(path, "an array");
			return value.map((entry, index) => string$1(entry, `${path}[${index}]`));
		}
		function route$1(value, path) {
			const source = record$1(value, path);
			exact$1(source, [
				"provider",
				"model",
				"maxTokens"
			], path);
			return {
				provider: string$1(source["provider"], `${path}.provider`),
				model: string$1(source["model"], `${path}.model`),
				maxTokens: integer$1(source["maxTokens"], `${path}.maxTokens`)
			};
		}
		function criteria(value, path) {
			if (!Array.isArray(value)) return fail$1(path, "an array");
			return value.map((entry, index) => {
				const source = record$1(entry, `${path}[${index}]`);
				exact$1(source, ["id", "text"], `${path}[${index}]`);
				return {
					id: string$1(source["id"], `${path}[${index}].id`),
					text: string$1(source["text"], `${path}[${index}].text`)
				};
			});
		}
		function lane(value, path) {
			const source = record$1(value, path);
			exact$1(source, [
				"name",
				"description",
				"kind",
				"transport",
				"execution",
				"orchestration",
				"executor",
				"verifier",
				"planner",
				"plannerTools",
				"maxPlanSteps",
				"maxPlanPatches",
				"maxTotalChildRuns",
				"taskTimeoutMs",
				"retryOnRevise",
				"maxAttempts",
				"childTimeoutMs",
				"requiredCriteria",
				"executorTools",
				"verifierTools"
			], path);
			const execution = record$1(source["execution"], `${path}.execution`);
			exact$1(execution, [
				"mode",
				"pool",
				"workspaceRef"
			], `${path}.execution`);
			const orchestration = record$1(source["orchestration"], `${path}.orchestration`);
			exact$1(orchestration, [
				"enabled",
				"childLane",
				"maxDepth",
				"maxTaskNodes",
				"maxChildrenPerNode",
				"maxConcurrentNodes",
				"maxTotalModelRuns",
				"maxResultBytes",
				"workspaceMode",
				"failureMode"
			], `${path}.orchestration`);
			const planner = source["planner"];
			const executorTools = source["executorTools"];
			return {
				name: string$1(source["name"], `${path}.name`),
				description: string$1(source["description"], `${path}.description`),
				kind: oneOf(source["kind"], LANE_KINDS, `${path}.kind`),
				transport: oneOf(source["transport"], LANE_TRANSPORTS, `${path}.transport`),
				execution: {
					mode: oneOf(execution["mode"], LANE_EXECUTION_MODES, `${path}.execution.mode`),
					pool: string$1(execution["pool"], `${path}.execution.pool`),
					workspaceRef: string$1(execution["workspaceRef"], `${path}.execution.workspaceRef`)
				},
				orchestration: {
					enabled: boolean$1(orchestration["enabled"], `${path}.orchestration.enabled`),
					childLane: string$1(orchestration["childLane"], `${path}.orchestration.childLane`),
					maxDepth: integer$1(orchestration["maxDepth"], `${path}.orchestration.maxDepth`),
					maxTaskNodes: integer$1(orchestration["maxTaskNodes"], `${path}.orchestration.maxTaskNodes`),
					maxChildrenPerNode: integer$1(orchestration["maxChildrenPerNode"], `${path}.orchestration.maxChildrenPerNode`),
					maxConcurrentNodes: integer$1(orchestration["maxConcurrentNodes"], `${path}.orchestration.maxConcurrentNodes`),
					maxTotalModelRuns: integer$1(orchestration["maxTotalModelRuns"], `${path}.orchestration.maxTotalModelRuns`),
					maxResultBytes: integer$1(orchestration["maxResultBytes"], `${path}.orchestration.maxResultBytes`),
					workspaceMode: oneOf(orchestration["workspaceMode"], ORCHESTRATION_WORKSPACE_MODES, `${path}.orchestration.workspaceMode`),
					failureMode: oneOf(orchestration["failureMode"], ORCHESTRATION_FAILURE_MODES, `${path}.orchestration.failureMode`)
				},
				executor: route$1(source["executor"], `${path}.executor`),
				verifier: route$1(source["verifier"], `${path}.verifier`),
				...planner === void 0 ? {} : { planner: route$1(planner, `${path}.planner`) },
				plannerTools: strings(source["plannerTools"], `${path}.plannerTools`),
				maxPlanSteps: integer$1(source["maxPlanSteps"], `${path}.maxPlanSteps`),
				maxPlanPatches: integer$1(source["maxPlanPatches"], `${path}.maxPlanPatches`),
				maxTotalChildRuns: integer$1(source["maxTotalChildRuns"], `${path}.maxTotalChildRuns`),
				taskTimeoutMs: integer$1(source["taskTimeoutMs"], `${path}.taskTimeoutMs`),
				retryOnRevise: boolean$1(source["retryOnRevise"], `${path}.retryOnRevise`),
				maxAttempts: integer$1(source["maxAttempts"], `${path}.maxAttempts`),
				childTimeoutMs: integer$1(source["childTimeoutMs"], `${path}.childTimeoutMs`),
				requiredCriteria: criteria(source["requiredCriteria"], `${path}.requiredCriteria`),
				...executorTools === void 0 ? {} : { executorTools: strings(executorTools, `${path}.executorTools`) },
				verifierTools: strings(source["verifierTools"], `${path}.verifierTools`)
			};
		}
		function distribution(value, path) {
			const source = record$1(value, path);
			exact$1(source, [
				"role",
				"databaseUrlEnv",
				"scopeId",
				"workerId",
				"workerAgentPreset",
				"pools",
				"workspaceMappings",
				"concurrency",
				"leaseMs",
				"heartbeatMs",
				"pollMs",
				"maxDeliveryAttempts"
			], path);
			const mappingSource = record$1(source["workspaceMappings"], `${path}.workspaceMappings`);
			const workspaceMappings = {};
			for (const [key, entry] of Object.entries(mappingSource)) workspaceMappings[key] = string$1(entry, `${path}.workspaceMappings.${key}`);
			return {
				role: oneOf(source["role"], DISTRIBUTION_ROLES, `${path}.role`),
				databaseUrlEnv: string$1(source["databaseUrlEnv"], `${path}.databaseUrlEnv`),
				scopeId: string$1(source["scopeId"], `${path}.scopeId`),
				workerId: string$1(source["workerId"], `${path}.workerId`),
				workerAgentPreset: string$1(source["workerAgentPreset"], `${path}.workerAgentPreset`),
				pools: strings(source["pools"], `${path}.pools`),
				workspaceMappings,
				concurrency: integer$1(source["concurrency"], `${path}.concurrency`),
				leaseMs: integer$1(source["leaseMs"], `${path}.leaseMs`),
				heartbeatMs: integer$1(source["heartbeatMs"], `${path}.heartbeatMs`),
				pollMs: integer$1(source["pollMs"], `${path}.pollMs`),
				maxDeliveryAttempts: integer$1(source["maxDeliveryAttempts"], `${path}.maxDeliveryAttempts`)
			};
		}
		function config(value, path) {
			const source = record$1(value, path);
			exact$1(source, [
				"lanes",
				"defaultRunInBackground",
				"maxConsecutiveFailures",
				"circuitCooldownMs",
				"jobOutputLimitBytes",
				"liveRoot",
				"stagingRoot",
				"distribution"
			], path);
			const laneSource = record$1(source["lanes"], `${path}.lanes`);
			const lanes = {};
			for (const [id, entry] of Object.entries(laneSource)) lanes[id] = lane(entry, `${path}.lanes.${id}`);
			return {
				lanes,
				defaultRunInBackground: boolean$1(source["defaultRunInBackground"], `${path}.defaultRunInBackground`),
				maxConsecutiveFailures: integer$1(source["maxConsecutiveFailures"], `${path}.maxConsecutiveFailures`),
				circuitCooldownMs: integer$1(source["circuitCooldownMs"], `${path}.circuitCooldownMs`),
				jobOutputLimitBytes: integer$1(source["jobOutputLimitBytes"], `${path}.jobOutputLimitBytes`),
				liveRoot: string$1(source["liveRoot"], `${path}.liveRoot`),
				stagingRoot: string$1(source["stagingRoot"], `${path}.stagingRoot`),
				distribution: distribution(source["distribution"], `${path}.distribution`)
			};
		}
		/** Decode one complete Host snapshot without trusting nested settings data. */
		function decodeDispatcherConfigSnapshot(value) {
			const source = record$1(value, "$");
			exact$1(source, [
				"protocolVersion",
				"available",
				"writable",
				"applies",
				"revision",
				"value",
				"base",
				"userLaneIds",
				"invalid"
			], "$");
			if (source["protocolVersion"] !== 1) fail$1("$.protocolVersion", "1");
			if (source["applies"] !== "restart") fail$1("$.applies", "restart");
			const invalid = source["invalid"];
			const base = config(source["base"], "$.base");
			let resolved;
			try {
				resolved = config(source["value"], "$.value");
			} catch (error) {
				if (invalid === void 0) throw error;
				resolved = structuredClone(base);
			}
			return {
				protocolVersion: 1,
				available: boolean$1(source["available"], "$.available"),
				revision: integer$1(source["revision"], "$.revision"),
				writable: boolean$1(source["writable"], "$.writable"),
				applies: "restart",
				value: resolved,
				base,
				userLaneIds: strings(source["userLaneIds"], "$.userLaneIds"),
				...invalid === void 0 ? {} : { invalid: string$1(invalid, "$.invalid") }
			};
		}
		//#endregion
		//#region src/client/config-controller.ts
		const TASK_DISPATCHER_CONFIG_RPC_CHANNEL = "/task-dispatcher-config";
		const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
		const REF = /^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,127}$/u;
		const TOOL = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
		const ENV = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
		const READ_ONLY = /* @__PURE__ */ new Set([
			"read",
			"read_image",
			"glob",
			"grep"
		]);
		const RAW_DELEGATION = /* @__PURE__ */ new Set([
			"dispatch_task",
			"dispatch_status",
			"dispatch_cancel",
			"subagent",
			"subagent_fork",
			"workflow",
			"ralph",
			"prompt_rewrite_rules",
			"trigger_rules"
		]);
		function range(errors, path, value, min, max) {
			if (!Number.isSafeInteger(value) || value < min || value > max) errors[path] = "range";
		}
		function nonEmpty(errors, path, value) {
			if (value.trim() === "") errors[path] = "required";
			else if (value !== value.trim()) errors[path] = "trimmed";
		}
		function absolutePath(value) {
			return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\");
		}
		function tools(errors, path, values) {
			if (values === void 0) return;
			if (values.length > 64) errors[path] = "range";
			const seen = /* @__PURE__ */ new Set();
			values.forEach((value, index) => {
				const itemPath = `${path}.${index}`;
				if (!TOOL.test(value)) errors[itemPath] = "invalid-id";
				else if (seen.has(value)) errors[itemPath] = "duplicate";
				seen.add(value);
			});
		}
		function route(errors, path, value) {
			nonEmpty(errors, `${path}.provider`, value.provider);
			nonEmpty(errors, `${path}.model`, value.model);
			range(errors, `${path}.maxTokens`, value.maxTokens, 1, 1e6);
		}
		function minimumLaneExecutionCost(laneId, lanes, remainingDepth, visiting = /* @__PURE__ */ new Set()) {
			const lane = lanes[laneId];
			if (lane === void 0) throw new TypeError("unknown child lane");
			if (!lane.orchestration.enabled) return {
				nodes: 1,
				modelRuns: lane.planner === void 0 ? 2 : 5
			};
			if (visiting.has(laneId)) throw new TypeError("orchestration lane cycle");
			const depth = Math.min(remainingDepth, lane.orchestration.maxDepth);
			if (depth < 1) throw new TypeError("orchestration depth cannot reach a leaf lane");
			const next = new Set(visiting);
			next.add(laneId);
			const child = minimumLaneExecutionCost(lane.orchestration.childLane, lanes, depth - 1, next);
			return {
				nodes: child.nodes + 1,
				modelRuns: child.modelRuns + 3
			};
		}
		/** Browser-side fast feedback. The Host remains authoritative on save. */
		function validateDispatcherDraft(config) {
			const errors = {};
			const laneEntries = Object.entries(config.lanes);
			if (laneEntries.length > 16) errors["lanes"] = "max-lanes";
			range(errors, "maxConsecutiveFailures", config.maxConsecutiveFailures, 1, 20);
			range(errors, "circuitCooldownMs", config.circuitCooldownMs, 1e3, 864e5);
			range(errors, "jobOutputLimitBytes", config.jobOutputLimitBytes, 4096, 1048576);
			for (const field of ["liveRoot", "stagingRoot"]) {
				const value = config[field];
				if (value !== "" && !absolutePath(value)) errors[field] = "absolute-path";
			}
			if (config.liveRoot !== "" && config.stagingRoot !== "") {
				const clean = (value) => value.replace(/[\\/]+$/u, "");
				const live = clean(config.liveRoot);
				const staging = clean(config.stagingRoot);
				if (live === staging || live.startsWith(`${staging}/`) || staging.startsWith(`${live}/`)) errors["stagingRoot"] = "overlap";
			}
			const distribution = config.distribution;
			if (!ENV.test(distribution.databaseUrlEnv)) errors["distribution.databaseUrlEnv"] = "invalid-env";
			nonEmpty(errors, "distribution.scopeId", distribution.scopeId);
			if (distribution.workerId !== "") nonEmpty(errors, "distribution.workerId", distribution.workerId);
			if (distribution.workerAgentPreset !== "") nonEmpty(errors, "distribution.workerAgentPreset", distribution.workerAgentPreset);
			if (distribution.pools.length > 16) errors["distribution.pools"] = "range";
			const pools = /* @__PURE__ */ new Set();
			distribution.pools.forEach((pool, index) => {
				const path = `distribution.pools.${index}`;
				if (!ID.test(pool)) errors[path] = "invalid-id";
				else if (pools.has(pool)) errors[path] = "duplicate";
				pools.add(pool);
			});
			if ((distribution.role === "worker" || distribution.role === "hybrid") && pools.size === 0) errors["distribution.pools"] = "required";
			for (const [ref, pathValue] of Object.entries(distribution.workspaceMappings)) {
				if (!REF.test(ref)) errors[`distribution.workspaceMappings.${ref}.ref`] = "invalid-id";
				if (!absolutePath(pathValue)) errors[`distribution.workspaceMappings.${ref}.path`] = "absolute-path";
			}
			range(errors, "distribution.concurrency", distribution.concurrency, 1, 16);
			range(errors, "distribution.leaseMs", distribution.leaseMs, 15e3, 3e5);
			range(errors, "distribution.heartbeatMs", distribution.heartbeatMs, 1e3, 6e4);
			if (distribution.heartbeatMs * 3 > distribution.leaseMs) errors["distribution.heartbeatMs"] = "heartbeat";
			range(errors, "distribution.pollMs", distribution.pollMs, 100, 3e4);
			range(errors, "distribution.maxDeliveryAttempts", distribution.maxDeliveryAttempts, 1, 10);
			for (const [id, lane] of laneEntries) {
				const root = `lanes.${id}`;
				if (!ID.test(id)) errors[`${root}.id`] = "invalid-id";
				if (lane.name !== lane.name.trim()) errors[`${root}.name`] = "trimmed";
				route(errors, `${root}.executor`, lane.executor);
				route(errors, `${root}.verifier`, lane.verifier);
				if (lane.planner !== void 0) route(errors, `${root}.planner`, lane.planner);
				tools(errors, `${root}.executorTools`, lane.executorTools);
				tools(errors, `${root}.plannerTools`, lane.plannerTools);
				tools(errors, `${root}.verifierTools`, lane.verifierTools);
				if (lane.plannerTools.some((tool) => !READ_ONLY.has(tool))) errors[`${root}.plannerTools`] = "read-only-tools";
				if (lane.verifierTools.some((tool) => !READ_ONLY.has(tool))) errors[`${root}.verifierTools`] = "read-only-tools";
				if ((lane.executorTools ?? []).some((tool) => RAW_DELEGATION.has(tool))) errors[`${root}.executorTools`] = "unsafe-tool";
				range(errors, `${root}.maxPlanSteps`, lane.maxPlanSteps, 1, 8);
				range(errors, `${root}.maxPlanPatches`, lane.maxPlanPatches, 0, 8);
				range(errors, `${root}.maxTotalChildRuns`, lane.maxTotalChildRuns, 5, 32);
				range(errors, `${root}.taskTimeoutMs`, lane.taskTimeoutMs, 1e3, 216e5);
				range(errors, `${root}.maxAttempts`, lane.maxAttempts, 1, 3);
				range(errors, `${root}.childTimeoutMs`, lane.childTimeoutMs, 1e3, 36e5);
				if (lane.requiredCriteria.length === 0) errors[`${root}.requiredCriteria`] = "criteria-required";
				if (lane.requiredCriteria.length > 24) errors[`${root}.requiredCriteria`] = "range";
				const criteria = /* @__PURE__ */ new Set();
				let criteriaLength = 0;
				lane.requiredCriteria.forEach((criterion, index) => {
					const criterionRoot = `${root}.requiredCriteria.${index}`;
					if (!ID.test(criterion.id)) errors[`${criterionRoot}.id`] = "invalid-id";
					else if (criteria.has(criterion.id)) errors[`${criterionRoot}.id`] = "duplicate";
					criteria.add(criterion.id);
					nonEmpty(errors, `${criterionRoot}.text`, criterion.text);
					if (criterion.text.length > 2e3) errors[`${criterionRoot}.text`] = "range";
					criteriaLength += criterion.text.length;
				});
				if (criteriaLength > 24e3) errors[`${root}.requiredCriteria`] = "range";
				if (lane.kind === "self-improvement" && (config.liveRoot === "" || config.stagingRoot === "")) errors[`${root}.kind`] = "absolute-path";
				if ((lane.executorTools ?? []).some((tool) => !READ_ONLY.has(tool)) && config.liveRoot === "") {
					errors[`${root}.executorTools`] ??= "absolute-path";
					errors["liveRoot"] = "absolute-path";
				}
				if (lane.execution.mode === "distributed") {
					if (distribution.role === "disabled") errors[`${root}.execution.mode`] = "distribution-required";
					if (lane.kind !== "general" || lane.transport !== "spawn") errors[`${root}.execution.mode`] = "read-only-tools";
					if (!ID.test(lane.execution.pool)) errors[`${root}.execution.pool`] = "invalid-id";
					if (!REF.test(lane.execution.workspaceRef)) errors[`${root}.execution.workspaceRef`] = "invalid-id";
					if ([
						...lane.executorTools ?? [],
						...lane.plannerTools,
						...lane.verifierTools
					].some((tool) => !READ_ONLY.has(tool))) {
						if (errors[`${root}.executorTools`] !== "unsafe-tool") errors[`${root}.executorTools`] = "read-only-tools";
					}
					if ((distribution.role === "worker" || distribution.role === "hybrid") && distribution.workspaceMappings[lane.execution.workspaceRef] === void 0) errors[`${root}.execution.workspaceRef`] = "mapping-required";
				}
				const orchestration = lane.orchestration;
				range(errors, `${root}.orchestration.maxDepth`, orchestration.maxDepth, 1, 4);
				range(errors, `${root}.orchestration.maxTaskNodes`, orchestration.maxTaskNodes, 1, 32);
				range(errors, `${root}.orchestration.maxChildrenPerNode`, orchestration.maxChildrenPerNode, 1, 8);
				range(errors, `${root}.orchestration.maxConcurrentNodes`, orchestration.maxConcurrentNodes, 1, 8);
				range(errors, `${root}.orchestration.maxTotalModelRuns`, orchestration.maxTotalModelRuns, 1, 128);
				range(errors, `${root}.orchestration.maxResultBytes`, orchestration.maxResultBytes, 4096, 1048576);
				if (orchestration.maxChildrenPerNode > orchestration.maxTaskNodes - 1 || orchestration.maxConcurrentNodes > orchestration.maxTaskNodes) errors[`${root}.orchestration.enabled`] = "orchestration";
				if (orchestration.enabled) {
					const childLane = config.lanes[orchestration.childLane];
					if (!ID.test(orchestration.childLane) || childLane === void 0) errors[`${root}.orchestration.childLane`] = "orchestration";
					else {
						const localSpawn = lane.execution.mode === "local" && childLane.execution.mode === "local" && lane.transport === "spawn" && childLane.transport === "spawn";
						const parentReadOnly = [
							...lane.executorTools ?? [],
							...lane.plannerTools,
							...lane.verifierTools
						].every((tool) => READ_ONLY.has(tool));
						const childReadOnly = [
							...childLane.executorTools ?? [],
							...childLane.plannerTools,
							...childLane.verifierTools
						].every((tool) => READ_ONLY.has(tool));
						if (lane.planner === void 0 || orchestration.maxTotalModelRuns < 5 || !localSpawn || !parentReadOnly || !childReadOnly || childLane.kind !== "general" || orchestration.workspaceMode !== "read-shared") errors[`${root}.orchestration.enabled`] = "orchestration";
						const childSets = [
							childLane.executorTools ?? [],
							childLane.plannerTools,
							childLane.verifierTools
						];
						const parentSets = [
							lane.executorTools ?? [],
							lane.plannerTools,
							lane.verifierTools
						];
						if (childSets.some((set, index) => set.some((tool) => !new Set(parentSets[index]).has(tool)))) errors[`${root}.orchestration.childLane`] = "orchestration";
					}
				} else if (orchestration.childLane !== "") errors[`${root}.orchestration.childLane`] = "orchestration";
			}
			for (const [id, lane] of laneEntries) {
				if (!lane.orchestration.enabled) continue;
				const root = `lanes.${id}.orchestration`;
				try {
					const minimum = minimumLaneExecutionCost(id, config.lanes, lane.orchestration.maxDepth);
					if (minimum.nodes > lane.orchestration.maxTaskNodes || minimum.modelRuns > lane.orchestration.maxTotalModelRuns) errors[`${root}.enabled`] = "orchestration";
				} catch {
					errors[`${root}.childLane`] = "orchestration";
				}
			}
			return errors;
		}
		function same(left, right) {
			return JSON.stringify(left) === JSON.stringify(right);
		}
		function failureText$1(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/** One root-scoped controller shared by every mount of the settings tab. */
		var DispatcherConfigController = class {
			rpc;
			state = {
				phase: "loading",
				dirty: false,
				saving: false,
				conflicted: false,
				resetToBase: false,
				errors: {}
			};
			listeners = /* @__PURE__ */ new Set();
			loadGeneration = 0;
			connectionGeneration = 0;
			controller;
			disposed = false;
			constructor(rpc) {
				this.rpc = rpc;
			}
			getSnapshot = () => this.state;
			subscribe = (listener) => {
				if (this.disposed) return () => {};
				this.listeners.add(listener);
				if (this.listeners.size === 1 && this.state.snapshot === void 0) this.load();
				return () => {
					this.listeners.delete(listener);
				};
			};
			async load(options = {}) {
				if (this.disposed) return;
				const generation = ++this.loadGeneration;
				this.controller?.abort();
				const controller = new AbortController();
				this.controller = controller;
				if (this.state.snapshot === void 0) this.publish({
					...this.state,
					phase: "loading",
					error: void 0
				});
				try {
					const result = await this.rpc.call(TASK_DISPATCHER_CONFIG_RPC_CHANNEL, "snapshot", {}, controller.signal);
					if (this.disposed || controller.signal.aborted || generation !== this.loadGeneration) return;
					if (!result.ok) {
						const code = String(result.error.code);
						this.publish({
							...this.state,
							phase: code === "unavailable" ? "unavailable" : "error",
							error: `${code}: ${result.error.message}`
						});
						return;
					}
					this.accept(decodeDispatcherConfigSnapshot(result.value), options);
				} catch (error) {
					if (this.disposed || controller.signal.aborted || generation !== this.loadGeneration) return;
					this.publish({
						...this.state,
						phase: "error",
						error: failureText$1(error)
					});
				}
			}
			/**
			* Drop the revision baseline when DSH establishes a new Host generation.
			* Host revisions restart from zero, so equality alone cannot fence a draft
			* created against the previous process. A dirty draft survives for explicit
			* reconciliation; a clean view adopts the new composition immediately.
			*/
			refreshAfterReconnect() {
				if (this.disposed) return;
				const preserveDraft = this.state.dirty && this.state.draft !== void 0;
				this.connectionGeneration += 1;
				this.loadGeneration += 1;
				this.controller?.abort();
				this.controller = void 0;
				const { snapshot: _staleSnapshot, ...withoutSnapshot } = this.state;
				this.publish({
					...withoutSnapshot,
					phase: "loading",
					saving: false,
					conflicted: preserveDraft,
					error: void 0
				});
				this.load({
					preserveDraft,
					conflicted: preserveDraft
				});
			}
			edit(update) {
				const baseline = this.state.snapshot;
				const current = this.state.draft;
				if (baseline === void 0 || current === void 0 || this.state.saving) return;
				const draft = structuredClone(current);
				update(draft);
				this.publish({
					...this.state,
					draft,
					dirty: !same(draft, baseline.value),
					conflicted: false,
					resetToBase: false,
					errors: validateDispatcherDraft(draft),
					error: void 0
				});
			}
			addLane(preferredId) {
				const draft = this.state.draft;
				if (draft === void 0 || Object.keys(draft.lanes).length >= 16) return void 0;
				let id = preferredId?.trim() ?? "";
				if (!ID.test(id) || draft.lanes[id] !== void 0) {
					let suffix = 1;
					do
						id = `lane-${String(suffix++)}`;
					while (draft.lanes[id] !== void 0);
				}
				this.edit((next) => {
					next.lanes[id] = newDispatcherLane();
				});
				return id;
			}
			removeLane(id) {
				const snapshot = this.state.snapshot;
				if (snapshot === void 0 || id in snapshot.base.lanes) return;
				this.edit((draft) => {
					delete draft.lanes[id];
				});
			}
			discard() {
				const snapshot = this.state.snapshot;
				if (snapshot === void 0 || this.state.saving) return;
				this.publish({
					...this.state,
					draft: structuredClone(snapshot.value),
					dirty: false,
					conflicted: false,
					resetToBase: false,
					errors: snapshot.invalid === void 0 ? {} : { "$config": "invalid-config" },
					error: snapshot.invalid
				});
			}
			reset() {
				const snapshot = this.state.snapshot;
				if (snapshot === void 0 || this.state.saving) return;
				const draft = structuredClone(snapshot.base);
				this.publish({
					...this.state,
					draft,
					dirty: !same(draft, snapshot.value) || snapshot.invalid !== void 0,
					conflicted: false,
					resetToBase: true,
					errors: validateDispatcherDraft(draft),
					error: void 0
				});
			}
			async save() {
				const snapshot = this.state.snapshot;
				const draft = this.state.draft;
				if (snapshot === void 0 || draft === void 0 || this.state.saving || !snapshot.available || !snapshot.writable) return;
				const errors = validateDispatcherDraft(draft);
				if (Object.keys(errors).length > 0) {
					this.publish({
						...this.state,
						errors
					});
					return;
				}
				this.publish({
					...this.state,
					saving: true,
					conflicted: false,
					error: void 0
				});
				const connectionGeneration = this.connectionGeneration;
				try {
					const result = await this.rpc.call(TASK_DISPATCHER_CONFIG_RPC_CHANNEL, "save", {
						expectedRevision: snapshot.revision,
						value: structuredClone(draft)
					});
					if (this.disposed || connectionGeneration !== this.connectionGeneration) return;
					if (!result.ok) {
						const code = String(result.error.code);
						if (code === "conflict") {
							this.publish({
								...this.state,
								saving: false,
								conflicted: true,
								error: result.error.message
							});
							await this.load({
								preserveDraft: true,
								conflicted: true
							});
							return;
						}
						this.publish({
							...this.state,
							saving: false,
							phase: code === "unavailable" ? "unavailable" : this.state.phase,
							error: `${code}: ${result.error.message}`
						});
						return;
					}
					this.accept(decodeDispatcherConfigSnapshot(result.value));
				} catch (error) {
					if (!this.disposed && connectionGeneration === this.connectionGeneration) this.publish({
						...this.state,
						saving: false,
						error: failureText$1(error)
					});
				}
			}
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				this.loadGeneration += 1;
				this.controller?.abort();
				this.controller = void 0;
				this.listeners.clear();
			}
			accept(snapshot, options = {}) {
				const draft = options.preserveDraft && this.state.draft !== void 0 ? this.state.draft : structuredClone(snapshot.value);
				const errors = validateDispatcherDraft(draft);
				if (snapshot.invalid !== void 0 && !options.preserveDraft) errors["$config"] = "invalid-config";
				this.publish({
					phase: snapshot.available ? "ready" : "unavailable",
					snapshot,
					draft,
					dirty: !same(draft, snapshot.value),
					saving: false,
					conflicted: options.conflicted === true,
					resetToBase: false,
					errors,
					...snapshot.invalid === void 0 ? {} : { error: snapshot.invalid }
				});
			}
			publish(state) {
				this.state = state;
				for (const listener of this.listeners) try {
					listener();
				} catch (error) {
					console.error("[task-dispatcher] config listener threw:", error);
				}
			}
		};
		//#endregion
		//#region \0dsh-task-dispatcher-css:src/client/TaskDispatcherAction.module.css.mjs
		const css$1 = ".qeug4a_trigger{max-width:min(360px,42vw);min-height:28px;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:7px;align-items:center;gap:7px;padding:3px 7px;font-size:12px;line-height:18px;display:inline-flex}.qeug4a_trigger:hover,.qeug4a_trigger:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.qeug4a_trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.qeug4a_trigger>span:last-child{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.qeug4a_dialog{width:min(780px,100vw - 32px);max-height:calc(100vh - 48px)}.qeug4a_modalContent{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);min-height:0;overflow-y:auto}.qeug4a_notice{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-secondary);border-radius:9px;flex-direction:column;gap:3px;margin-bottom:12px;padding:10px 12px;font-size:12px;line-height:18px;display:flex}.qeug4a_noticeError{color:var(--dsw-alias-state-error-primary)}.qeug4a_noticeDetail{overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);font-size:11px}.qeug4a_empty{color:var(--dsw-alias-label-tertiary);text-align:center;flex-direction:column;align-items:center;gap:6px;padding:36px 16px 28px;font-size:13px;line-height:20px;display:flex}.qeug4a_empty strong{color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:510}.qeug4a_tasks,.qeug4a_nestedTasks,.qeug4a_workers,.qeug4a_steps{margin:0;padding:0;list-style:none}.qeug4a_tasks{flex-direction:column;gap:10px;display:flex}.qeug4a_nestedTasks{margin-top:10px}.qeug4a_nestedTasks .qeug4a_task{background:var(--dsw-alias-bg-module-platform);border-radius:9px}.qeug4a_nestedTasks .qeug4a_taskBody{padding-left:30px}.qeug4a_task{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:12px;min-width:0;overflow:hidden}.qeug4a_taskHeader{box-sizing:border-box;align-items:center;gap:8px;min-height:42px;padding:7px 10px;display:flex}.qeug4a_taskHeader:hover{background:var(--dsw-alias-interactive-bg-hover)}.qeug4a_taskHeader:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.qeug4a_taskLeading{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;margin-right:0;display:inline-flex}.qeug4a_taskTitle{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:14px;font-weight:510;line-height:22px;overflow:hidden}.qeug4a_taskStatus{color:var(--dsw-alias-label-secondary);flex:none;font-size:12px;line-height:18px}.qeug4a_taskBody{flex-direction:column;gap:12px;min-width:0;padding:0 14px 14px 34px;display:flex}.qeug4a_taskMeta{min-width:0;color:var(--dsw-alias-label-tertiary);align-items:center;gap:9px;font-size:11px;line-height:17px;display:flex}.qeug4a_taskMeta code,.qeug4a_stepId{background:var(--dsw-alias-fill-l2);max-width:38%;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono);text-overflow:ellipsis;white-space:nowrap;border-radius:5px;flex:none;padding:1px 5px;font-size:11px;line-height:17px;overflow:hidden}.qeug4a_taskMeta span{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.qeug4a_scopeBadge{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 6px}.qeug4a_distribution{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:8px;min-width:0;padding:9px 10px}.qeug4a_distributionHead{align-items:center;gap:8px;min-width:0;display:flex}.qeug4a_distributionHead strong{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:510;line-height:18px}.qeug4a_distributionState,.qeug4a_distributionCancellation{background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 6px;font-size:10px;line-height:16px}.qeug4a_distributionCancellation{margin-left:auto}.qeug4a_distributionCancellationRequested{color:var(--dsw-alias-state-error-primary);font-weight:510}.qeug4a_distributionFacts{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px 12px;margin:8px 0 0;display:grid}.qeug4a_distributionFacts>div{min-width:0}.qeug4a_distributionFacts dt,.qeug4a_distributionFacts dd{margin:0;font-size:10px;line-height:16px}.qeug4a_distributionFacts dt{color:var(--dsw-alias-label-tertiary)}.qeug4a_distributionFacts dd{color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono);overflow-wrap:anywhere}.qeug4a_distributionProgress{color:var(--dsw-alias-label-tertiary);margin:8px 0 0;font-size:10px;line-height:16px}.qeug4a_plan{flex-direction:column;gap:9px;min-width:0;display:flex}.qeug4a_planContext{border-left:2px solid var(--dsw-alias-state-business-primary);background:var(--dsw-alias-fill-l2);border-radius:0 8px 8px 0;padding:9px 10px}.qeug4a_planContext h4,.qeug4a_planContext p{margin:0}.qeug4a_progress{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:9px;min-width:0;padding:11px}.qeug4a_progressHead{justify-content:space-between;align-items:baseline;gap:10px;display:flex}.qeug4a_progressHead strong{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:510;line-height:18px}.qeug4a_progressHead span{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}.qeug4a_progressTrack{gap:3px;height:8px;margin:9px 0 0;padding:0;list-style:none;display:flex}.qeug4a_progressTrack li{background:var(--dsw-alias-fill-l2);border-radius:999px;flex-basis:0;min-width:8px}.qeug4a_progressTrack li[data-progress-state=completed],.qeug4a_progressLegend li[data-progress-state=completed]>span:first-child{background:var(--dsw-alias-state-business-primary)}.qeug4a_progressTrack li[data-progress-state=working],.qeug4a_progressLegend li[data-progress-state=working]>span:first-child{background:repeating-linear-gradient(135deg, var(--dsw-alias-state-business-primary) 0 3px, var(--dsw-alias-fill-l2) 3px 6px)}.qeug4a_progressTrack li[data-progress-state=ready],.qeug4a_progressLegend li[data-progress-state=ready]>span:first-child{box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary);background:0 0}.qeug4a_progressTrack li[data-progress-state=waiting],.qeug4a_progressLegend li[data-progress-state=waiting]>span:first-child{box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-l2)}.qeug4a_progressTrack li[data-progress-state=failed][data-progress-tone=error],.qeug4a_progressLegend li[data-progress-state=failed][data-progress-tone=error]>span:first-child{background:var(--dsw-alias-state-error-primary)}.qeug4a_progressTrack li[data-progress-state=failed][data-progress-tone=warning],.qeug4a_progressLegend li[data-progress-state=failed][data-progress-tone=warning]>span:first-child{box-shadow:inset 0 0 0 1px var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-l2)}.qeug4a_progressLegend{flex-wrap:wrap;gap:4px 11px;margin:8px 0 0;padding:0;list-style:none;display:flex}.qeug4a_progressLegend li{color:var(--dsw-alias-label-tertiary);align-items:center;gap:5px;font-size:11px;line-height:17px;display:inline-flex}.qeug4a_progressLegend li>span:first-child{border-radius:2px;flex:none;width:7px;height:7px}.qeug4a_progressLegend strong{color:var(--dsw-alias-label-secondary);font-weight:510}.qeug4a_progressFocus{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:10px 0 0;display:grid}.qeug4a_progressFocus>div{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:7px;min-width:0;padding:7px 8px}.qeug4a_progressFocus dt,.qeug4a_progressFocus dd{margin:0}.qeug4a_progressFocus dt{color:var(--dsw-alias-label-tertiary);justify-content:space-between;align-items:center;gap:6px;font-size:11px;font-weight:510;line-height:16px;display:flex}.qeug4a_progressFocus dt>span:last-child{background:var(--dsw-alias-fill-l2);min-width:16px;color:var(--dsw-alias-label-secondary);text-align:center;border-radius:999px;padding:0 4px}.qeug4a_progressFocus dd{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;padding-top:3px;font-size:11px;line-height:17px}.qeug4a_progressHint{color:var(--dsw-alias-label-tertiary);margin:8px 0 0;font-size:10px;line-height:16px}.qeug4a_srOnly{clip:rect(0, 0, 0, 0);white-space:nowrap;border:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}.qeug4a_planContext h4{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:510;line-height:18px}.qeug4a_planContext p{color:var(--dsw-alias-label-tertiary);padding-top:3px;font-size:11px;line-height:17px}.qeug4a_scheduler{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:9px;min-width:0;padding:10px}.qeug4a_schedulerHead{align-items:center;gap:8px;display:flex}.qeug4a_schedulerHead strong{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:510;line-height:18px}.qeug4a_schedulerHead span{background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-secondary);border-radius:999px;margin-left:auto;padding:1px 7px;font-size:10px;line-height:16px}.qeug4a_scheduler>p{color:var(--dsw-alias-label-tertiary);margin:6px 0 0;font-size:10px;line-height:16px}.qeug4a_scheduler>ul{flex-direction:column;gap:4px;margin:8px 0 0;padding:0;list-style:none;display:flex}.qeug4a_scheduledNode{background:var(--dsw-alias-fill-l2);min-width:0;color:var(--dsw-alias-label-secondary);border-radius:6px;grid-template-columns:minmax(80px,.8fr) minmax(100px,1.4fr) minmax(92px,.8fr);align-items:center;gap:8px;padding:5px 7px;font-size:10px;line-height:16px;display:grid}.qeug4a_scheduledNode code,.qeug4a_scheduledNode span{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.qeug4a_scheduledNode code{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono)}.qeug4a_scheduledNode span:last-child{color:var(--dsw-alias-label-tertiary);text-align:right}.qeug4a_planHead{min-width:0;color:var(--dsw-alias-label-tertiary);justify-content:space-between;align-items:center;gap:12px;font-size:11px;line-height:18px;display:flex}.qeug4a_planHead>span:first-child{color:var(--dsw-alias-label-secondary);flex:none;align-items:center;gap:7px;font-weight:510;display:inline-flex}.qeug4a_planHead>span:last-child{min-width:0;font-family:var(--dsw-font-mono);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.qeug4a_planSummary,.qeug4a_noPlan,.qeug4a_emptySteps,.qeug4a_result p,.qeug4a_stepObjective,.qeug4a_workerError{margin:0}.qeug4a_planSummary,.qeug4a_noPlan,.qeug4a_emptySteps{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;font-size:13px;line-height:20px}.qeug4a_steps{flex-direction:column;display:flex}.qeug4a_step{grid-template-columns:18px minmax(0,1fr);gap:9px;min-width:0;display:grid}.qeug4a_stepRail{justify-content:center;padding-top:6px;display:flex;position:relative}.qeug4a_step:not(:last-child) .qeug4a_stepRail:after{z-index:0;background:var(--dsw-alias-border-l2);content:\"\";width:1px;position:absolute;top:18px;bottom:-6px;left:50%;transform:translate(-50%)}.qeug4a_plan[data-plan-scope=macro] .qeug4a_stepRail:after{display:none}.qeug4a_stepRail>*{z-index:1;position:relative}.qeug4a_stepBody{min-width:0;padding:2px 0 17px}.qeug4a_stepHead{align-items:center;gap:7px;min-width:0;min-height:22px;display:flex}.qeug4a_stepHead strong{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:13px;font-weight:510;line-height:20px;overflow:hidden}.qeug4a_stepStatus{color:var(--dsw-alias-label-secondary);flex:none;font-size:11px;line-height:18px}.qeug4a_step[data-progress-state=working] .qeug4a_stepStatus,.qeug4a_step[data-progress-state=ready] .qeug4a_stepStatus{color:var(--dsw-alias-state-business-primary)}.qeug4a_step[data-progress-state=failed][data-progress-tone=error] .qeug4a_stepStatus{color:var(--dsw-alias-state-error-primary)}.qeug4a_stepObjective{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;padding-top:5px;font-size:12px;line-height:18px}.qeug4a_stepMeta{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono);flex-wrap:wrap;gap:3px 12px;padding-top:5px;font-size:10px;line-height:16px;display:flex}.qeug4a_workerSection{min-width:0;padding-top:7px}.qeug4a_workerSection h4,.qeug4a_result h4{color:var(--dsw-alias-label-tertiary);margin:0 0 6px;font-size:11px;font-weight:510;line-height:17px}.qeug4a_workers{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;display:grid}.qeug4a_worker{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:8px;min-width:0;padding:8px 9px}.qeug4a_workerHead{align-items:center;gap:6px;min-width:0;display:flex}.qeug4a_workerRole{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:1;align-items:center;gap:6px;font-size:12px;font-weight:510;line-height:18px;display:inline-flex;overflow:hidden}.qeug4a_workerStatus,.qeug4a_workerAttempt{color:var(--dsw-alias-label-tertiary);flex:none;font-size:10px;line-height:16px}.qeug4a_workerFacts{gap:2px;margin:7px 0 0;display:grid}.qeug4a_workerFacts>div{grid-template-columns:92px minmax(0,1fr);gap:7px;min-width:0;display:grid}.qeug4a_workerFacts dt,.qeug4a_workerFacts dd{font-family:var(--dsw-font-mono);margin:0;font-size:10px;line-height:16px}.qeug4a_workerFacts dt{color:var(--dsw-alias-label-tertiary)}.qeug4a_workerFacts dd{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.qeug4a_workerError{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;padding-top:5px;font-size:10px;line-height:16px}.qeug4a_result{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-l2);border-radius:8px;padding:9px 11px}.qeug4a_result[data-result-status=rejected],.qeug4a_result[data-result-status=error]{border-color:var(--dsw-alias-state-error-primary)}.qeug4a_resultHead{align-items:flex-start;gap:8px;display:flex}.qeug4a_resultHead h4{flex:none;margin:1px 0 0}.qeug4a_resultFacts{flex-wrap:wrap;flex:1;justify-content:flex-end;gap:4px;margin:0;padding:0;list-style:none;display:flex}.qeug4a_resultFacts li{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 6px;font-size:10px;line-height:16px}.qeug4a_resultFacts li[data-quarantined=true]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}.qeug4a_result p{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;padding-top:7px;font-size:12px;line-height:18px}@media (width<=640px){.qeug4a_trigger{max-width:54vw}.qeug4a_dialog{border-radius:16px;width:calc(100vw - 16px);max-height:calc(100vh - 16px)}.qeug4a_taskBody{padding-left:26px;padding-right:10px}.qeug4a_workers{grid-template-columns:minmax(0,1fr)}.qeug4a_distributionFacts{grid-template-columns:repeat(2,minmax(0,1fr))}.qeug4a_planHead,.qeug4a_taskMeta,.qeug4a_schedulerHead{flex-direction:column;align-items:flex-start;gap:3px}.qeug4a_schedulerHead span{margin-left:0}.qeug4a_scheduledNode{grid-template-columns:minmax(76px,.8fr) minmax(100px,1.2fr)}.qeug4a_scheduledNode span:last-child{text-align:left;grid-column:1/-1}.qeug4a_planHead>span:last-child,.qeug4a_taskMeta span{max-width:100%}.qeug4a_workerFacts>div{grid-template-columns:80px minmax(0,1fr)}.qeug4a_progressHead{flex-direction:column;align-items:flex-start;gap:2px}.qeug4a_progressFocus{grid-template-columns:minmax(0,1fr)}.qeug4a_nestedTasks .qeug4a_taskBody{padding-left:22px;padding-right:8px}.qeug4a_resultHead{flex-direction:column}.qeug4a_resultFacts{justify-content:flex-start}}";
		const tagId$1 = "dsh-task-dispatcher/TaskDispatcherAction.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-task-dispatcher";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
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
			"nestedTasks": "qeug4a_nestedTasks",
			"noPlan": "qeug4a_noPlan",
			"notice": "qeug4a_notice",
			"noticeDetail": "qeug4a_noticeDetail",
			"noticeError": "qeug4a_noticeError",
			"plan": "qeug4a_plan",
			"planContext": "qeug4a_planContext",
			"planHead": "qeug4a_planHead",
			"planSummary": "qeug4a_planSummary",
			"progress": "qeug4a_progress",
			"progressFocus": "qeug4a_progressFocus",
			"progressHead": "qeug4a_progressHead",
			"progressHint": "qeug4a_progressHint",
			"progressLegend": "qeug4a_progressLegend",
			"progressTrack": "qeug4a_progressTrack",
			"result": "qeug4a_result",
			"resultFacts": "qeug4a_resultFacts",
			"resultHead": "qeug4a_resultHead",
			"scheduledNode": "qeug4a_scheduledNode",
			"scheduler": "qeug4a_scheduler",
			"schedulerHead": "qeug4a_schedulerHead",
			"scopeBadge": "qeug4a_scopeBadge",
			"srOnly": "qeug4a_srOnly",
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
		const PLAN_PROGRESS_STATES = [
			"completed",
			"working",
			"ready",
			"waiting",
			"failed"
		];
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
		function progressDot(entry) {
			switch (entry.state) {
				case "completed": return "done";
				case "working": return "ongoing";
				case "ready":
				case "waiting": return "warning";
				case "failed": return entry.failureTone === "error" ? "error" : "warning";
			}
		}
		function progressLabel(entry, t) {
			if (entry.resolution === "blocked") return t("progress.status.blocked", { ids: entry.blockedBy.join(", ") });
			if (entry.resolution === "joining") return t("progress.status.joining");
			if (entry.resolution === "unsealed") return t("progress.status.unsealed");
			if (entry.resolution === "stopped") return t("progress.status.stopped");
			return t(`progress.status.${entry.state}`);
		}
		function workerIsRunning(worker) {
			return worker.status === "starting" || worker.status === "running";
		}
		function taskPhaseLabel(task, t) {
			return task.distribution?.state === "running" && task.workers.length === 0 ? t("distribution.phase.unreported") : t(PHASE_KEYS[task.phase]);
		}
		function isStrictlyLinearPlan(plan) {
			return plan.steps.every((step, index, steps) => {
				if (index === 0) return step.dependsOn.length === 0;
				return step.dependsOn.length === 1 && step.dependsOn[0] === steps[index - 1]?.id;
			});
		}
		function planScope(task, childTasks) {
			if (childTasks.length > 0) return "macro";
			if (task.orchestration !== void 0) return "node-local";
			if (task.masterPlan !== void 0 && !isStrictlyLinearPlan(task.masterPlan)) return "macro";
			return "linear";
		}
		function childHasFailed(childTask) {
			return childTask !== void 0 && childTask.status !== "running" && childTask.status !== "accepted";
		}
		/**
		* Project the published DAG and child-task evidence into display-only states.
		* "Ready" means dependency-ready, not admitted to an executor slot.
		*/
		function derivePlanProgress(plan, childTasks) {
			const childByNode = new Map(childTasks.flatMap((child) => child.orchestration === void 0 ? [] : [[child.orchestration.nodeId, child]]));
			const initial = /* @__PURE__ */ new Map();
			for (const step of plan.steps) {
				const childTask = childByNode.get(step.id);
				if (step.status === "completed") initial.set(step.id, { state: "completed" });
				else if (childHasFailed(childTask)) initial.set(step.id, {
					state: "failed",
					resolution: "direct-failure",
					failureTone: childTask?.status === "rejected" || childTask?.status === "error" ? "error" : "warning"
				});
				else if (plan.status !== "active") initial.set(step.id, childTask?.status === "accepted" ? {
					state: "failed",
					resolution: "unsealed",
					failureTone: "warning"
				} : {
					state: "failed",
					resolution: "stopped",
					failureTone: "warning"
				});
				else if (childTask?.status === "accepted") initial.set(step.id, {
					state: "working",
					resolution: "joining"
				});
				else if (step.status === "working" || childTask?.status === "running") initial.set(step.id, { state: "working" });
			}
			const stepById = new Map(plan.steps.map((step) => [step.id, step]));
			const resolved = /* @__PURE__ */ new Map();
			const resolving = /* @__PURE__ */ new Set();
			const resolve = (step) => {
				const existing = resolved.get(step.id);
				if (existing !== void 0) return existing;
				const childTask = childByNode.get(step.id);
				const initialEntry = initial.get(step.id);
				if (initialEntry !== void 0) {
					const entry = {
						step,
						...initialEntry,
						childTask,
						blockedBy: []
					};
					resolved.set(step.id, entry);
					return entry;
				}
				if (resolving.has(step.id)) return {
					step,
					state: "waiting",
					childTask,
					blockedBy: []
				};
				resolving.add(step.id);
				const dependencies = step.dependsOn.map((dependencyId) => {
					const dependency = stepById.get(dependencyId);
					return dependency === void 0 ? void 0 : resolve(dependency);
				});
				resolving.delete(step.id);
				const blockedBy = [...new Set(dependencies.flatMap((dependency, index) => {
					if (dependency?.state !== "failed") return [];
					return dependency.resolution === "blocked" && dependency.blockedBy.length > 0 ? dependency.blockedBy : [step.dependsOn[index]];
				}))].sort();
				const dependenciesComplete = dependencies.length === step.dependsOn.length && dependencies.every((dependency) => dependency?.state === "completed");
				const entry = {
					step,
					state: blockedBy.length > 0 ? "failed" : plan.status !== "active" ? "failed" : dependenciesComplete ? "ready" : "waiting",
					childTask,
					blockedBy,
					resolution: blockedBy.length > 0 ? "blocked" : plan.status !== "active" ? "stopped" : void 0,
					failureTone: blockedBy.length > 0 || plan.status !== "active" ? "warning" : void 0
				};
				resolved.set(step.id, entry);
				return entry;
			};
			const entries = plan.steps.map(resolve);
			const counts = {
				completed: 0,
				working: 0,
				ready: 0,
				waiting: 0,
				failed: 0
			};
			for (const entry of entries) counts[entry.state] += 1;
			return {
				entries,
				counts
			};
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
		function topLevelTasks(tasks) {
			const taskIds = new Set(tasks.map((task) => task.taskId));
			return tasks.filter((task) => task.orchestration === void 0 || !taskIds.has(task.orchestration.parentTaskId));
		}
		function tasksInRootForest(roots, tasks) {
			const rootIds = new Set(roots.map((task) => task.taskId));
			const byId = new Map(tasks.map((task) => [task.taskId, task]));
			return tasks.filter((task) => {
				let current = task;
				const visited = /* @__PURE__ */ new Set();
				while (current !== void 0 && !visited.has(current.taskId)) {
					if (rootIds.has(current.taskId)) return true;
					visited.add(current.taskId);
					const parentTaskId = current.orchestration?.parentTaskId;
					current = parentTaskId === void 0 ? void 0 : byId.get(parentTaskId);
				}
				return false;
			});
		}
		function activeHeaderSummary(tasks, allTasks, t) {
			const rootProgress = planProgress(tasks);
			const agents = tasksInRootForest(tasks, allTasks).reduce((count, task) => count + task.workers.filter(workerIsRunning).length, 0);
			const progress = {
				...rootProgress,
				agents
			};
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
			const snapshotTasks = state.snapshot?.tasks;
			if (snapshotTasks !== void 0 && snapshotTasks.length > 0) {
				const tasks = topLevelTasks(snapshotTasks);
				const active = tasks.filter((task) => task.status === "running");
				if (active.length > 0) return activeHeaderSummary(active, snapshotTasks, t);
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
		function ScheduledNode({ task, t }) {
			const relation = task.orchestration;
			if (relation === void 0) return null;
			const phase = taskPhaseLabel(task, t);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: TaskDispatcherAction_module_css_default.scheduledNode,
				"aria-label": t("orchestration.scheduler.node.aria", {
					node: relation.nodeId,
					title: task.title,
					phase
				}),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						title: relation.nodeId,
						children: relation.nodeId
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						title: task.title,
						children: task.title
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: phase })
				]
			});
		}
		function HostSchedulerSummary({ childTasks, t }) {
			const runningNodes = childTasks.filter((task) => task.status === "running");
			if (runningNodes.length === 0) return null;
			const summary = t(`orchestration.scheduler.summary.${runningNodes.length === 1 ? "one" : "other"}`, { count: runningNodes.length });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: TaskDispatcherAction_module_css_default.scheduler,
				"data-orchestration-active-nodes": runningNodes.length,
				"data-orchestration-scheduling": "continuous-ready-queue",
				"aria-label": t("orchestration.scheduler.aria", { summary }),
				"aria-live": "polite",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherAction_module_css_default.schedulerHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("orchestration.scheduler.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: summary })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("orchestration.scheduler.hint") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						"aria-label": t("orchestration.scheduler.nodes.aria"),
						children: runningNodes.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScheduledNode, {
							task,
							t
						}, task.taskId))
					})
				]
			});
		}
		function ProgressFocus({ entries, focus, t }) {
			const state = focus === "now" ? "working" : focus;
			const matching = entries.filter((entry) => entry.state === state);
			const names = matching.map((entry) => entry.step.title).join(" · ");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-progress-focus": focus,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dt", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(`progress.focus.${focus}`) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": "true",
					children: matching.length
				})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: names === "" ? t(`progress.focus.${focus}.empty`) : names })]
			});
		}
		function ProgressOverview({ overview, scope, t }) {
			const { counts, entries } = overview;
			const unit = scope === "macro" ? "nodes" : "steps";
			const aria = t(`progress.aria.${unit}`, {
				total: entries.length,
				completed: counts.completed,
				working: counts.working,
				ready: counts.ready,
				waiting: counts.waiting,
				failed: counts.failed
			});
			const failureTone = entries.some((entry) => entry.state === "failed" && entry.failureTone === "error") ? "error" : "warning";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: TaskDispatcherAction_module_css_default.progress,
				"aria-label": aria,
				"data-plan-progress": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherAction_module_css_default.progressHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("progress.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(`progress.summary.${unit}`, {
							done: counts.completed,
							total: entries.length
						}) })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: TaskDispatcherAction_module_css_default.progressTrack,
						"aria-label": t(`progress.track.aria.${unit}`),
						children: PLAN_PROGRESS_STATES.filter((state) => counts[state] > 0).map((state) => {
							const status = t(state === "failed" ? "progress.status.failedGroup" : `progress.status.${state}`);
							const label = t(`progress.track.group.${unit}`, {
								status,
								count: counts[state]
							});
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
								"data-progress-state": state,
								"data-progress-tone": state === "failed" ? failureTone : void 0,
								"aria-label": label,
								title: label,
								style: { flexGrow: counts[state] },
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: TaskDispatcherAction_module_css_default.srOnly,
									children: label
								})
							}, state);
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: TaskDispatcherAction_module_css_default.progressLegend,
						"aria-label": t(`progress.legend.aria.${unit}`),
						children: PLAN_PROGRESS_STATES.map((progressState) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							"data-progress-state": progressState,
							"data-progress-tone": progressState === "failed" ? failureTone : void 0,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { "aria-hidden": "true" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(progressState === "failed" ? "progress.status.failedGroup" : `progress.status.${progressState}`) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: counts[progressState] })
							]
						}, progressState))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
						className: TaskDispatcherAction_module_css_default.progressFocus,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProgressFocus, {
								entries,
								focus: "now",
								t
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProgressFocus, {
								entries,
								focus: "ready",
								t
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProgressFocus, {
								entries,
								focus: "waiting",
								t
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: TaskDispatcherAction_module_css_default.progressHint,
						children: t(`progress.hint.${unit}`)
					})
				]
			});
		}
		function StepRow({ childTask, childTasksByParent, dependencyLabels, progressEntry, step, taskTitles, workerLabel, workers, t }) {
			const terminalChild = step.status !== "completed" && childHasFailed(childTask) ? childTask : void 0;
			const visibleStatus = terminalChild?.status ?? (progressEntry.blockedBy.length > 0 ? "blocked" : progressEntry.state);
			const visibleStatusLabel = terminalChild === void 0 ? progressLabel(progressEntry, t) : t(TASK_STATUS_KEYS[terminalChild.status]);
			const visibleStatusDot = terminalChild === void 0 ? progressDot(progressEntry) : taskDot(terminalChild.status);
			const dependencies = dependencyLabels.join(", ");
			const dependencyText = dependencyLabels.length === 0 ? t("step.dependency.none") : t("step.dependency.some", { ids: dependencies });
			const dependencyAria = dependencyLabels.length === 0 ? t("step.dependency.aria.none", { step: step.id }) : t("step.dependency.aria.some", {
				step: step.id,
				ids: dependencies
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: TaskDispatcherAction_module_css_default.step,
				"data-step-status": visibleStatus,
				"data-progress-state": progressEntry.state,
				"data-progress-tone": progressEntry.failureTone,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: TaskDispatcherAction_module_css_default.stepRail,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: visibleStatusDot })
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
									children: visibleStatusLabel
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
							label: workerLabel,
							scope: step.title,
							workers,
							t
						}),
						childTask === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: TaskDispatcherAction_module_css_default.nestedTasks,
							"aria-label": t("orchestration.children.aria", { step: step.title }),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCard, {
								task: childTask,
								childTasks: childTasksByParent.get(childTask.taskId) ?? [],
								childTasksByParent,
								nested: true,
								parentTitle: taskTitles.get(childTask.orchestration?.parentTaskId ?? ""),
								taskTitles,
								t
							})
						})
					]
				})]
			});
		}
		function PlanContext({ scope, t }) {
			if (scope === "linear") return null;
			const prefix = scope === "macro" ? "plan.scope.macro" : "plan.scope.node";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: TaskDispatcherAction_module_css_default.planContext,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t(`${prefix}.title`) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t(`${prefix}.description`) })]
			});
		}
		function PlanBody({ childTasks, childTasksByParent, plan, scope, task, taskTitles, t }) {
			const stepTitles = new Map(plan.steps.map((step) => [step.id, step.title]));
			const childByNode = new Map(childTasks.flatMap((child) => child.orchestration === void 0 ? [] : [[child.orchestration.nodeId, child]]));
			const progress = derivePlanProgress(plan, childTasks);
			const progressByStep = new Map(progress.entries.map((entry) => [entry.step.id, entry]));
			const stepsAria = scope === "macro" ? t("steps.aria.macro", { task: task.title }) : scope === "node-local" ? t("steps.aria.node", { task: task.title }) : t("steps.aria", { task: task.title });
			const stepWorkerLabel = scope === "macro" ? t("workers.macroStep") : scope === "node-local" ? t("workers.localStep") : t("workers.step");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: TaskDispatcherAction_module_css_default.plan,
				"data-plan-scope": scope,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlanContext, {
						scope,
						t
					}),
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
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProgressOverview, {
						overview: progress,
						scope,
						t
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
						className: TaskDispatcherAction_module_css_default.steps,
						"aria-label": stepsAria,
						children: plan.steps.map((step) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StepRow, {
							childTask: childByNode.get(step.id),
							childTasksByParent,
							step,
							taskTitles,
							progressEntry: progressByStep.get(step.id) ?? {
								step,
								state: "waiting",
								blockedBy: []
							},
							dependencyLabels: step.dependsOn.map((dependencyId) => {
								const title = stepTitles.get(dependencyId);
								return title === void 0 ? dependencyId : `${title} (${dependencyId})`;
							}),
							workerLabel: stepWorkerLabel,
							workers: task.workers.filter((worker) => worker.stepId === step.id),
							t
						}, step.id))
					})] })
				]
			});
		}
		function ResultSummary({ result, t }) {
			const verified = t(result.modelVerified ? "task.result.modelVerified.yes" : "task.result.modelVerified.no");
			const failure = t(`task.result.failureClass.${result.failureClass}`);
			const workspace = t(result.workspaceQuarantined ? "task.result.workspaceQuarantined.yes" : "task.result.workspaceQuarantined.no");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: TaskDispatcherAction_module_css_default.result,
				"data-result-status": result.status,
				"data-result-model-verified": result.modelVerified,
				"data-result-failure-class": result.failureClass,
				"data-result-workspace-quarantined": result.workspaceQuarantined,
				"aria-label": t("task.result.aria", {
					status: t(TASK_STATUS_KEYS[result.status]),
					verified,
					failure,
					workspace
				}),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: TaskDispatcherAction_module_css_default.resultHead,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("task.result") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
						className: TaskDispatcherAction_module_css_default.resultFacts,
						"aria-label": t("task.result.facts.aria"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: verified }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: failure }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
								"data-quarantined": result.workspaceQuarantined,
								children: workspace
							})
						]
					})]
				}), result.message === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: result.message })]
			});
		}
		function TaskCard({ childTasks, childTasksByParent, nested, parentTitle, task, taskTitles, t }) {
			const [open, setOpen] = (0, react.useState)(nested ? task.status !== "running" && task.status !== "accepted" : task.status !== "accepted");
			const stepIds = new Set(task.masterPlan?.steps.map((step) => step.id) ?? []);
			const taskWorkers = task.workers.filter((worker) => worker.stepId === void 0 || !stepIds.has(worker.stepId));
			const scope = planScope(task, childTasks);
			const taskWorkerLabel = scope === "macro" ? t("workers.master") : scope === "node-local" ? t("workers.node") : t("workers.task");
			const status = t(TASK_STATUS_KEYS[task.status]);
			const phase = taskPhaseLabel(task, t);
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
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: task.taskId }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("task.meta", {
										lane: task.lane,
										phase
									}) }),
									task.orchestration === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: TaskDispatcherAction_module_css_default.scopeBadge,
										children: t("task.orchestration.workerScope")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("task.orchestration.parent", {
										parent: parentTitle ?? task.orchestration.parentTaskId,
										node: task.orchestration.nodeId,
										depth: task.orchestration.depth
									}) })] })
								]
							}),
							task.result === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ResultSummary, {
								result: task.result,
								t
							}),
							task.distribution === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DistributionSummary, {
								distribution: task.distribution,
								t
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkerList, {
								label: taskWorkerLabel,
								scope: task.title,
								workers: taskWorkers,
								t
							}),
							task.masterPlan === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: TaskDispatcherAction_module_css_default.noPlan,
								children: t(task.distribution !== void 0 ? "task.noPlan.distributed" : scope === "macro" ? "task.noPlan.macro" : scope === "node-local" ? "task.noPlan.node" : "task.noPlan")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlanBody, {
								childTasks,
								childTasksByParent,
								plan: task.masterPlan,
								scope,
								task,
								taskTitles,
								t
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(HostSchedulerSummary, {
								childTasks,
								t
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
			const rootTasks = (0, react.useMemo)(() => topLevelTasks(tasks), [tasks]);
			const orderedTasks = (0, react.useMemo)(() => [...rootTasks].sort((left, right) => {
				if (left.status === "running" !== (right.status === "running")) return left.status === "running" ? -1 : 1;
				return right.updatedAt - left.updatedAt;
			}), [rootTasks]);
			const taskTitles = (0, react.useMemo)(() => new Map(tasks.map((task) => [task.taskId, task.title])), [tasks]);
			const childTasksByParent = (0, react.useMemo)(() => {
				const byParent = /* @__PURE__ */ new Map();
				for (const task of tasks) {
					const parentTaskId = task.orchestration?.parentTaskId;
					if (parentTaskId === void 0) continue;
					const childTasks = byParent.get(parentTaskId) ?? [];
					childTasks.push(task);
					byParent.set(parentTaskId, childTasks);
				}
				return byParent;
			}, [tasks]);
			const summary = headerSummary(state, t);
			const runningTasks = rootTasks.filter((task) => task.status === "running");
			const latestTerminal = newestTask(rootTasks);
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
						childTasks: childTasksByParent.get(task.taskId) ?? [],
						childTasksByParent,
						nested: false,
						parentTitle: task.orchestration === void 0 ? void 0 : taskTitles.get(task.orchestration.parentTaskId),
						taskTitles,
						t
					}, task.taskId))
				})]
			})] });
		}
		//#endregion
		//#region \0dsh-task-dispatcher-css:src/client/TaskDispatcherSettingsTab.module.css.mjs
		const css = ".OewtXG_page{min-width:0;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px;display:flex}.OewtXG_page h2,.OewtXG_page h4,.OewtXG_page p{margin:0}.OewtXG_page h2{font-size:18px;font-weight:600}.OewtXG_page h4{font-size:14px;font-weight:600}.OewtXG_pageHead{justify-content:space-between;align-items:flex-start;gap:16px;display:flex}.OewtXG_pageHead>div{gap:5px;min-width:0;display:grid}.OewtXG_pageHead p,.OewtXG_sectionIntro{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.OewtXG_status,.OewtXG_empty{color:var(--dsw-alias-label-tertiary);font-size:13px}.OewtXG_notice{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;align-items:flex-start;gap:10px;padding:11px 12px;display:flex}.OewtXG_notice>div{gap:3px;min-width:0;display:grid}.OewtXG_notice strong{font-size:13px}.OewtXG_notice p{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;font-size:12px;line-height:1.5}.OewtXG_notice[data-tone=error]{border-color:color-mix(in srgb, var(--dsw-alias-label-error) 40%, transparent)}.OewtXG_notice[data-tone=restart]{background:var(--dsw-alias-bg-module-platform)}.OewtXG_form{flex-direction:column;gap:14px;min-width:0;display:flex}.OewtXG_sectionCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;min-width:0;margin:0;padding:14px}.OewtXG_sectionCard>legend{padding:0 6px;font-size:15px;font-weight:600}.OewtXG_sectionCard>*+*{margin-top:12px}.OewtXG_grid2,.OewtXG_grid3{align-items:start;gap:12px;display:grid}.OewtXG_grid2{grid-template-columns:repeat(2,minmax(0,1fr))}.OewtXG_grid3{grid-template-columns:repeat(3,minmax(0,1fr))}.OewtXG_field{flex-direction:column;gap:5px;min-width:0;display:flex}.OewtXG_label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500}.OewtXG_input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);width:100%;min-width:0;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;padding:7px 9px;font-size:13px;line-height:1.45}textarea.OewtXG_input{resize:vertical}.OewtXG_input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.OewtXG_input[aria-invalid=true]{border-color:var(--dsw-alias-label-error)}.OewtXG_input:disabled{opacity:.58;cursor:not-allowed}.OewtXG_hint,.OewtXG_validation{overflow-wrap:anywhere;min-height:16px;font-size:11px;line-height:1.45}.OewtXG_hint{color:var(--dsw-alias-label-tertiary)}.OewtXG_validation{color:var(--dsw-alias-label-error)}.OewtXG_check{cursor:pointer;border-radius:8px;align-items:flex-start;gap:9px;padding:8px 0;display:flex}.OewtXG_check input{margin-top:3px}.OewtXG_check span{gap:3px;display:grid}.OewtXG_check strong{font-size:13px}.OewtXG_check small{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.45}.OewtXG_lanes,.OewtXG_criteria,.OewtXG_mappings{flex-direction:column;gap:10px;display:flex}.OewtXG_laneCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;min-width:0;overflow:clip}.OewtXG_laneSummary{cursor:pointer;justify-content:space-between;align-items:center;gap:10px;padding:11px 12px;font-size:13px;font-weight:600;display:flex}.OewtXG_laneSummary>span:first-child{overflow-wrap:anywhere;min-width:0}.OewtXG_laneSummary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.OewtXG_laneBody{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:12px;padding:14px;display:flex}.OewtXG_route,.OewtXG_criterion{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;min-width:0;margin:0;padding:10px}.OewtXG_route>legend,.OewtXG_criterion>legend{padding:0 5px;font-size:12px;font-weight:600}.OewtXG_subhead{justify-content:space-between;align-items:center;gap:12px;display:flex}.OewtXG_subhead>div{gap:4px;min-width:0;display:grid}.OewtXG_dangerRow{justify-content:flex-end;display:flex}.OewtXG_addLane,.OewtXG_addRow{grid-template-columns:max-content minmax(120px,1fr) max-content;align-items:center;gap:8px;display:grid}.OewtXG_addLane>label,.OewtXG_addRow>label{font-size:12px;font-weight:500}.OewtXG_addLane>p{grid-column:2/-1}.OewtXG_mapping{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;grid-template-columns:minmax(100px,.7fr) minmax(180px,1.3fr) max-content;align-items:end;gap:8px;padding:10px;display:grid}.OewtXG_mapping>button{margin-bottom:21px}.OewtXG_advanced,.OewtXG_yaml{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:10px 12px}.OewtXG_advanced>summary,.OewtXG_yaml>summary{cursor:pointer;font-size:13px;font-weight:600}.OewtXG_advanced>div{margin-top:12px}.OewtXG_yaml p{color:var(--dsw-alias-label-tertiary);margin-top:8px;font-size:12px;line-height:1.5}.OewtXG_yaml code{background:var(--dsw-alias-bg-layer-3);border-radius:7px;margin-top:8px;padding:8px;display:block}.OewtXG_footer{z-index:2;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0;display:flex;position:sticky;bottom:-24px}.OewtXG_footerStatus{min-width:0;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;flex:1;font-size:12px}@media (width<=680px){.OewtXG_pageHead,.OewtXG_subhead{flex-direction:column;align-items:stretch}.OewtXG_grid2,.OewtXG_grid3,.OewtXG_mapping,.OewtXG_addLane,.OewtXG_addRow{grid-template-columns:minmax(0,1fr)}.OewtXG_mapping>button{justify-self:start;margin-bottom:0}.OewtXG_addLane>p{grid-column:auto}.OewtXG_footer{flex-wrap:wrap;bottom:-24px}.OewtXG_footerStatus{flex-basis:100%}}@media (prefers-reduced-motion:reduce){.OewtXG_laneCard,.OewtXG_input{scroll-behavior:auto}}";
		const tagId = "dsh-task-dispatcher/TaskDispatcherSettingsTab.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-task-dispatcher";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var TaskDispatcherSettingsTab_module_css_default = {
			"addLane": "OewtXG_addLane",
			"addRow": "OewtXG_addRow",
			"advanced": "OewtXG_advanced",
			"check": "OewtXG_check",
			"criteria": "OewtXG_criteria",
			"criterion": "OewtXG_criterion",
			"dangerRow": "OewtXG_dangerRow",
			"empty": "OewtXG_empty",
			"field": "OewtXG_field",
			"footer": "OewtXG_footer",
			"footerStatus": "OewtXG_footerStatus",
			"form": "OewtXG_form",
			"grid2": "OewtXG_grid2",
			"grid3": "OewtXG_grid3",
			"hint": "OewtXG_hint",
			"input": "OewtXG_input",
			"label": "OewtXG_label",
			"laneBody": "OewtXG_laneBody",
			"laneCard": "OewtXG_laneCard",
			"laneSummary": "OewtXG_laneSummary",
			"lanes": "OewtXG_lanes",
			"mapping": "OewtXG_mapping",
			"mappings": "OewtXG_mappings",
			"notice": "OewtXG_notice",
			"page": "OewtXG_page",
			"pageHead": "OewtXG_pageHead",
			"route": "OewtXG_route",
			"sectionCard": "OewtXG_sectionCard",
			"sectionIntro": "OewtXG_sectionIntro",
			"status": "OewtXG_status",
			"subhead": "OewtXG_subhead",
			"validation": "OewtXG_validation",
			"yaml": "OewtXG_yaml"
		};
		//#endregion
		//#region src/client/TaskDispatcherSettingsTab.tsx
		/** Non-technical settings page for the complete Task Dispatcher policy. */
		function validationText(t, code) {
			if (code === void 0) return void 0;
			return t(`settings.validation.${code}`);
		}
		function Field(props) {
			const descriptionId = `${props.id}-description`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: TaskDispatcherSettingsTab_module_css_default.field,
				"data-invalid": props.error === void 0 ? void 0 : "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						className: TaskDispatcherSettingsTab_module_css_default.label,
						htmlFor: props.id,
						children: props.label
					}),
					props.children,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						id: descriptionId,
						className: props.error === void 0 ? TaskDispatcherSettingsTab_module_css_default.hint : TaskDispatcherSettingsTab_module_css_default.validation,
						children: props.error ?? props.hint
					})
				]
			});
		}
		function TextField(props) {
			const shared = {
				id: props.id,
				className: TaskDispatcherSettingsTab_module_css_default.input,
				value: props.value,
				disabled: props.disabled,
				placeholder: props.placeholder,
				"aria-invalid": props.error === void 0 ? void 0 : true,
				"aria-describedby": `${props.id}-description`,
				onChange: (event) => {
					props.onChange(event.target.value);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
				id: props.id,
				label: props.label,
				hint: props.hint,
				error: props.error,
				children: props.multiline ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
					...shared,
					rows: 3
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					...shared,
					type: "text"
				})
			});
		}
		function NumberField(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
				id: props.id,
				label: props.label,
				hint: props.hint,
				error: props.error,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					id: props.id,
					className: TaskDispatcherSettingsTab_module_css_default.input,
					type: "number",
					inputMode: "numeric",
					value: Number.isFinite(props.value) ? props.value : "",
					disabled: props.disabled,
					min: props.min,
					max: props.max,
					"aria-invalid": props.error === void 0 ? void 0 : true,
					"aria-describedby": `${props.id}-description`,
					onChange: (event) => {
						props.onChange(event.target.value === "" ? NaN : Number(event.target.value));
					}
				})
			});
		}
		function SelectField(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
				id: props.id,
				label: props.label,
				hint: props.hint,
				error: props.error,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
					id: props.id,
					className: TaskDispatcherSettingsTab_module_css_default.input,
					value: props.value,
					disabled: props.disabled,
					"aria-invalid": props.error === void 0 ? void 0 : true,
					"aria-describedby": `${props.id}-description`,
					onChange: (event) => {
						props.onChange(event.target.value);
					},
					children: props.options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: option.value,
						children: option.label
					}, option.value))
				})
			});
		}
		function CheckField(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: TaskDispatcherSettingsTab_module_css_default.check,
				htmlFor: props.id,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					id: props.id,
					type: "checkbox",
					checked: props.checked,
					disabled: props.disabled,
					"aria-labelledby": `${props.id}-label`,
					"aria-describedby": `${props.id}-hint`,
					onChange: (event) => {
						props.onChange(event.target.checked);
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
					id: `${props.id}-label`,
					children: props.label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", {
					id: `${props.id}-hint`,
					children: props.hint
				})] })]
			});
		}
		function listText(values) {
			return (values ?? []).join(", ");
		}
		function parseList(value) {
			return value.split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean);
		}
		function RouteEditor(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
				className: TaskDispatcherSettingsTab_module_css_default.route,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", { children: props.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: TaskDispatcherSettingsTab_module_css_default.grid3,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
							id: `${props.id}-provider`,
							label: props.t("settings.route.provider"),
							hint: props.t("settings.route.providerHint"),
							value: props.route.provider,
							disabled: props.disabled,
							error: props.error(`${props.path}.provider`),
							onChange: (value) => {
								props.onChange((route) => {
									route.provider = value;
								});
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
							id: `${props.id}-model`,
							label: props.t("settings.route.model"),
							hint: props.t("settings.route.modelHint"),
							value: props.route.model,
							disabled: props.disabled,
							error: props.error(`${props.path}.model`),
							onChange: (value) => {
								props.onChange((route) => {
									route.model = value;
								});
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
							id: `${props.id}-tokens`,
							label: props.t("settings.route.maxTokens"),
							hint: props.t("settings.route.maxTokensHint"),
							value: props.route.maxTokens,
							min: 1,
							max: 1e6,
							disabled: props.disabled,
							error: props.error(`${props.path}.maxTokens`),
							onChange: (value) => {
								props.onChange((route) => {
									route.maxTokens = value;
								});
							}
						})
					]
				})]
			});
		}
		function laneTitle(lane, id) {
			return lane.name.trim() === "" ? id : `${lane.name} · ${id}`;
		}
		function LaneEditor(props) {
			const uid = (0, react.useId)();
			const root = `lanes.${props.id}`;
			const error = (path) => validationText(props.t, props.errors[path]);
			const setRoute = (key, update) => {
				props.edit((lane) => {
					const target = lane[key];
					if (target !== void 0) update(target);
				});
			};
			const editCriterion = (index, update) => {
				props.edit((lane) => {
					const target = lane.requiredCriteria[index];
					if (target !== void 0) update(target);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: TaskDispatcherSettingsTab_module_css_default.laneCard,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", {
					className: TaskDispatcherSettingsTab_module_css_default.laneSummary,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: laneTitle(props.lane, props.id) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: props.t(props.compositionOwned ? "settings.lane.builtIn" : "settings.lane.user") })]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: TaskDispatcherSettingsTab_module_css_default.laneBody,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: TaskDispatcherSettingsTab_module_css_default.grid2,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
									id: `${uid}-name`,
									label: props.t("settings.lane.name"),
									value: props.lane.name,
									disabled: props.disabled,
									error: error(`${root}.name`),
									onChange: (value) => {
										props.edit((lane) => {
											lane.name = value;
										});
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
									id: `${uid}-description`,
									label: props.t("settings.lane.description"),
									value: props.lane.description,
									disabled: props.disabled,
									onChange: (value) => {
										props.edit((lane) => {
											lane.description = value;
										});
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectField, {
									id: `${uid}-kind`,
									label: props.t("settings.lane.kind"),
									value: props.lane.kind,
									disabled: props.disabled,
									error: error(`${root}.kind`),
									options: [{
										value: "general",
										label: props.t("settings.lane.kind.general")
									}, {
										value: "self-improvement",
										label: props.t("settings.lane.kind.selfImprovement")
									}],
									onChange: (value) => {
										props.edit((lane) => {
											lane.kind = value;
										});
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectField, {
									id: `${uid}-transport`,
									label: props.t("settings.lane.transport"),
									value: props.lane.transport,
									disabled: props.disabled,
									options: [{
										value: "spawn",
										label: props.t("settings.lane.transport.spawn")
									}, {
										value: "fork",
										label: props.t("settings.lane.transport.fork")
									}],
									onChange: (value) => {
										props.edit((lane) => {
											lane.transport = value;
										});
									}
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: props.t("settings.lane.models") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RouteEditor, {
							id: `${uid}-executor`,
							title: props.t("settings.route.executor"),
							route: props.lane.executor,
							path: `${root}.executor`,
							disabled: props.disabled,
							t: props.t,
							error,
							onChange: (update) => {
								setRoute("executor", update);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RouteEditor, {
							id: `${uid}-verifier`,
							title: props.t("settings.route.verifier"),
							route: props.lane.verifier,
							path: `${root}.verifier`,
							disabled: props.disabled,
							t: props.t,
							error,
							onChange: (update) => {
								setRoute("verifier", update);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckField, {
							id: `${uid}-planner-enabled`,
							label: props.t("settings.route.plannerEnabled"),
							hint: props.t(props.baseLane?.planner === void 0 ? "settings.route.plannerEnabledHint" : "settings.route.plannerRequiredHint"),
							checked: props.lane.planner !== void 0,
							disabled: props.disabled || props.baseLane?.planner !== void 0,
							onChange: (checked) => {
								props.edit((lane) => {
									if (checked) lane.planner = {
										provider: lane.verifier.provider,
										model: lane.verifier.model,
										maxTokens: lane.verifier.maxTokens
									};
									else delete lane.planner;
								});
							}
						}),
						props.lane.planner === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RouteEditor, {
							id: `${uid}-planner`,
							title: props.t("settings.route.planner"),
							route: props.lane.planner,
							path: `${root}.planner`,
							disabled: props.disabled,
							t: props.t,
							error,
							onChange: (update) => {
								setRoute("planner", update);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: props.t("settings.lane.execution") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: TaskDispatcherSettingsTab_module_css_default.grid3,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectField, {
									id: `${uid}-execution-mode`,
									label: props.t("settings.lane.executionMode"),
									value: props.lane.execution.mode,
									disabled: props.disabled,
									error: error(`${root}.execution.mode`),
									options: [{
										value: "local",
										label: props.t("settings.lane.execution.local")
									}, {
										value: "distributed",
										label: props.t("settings.lane.execution.distributed")
									}],
									onChange: (value) => {
										props.edit((lane) => {
											lane.execution.mode = value;
										});
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
									id: `${uid}-pool`,
									label: props.t("settings.distribution.pool"),
									value: props.lane.execution.pool,
									disabled: props.disabled || props.lane.execution.mode === "local",
									error: error(`${root}.execution.pool`),
									onChange: (value) => {
										props.edit((lane) => {
											lane.execution.pool = value;
										});
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
									id: `${uid}-workspace-ref`,
									label: props.t("settings.distribution.workspaceRef"),
									value: props.lane.execution.workspaceRef,
									disabled: props.disabled || props.lane.execution.mode === "local",
									error: error(`${root}.execution.workspaceRef`),
									onChange: (value) => {
										props.edit((lane) => {
											lane.execution.workspaceRef = value;
										});
									}
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: props.t("settings.orchestration.title") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckField, {
							id: `${uid}-orchestration-enabled`,
							label: props.t("settings.orchestration.enabled"),
							hint: props.t("settings.orchestration.enabledHint"),
							checked: props.lane.orchestration.enabled,
							disabled: props.disabled,
							onChange: (checked) => {
								props.edit((lane) => {
									lane.orchestration.enabled = checked;
								});
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: TaskDispatcherSettingsTab_module_css_default.grid3,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
									id: `${uid}-orchestration-child-lane`,
									label: props.t("settings.orchestration.childLane"),
									value: props.lane.orchestration.childLane,
									disabled: props.disabled || !props.lane.orchestration.enabled,
									error: error(`${root}.orchestration.childLane`),
									onChange: (value) => {
										props.edit((lane) => {
											lane.orchestration.childLane = value;
										});
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectField, {
									id: `${uid}-orchestration-workspace-mode`,
									label: props.t("settings.orchestration.workspaceMode"),
									value: props.lane.orchestration.workspaceMode,
									disabled: props.disabled || !props.lane.orchestration.enabled,
									error: error(`${root}.orchestration.enabled`),
									options: [{
										value: "read-shared",
										label: props.t("settings.orchestration.readShared")
									}],
									onChange: (value) => {
										props.edit((lane) => {
											lane.orchestration.workspaceMode = value;
										});
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectField, {
									id: `${uid}-orchestration-failure-mode`,
									label: props.t("settings.orchestration.failureMode"),
									value: props.lane.orchestration.failureMode,
									disabled: props.disabled || !props.lane.orchestration.enabled,
									options: [{
										value: "fail-fast",
										label: props.t("settings.orchestration.failFast")
									}, {
										value: "collect",
										label: props.t("settings.orchestration.collect")
									}],
									onChange: (value) => {
										props.edit((lane) => {
											lane.orchestration.failureMode = value;
										});
									}
								}),
								[
									[
										"maxDepth",
										"settings.orchestration.maxDepth",
										1,
										4
									],
									[
										"maxTaskNodes",
										"settings.orchestration.maxTaskNodes",
										1,
										32
									],
									[
										"maxChildrenPerNode",
										"settings.orchestration.maxChildrenPerNode",
										1,
										8
									],
									[
										"maxConcurrentNodes",
										"settings.orchestration.maxConcurrentNodes",
										1,
										8
									],
									[
										"maxTotalModelRuns",
										"settings.orchestration.maxTotalModelRuns",
										1,
										128
									],
									[
										"maxResultBytes",
										"settings.orchestration.maxResultBytes",
										4096,
										1048576
									]
								].map(([key, label, min, max]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
									id: `${uid}-orchestration-${key}`,
									label: props.t(label),
									value: props.lane.orchestration[key],
									min,
									max,
									disabled: props.disabled || !props.lane.orchestration.enabled,
									error: error(`${root}.orchestration.${key}`),
									onChange: (value) => {
										props.edit((lane) => {
											lane.orchestration[key] = value;
										});
									}
								}, key))
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: TaskDispatcherSettingsTab_module_css_default.hint,
							children: props.t("settings.orchestration.safetyHint")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: props.t("settings.lane.tools") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: TaskDispatcherSettingsTab_module_css_default.grid3,
							children: [
								"executorTools",
								"plannerTools",
								"verifierTools"
							].map((key) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
								id: `${uid}-${key}`,
								label: props.t(`settings.lane.${key}`),
								hint: props.t("settings.lane.toolsHint"),
								value: listText(props.lane[key]),
								disabled: props.disabled || key === "plannerTools" && props.lane.planner === void 0,
								error: error(`${root}.${key}`),
								onChange: (value) => {
									props.edit((lane) => {
										lane[key] = parseList(value);
									});
								}
							}, key))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: props.t("settings.lane.budgets") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: TaskDispatcherSettingsTab_module_css_default.grid3,
							children: [
								[
									"maxPlanSteps",
									"settings.lane.maxPlanSteps",
									1,
									8
								],
								[
									"maxPlanPatches",
									"settings.lane.maxPlanPatches",
									0,
									8
								],
								[
									"maxTotalChildRuns",
									"settings.lane.maxTotalChildRuns",
									5,
									32
								],
								[
									"taskTimeoutMs",
									"settings.lane.taskTimeoutMs",
									1e3,
									216e5
								],
								[
									"maxAttempts",
									"settings.lane.maxAttempts",
									1,
									3
								],
								[
									"childTimeoutMs",
									"settings.lane.childTimeoutMs",
									1e3,
									36e5
								]
							].map(([key, label, min, max]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
								id: `${uid}-${key}`,
								label: props.t(label),
								value: props.lane[key],
								min,
								max,
								disabled: props.disabled,
								error: error(`${root}.${key}`),
								onChange: (value) => {
									props.edit((lane) => {
										lane[key] = value;
									});
								}
							}, key))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckField, {
							id: `${uid}-retry`,
							label: props.t("settings.lane.retryOnRevise"),
							hint: props.t("settings.lane.retryOnReviseHint"),
							checked: props.lane.retryOnRevise,
							disabled: props.disabled,
							onChange: (checked) => {
								props.edit((lane) => {
									lane.retryOnRevise = checked;
								});
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: TaskDispatcherSettingsTab_module_css_default.subhead,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: props.t("settings.criteria.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "outline",
								disabled: props.disabled || props.lane.requiredCriteria.length >= 24,
								onClick: () => {
									props.edit((lane) => {
										lane.requiredCriteria.push({
											id: `criterion-${lane.requiredCriteria.length + 1}`,
											text: ""
										});
									});
								},
								children: props.t("settings.criteria.add")
							})]
						}),
						props.lane.requiredCriteria.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: TaskDispatcherSettingsTab_module_css_default.validation,
							role: "alert",
							children: error(`${root}.requiredCriteria`)
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: TaskDispatcherSettingsTab_module_css_default.criteria,
							children: props.lane.requiredCriteria.map((criterion, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
								className: TaskDispatcherSettingsTab_module_css_default.criterion,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", { children: props.t("settings.criteria.item", { index: index + 1 }) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: TaskDispatcherSettingsTab_module_css_default.grid2,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
											id: `${uid}-criterion-${index}-id`,
											label: props.t("settings.criteria.id"),
											value: criterion.id,
											disabled: props.disabled,
											error: error(`${root}.requiredCriteria.${index}.id`),
											onChange: (value) => {
												editCriterion(index, (item) => {
													item.id = value;
												});
											}
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
											id: `${uid}-criterion-${index}-text`,
											label: props.t("settings.criteria.text"),
											value: criterion.text,
											disabled: props.disabled,
											error: error(`${root}.requiredCriteria.${index}.text`),
											onChange: (value) => {
												editCriterion(index, (item) => {
													item.text = value;
												});
											}
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: "ghost",
										disabled: props.disabled,
										"aria-label": props.t("settings.criteria.removeAria", { id: criterion.id || index + 1 }),
										onClick: () => {
											props.edit((lane) => {
												lane.requiredCriteria.splice(index, 1);
											});
										},
										children: props.t("settings.remove")
									})
								]
							}, index))
						}),
						!props.compositionOwned && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: TaskDispatcherSettingsTab_module_css_default.dangerRow,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								disabled: props.disabled,
								onClick: props.remove,
								children: props.t("settings.lane.remove")
							})
						})
					]
				})]
			});
		}
		function DistributionEditor(props) {
			const uid = (0, react.useId)();
			const distribution = props.config.distribution;
			const error = (path) => validationText(props.t, props.errors[path]);
			const [mappingRef, setMappingRef] = (0, react.useState)("");
			const mappingEntries = Object.entries(distribution.workspaceMappings);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
				className: TaskDispatcherSettingsTab_module_css_default.sectionCard,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", { children: props.t("settings.distribution.title") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: TaskDispatcherSettingsTab_module_css_default.sectionIntro,
						children: props.t("settings.distribution.intro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherSettingsTab_module_css_default.grid2,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectField, {
								id: `${uid}-role`,
								label: props.t("settings.distribution.role"),
								value: distribution.role,
								disabled: props.disabled,
								options: [
									{
										value: "disabled",
										label: props.t("settings.distribution.role.disabled")
									},
									{
										value: "coordinator",
										label: props.t("settings.distribution.role.coordinator")
									},
									{
										value: "worker",
										label: props.t("settings.distribution.role.worker")
									},
									{
										value: "hybrid",
										label: props.t("settings.distribution.role.hybrid")
									}
								],
								onChange: (value) => {
									props.edit((config) => {
										config.distribution.role = value;
									});
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
								id: `${uid}-database-env`,
								label: props.t("settings.distribution.databaseUrlEnv"),
								hint: props.t("settings.distribution.databaseUrlEnvHint"),
								value: distribution.databaseUrlEnv,
								disabled: props.disabled || distribution.role === "disabled",
								error: error("distribution.databaseUrlEnv"),
								placeholder: "DSH_DISPATCHER_DATABASE_URL",
								onChange: (value) => {
									props.edit((config) => {
										config.distribution.databaseUrlEnv = value;
									});
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
								id: `${uid}-scope`,
								label: props.t("settings.distribution.scopeId"),
								hint: props.t("settings.distribution.scopeIdHint"),
								value: distribution.scopeId,
								disabled: props.disabled || distribution.role === "disabled",
								error: error("distribution.scopeId"),
								onChange: (value) => {
									props.edit((config) => {
										config.distribution.scopeId = value;
									});
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
								id: `${uid}-pools`,
								label: props.t("settings.distribution.pools"),
								hint: props.t("settings.listHint"),
								value: listText(distribution.pools),
								disabled: props.disabled || distribution.role === "disabled",
								error: error("distribution.pools"),
								onChange: (value) => {
									props.edit((config) => {
										config.distribution.pools = parseList(value);
									});
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
								id: `${uid}-worker-id`,
								label: props.t("settings.distribution.workerId"),
								hint: props.t("settings.distribution.workerIdHint"),
								value: distribution.workerId,
								disabled: props.disabled || !["worker", "hybrid"].includes(distribution.role),
								error: error("distribution.workerId"),
								onChange: (value) => {
									props.edit((config) => {
										config.distribution.workerId = value;
									});
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
								id: `${uid}-worker-preset`,
								label: props.t("settings.distribution.workerAgentPreset"),
								hint: props.t("settings.distribution.workerAgentPresetHint"),
								value: distribution.workerAgentPreset,
								disabled: props.disabled || !["worker", "hybrid"].includes(distribution.role),
								error: error("distribution.workerAgentPreset"),
								onChange: (value) => {
									props.edit((config) => {
										config.distribution.workerAgentPreset = value;
									});
								}
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: TaskDispatcherSettingsTab_module_css_default.advanced,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: props.t("settings.distribution.advanced") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: TaskDispatcherSettingsTab_module_css_default.grid3,
							children: [
								[
									"concurrency",
									"settings.distribution.concurrency",
									1,
									16
								],
								[
									"leaseMs",
									"settings.distribution.leaseMs",
									15e3,
									3e5
								],
								[
									"heartbeatMs",
									"settings.distribution.heartbeatMs",
									1e3,
									6e4
								],
								[
									"pollMs",
									"settings.distribution.pollMs",
									100,
									3e4
								],
								[
									"maxDeliveryAttempts",
									"settings.distribution.maxDeliveryAttempts",
									1,
									10
								]
							].map(([key, label, min, max]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
								id: `${uid}-${key}`,
								label: props.t(label),
								value: distribution[key],
								min,
								max,
								disabled: props.disabled || distribution.role === "disabled",
								error: error(`distribution.${key}`),
								onChange: (value) => {
									props.edit((config) => {
										config.distribution[key] = value;
									});
								}
							}, key))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: TaskDispatcherSettingsTab_module_css_default.subhead,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: props.t("settings.mapping.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: TaskDispatcherSettingsTab_module_css_default.hint,
							children: props.t("settings.mapping.intro")
						})] })
					}),
					mappingEntries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: TaskDispatcherSettingsTab_module_css_default.empty,
						children: props.t("settings.mapping.empty")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: TaskDispatcherSettingsTab_module_css_default.mappings,
						children: mappingEntries.map(([ref, pathValue], index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: TaskDispatcherSettingsTab_module_css_default.mapping,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
									id: `${uid}-mapping-${index}-ref`,
									label: props.t("settings.mapping.ref"),
									value: ref,
									disabled: props.disabled || Object.hasOwn(props.base.distribution.workspaceMappings, ref),
									error: error(`distribution.workspaceMappings.${ref}.ref`),
									onChange: (value) => {
										props.edit((config) => {
											const mappings = config.distribution.workspaceMappings;
											if (value !== ref && Object.hasOwn(mappings, value)) return;
											config.distribution.workspaceMappings = Object.fromEntries(Object.entries(mappings).map(([key, path]) => key === ref ? [value, path] : [key, path]));
										});
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
									id: `${uid}-mapping-${index}-path`,
									label: props.t("settings.mapping.path"),
									hint: props.t("settings.mapping.pathHint"),
									value: pathValue,
									disabled: props.disabled,
									error: error(`distribution.workspaceMappings.${ref}.path`),
									onChange: (value) => {
										props.edit((config) => {
											config.distribution.workspaceMappings[ref] = value;
										});
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "ghost",
									disabled: props.disabled || Object.hasOwn(props.base.distribution.workspaceMappings, ref),
									"aria-label": props.t("settings.mapping.removeAria", { ref }),
									onClick: () => {
										props.edit((config) => {
											delete config.distribution.workspaceMappings[ref];
										});
									},
									children: props.t("settings.remove")
								})
							]
						}, index))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherSettingsTab_module_css_default.addRow,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								htmlFor: `${uid}-new-mapping`,
								children: props.t("settings.mapping.newRef")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								id: `${uid}-new-mapping`,
								className: TaskDispatcherSettingsTab_module_css_default.input,
								value: mappingRef,
								disabled: props.disabled,
								onChange: (event) => {
									setMappingRef(event.target.value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "outline",
								disabled: props.disabled || mappingRef.trim() === "" || distribution.workspaceMappings[mappingRef.trim()] !== void 0,
								onClick: () => {
									const ref = mappingRef.trim();
									props.edit((config) => {
										config.distribution.workspaceMappings[ref] = "";
									});
									setMappingRef("");
								},
								children: props.t("settings.mapping.add")
							})
						]
					})
				]
			});
		}
		function GlobalEditor(props) {
			const uid = (0, react.useId)();
			const error = (path) => validationText(props.t, props.errors[path]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
				className: TaskDispatcherSettingsTab_module_css_default.sectionCard,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", { children: props.t("settings.global.title") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckField, {
						id: `${uid}-background`,
						label: props.t("settings.global.background"),
						hint: props.t("settings.global.backgroundHint"),
						checked: props.config.defaultRunInBackground,
						disabled: props.disabled,
						onChange: (checked) => {
							props.edit((config) => {
								config.defaultRunInBackground = checked;
							});
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherSettingsTab_module_css_default.grid3,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
								id: `${uid}-failures`,
								label: props.t("settings.global.failures"),
								value: props.config.maxConsecutiveFailures,
								min: 1,
								max: 20,
								disabled: props.disabled,
								error: error("maxConsecutiveFailures"),
								onChange: (value) => {
									props.edit((config) => {
										config.maxConsecutiveFailures = value;
									});
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
								id: `${uid}-cooldown`,
								label: props.t("settings.global.cooldown"),
								value: props.config.circuitCooldownMs,
								min: 1e3,
								max: 864e5,
								disabled: props.disabled,
								error: error("circuitCooldownMs"),
								onChange: (value) => {
									props.edit((config) => {
										config.circuitCooldownMs = value;
									});
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
								id: `${uid}-output`,
								label: props.t("settings.global.outputLimit"),
								value: props.config.jobOutputLimitBytes,
								min: 4096,
								max: 1048576,
								disabled: props.disabled,
								error: error("jobOutputLimitBytes"),
								onChange: (value) => {
									props.edit((config) => {
										config.jobOutputLimitBytes = value;
									});
								}
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherSettingsTab_module_css_default.grid2,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
							id: `${uid}-live-root`,
							label: props.t("settings.global.liveRoot"),
							hint: props.t("settings.global.liveRootHint"),
							value: props.config.liveRoot,
							disabled: props.disabled,
							error: error("liveRoot"),
							onChange: (value) => {
								props.edit((config) => {
									config.liveRoot = value;
								});
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
							id: `${uid}-staging-root`,
							label: props.t("settings.global.stagingRoot"),
							hint: props.t("settings.global.stagingRootHint"),
							value: props.config.stagingRoot,
							disabled: props.disabled,
							error: error("stagingRoot"),
							onChange: (value) => {
								props.edit((config) => {
									config.stagingRoot = value;
								});
							}
						})]
					})
				]
			});
		}
		/** Render the Task Dispatcher page inside the shared Plugins settings section. */
		function TaskDispatcherSettingsTab(props) {
			const { t, controller } = props;
			const state = props.useTaskDispatcherConfig((value) => value);
			const [newLaneId, setNewLaneId] = (0, react.useState)("");
			const laneIdValid = /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(newLaneId);
			if (state.phase === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: TaskDispatcherSettingsTab_module_css_default.page,
				"aria-labelledby": "task-dispatcher-settings-title",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					id: "task-dispatcher-settings-title",
					children: t("settings.title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: TaskDispatcherSettingsTab_module_css_default.status,
					role: "status",
					children: t("settings.loading")
				})]
			});
			if (state.snapshot === void 0 || state.draft === void 0 || state.phase === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: TaskDispatcherSettingsTab_module_css_default.page,
				"aria-labelledby": "task-dispatcher-settings-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						id: "task-dispatcher-settings-title",
						children: t("settings.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherSettingsTab_module_css_default.notice,
						"data-tone": "error",
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("settings.error") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: state.error })] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						onClick: () => {
							controller.load();
						},
						children: t("settings.retry")
					})
				]
			});
			const snapshot = state.snapshot;
			const disabled = state.saving || !snapshot.available || !snapshot.writable;
			const validationCount = Object.keys(state.errors).length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: TaskDispatcherSettingsTab_module_css_default.page,
				"aria-labelledby": "task-dispatcher-settings-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherSettingsTab_module_css_default.pageHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							id: "task-dispatcher-settings-title",
							children: t("settings.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settings.intro") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
							active: snapshot.available,
							children: t(snapshot.available ? "settings.available" : "settings.unavailable")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherSettingsTab_module_css_default.notice,
						"data-tone": "restart",
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "warning" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("settings.restart.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settings.restart.body") })] })]
					}),
					!snapshot.available && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherSettingsTab_module_css_default.notice,
						"data-tone": "error",
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("settings.unavailable") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settings.unavailableHint") })] })]
					}),
					!snapshot.writable && snapshot.available && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherSettingsTab_module_css_default.notice,
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "warning" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("settings.readOnly") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settings.readOnlyHint") })] })]
					}),
					snapshot.invalid !== void 0 && !state.resetToBase && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherSettingsTab_module_css_default.notice,
						"data-tone": "error",
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("settings.invalidStored") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: snapshot.invalid })] })]
					}),
					state.conflicted && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: TaskDispatcherSettingsTab_module_css_default.notice,
						"data-tone": "error",
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "warning" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("settings.conflict") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settings.conflictHint") })] })]
					}),
					state.error !== void 0 && snapshot.invalid === void 0 && !state.conflicted && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: TaskDispatcherSettingsTab_module_css_default.validation,
						role: "alert",
						children: state.error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: TaskDispatcherSettingsTab_module_css_default.form,
						onSubmit: (event) => {
							event.preventDefault();
							controller.save();
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GlobalEditor, {
								config: state.draft,
								disabled,
								t,
								errors: state.errors,
								edit: (update) => {
									controller.edit(update);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
								className: TaskDispatcherSettingsTab_module_css_default.sectionCard,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", { children: t("settings.lanes.title") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: TaskDispatcherSettingsTab_module_css_default.sectionIntro,
										children: t("settings.lanes.intro")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: TaskDispatcherSettingsTab_module_css_default.lanes,
										children: Object.entries(state.draft.lanes).map(([id, lane]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LaneEditor, {
											id,
											lane,
											baseLane: snapshot.base.lanes[id],
											compositionOwned: id in snapshot.base.lanes,
											disabled,
											t,
											errors: state.errors,
											edit: (update) => {
												controller.edit((config) => {
													const target = config.lanes[id];
													if (target !== void 0) update(target);
												});
											},
											remove: () => {
												controller.removeLane(id);
											}
										}, id))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: TaskDispatcherSettingsTab_module_css_default.addLane,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
												htmlFor: "task-dispatcher-new-lane",
												children: t("settings.lane.newId")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												id: "task-dispatcher-new-lane",
												className: TaskDispatcherSettingsTab_module_css_default.input,
												value: newLaneId,
												disabled,
												"aria-invalid": newLaneId !== "" && (!laneIdValid || state.draft.lanes[newLaneId] !== void 0) || void 0,
												"aria-describedby": "task-dispatcher-new-lane-hint",
												onChange: (event) => {
													setNewLaneId(event.target.value);
												}
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												size: "sm",
												variant: "outline",
												disabled: disabled || !laneIdValid || state.draft.lanes[newLaneId] !== void 0 || Object.keys(state.draft.lanes).length >= 16,
												onClick: () => {
													if (controller.addLane(newLaneId) !== void 0) setNewLaneId("");
												},
												children: t("settings.lane.add")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												id: "task-dispatcher-new-lane-hint",
												className: TaskDispatcherSettingsTab_module_css_default.hint,
												children: t("settings.lane.idHint")
											})
										]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DistributionEditor, {
								config: state.draft,
								base: snapshot.base,
								disabled,
								t,
								errors: state.errors,
								edit: (update) => {
									controller.edit(update);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
								className: TaskDispatcherSettingsTab_module_css_default.yaml,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("settings.yaml.title") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settings.yaml.body") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "dsh-task-dispatcher:" })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: TaskDispatcherSettingsTab_module_css_default.footer,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: TaskDispatcherSettingsTab_module_css_default.footerStatus,
										"aria-live": "polite",
										children: validationCount > 0 ? t("settings.validationSummary", { count: validationCount }) : state.dirty ? t("settings.unsaved") : t("settings.saved")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "ghost",
										disabled: disabled || state.saving,
										onClick: () => {
											controller.reset();
										},
										children: t("settings.reset")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "outline",
										disabled: disabled || !state.dirty,
										onClick: () => {
											controller.discard();
										},
										children: t("settings.discard")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "primary",
										disabled: disabled || !state.dirty || validationCount > 0,
										"aria-busy": state.saving,
										type: "submit",
										children: t(state.saving ? "settings.saving" : "settings.save")
									})
								]
							})
						]
					})
				]
			});
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
			"task.orchestration.workerScope": "Worker 节点 · 仅当前节点范围",
			"task.orchestration.parent": "父任务：{parent} · 节点 {node} · 深度 {depth}",
			"orchestration.scheduler.title": "Host Ready Queue",
			"orchestration.scheduler.summary.one": "{count} 个本地任务节点运行中",
			"orchestration.scheduler.summary.other": "{count} 个本地任务节点运行中",
			"orchestration.scheduler.aria": "Host Ready Queue：{summary}",
			"orchestration.scheduler.hint": "这里只展示 Host 已报告为运行中的本地只读节点任务；任务可能正在执行、验收或等待其递归子节点汇合。",
			"orchestration.scheduler.nodes.aria": "Host 当前报告为运行中的本地任务节点",
			"orchestration.scheduler.node.aria": "任务节点 {node}，{title}，节点内阶段：{phase}",
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
			"task.noPlan.macro": "Master Planner 尚未发布宏观 DAG；规划和审查模型仍显示在上方。",
			"task.noPlan.node": "此 Worker 节点尚未发布节点内局部流水线；节点级 Agent / 模型仍显示在上方。",
			"task.noPlan.distributed": "此分布式任务尚无可用 master plan；v1 仅持久化任务、节点、租约和最终结果。",
			"task.result": "执行结果",
			"task.result.aria": "执行结果：{status}；{verified}；{failure}；{workspace}",
			"task.result.facts.aria": "模型验收、失败类别和工作区状态",
			"task.result.modelVerified.yes": "模型已验收",
			"task.result.modelVerified.no": "未经模型验收",
			"task.result.failureClass.none": "无失败",
			"task.result.failureClass.task": "任务失败",
			"task.result.failureClass.infrastructure": "基础设施失败",
			"task.result.workspaceQuarantined.yes": "工作区已隔离",
			"task.result.workspaceQuarantined.no": "工作区未隔离",
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
			"plan.scope.macro.title": "Master Plan · 宏观 DAG",
			"plan.scope.macro.description": "契约级计划只定义节点结果、依赖和验收边界；Worker 仅接收 Host 分配的节点契约。",
			"plan.scope.node.title": "Worker 节点内执行 · 局部流水线",
			"plan.scope.node.description": "仅展示当前节点的规划、执行与验收；此 Worker 不持有父任务的完整宏观 DAG。",
			"steps.aria": "“{task}”的纵向依赖链",
			"steps.aria.macro": "“{task}”宏观 DAG 的契约节点",
			"steps.aria.node": "“{task}”Worker 节点内的局部流水线",
			"steps.empty": "计划中还没有步骤。",
			"progress.title": "工作进度",
			"progress.summary.nodes": "已完成 {done}/{total} 个节点",
			"progress.summary.steps": "已完成 {done}/{total} 个步骤",
			"progress.aria.nodes": "节点工作进度：共 {total} 个节点；已完成 {completed}；工作中 {working}；可开始 {ready}；等待中 {waiting}；失败、受阻或未完成 {failed}",
			"progress.aria.steps": "步骤工作进度：共 {total} 个步骤；已完成 {completed}；工作中 {working}；可开始 {ready}；等待中 {waiting}；失败、受阻或未完成 {failed}",
			"progress.track.aria.nodes": "计划节点状态构成分段轨",
			"progress.track.aria.steps": "计划步骤状态构成分段轨",
			"progress.track.group.nodes": "{status}：{count} 个节点",
			"progress.track.group.steps": "{status}：{count} 个步骤",
			"progress.legend.aria.nodes": "节点进度状态统计",
			"progress.legend.aria.steps": "步骤进度状态统计",
			"progress.status.completed": "已完成",
			"progress.status.working": "工作中",
			"progress.status.ready": "可开始",
			"progress.status.waiting": "等待中",
			"progress.status.failed": "失败",
			"progress.status.failedGroup": "失败 / 受阻 / 未收口",
			"progress.status.blocked": "被失败依赖阻塞：{ids}",
			"progress.status.joining": "正在汇合已通过的子节点结果",
			"progress.status.unsealed": "子节点结果未在计划结束前封存",
			"progress.status.stopped": "计划结束时尚未完成",
			"progress.focus.now": "当前",
			"progress.focus.ready": "就绪",
			"progress.focus.waiting": "等待",
			"progress.focus.now.empty": "当前没有正在进行的工作",
			"progress.focus.ready.empty": "没有前置依赖均已完成的工作",
			"progress.focus.waiting.empty": "没有正在等待依赖的工作",
			"progress.hint.nodes": "“可开始”仅表示节点已发布的前置依赖均已完成；此处不包含调度准入或时间预测。",
			"progress.hint.steps": "“可开始”仅表示步骤已发布的前置依赖均已完成；此处不代表步骤已经开始，也不包含时间预测。",
			"orchestration.children.aria": "宏观节点“{step}”的 Worker 任务",
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
			"workers.master": "Master Planner / 审查模型",
			"workers.node": "节点内 Agent / 模型",
			"workers.macroStep": "宏观节点关联的 Agent / 模型",
			"workers.localStep": "局部流水线的 Agent / 模型",
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
			"worker.error": "错误：{error}",
			"settings.nav": "Task Dispatcher",
			"settings.title": "Task Dispatcher",
			"settings.intro": "用清晰的表单管理任务通道、验收模型和分布式节点。保存不会打断正在运行的任务。",
			"settings.loading": "正在读取 Task Dispatcher 设置…",
			"settings.available": "可配置",
			"settings.unavailable": "配置不可用",
			"settings.unavailableHint": "当前 Host 没有可写的 Task Dispatcher 配置服务。现有任务不会受影响。",
			"settings.error": "无法读取设置",
			"settings.retry": "重试",
			"settings.readOnly": "只读模式",
			"settings.readOnlyHint": "你可以查看当前设置，但这个 Host 不允许从浏览器保存。",
			"settings.restart.title": "保存后需要重启 DSH",
			"settings.restart.body": "新设置会在下次启动时生效；当前任务和工作节点继续使用启动时的配置。",
			"settings.invalidStored": "高级配置需要修复",
			"settings.conflict": "设置已在别处更新",
			"settings.conflictHint": "你的草稿仍在。页面已读取最新版本，请检查后再次保存。",
			"settings.unsaved": "有尚未保存的更改",
			"settings.saved": "设置已保存",
			"settings.saving": "保存中…",
			"settings.save": "保存设置",
			"settings.discard": "放弃更改",
			"settings.reset": "恢复组合默认值",
			"settings.remove": "移除",
			"settings.validationSummary": "有 {count} 处需要检查",
			"settings.listHint": "用逗号或空格分隔多个值。",
			"settings.global.title": "默认行为与安全路径",
			"settings.global.background": "默认在后台运行",
			"settings.global.backgroundHint": "任务发出后立即返回，用户可继续使用当前会话。",
			"settings.global.failures": "连续故障上限",
			"settings.global.cooldown": "故障冷却时间（毫秒）",
			"settings.global.outputLimit": "后台结果上限（字节）",
			"settings.global.liveRoot": "运行中代码路径",
			"settings.global.liveRootHint": "会修改文件的任务必须避开的绝对路径；只读任务可留空。",
			"settings.global.stagingRoot": "改进工作区路径",
			"settings.global.stagingRootHint": "自我改进任务使用的独立绝对路径，不能与运行中代码重叠。",
			"settings.lanes.title": "任务通道",
			"settings.lanes.intro": "每个通道固定执行模型、独立验收模型、工具和验收标准。内置通道可以调整但不能删除。",
			"settings.lane.builtIn": "内置",
			"settings.lane.user": "自定义",
			"settings.lane.name": "显示名称",
			"settings.lane.description": "适用任务说明",
			"settings.lane.kind": "任务类型",
			"settings.lane.kind.general": "普通任务",
			"settings.lane.kind.selfImprovement": "框架自我改进",
			"settings.lane.transport": "子会话方式",
			"settings.lane.transport.spawn": "新建隔离会话",
			"settings.lane.transport.fork": "从当前会话分叉",
			"settings.lane.models": "工作模型",
			"settings.lane.execution": "运行位置",
			"settings.lane.executionMode": "执行方式",
			"settings.lane.execution.local": "当前 DSH",
			"settings.lane.execution.distributed": "远端 Worker",
			"settings.orchestration.title": "安全子任务编排",
			"settings.orchestration.enabled": "启用 Host 托管的递归编排",
			"settings.orchestration.enabledHint": "不向模型开放原始 dispatch/subagent/workflow 工具；所有子任务由 Host 校验、计费并等待完成。",
			"settings.orchestration.childLane": "固定子任务通道 ID",
			"settings.orchestration.workspaceMode": "工作区模式",
			"settings.orchestration.readShared": "共享只读快照",
			"settings.orchestration.isolatedWrite": "隔离写入（尚未启用）",
			"settings.orchestration.failureMode": "失败处理",
			"settings.orchestration.failFast": "首次失败即停止",
			"settings.orchestration.collect": "等待并汇总全部结果",
			"settings.orchestration.maxDepth": "最大递归深度",
			"settings.orchestration.maxTaskNodes": "整棵树最多节点",
			"settings.orchestration.maxChildrenPerNode": "每个节点最多子任务",
			"settings.orchestration.maxConcurrentNodes": "最多并发节点",
			"settings.orchestration.maxTotalModelRuns": "整棵树最多模型调用",
			"settings.orchestration.maxResultBytes": "最大汇总结果字节",
			"settings.orchestration.safetyHint": "第一阶段仅支持本地只读子任务；可写并行会在隔离 worktree 和串行合并完成后开放。",
			"settings.lane.tools": "可用工具",
			"settings.lane.toolsHint": "只填写工具名称；分布式任务仅允许只读工具。",
			"settings.lane.executorTools": "执行工具",
			"settings.lane.plannerTools": "规划工具",
			"settings.lane.verifierTools": "验收工具",
			"settings.lane.budgets": "时间与尝试预算",
			"settings.lane.maxPlanSteps": "最多计划步骤",
			"settings.lane.maxPlanPatches": "最多计划调整",
			"settings.lane.maxTotalChildRuns": "最多子会话总数",
			"settings.lane.taskTimeoutMs": "整项任务时限（毫秒）",
			"settings.lane.maxAttempts": "最多执行尝试",
			"settings.lane.childTimeoutMs": "单个子会话时限（毫秒）",
			"settings.lane.retryOnRevise": "验收要求修改时重试",
			"settings.lane.retryOnReviseHint": "仅对可安全重复执行的任务开启，以免重复产生外部副作用。",
			"settings.lane.remove": "删除自定义通道",
			"settings.lane.newId": "新通道 ID",
			"settings.lane.idHint": "使用小写字母、数字、短横线或下划线，最多 64 个字符。",
			"settings.lane.add": "添加通道",
			"settings.route.executor": "执行模型",
			"settings.route.verifier": "独立验收模型",
			"settings.route.planner": "规划模型",
			"settings.route.provider": "模型提供方 ID",
			"settings.route.providerHint": "与「模型」设置中的提供方 ID 一致。",
			"settings.route.model": "模型 ID",
			"settings.route.modelHint": "模型提供方接受的准确模型名称。",
			"settings.route.maxTokens": "最大输出 token",
			"settings.route.maxTokensHint": "这个子会话最多可生成的 token 数。",
			"settings.route.plannerEnabled": "启用 master plan",
			"settings.route.plannerEnabledHint": "先生成并独立审核计划，再逐步执行和调整。",
			"settings.route.plannerRequiredHint": "这个规划模型来自内置通道，可以调整但不能关闭。",
			"settings.criteria.title": "必须满足的验收标准",
			"settings.criteria.add": "添加标准",
			"settings.criteria.item": "标准 {index}",
			"settings.criteria.id": "标准 ID",
			"settings.criteria.text": "通过条件",
			"settings.criteria.removeAria": "移除验收标准 {id}",
			"settings.distribution.title": "分布式任务分发",
			"settings.distribution.intro": "协调节点把完整只读任务放入 PostgreSQL 队列，Worker 领取后独立执行。",
			"settings.distribution.role": "此节点的角色",
			"settings.distribution.role.disabled": "关闭分布式分发",
			"settings.distribution.role.coordinator": "只分发任务",
			"settings.distribution.role.worker": "只执行任务",
			"settings.distribution.role.hybrid": "同时分发和执行",
			"settings.distribution.databaseUrlEnv": "数据库环境变量名",
			"settings.distribution.databaseUrlEnvHint": "只填写变量名，绝不要在这里粘贴数据库地址或密码。",
			"settings.distribution.scopeId": "部署隔离 ID",
			"settings.distribution.scopeIdHint": "只有相同 ID 的协调节点和 Worker 才能共享任务。",
			"settings.distribution.workerId": "Worker ID",
			"settings.distribution.workerIdHint": "留空时每次启动自动生成；生产节点建议使用稳定名称。",
			"settings.distribution.workerAgentPreset": "Worker Agent 预设",
			"settings.distribution.workerAgentPresetHint": "留空时使用 DSH 的默认 Agent 预设。",
			"settings.distribution.pools": "Worker 队列",
			"settings.distribution.pool": "目标队列",
			"settings.distribution.workspaceRef": "工作区引用",
			"settings.distribution.advanced": "连接与重试高级参数",
			"settings.distribution.concurrency": "并行任务数",
			"settings.distribution.leaseMs": "任务租约（毫秒）",
			"settings.distribution.heartbeatMs": "心跳间隔（毫秒）",
			"settings.distribution.pollMs": "空队列轮询（毫秒）",
			"settings.distribution.maxDeliveryAttempts": "最多投递次数",
			"settings.mapping.title": "Worker 工作区映射",
			"settings.mapping.intro": "把任务携带的固定引用映射到这个 Worker 上的绝对路径。",
			"settings.mapping.empty": "尚未配置工作区映射。",
			"settings.mapping.ref": "工作区引用",
			"settings.mapping.path": "本机绝对路径",
			"settings.mapping.pathHint": "路径必须已存在，并且不同 Worker 可以使用不同本机路径。",
			"settings.mapping.removeAria": "移除工作区映射 {ref}",
			"settings.mapping.newRef": "新工作区引用",
			"settings.mapping.add": "添加映射",
			"settings.yaml.title": "高级 YAML",
			"settings.yaml.body": "工具细节和完整策略也可以在设置窗口右上角的配置文件中编辑。请保留 dsh-task-dispatcher 命名空间。",
			"settings.validation.required": "此项不能为空。",
			"settings.validation.trimmed": "请删除开头或结尾的空格。",
			"settings.validation.invalid-id": "格式不正确。",
			"settings.validation.invalid-env": "请输入环境变量名，而不是数据库地址。",
			"settings.validation.range": "数值或条目数量超出允许范围。",
			"settings.validation.duplicate": "不能与同一列表中的值重复。",
			"settings.validation.absolute-path": "请输入不重叠的绝对路径。",
			"settings.validation.criteria-required": "至少需要一条验收标准。",
			"settings.validation.read-only-tools": "这种运行方式只能使用只读工具和隔离新会话。",
			"settings.validation.distribution-required": "请先启用一个分布式节点角色。",
			"settings.validation.mapping-required": "这个 Worker 缺少对应的工作区映射。",
			"settings.validation.heartbeat": "心跳间隔不能超过租约的三分之一。",
			"settings.validation.max-lanes": "最多可配置 16 个通道。",
			"settings.validation.overlap": "运行路径与改进路径不能互相包含。",
			"settings.validation.invalid-config": "已存高级配置无效；请恢复默认值或在 YAML 中修复。",
			"settings.validation.unsafe-tool": "不能直接开放递归编排或全局规则工具；请使用 Host 托管机制。",
			"settings.validation.orchestration": "当前安全编排仅支持本地、spawn、只读且不扩权的固定子通道。"
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
			"task.orchestration.workerScope": "Worker node · current-node scope only",
			"task.orchestration.parent": "Parent task: {parent} · node {node} · depth {depth}",
			"orchestration.scheduler.title": "Host Ready Queue",
			"orchestration.scheduler.summary.one": "{count} local task node running",
			"orchestration.scheduler.summary.other": "{count} local task nodes running",
			"orchestration.scheduler.aria": "Host Ready Queue: {summary}",
			"orchestration.scheduler.hint": "This shows only local read-only node tasks the Host reports as running; a task may be executing, verifying, or waiting to join recursive descendants.",
			"orchestration.scheduler.nodes.aria": "Local task nodes the Host currently reports as running",
			"orchestration.scheduler.node.aria": "Task node {node}, {title}, node-local phase: {phase}",
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
			"task.noPlan.macro": "The Master Planner has not published the macro DAG yet; planning and review models remain visible above.",
			"task.noPlan.node": "This Worker node has not published a node-local pipeline yet; node-level agents and models remain visible above.",
			"task.noPlan.distributed": "This distributed task has no available master plan yet; v1 persists only the task, node, lease, and terminal result.",
			"task.result": "Result",
			"task.result.aria": "Result: {status}; {verified}; {failure}; {workspace}",
			"task.result.facts.aria": "Model verification, failure class, and workspace state",
			"task.result.modelVerified.yes": "Model verified",
			"task.result.modelVerified.no": "Not model verified",
			"task.result.failureClass.none": "No failure",
			"task.result.failureClass.task": "Task failure",
			"task.result.failureClass.infrastructure": "Infrastructure failure",
			"task.result.workspaceQuarantined.yes": "Workspace quarantined",
			"task.result.workspaceQuarantined.no": "Workspace not quarantined",
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
			"plan.scope.macro.title": "Master Plan · Macro DAG",
			"plan.scope.macro.description": "This contract-level plan defines node outcomes, dependencies, and acceptance boundaries; each Worker receives only its Host-assigned node contract.",
			"plan.scope.node.title": "Worker node execution · Local pipeline",
			"plan.scope.node.description": "This view covers planning, execution, and verification inside the current node only; this Worker does not hold its parent’s complete macro DAG.",
			"steps.aria": "Vertical dependency chain for “{task}”",
			"steps.aria.macro": "Contract nodes in the macro DAG for “{task}”",
			"steps.aria.node": "Node-local Worker pipeline for “{task}”",
			"steps.empty": "The plan has no steps yet.",
			"progress.title": "Work progress",
			"progress.summary.nodes": "{done}/{total} nodes completed",
			"progress.summary.steps": "{done}/{total} steps completed",
			"progress.aria.nodes": "Node work progress: {total} nodes; {completed} completed; {working} working; {ready} ready; {waiting} waiting; {failed} failed, blocked, or unfinished",
			"progress.aria.steps": "Step work progress: {total} steps; {completed} completed; {working} working; {ready} ready; {waiting} waiting; {failed} failed, blocked, or unfinished",
			"progress.track.aria.nodes": "Segmented distribution of plan-node states",
			"progress.track.aria.steps": "Segmented distribution of plan-step states",
			"progress.track.group.nodes": "{status}: {count} nodes",
			"progress.track.group.steps": "{status}: {count} steps",
			"progress.legend.aria.nodes": "Node progress status counts",
			"progress.legend.aria.steps": "Step progress status counts",
			"progress.status.completed": "Completed",
			"progress.status.working": "Working",
			"progress.status.ready": "Ready",
			"progress.status.waiting": "Waiting",
			"progress.status.failed": "Failed",
			"progress.status.failedGroup": "Failed / blocked / unclosed",
			"progress.status.blocked": "Blocked by failed dependency: {ids}",
			"progress.status.joining": "Joining an accepted child result",
			"progress.status.unsealed": "Child result was not committed before the plan ended",
			"progress.status.stopped": "Not completed when the plan ended",
			"progress.focus.now": "Now",
			"progress.focus.ready": "Ready",
			"progress.focus.waiting": "Waiting",
			"progress.focus.now.empty": "No work is active now",
			"progress.focus.ready.empty": "No work has all dependencies completed",
			"progress.focus.waiting.empty": "No work is waiting on dependencies",
			"progress.hint.nodes": "“Ready” means only that every published node dependency is complete; scheduler admission and time predictions are not reported here.",
			"progress.hint.steps": "“Ready” means only that every published step dependency is complete; it does not mean the step has started, and no time prediction is reported.",
			"orchestration.children.aria": "Worker task for macro node “{step}”",
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
			"workers.master": "Master Planner / review models",
			"workers.node": "Node-local agents / models",
			"workers.macroStep": "Agents / models associated with the macro node",
			"workers.localStep": "Local-pipeline agents / models",
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
			"worker.error": "Error: {error}",
			"settings.nav": "Task Dispatcher",
			"settings.title": "Task Dispatcher",
			"settings.intro": "Manage task lanes, verification models, and distributed nodes with a clear form. Saving never interrupts running work.",
			"settings.loading": "Loading Task Dispatcher settings…",
			"settings.available": "Configurable",
			"settings.unavailable": "Configuration unavailable",
			"settings.unavailableHint": "This Host does not currently expose writable Task Dispatcher settings. Existing tasks are unaffected.",
			"settings.error": "Could not load settings",
			"settings.retry": "Retry",
			"settings.readOnly": "Read-only mode",
			"settings.readOnlyHint": "You can inspect the current policy, but this Host does not allow browser saves.",
			"settings.restart.title": "Restart DSH after saving",
			"settings.restart.body": "New settings take effect on the next start. Current tasks and workers keep their startup policy.",
			"settings.invalidStored": "Advanced configuration needs repair",
			"settings.conflict": "Settings changed elsewhere",
			"settings.conflictHint": "Your draft is preserved. The page has loaded the latest revision; review it and save again.",
			"settings.unsaved": "Unsaved changes",
			"settings.saved": "Settings saved",
			"settings.saving": "Saving…",
			"settings.save": "Save settings",
			"settings.discard": "Discard changes",
			"settings.reset": "Restore composition defaults",
			"settings.remove": "Remove",
			"settings.validationSummary": "{count} fields need attention",
			"settings.listHint": "Separate multiple values with commas or spaces.",
			"settings.global.title": "Default behavior and safety paths",
			"settings.global.background": "Run in the background by default",
			"settings.global.backgroundHint": "Return immediately after dispatch so the current session remains available.",
			"settings.global.failures": "Consecutive failure limit",
			"settings.global.cooldown": "Failure cooldown (ms)",
			"settings.global.outputLimit": "Background result limit (bytes)",
			"settings.global.liveRoot": "Running code path",
			"settings.global.liveRootHint": "Absolute path that file-changing tasks must avoid; read-only tasks may leave it blank.",
			"settings.global.stagingRoot": "Improvement workspace path",
			"settings.global.stagingRootHint": "Separate absolute path for self-improvement work; it must not overlap running code.",
			"settings.lanes.title": "Task lanes",
			"settings.lanes.intro": "Each lane fixes its working model, independent verifier, tools, and acceptance criteria. Built-in lanes may be adjusted but not deleted.",
			"settings.lane.builtIn": "Built in",
			"settings.lane.user": "Custom",
			"settings.lane.name": "Display name",
			"settings.lane.description": "When to use this lane",
			"settings.lane.kind": "Task type",
			"settings.lane.kind.general": "General task",
			"settings.lane.kind.selfImprovement": "Harness self-improvement",
			"settings.lane.transport": "Child-session method",
			"settings.lane.transport.spawn": "New isolated session",
			"settings.lane.transport.fork": "Fork current session",
			"settings.lane.models": "Working models",
			"settings.lane.execution": "Execution location",
			"settings.lane.executionMode": "Execution method",
			"settings.lane.execution.local": "This DSH process",
			"settings.lane.execution.distributed": "Remote worker",
			"settings.orchestration.title": "Safe subtask orchestration",
			"settings.orchestration.enabled": "Enable Host-managed recursive orchestration",
			"settings.orchestration.enabledHint": "Raw dispatch, subagent, and workflow tools stay hidden; the Host validates, budgets, and joins every child.",
			"settings.orchestration.childLane": "Fixed child lane ID",
			"settings.orchestration.workspaceMode": "Workspace mode",
			"settings.orchestration.readShared": "Shared read-only snapshot",
			"settings.orchestration.isolatedWrite": "Isolated writes (not enabled yet)",
			"settings.orchestration.failureMode": "Failure handling",
			"settings.orchestration.failFast": "Stop after the first failure",
			"settings.orchestration.collect": "Wait and collect every result",
			"settings.orchestration.maxDepth": "Maximum recursion depth",
			"settings.orchestration.maxTaskNodes": "Maximum nodes in the task tree",
			"settings.orchestration.maxChildrenPerNode": "Maximum children per node",
			"settings.orchestration.maxConcurrentNodes": "Maximum concurrent nodes",
			"settings.orchestration.maxTotalModelRuns": "Maximum model runs in the task tree",
			"settings.orchestration.maxResultBytes": "Maximum aggregate result bytes",
			"settings.orchestration.safetyHint": "The first release supports local read-only children. Writable parallelism remains disabled until isolated worktrees and serial integration are active.",
			"settings.lane.tools": "Available tools",
			"settings.lane.toolsHint": "Enter tool names only. Distributed tasks permit read-only tools.",
			"settings.lane.executorTools": "Executor tools",
			"settings.lane.plannerTools": "Planner tools",
			"settings.lane.verifierTools": "Verifier tools",
			"settings.lane.budgets": "Time and attempt budgets",
			"settings.lane.maxPlanSteps": "Maximum plan steps",
			"settings.lane.maxPlanPatches": "Maximum plan updates",
			"settings.lane.maxTotalChildRuns": "Maximum total child sessions",
			"settings.lane.taskTimeoutMs": "Whole-task timeout (ms)",
			"settings.lane.maxAttempts": "Maximum executor attempts",
			"settings.lane.childTimeoutMs": "Child-session timeout (ms)",
			"settings.lane.retryOnRevise": "Retry when verification requests revision",
			"settings.lane.retryOnReviseHint": "Enable only for safely repeatable work to avoid duplicating external side effects.",
			"settings.lane.remove": "Delete custom lane",
			"settings.lane.newId": "New lane ID",
			"settings.lane.idHint": "Use lowercase letters, numbers, hyphens, or underscores; up to 64 characters.",
			"settings.lane.add": "Add lane",
			"settings.route.executor": "Executor model",
			"settings.route.verifier": "Independent verifier model",
			"settings.route.planner": "Planner model",
			"settings.route.provider": "Model provider ID",
			"settings.route.providerHint": "Match the provider ID shown in Model settings.",
			"settings.route.model": "Model ID",
			"settings.route.modelHint": "The exact model name accepted by the provider.",
			"settings.route.maxTokens": "Maximum output tokens",
			"settings.route.maxTokensHint": "Maximum tokens this child session may generate.",
			"settings.route.plannerEnabled": "Enable a master plan",
			"settings.route.plannerEnabledHint": "Create and independently review a plan before step-by-step execution and adjustment.",
			"settings.route.plannerRequiredHint": "This planner comes from a built-in lane. It may be adjusted but not turned off.",
			"settings.criteria.title": "Required acceptance criteria",
			"settings.criteria.add": "Add criterion",
			"settings.criteria.item": "Criterion {index}",
			"settings.criteria.id": "Criterion ID",
			"settings.criteria.text": "Passing condition",
			"settings.criteria.removeAria": "Remove acceptance criterion {id}",
			"settings.distribution.title": "Distributed task dispatch",
			"settings.distribution.intro": "Coordinators put complete read-only tasks in PostgreSQL; workers claim and run them independently.",
			"settings.distribution.role": "This node’s role",
			"settings.distribution.role.disabled": "Turn off distributed dispatch",
			"settings.distribution.role.coordinator": "Dispatch tasks only",
			"settings.distribution.role.worker": "Run tasks only",
			"settings.distribution.role.hybrid": "Dispatch and run tasks",
			"settings.distribution.databaseUrlEnv": "Database environment variable",
			"settings.distribution.databaseUrlEnvHint": "Enter only the variable name. Never paste a database URL or password here.",
			"settings.distribution.scopeId": "Deployment isolation ID",
			"settings.distribution.scopeIdHint": "Only coordinators and workers with the same ID share tasks.",
			"settings.distribution.workerId": "Worker ID",
			"settings.distribution.workerIdHint": "Leave blank to generate one per start; production nodes should use a stable name.",
			"settings.distribution.workerAgentPreset": "Worker Agent preset",
			"settings.distribution.workerAgentPresetHint": "Leave blank to use DSH’s default Agent preset.",
			"settings.distribution.pools": "Worker pools",
			"settings.distribution.pool": "Target pool",
			"settings.distribution.workspaceRef": "Workspace reference",
			"settings.distribution.advanced": "Advanced connection and retry values",
			"settings.distribution.concurrency": "Parallel tasks",
			"settings.distribution.leaseMs": "Task lease (ms)",
			"settings.distribution.heartbeatMs": "Heartbeat interval (ms)",
			"settings.distribution.pollMs": "Empty-queue polling (ms)",
			"settings.distribution.maxDeliveryAttempts": "Maximum deliveries",
			"settings.mapping.title": "Worker workspace mappings",
			"settings.mapping.intro": "Map the task’s fixed reference to an absolute path on this worker.",
			"settings.mapping.empty": "No workspace mappings configured.",
			"settings.mapping.ref": "Workspace reference",
			"settings.mapping.path": "Absolute local path",
			"settings.mapping.pathHint": "The path must exist. Different workers may use different local paths.",
			"settings.mapping.removeAria": "Remove workspace mapping {ref}",
			"settings.mapping.newRef": "New workspace reference",
			"settings.mapping.add": "Add mapping",
			"settings.yaml.title": "Advanced YAML",
			"settings.yaml.body": "Tool details and the full policy can also be edited through the configuration file action at the top right of Settings. Keep the dsh-task-dispatcher namespace.",
			"settings.validation.required": "This field is required.",
			"settings.validation.trimmed": "Remove leading or trailing spaces.",
			"settings.validation.invalid-id": "The format is not valid.",
			"settings.validation.invalid-env": "Enter an environment variable name, not a database URL.",
			"settings.validation.range": "The number or item count is outside the allowed range.",
			"settings.validation.duplicate": "This value must be unique within its list.",
			"settings.validation.absolute-path": "Enter non-overlapping absolute paths.",
			"settings.validation.criteria-required": "At least one acceptance criterion is required.",
			"settings.validation.read-only-tools": "This execution method requires read-only tools and a new isolated session.",
			"settings.validation.distribution-required": "Enable a distributed node role first.",
			"settings.validation.mapping-required": "This worker has no matching workspace mapping.",
			"settings.validation.heartbeat": "Heartbeat must be no more than one third of the lease.",
			"settings.validation.max-lanes": "A maximum of 16 lanes is supported.",
			"settings.validation.overlap": "Running and improvement paths must not contain one another.",
			"settings.validation.invalid-config": "Stored advanced configuration is invalid; restore defaults or repair the YAML.",
			"settings.validation.unsafe-tool": "Raw recursive orchestration and global-rule tools cannot be exposed; use the Host-managed mechanism.",
			"settings.validation.orchestration": "Safe orchestration currently requires a local, spawn-only, read-only fixed child lane with no privilege increase."
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
		/** A wire response failed the plugin's exact telemetry v2 contract. */
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
		function decodeOrchestration(value, path) {
			const item = record(value, path);
			exact(item, path, [
				"parentTaskId",
				"nodeId",
				"depth"
			]);
			return {
				parentTaskId: string(item["parentTaskId"], `${path}.parentTaskId`),
				nodeId: string(item["nodeId"], `${path}.nodeId`),
				depth: integer(item["depth"], `${path}.depth`, 1)
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
				"orchestration",
				"distribution",
				"masterPlan",
				"result"
			]);
			const jobId = optional(item, "jobId", string, path);
			const finishedAt = optional(item, "finishedAt", integer, path);
			const orchestration = optional(item, "orchestration", decodeOrchestration, path);
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
				...orchestration === void 0 ? {} : { orchestration },
				...distribution === void 0 ? {} : { distribution },
				...masterPlan === void 0 ? {} : { masterPlan },
				workers: array(item["workers"], `${path}.workers`, decodeWorker),
				...result === void 0 ? {} : { result }
			};
		}
		/** Decode one exact v2 success value and bind it to the requested session. */
		function decodeDispatcherSnapshot(value, expectedSessionId) {
			const item = record(value, "snapshot");
			exact(item, "snapshot", [
				"protocolVersion",
				"revision",
				"sessionId",
				"generatedAt",
				"tasks"
			]);
			if (item["protocolVersion"] !== 2) fail("snapshot.protocolVersion", "2");
			const sessionId = string(item["sessionId"], "snapshot.sessionId");
			if (expectedSessionId !== void 0 && sessionId !== expectedSessionId) fail("snapshot.sessionId", JSON.stringify(expectedSessionId));
			return {
				protocolVersion: 2,
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
			const connection = ctx.get("connection");
			const sources = new DispatcherSourceRegistry(connection.rpc);
			const config = new DispatcherConfigController(connection.rpc);
			ctx.effect(() => ctx.on("connection/reset", () => {
				config.refreshAfterReconnect();
			}), "task-dispatcher: config generation invalidation");
			ctx.effect(() => () => {
				sources.dispose();
				config.dispose();
			}, "task-dispatcher: browser sources");
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
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "task-dispatcher",
				order: 20,
				label: () => t("settings.nav"),
				locale: NS,
				inject: () => ({
					controller: config,
					hooks: { taskDispatcherConfig: config }
				})
			}, TaskDispatcherSettingsTab));
		}
		//#endregion
		exports.DispatcherConfigController = DispatcherConfigController;
		exports.DispatcherConfigDecodeError = DispatcherConfigDecodeError;
		exports.DispatcherDecodeError = DispatcherDecodeError;
		exports.DispatcherSessionSource = DispatcherSessionSource;
		exports.DispatcherSourceRegistry = DispatcherSourceRegistry;
		exports.TaskDispatcherAction = TaskDispatcherAction;
		exports.TaskDispatcherSettingsTab = TaskDispatcherSettingsTab;
		exports.apply = apply;
		exports.decodeDispatcherConfigSnapshot = decodeDispatcherConfigSnapshot;
		exports.decodeDispatcherSnapshot = decodeDispatcherSnapshot;
		exports.inject = inject;
		exports.planProgress = planProgress;
		exports.validateDispatcherDraft = validateDispatcherDraft;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map