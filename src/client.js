// Talks to the daemon, starting it in the background first if it is not running.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PORT, TOKEN_FILE } from "./config.js";

const BASE = `http://127.0.0.1:${PORT}`;
const DAEMON = fileURLToPath(new URL("./daemon.js", import.meta.url));

export async function health() {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
    const j = await r.json();
    return j.name === "wa-studio" ? j : null;
  } catch {
    return null;
  }
}

export async function ensureDaemon() {
  if (await health()) return;
  spawn(process.execPath, [DAEMON], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await health()) return;
  }
  throw new Error(`WhatsApp Studio did not start on port ${PORT}. Run \`npm run serve\` to see why.`);
}

export async function call(op, args = {}) {
  await ensureDaemon();
  const res = await fetch(`${BASE}/api/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-wa-token": readFileSync(TOKEN_FILE, "utf8").trim(), "x-wa-source": "mcp" },
    body: JSON.stringify(args),
    // A send waits for the pace gap and WhatsApp's tick; listing groups scrolls the whole chat list.
    signal: AbortSignal.timeout(180000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}
