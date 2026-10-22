import { Rpc } from "@opencode/plugin/rpc"

// Shares the latest one line recap with the TUI plugin.
export const Recap = Rpc.define({
  id: "recap",
  methods: {
    current: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { line: { type: "string" } },
        required: ["line"],
        additionalProperties: false,
      },
    },
    refresh: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { line: { type: "string" } },
        required: ["line"],
        additionalProperties: false,
      },
    },
  },
  events: {
    updated: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          line: { type: "string" },
        },
        required: ["sessionID", "line"],
        additionalProperties: false,
      },
    },
  },
})
