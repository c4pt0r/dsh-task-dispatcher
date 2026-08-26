# Documentation

[Project overview](../README.md) · [简体中文文档](./zh-CN/README.md)

The project README is the fast path for installation, first dispatch, role selection, and the principal safety boundary. These guides hold the complete operational and protocol reference.

| Guide | Contents |
|---|---|
| [Architecture and execution model](./architecture.md) | Classic and adaptive pipelines, Host-owned macro DAGs, scheduling, verification, public planning modules, and truthful Web progress |
| [Configuration and usage](./configuration.md) | Web Settings, dispatch lifecycle, complete field reference, six role routes, and orchestration policy |
| [Distributed read-only execution](./distributed.md) | PostgreSQL schema ownership, coordinator/worker roles, workspace mappings, leases, cancellation, recovery, and supervision |
| [Examples](./examples.md) | Background and foreground reviews, concurrent macro-DAG analysis, durable status/cancellation, and authorized local write work |
| [Security, self-improvement, and operations](./security-and-operations.md) | Staging-only improvement, fail-closed boundaries, workspace quarantine, process availability, and limits |
| [Development](./development.md) | Source installation, generated client bundle, tests, package checks, and release workflow |

## Reading paths

- **First-time operator:** project [Quickstart](../README.md#quickstart) → [configuration](./configuration.md) → [examples](./examples.md).
- **Runtime integrator:** [architecture](./architecture.md) → [configuration](./configuration.md#lane-configuration-reference).
- **Distributed deployment:** [distributed execution](./distributed.md) → [security and operations](./security-and-operations.md).
- **Contributor:** [development](./development.md) → [architecture](./architecture.md#internal-code-boundaries).
- **Security review:** project [safety boundary](../README.md#key-safety-boundaries) → [architecture guarantees](./architecture.md#what-it-guarantees) → [security and operations](./security-and-operations.md).
