#!/usr/bin/env node
// The one long-running process: owns the WhatsApp browser tab, runs the schedules, and serves the panel and the JSON
// API on 127.0.0.1. The MCP server and the panel are only clients of it, so schedules keep running with no assistant
// open. `npm run autostart` starts it at logon.
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { LOG_FILE, PORT, TOKEN_FILE } from "./config.js";
import { Studio, shapes } from "./core.js";

const NAME = "wa-studio";
const PANEL = fileURLToPath(new URL("../studio/index.html", import.meta.url));
const TICK_MS = 15000;

const log = (msg) => appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
const studio = new Studio();
const token = randomBytes(24).toString("hex");
const hosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const reply = (res, code, data) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
};

function body(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 256 * 1024) {
        fail(new Error("Request too large."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString()));
    req.on("error", fail);
  });
}

const server = createServer(async (req, res) => {
  try {
    // The Host check stops DNS rebinding; the token stops other local pages and programs from sending messages.
    if (!hosts.has(req.headers.host ?? "")) return reply(res, 403, { error: "Bad host." });
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/health") return reply(res, 200, { name: NAME, pid: process.pid });
    if (url.pathname === "/favicon.ico") return void res.writeHead(204).end();
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(readFileSync(PANEL, "utf8").replace("__TOKEN__", token));
    }
    if (req.headers["x-wa-token"] !== token) return reply(res, 401, { error: "Missing or wrong token. Reload the panel." });
    const op = url.pathname.match(/^\/api\/(\w+)$/)?.[1];
    if (req.method !== "POST" || !op || !Object.hasOwn(shapes, op)) return reply(res, 404, { error: "Not found." });
    const args = z.object(shapes[op]).parse(JSON.parse((await body(req)) || "{}"));
    const source = req.headers["x-wa-source"] === "mcp" ? "claude" : "panel";
    const result = op === "send" || op === "send_file" ? await studio[op](args, source) : await studio[op](args);
    if (op.startsWith("send") || op.startsWith("schedule_")) log(`${source} ${op} ${JSON.stringify(op.startsWith("send") ? { chat: args.chat } : result).slice(0, 200)}`);
    reply(res, 200, result);
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (err?.message ?? String(err));
    reply(res, 400, { error: msg });
  }
});

server.on("error", (err) => {
  console.error(err.code === "EADDRINUSE" ? `Port ${PORT} is already in use (WhatsApp Studio already running?).` : err.message);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  log(`started pid ${process.pid} on ${PORT}`);
  console.log(`WhatsApp Studio running at http://127.0.0.1:${PORT}  (Ctrl+C to stop)`);
  const tick = () => studio.tick().catch((e) => log(`tick: ${e.message}`));
  tick();
  setInterval(tick, TICK_MS);
});
