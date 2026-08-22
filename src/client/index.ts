/** Browser half of dsh-task-dispatcher: session plan telemetry and visualization. */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TaskDispatcherAction, type TaskDispatcherInjected } from './TaskDispatcherAction.tsx'
import { en, NS, zh, type TaskDispatcherKey } from './locales.ts'
import { DispatcherSourceRegistry } from './source.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Task Dispatcher execution-plan visualization copy. */
    'taskDispatcher': TaskDispatcherKey
  }
}

export { TaskDispatcherAction, planProgress } from './TaskDispatcherAction.tsx'
export type { TaskDispatcherActionProps, TaskDispatcherInjected } from './TaskDispatcherAction.tsx'
export { decodeDispatcherSnapshot, DispatcherDecodeError } from './decode.ts'
export { DispatcherSessionSource, DispatcherSourceRegistry } from './source.ts'
export type * from './types.ts'

/** Required services for the header slot, dictionaries, and generic RPC transport. */
export const inject = ['connection', 'slots', 'locale']

/** Register bilingual copy and one session-header execution-plan action. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const sources = new DispatcherSourceRegistry(connection.rpc)
  ctx.effect(() => () => { sources.dispose() }, 'task-dispatcher: session snapshot watchers')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'task-dispatcher: dictionaries')
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'task-dispatcher-plan',
      order: 30,
      locale: NS,
      inject: (sessionId): TaskDispatcherInjected => ({
        hooks: { taskDispatcher: sources.forSession(sessionId) },
      }),
    }, TaskDispatcherAction),
  )
}
