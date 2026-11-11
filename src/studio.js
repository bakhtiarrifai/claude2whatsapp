#!/usr/bin/env node
// Opens the control panel, starting the background service first if needed.
import { execFile, spawn } from "node:child_process";
import { findBrowser } from "./browser.js";
import { ensureDaemon } from "./client.js";
import { PORT } from "./config.js";

await ensureDaemon();
const url = `http://127.0.0.1:${PORT}`;
console.log(`WhatsApp Studio: ${url}`);
const openDefault = () => execFile(process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", [url], () => {});
try {
  spawn(findBrowser(), [url], { detached: true, stdio: "ignore" }).on("error", openDefault).unref();
} catch {
  openDefault();
}
process.exit(0);
