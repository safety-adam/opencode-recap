import { Plugin } from "@opencode/plugin"
import { generateRecap } from "./recap"
import { claim, lineKey, startAutoRecap, summarizeSession, type AutoHandle } from "./auto"
import { Recap } from "./rpc"

interface Options {
  auto: boolean
  idleSeconds: number
}

function readOptions(raw: any): Options {
  return {
    auto: raw?.auto !== false,
    idleSeconds: typeof raw?.idleSeconds === "number" && raw.idleSeconds > 0 ? raw.idleSeconds : 60,
  }
}

export default Plugin.define({
  id: "recap",
  async setup(ctx) {
    const options = readOptions(ctx.options)
    let auto: AutoHandle | undefined

    const registration = await ctx.rpc.register(Recap, {
      current: async (input: unknown) => {
        const { sessionID } = input as { sessionID: string }
        const stored = (await ctx.storage.get(lineKey(sessionID))) as { line?: string } | undefined
        return { line: stored?.line ?? "" }
      },
      refresh: async (input: unknown) => {
        const { sessionID } = input as { sessionID: string }
        const line = await summarizeSession(ctx, sessionID, async (id, text) => {
          await registration.events.emit("updated", { sessionID: id, line: text })
        })
        return { line: line ?? "" }
      },
      touch: async (input: unknown) => {
        const { sessionID } = input as { sessionID: string }
        auto?.touch(sessionID)
        return { ok: true }
      },
    })

    await ctx.command.transform((editor) => {
      editor.add({
        name: "recap",
        description: "Summarise this session: goal, progress, decisions, state and next steps",
        execute: async ({ sessionID }) => {
          try {
            if (!(await claim(ctx, "cmd", sessionID))) return
            const recap = await generateRecap(ctx, sessionID)
            await ctx.session.synthetic({
              sessionID,
              text: recap ? `Session recap:\n\n${recap.text}` : "Nothing to recap yet.",
              description: "recap",
            })
          } catch (error) {
            await ctx.session.synthetic({
              sessionID,
              text: `Recap unavailable with this session's model: ${error instanceof Error ? error.message : String(error)}`,
              description: "recap",
            })
          }
        },
      })
    })

    if (!options.auto) return
    auto = await startAutoRecap(ctx, {
      idleSeconds: options.idleSeconds,
      onLine: async (sessionID, line) => {
        await registration.events.emit("updated", { sessionID, line })
      },
    })
    return auto.dispose
  },
})
