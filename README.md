# opencode-plugin-recap

Session recap for OpenCode. After a session goes quiet, it writes a one line summary of what you are doing and shows it directly above the input.

The summary uses the same model as the session, so it runs on something you already have working. Some models refuse plugin issued generate calls (OpenCode's free tier only serves the interactive client). In that case no summary is produced.

## Install

Add the plugin to `opencode.json(c)`.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-plugin-recap"]
}
```

Or load a local checkout.

```jsonc
{
  "plugins": ["~/repos/opencode-recap"]
}
```

The row is a TUI plugin and loads from `cli.json`, so add it there too, after any plugin whose rows should sit above it.

```jsonc
{
  "plugins": ["opencode-plugin-recap/tui"]
}
```

## What it does

1. Watches for the session going quiet.
2. After 60 seconds with no activity, reads the last few messages and asks the model for a one line summary of the current activity. Typing in the prompt restarts the 60 second window.
3. Shows the line as a single row directly above the input, below any plugin listed before it in `cli.json`. No command needed.

The line updates after each idle period. It is stored per session and shown again when you reopen the session.

## Options

```jsonc
{
  "plugins": [
    {
      "package": "opencode-plugin-recap",
      "options": {
        "auto": true,
        "idleSeconds": 60
      }
    }
  ]
}
```

| Option | Default | Purpose |
| --- | --- | --- |
| `auto` | `true` | Regenerate the line after idle periods |
| `idleSeconds` | `60` | Quiet time before the summary runs |

## The /recap command

`/recap` still exists. It posts a full five section recap in the chat: goal, progress, decisions, state and next steps.

## Notes

- Summaries are best effort. A failed generation never surfaces and never blocks a prompt.
- The status row renders in the terminal TUI. The desktop app has no plugin slot above the input.
- Generation uses `ctx.generate.text`, which runs outside the session and adds nothing to its history.
