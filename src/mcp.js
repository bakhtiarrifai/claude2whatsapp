#!/usr/bin/env node
// MCP entry point, over stdio. A thin client of the daemon, which it starts when needed.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { call } from "./client.js";
import { shapes } from "./core.js";

const TOOLS = {
  wa_status: ["status", "Check WhatsApp Web: linked or waiting for a QR scan, what is running, messages sent in the last hour, limits, and the next schedule. Call this first."],
  wa_groups: ["groups", "List the names of the WhatsApp groups this account is in (from WhatsApp's Groups filter). Use the exact name with wa_send."],
  wa_send: ["send", "Send one text message to one WhatsApp group, by its exact name, from the user's own number. Show the user the group and the full text and get their go-ahead before calling. Sends at a person's pace (minimum gap and hourly cap); never use it for bulk or unsolicited messages."],
  wa_schedule_add: ["schedule_add", "Schedule a message to a group: once (`at`, 'YYYY-MM-DD HH:MM' local time) or daily (`daily` HH:MM, optional `days` 1=Mon..7=Sun). Runs in the background service even with no assistant open. Confirm group, text and time with the user first."],
  wa_schedules: ["schedules", "List scheduled messages with their next send time."],
  wa_schedule_remove: ["schedule_remove", "Delete a scheduled message by id."],
  wa_history: ["history", "Recent sends (manual, from Claude, and scheduled) with success or the reason they failed."],
};

const server = new McpServer({ name: "wa-studio", version: "0.1.0" });

for (const [name, [op, description]] of Object.entries(TOOLS)) {
  server.registerTool(name, { description, inputSchema: shapes[op] }, async (args) => {
    try {
      const result = await call(op, args ?? {});
      if (result.qr_png) {
        const { qr_png, ...rest } = result;
        return { content: [{ type: "text", text: JSON.stringify(rest, null, 2) }, { type: "image", data: qr_png, mimeType: "image/png" }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
    }
  });
}

await server.connect(new StdioServerTransport());
