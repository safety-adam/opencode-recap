// Watches the event stream. When a session goes idle, waits out a debounce
// window and asks the model for a one line summary of what the session is
// doing. The line is stored and handed to the caller so the TUI can show it
// above the input.

import { generateLine } from "./recap"

export interface AutoOptions {
  idleSeconds: number
  onLine: (sessionID: string, line: string) => Promise<void> | void
}

export function lineKey(sessionID: string): string {
  return `line/${sessionID}`
}

// Elect a single winner across plugin instances. Every instance writes its
// token, then after a short settle only the last writer proceeds.
export async function claim(ctx: any, purpose: string, sessionID: string): Promise<boolean> {
  const key = `claim/${purpose}/${sessionID}`
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  await ctx.storage.set(key, { token, at: Date.now() })
  await new Promise((resolve) => setTimeout(resolve, 250))
  const current = (await ctx.storage.get(key)) as { token?: string } | undefined
  return current?.token === token
}

function eventSessionID(event: any): string | undefined {
  return (
    event?.data?.sessionID ??
    event?.sessionID ??
    event?.properties?.sessionID ??
    event?.data?.session?.id
  )
}

function eventKind(event: any): "idle" | "activity" | null {
  if (event.type === "session.idle") return "idle"
  if (
    event.type === "session.execution.succeeded" ||
    event.type === "session.execution.failed" ||
    event.type === "session.execution.interrupted"
  ) {
    return "idle"
  }
  if (event.type === "session.status") {
    const status = event?.data?.status?.type ?? event?.status?.type
    if (status === "idle") return "idle"
    if (status === "busy" || status === "retry") return "activity"
    return null
  }
  if (
    event.type.startsWith("session.message") ||
    event.type.startsWith("session.inbox") ||
    event.type === "session.execution.started"
  ) {
    return "activity"
  }
  return null
}

// Shared by the idle watcher and the on demand refresh. Runs one generation
// per session across every plugin instance and emits the result.
export async function summarizeSession(
  ctx: any,
  sessionID: string,
  onLine: (sessionID: string, line: string) => Promise<void> | void,
): Promise<string | null> {
  try {
    const session = await ctx.session.get({ sessionID }).catch(() => undefined)
    // One recap per user session. Skip child sessions created by subagents.
    if (!session || session.parentID) return null
    if (!(await claim(ctx, "gen", sessionID))) return null
    const line = await generateLine(ctx, sessionID)
    if (!line) return null
    const stored = (await ctx.storage.get(lineKey(sessionID))) as { line?: string } | undefined
    if (stored?.line === line) return line
    await ctx.storage.set(lineKey(sessionID), { line, at: Date.now() })
    await onLine(sessionID, line)
    return line
  } catch {
    // Best effort. A failed summary never surfaces.
    return null
  }
}

export async function startAutoRecap(ctx: any, options: AutoOptions): Promise<() => void> {
  const controller = new AbortController()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function summarize(sessionID: string) {
    return summarizeSession(ctx, sessionID, options.onLine)
  }

  function schedule(sessionID: string) {
    const existing = timers.get(sessionID)
    if (existing) clearTimeout(existing)
    timers.set(
      sessionID,
      setTimeout(() => {
        timers.delete(sessionID)
        void summarize(sessionID)
      }, options.idleSeconds * 1000),
    )
  }

  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const sessionID = eventSessionID(event)
        if (!sessionID) continue
        const kind = eventKind(event)
        if (kind === "idle") {
          schedule(sessionID)
        } else if (kind === "activity") {
          const timer = timers.get(sessionID)
          if (timer) {
            clearTimeout(timer)
            timers.delete(sessionID)
          }
        }
      }
    } catch {
      // Stream aborted during unload or lost. Timers are cleared by cleanup.
    }
  })()

  return () => {
    controller.abort()
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  }
}
