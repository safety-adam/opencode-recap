import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, Show } from "solid-js"
import { Recap } from "./rpc"

// Shows the latest one line recap as a single row directly above the input.
export default Plugin.define({
  id: "recap.tui",
  async setup(context) {
    const rpc = (context.client as any).rpc(Recap)
    const [lines, setLines] = createSignal<Record<string, string>>({})
    const [activeSession, setActiveSession] = createSignal<string | undefined>()
    const fetched = new Set<string>()

    const unsubscribe = rpc.events.on("updated", (event: any) => {
      const { sessionID, line } = event.data
      if (!sessionID || !line) return
      setLines((prev) => ({ ...prev, [sessionID]: line }))
    })

    // Sending a message clears the row until the next idle summary arrives.
    const clear = (event: any) => {
      const id = event?.data?.sessionID
      if (!id) return
      setLines((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
    const stopEnqueued = context.data.on("session.inbox.enqueued", clear)
    const stopStarted = context.data.on("session.execution.started", clear)

    // Every character typed in the prompt restarts the server's idle window.
    // Throttled to one call a second; the server only stores a timestamp.
    let lastTouch = 0
    const onKey = (key: any) => {
      const sessionID = activeSession()
      if (!sessionID) return
      if (key?.ctrl || key?.meta || key?.super) return
      if (key?.eventType === "release") return
      const printable =
        (typeof key?.sequence === "string" && key.sequence.length === 1 && key.sequence >= " ") ||
        key?.name === "space"
      if (!printable) return
      const now = Date.now()
      if (now - lastTouch < 1000) return
      lastTouch = now
      void rpc.touch({ sessionID }).catch(() => {})
    }
    context.renderer.keyInput.on("keypress", onKey)

    context.ui.slot({
      append: "session.composer.top",
      render: (input: any) => {
        const sessionID = () => input?.sessionID as string | undefined
        createEffect(() => {
          setActiveSession(sessionID())
        })
        createEffect(() => {
          const id = sessionID()
          if (!id || fetched.has(id)) return
          fetched.add(id)
          void rpc
            .current({ sessionID: id })
            .then((result: any) => {
              const line = result?.data?.line ?? result?.line
              if (line) {
                setLines((prev) => ({ ...prev, [id]: line }))
                return
              }
              // Opening a session with no stored line, for example after a
              // restart, generates one now rather than waiting for idle.
              void rpc
                .refresh({ sessionID: id })
                .then((fresh: any) => {
                  const next = fresh?.data?.line ?? fresh?.line
                  if (next) setLines((prev) => ({ ...prev, [id]: next }))
                })
                .catch(() => {})
            })
            .catch(() => {})
        })

        // Same colour the prompt uses for the agent name and its left bar. The
        // prompt falls back to the categorical theme palette when the agent has
        // no explicit colour, indexed by the agent's position in the list.
        const agentColor = () => {
          try {
            const location = context.location ?? context.data.location.default()
            const agents = (context.data.location.agent.list(location) ?? []).filter(
              (entry: any) => !entry.hidden,
            )
            const id = sessionID()
            const messages = id ? (context.data.session.message.list(id) ?? []) : []
            const last = [...messages].reverse().find((message: any) => message.type === "assistant")
            const agentID = (last as any)?.agent ?? "build"
            const index = agents.findIndex((entry: any) => entry.id === agentID)
            const agent: any = index >= 0 ? agents[index] : undefined
            if (agent?.color) return agent.color
            const categorical = (context.theme as any).categorical
            const scale = categorical?.length ? categorical[Math.max(index, 0) % categorical.length] : undefined
            return scale?.[200] ?? scale?.[400] ?? context.theme.border.base
          } catch {
            return context.theme.border.base
          }
        }

        return (
          <Show when={sessionID() ? lines()[sessionID()!] : undefined}>
            <box
              width="100%"
              flexDirection="row"
              backgroundColor={context.theme.decrease(context.theme.background.raised.base)}
            >
              <text wrapMode="none" truncate>
                <span style={{ fg: agentColor() }}>{"┃"}</span>
                <span style={{ fg: context.theme.text.muted }}>{`  Recap: ${lines()[sessionID()!]}`}</span>
              </text>
            </box>
          </Show>
        )
      },
    })

    return () => {
      context.renderer.keyInput.off("keypress", onKey)
      unsubscribe()
      stopEnqueued()
      stopStarted()
    }
  },
})
