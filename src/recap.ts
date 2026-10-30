// Builds a compact digest of a session transcript and asks the session's
// model for a short recap. The digest drops bulk tool output so small free
// models can handle long sessions.

const MAX_TEXT_CHARS = 2000
const MAX_TOOL_CHARS = 300
const MAX_DIGEST_CHARS = 24_000

export interface RecapModel {
  providerID: string
  id: string
}

// The recap runs on the session's own model, taken from the most recent
// assistant message, so it always uses a model that already worked in this
// session. Some models refuse plugin issued generate calls (OpenCode's free
// tier only serves the interactive client); in that case no recap is
// produced.
async function resolveModel(ctx: any, messages: readonly any[]): Promise<RecapModel> {
  for (let i = messages.length - 1; i >= 0; i--) {
    const model = messages[i]?.model
    if (model?.providerID && model?.id) return { providerID: model.providerID, id: model.id }
  }
  const fallback = await ctx.model.default()
  return { providerID: fallback.providerID, id: fallback.modelID }
}

const PROMPT = `You are writing a recap of an OpenCode coding session so the user can pick up where they left off.

Read the transcript digest below and write a recap with exactly these five sections:

1. Goal. What the user is trying to do, in one or two sentences.
2. Progress. What is done so far.
3. Decisions. Anything agreed, chosen, or ruled out.
4. State. Files touched, commands run, current branch if known.
5. Next steps. The immediate next actions.

Rules:
- Plain English, short sentences.
- No more than 300 words in total.
- No preamble, no sign off, start directly with the first section heading.
- If the digest is empty or trivial, reply with the single word EMPTY.

Transcript digest:
`

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n[truncated, ${text.length - max} chars omitted]`
}

function toolLine(part: any): string {
  const state = part.state ?? {}
  const detail = truncate(JSON.stringify(state), MAX_TOOL_CHARS)
  return `  tool ${part.name ?? "unknown"}: ${detail}`
}

export function buildDigest(messages: readonly any[]): string {
  const lines: string[] = []
  for (const message of messages) {
    if (message.type === "user") {
      lines.push(`user: ${truncate(String(message.text ?? ""), MAX_TEXT_CHARS)}`)
    } else if (message.type === "assistant") {
      for (const part of message.content ?? []) {
        if (part.type === "text") {
          lines.push(`assistant: ${truncate(String(part.text ?? ""), MAX_TEXT_CHARS)}`)
        } else if (part.type === "tool") {
          lines.push(toolLine(part))
        }
      }
    } else if (message.type === "shell") {
      const text = (message as any).command ?? (message as any).text
      if (text) lines.push(`shell: ${truncate(String(text), MAX_TOOL_CHARS)}`)
    }
  }

  const full = lines.join("\n")
  if (full.length <= MAX_DIGEST_CHARS) return full

  // Keep the opening user message (the goal) and the most recent activity.
  const head = lines.find((line) => line.startsWith("user: ")) ?? ""
  const tail: string[] = []
  let size = head.length
  for (let i = lines.length - 1; i >= 0; i--) {
    if (size + lines[i].length > MAX_DIGEST_CHARS) break
    tail.unshift(lines[i])
    size += lines[i].length
  }
  return `${head}\n[middle of transcript omitted for length]\n${tail.join("\n")}`
}

export async function generateRecap(
  ctx: any,
  sessionID: string,
): Promise<{ text: string; messages: number } | null> {
  const messages = await ctx.session.context({ sessionID })
  const digest = buildDigest(messages)
  if (!digest.trim()) return null

  const model = await resolveModel(ctx, messages)
  const result = await ctx.generate.text({
    model: { providerID: model.providerID, id: model.id },
    prompt: PROMPT + digest,
  })
  const text = String(result?.text ?? result?.data?.text ?? "").trim()
  if (!text || text === "EMPTY") return null
  return { text, messages: messages.length }
}

const LINE_PROMPT = `Summarise what this coding session is doing right now in one short line.

Rules:
- One line only. No newlines, no bullet points.
- Present tense. Describe the current activity, not the history.
- Under 120 characters.
- No preamble, no quotes, no sign off.
- If there is nothing to summarise, reply with the single word EMPTY.

Recent transcript:
`

export async function generateLine(ctx: any, sessionID: string): Promise<string | null> {
  const messages = await ctx.session.context({ sessionID })
  if (messages.length === 0) return null
  const digest = buildDigest(messages.slice(-10))
  if (!digest.trim()) return null

  const model = await resolveModel(ctx, messages)
  const result = await ctx.generate.text({
    model: { providerID: model.providerID, id: model.id },
    prompt: LINE_PROMPT + digest,
  })
  const raw = String(result?.text ?? result?.data?.text ?? "")
    .replace(/\s+/g, " ")
    .trim()
  let line: string | null = raw && raw !== "EMPTY" ? raw : fallbackLine(messages)
  if (!line) return null
  if (line.length > 140) line = line.slice(0, 137) + "..."
  return line
}

// The model answers EMPTY for trivial sessions. Use the last request as the
// line instead so the row is never blank while a session has content.
function fallbackLine(messages: readonly any[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.type !== "user") continue
    const text = String(message.text ?? "")
      .replace(/\s+/g, " ")
      .trim()
    if (text) return `Working on ${text}`
  }
  return null
}
