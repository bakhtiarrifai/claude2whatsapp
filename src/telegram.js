// Telegram through the official Bot API: the bot must be a member of each group it posts to.
// Settings live in ~/.wa-studio/telegram.json: { token, chats: { alias: { id, title, default } } }.
// The token is set from the panel or WA_STUDIO_TELEGRAM_TOKEN, never through an assistant.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { TELEGRAM_FILE } from "./config.js";

export class TgError extends Error {}

export function load() {
  const cfg = existsSync(TELEGRAM_FILE) ? JSON.parse(readFileSync(TELEGRAM_FILE, "utf8")) : {};
  return { token: process.env.WA_STUDIO_TELEGRAM_TOKEN || cfg.token || "", chats: cfg.chats ?? {}, fileToken: cfg.token || "" };
}

export function save({ fileToken, chats }) {
  const tmp = TELEGRAM_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify({ token: fileToken || undefined, chats }, null, 2), { mode: 0o600 });
  renameSync(tmp, TELEGRAM_FILE);
}

async function api(token, method, params = {}) {
  if (!token) throw new TgError("Token bot Telegram belum diisi. Isi di panel (npm run studio) bagian Telegram.");
  const go = () => fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(20000),
  });
  let res;
  try {
    res = await go();
  } catch (e) {
    // Retry once only when no connection was made, so Telegram cannot have received the first attempt.
    const code = e.cause?.code;
    if (!["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH"].includes(code)) {
      throw new TgError(`Tidak bisa menghubungi api.telegram.org (${code ?? e.message}).`);
    }
    await new Promise((r) => setTimeout(r, 2000));
    res = await go().catch((e2) => {
      throw new TgError(`Tidak bisa menghubungi api.telegram.org (${e2.cause?.code ?? e2.message}).`);
    });
  }
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new TgError(`Telegram ${method}: ${j.description ?? `HTTP ${res.status}`}`);
  return j.result;
}

export const me = (token) => api(token, "getMe");
export const chat = (token, chatId) => api(token, "getChat", { chat_id: chatId });

// WhatsApp-style marks (*tebal*, _miring_, ~coret~, ```blok```, `kode`) to Telegram HTML, so one text reads the same in both.
export function toHtml(text) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const blocks = [];
  let s = esc(text).replace(/```([\s\S]+?)```/g, (_, code) => `\u0000${blocks.push(`<pre>${code}</pre>`) - 1}\u0000`);
  s = s.replace(/`([^`\n]+)`/g, (_, code) => `\u0000${blocks.push(`<code>${code}</code>`) - 1}\u0000`);
  const wrap = (mark, tag) => {
    const m = mark.replace(/[*~]/g, "\\$&");
    s = s.replace(new RegExp(`(^|[\\s(\\[])${m}(\\S(?:[^${m}\\n]*?\\S)?)${m}(?=$|[\\s.,!?;:)\\]])`, "gm"), `$1<${tag}>$2</${tag}>`);
  };
  wrap("*", "b");
  wrap("_", "i");
  wrap("~", "s");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

export async function send(token, chatId, text) {
  try {
    const r = await api(token, "sendMessage", { chat_id: chatId, text: toHtml(text), parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    return { message_id: r.message_id, title: r.chat?.title };
  } catch (e) {
    // Formatting Telegram cannot read must not stop an announcement: send it as plain text instead.
    if (!/parse entities|too long/i.test(e.message)) throw e;
    const r = await api(token, "sendMessage", { chat_id: chatId, text: text.slice(0, 4096), link_preview_options: { is_disabled: true } });
    return { message_id: r.message_id, title: r.chat?.title, note: "dikirim tanpa format" };
  }
}

// Groups the bot has seen recently (added to, or messaged in), to find their ids. Telegram keeps updates ~24 hours,
// and returns none while a webhook is set on the bot.
export async function recentChats(token) {
  const updates = await api(token, "getUpdates", { limit: 100, allowed_updates: ["message", "my_chat_member", "channel_post"] });
  const seen = new Map();
  for (const u of updates) {
    const c = u.message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
    if (c && c.type !== "private") seen.set(c.id, { id: c.id, title: c.title, type: c.type });
  }
  return [...seen.values()];
}
