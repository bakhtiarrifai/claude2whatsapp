#!/usr/bin/env node
// Starts the background service at logon, so schedules run without opening an assistant. `npm run autostart` adds it,
// `npm run autostart -- remove` takes it out. It starts inside the desktop session because WhatsApp Web needs a
// visible browser window.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NODE = process.execPath;
const DAEMON = fileURLToPath(new URL("./daemon.js", import.meta.url));
const home = homedir();

function target() {
  if (process.platform === "win32") {
    const startup = join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
    return {
      file: join(startup, "wa-studio.vbs"),
      text: `' Starts WhatsApp Studio hidden at logon (added by wa-studio: npm run autostart).\r\nCreateObject("WScript.Shell").Run """${NODE}"" ""${DAEMON}""", 0, False\r\n`,
    };
  }
  if (process.platform === "darwin") {
    return {
      file: join(home, "Library", "LaunchAgents", "local.wa-studio.plist"),
      text: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>local.wa-studio</string>
  <key>ProgramArguments</key><array><string>${NODE}</string><string>${DAEMON}</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
`,
    };
  }
  // Linux desktops (GNOME, KDE, XFCE...) run XDG autostart entries inside the graphical session.
  const dir = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
  return {
    file: join(dir, "autostart", "wa-studio.desktop"),
    text: `[Desktop Entry]\nType=Application\nName=WhatsApp Studio\nComment=Scheduled WhatsApp group messages (wa-studio)\nExec="${NODE}" "${DAEMON}"\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n`,
  };
}

const { file, text } = target();
if (process.argv[2] === "remove") {
  if (existsSync(file)) rmSync(file);
  console.log(`Removed ${file}`);
} else {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  console.log(`Starts at logon: ${file}`);
}
