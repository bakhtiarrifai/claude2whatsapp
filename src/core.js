// What every front end (MCP tools, panel, scheduler) calls. One send at a time, at a person's pace, with a history.
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { HISTORY_FILE, HOME, LATE_LIMIT_MIN, MAX_PER_HOUR, MAX_TEXT, MIN_GAP_S, SCHEDULE_FILE } from "./config.js";
import * as tg from "./telegram.js";
import * as wa from "./wa.js";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = z.string().trim().min(1).max(MAX_TEXT).describe("Isi pesan. Baris baru boleh; *tebal* dan _miring_ ala WhatsApp ikut terkirim.");
const chat = z.string().trim().min(1).max(200).describe("Nama grup persis seperti di WhatsApp (huruf besar/kecil boleh beda).");
const alias = z.string().trim().regex(/^[\w-]{1,40}$/).describe("Nama pendek grup Telegram yang disimpan, misalnya 'sbp-branding'.");
const telegram = z.array(z.string().trim().min(1)).optional()
  .describe("Grup Telegram tujuan: alias yang disimpan. Kosongkan untuk grup Telegram default; [] = tanpa Telegram.");
const whatsapp = z.string().trim().min(1).max(200).optional().describe("Opsional: nama grup WhatsApp yang juga menerima pesan ini.");

export const shapes = {
  status: {},
  groups: {},
  send: { chat, text, dry_run: z.boolean().optional().describe("true: hanya cari dan buka grupnya, tanpa mengirim (untuk mengecek nama).") },
  announce: { text, telegram, whatsapp },
  send_file: {
    chat,
    files: z.array(z.string().trim().min(1)).min(1).max(10).describe("Path absolut file di komputer ini (PDF, PPTX, XLSX, gambar...), maks 10, masing-masing ≤ 100 MB."),
    dry_run: z.boolean().optional().describe("true: hanya cari dan buka chatnya, tanpa mengirim."),
  },
  tg_chats: {},
  tg_add_chat: { alias, chat_id: z.union([z.number().int(), z.string().regex(/^(-?\d+|@\w{4,})$/)]).describe("ID grup (angka, biasanya diawali -100) atau @username channel."), default: z.boolean().optional().describe("Ikut menerima announce yang tidak menyebut grup Telegram.") },
  tg_remove_chat: { alias },
  tg_set_token: { token: z.string().trim().regex(/^\d+:[\w-]{30,}$/, "Bukan token bot Telegram (format 123456:ABC...).") },
  schedule_add: {
    text,
    telegram,
    whatsapp,
    at: z.string().optional().describe("Sekali kirim, waktu lokal komputer ini: 'YYYY-MM-DD HH:MM'."),
    daily: z.string().regex(HHMM).optional().describe("Kirim tiap hari pada jam ini (HH:MM, waktu lokal)."),
    days: z.array(z.number().int().min(1).max(7)).optional().describe("Dengan daily: hanya hari ini (1 = Senin ... 7 = Minggu)."),
    label: z.string().max(80).optional(),
  },
  schedules: {},
  schedule_remove: { id: z.string() },
  history: { limit: z.number().int().min(1).max(200).optional() },
};

const pad = (n) => String(n).padStart(2, "0");
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isoDay = (d) => ((d.getDay() + 6) % 7) + 1;

function parseLocal(s) {
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) throw new Error(`Waktu "${s}" tidak dikenali. Pakai format 'YYYY-MM-DD HH:MM'.`);
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (d.getMonth() !== +m[2] - 1 || d.getHours() !== +m[4]) throw new Error(`Waktu "${s}" tidak ada di kalender.`);
  return d;
}

// The next moment a daily schedule fires, strictly after `after`.
function nextDaily(s, after) {
  const [h, m] = s.daily.split(":").map(Number);
  const d = new Date(after);
  d.setSeconds(0, 0);
  d.setHours(h, m);
  if (d <= after) d.setDate(d.getDate() + 1);
  for (let i = 0; i < 8 && s.days?.length && !s.days.includes(isoDay(d)); i++) d.setDate(d.getDate() + 1);
  return d;
}

export class Studio {
  constructor() {
    // The browser profile in here is a logged-in WhatsApp session: keep the folder private.
    mkdirSync(HOME, { recursive: true, mode: 0o700 });
    chmodSync(HOME, 0o700);
    this.chain = Promise.resolve();
    this.sentAt = [];
    this.working = null;
    this.plan = existsSync(SCHEDULE_FILE) ? JSON.parse(readFileSync(SCHEDULE_FILE, "utf8")) : [];
  }

  saveSchedules() {
    const tmp = SCHEDULE_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.plan, null, 2));
    renameSync(tmp, SCHEDULE_FILE);
  }

  record(entry) {
    appendFileSync(HISTORY_FILE, JSON.stringify({ time: new Date().toISOString(), ...entry }) + "\n");
  }

  // Everything that touches the browser goes through here, one at a time.
  exclusive(what, fn) {
    const run = this.chain.then(async () => {
      this.working = what;
      try {
        return await fn();
      } finally {
        this.working = null;
      }
    });
    this.chain = run.catch(() => {});
    return run;
  }

  async status() {
    const s = await wa.status(); // read-only, so it does not wait behind a send
    const hour = this.sentAt.filter((t) => Date.now() - t < 3600e3).length;
    return {
      ...s,
      working: this.working,
      sent_last_hour: hour,
      limits: { min_gap_s: MIN_GAP_S, max_per_hour: MAX_PER_HOUR },
      schedules: this.plan.length,
      next: this.plan.filter((x) => x.next).sort((a, b) => a.next.localeCompare(b.next))[0] ?? null,
    };
  }

  groups() {
    return this.exclusive("groups", () => wa.groups());
  }

  send({ chat, text, dry_run }, source = "manual") {
    if (dry_run) return this.exclusive(`check ${chat}`, () => wa.send(chat, text, { dryRun: true }));
    return this.exclusive(`send to ${chat}`, async () => {
      const now = Date.now();
      this.sentAt = this.sentAt.filter((t) => now - t < 3600e3);
      if (this.sentAt.length >= MAX_PER_HOUR) {
        const err = `Batas ${MAX_PER_HOUR} pesan per jam tercapai. Coba lagi nanti.`;
        this.record({ source, to: `whatsapp:${chat}`, ok: false, error: err });
        throw new Error(err);
      }
      const wait = (this.sentAt.at(-1) ?? 0) + MIN_GAP_S * 1000 - now;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        const r = await wa.send(chat, text);
        this.sentAt.push(Date.now());
        this.record({ source, to: `whatsapp:${r.chat}`, ok: true, status: r.status, preview: text.slice(0, 80) });
        return { ok: true, chat: r.chat, status: r.status };
      } catch (e) {
        this.record({ source, to: `whatsapp:${chat}`, ok: false, error: e.message, preview: text.slice(0, 80) });
        throw e;
      }
    });
  }

  // Files as WhatsApp documents to one chat; counts as one send for the pace limits.
  send_file({ chat, files, dry_run }, source = "manual") {
    for (const f of files) {
      if (!isAbsolute(f) || !existsSync(f)) throw new Error(`File tidak ditemukan (pakai path absolut): ${f}`);
      const st = statSync(f);
      if (!st.isFile()) throw new Error(`Bukan file: ${f}`);
      if (st.size > 100 * 1024 * 1024) throw new Error(`File lebih dari 100 MB: ${f}`);
    }
    if (dry_run) return this.exclusive(`check ${chat}`, () => wa.sendFiles(chat, files, { dryRun: true }));
    return this.exclusive(`send files to ${chat}`, async () => {
      const now = Date.now();
      this.sentAt = this.sentAt.filter((t) => now - t < 3600e3);
      if (this.sentAt.length >= MAX_PER_HOUR) throw new Error(`Batas ${MAX_PER_HOUR} pesan per jam tercapai. Coba lagi nanti.`);
      const wait = (this.sentAt.at(-1) ?? 0) + MIN_GAP_S * 1000 - now;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const preview = "file: " + files.map((f) => f.split("/").pop()).join(", ");
      try {
        const r = await wa.sendFiles(chat, files);
        this.sentAt.push(Date.now());
        const ok = Object.values(r.status).every((t) => t && t !== "pending");
        this.record({ source, to: `whatsapp:${r.chat}`, ok, status: JSON.stringify(r.status), preview: preview.slice(0, 120) });
        return { ok, chat: r.chat, files: r.files, status: r.status };
      } catch (e) {
        this.record({ source, to: `whatsapp:${chat}`, ok: false, error: e.message, preview: preview.slice(0, 120) });
        throw e;
      }
    });
  }

  // Telegram aliases to {alias, id}. undefined = the default chats; [] = none.
  tgTargets(names) {
    const { chats } = tg.load();
    if (names === undefined) return Object.entries(chats).filter(([, c]) => c.default).map(([a, c]) => ({ alias: a, id: c.id }));
    return names.map((n) => {
      if (!chats[n]) throw new Error(`Grup Telegram "${n}" belum disimpan. Yang ada: ${Object.keys(chats).join(", ") || "(belum ada)"}.`);
      return { alias: n, id: chats[n].id };
    });
  }

  // One text to Telegram (main) and, when asked, a WhatsApp group. Each destination succeeds or fails on its own.
  async announce({ text, telegram, whatsapp }, source = "manual") {
    const targets = this.tgTargets(telegram);
    if (!targets.length && !whatsapp) throw new Error("Tidak ada tujuan: belum ada grup Telegram default, dan `whatsapp` kosong.");
    const { token } = tg.load();
    const results = [];
    for (const t of targets) {
      try {
        const r = await tg.send(token, t.id, text);
        this.record({ source, to: `telegram:${t.alias}`, ok: true, status: r.note ?? "sent", preview: text.slice(0, 80) });
        results.push({ to: `telegram:${t.alias}`, ok: true, ...r });
      } catch (e) {
        this.record({ source, to: `telegram:${t.alias}`, ok: false, error: e.message, preview: text.slice(0, 80) });
        results.push({ to: `telegram:${t.alias}`, ok: false, error: e.message });
      }
    }
    if (whatsapp) {
      const r = await this.send({ chat: whatsapp, text }, source).then((x) => ({ ok: true, status: x.status }), (e) => ({ ok: false, error: e.message }));
      results.push({ to: `whatsapp:${whatsapp}`, ...r });
    }
    return { ok: results.every((r) => r.ok), results };
  }

  async tg_chats() {
    const cfg = tg.load();
    const saved = Object.entries(cfg.chats).map(([alias, c]) => ({ alias, ...c }));
    if (!cfg.token) return { token: false, saved, hint: "Isi token bot di panel (npm run studio) bagian Telegram." };
    const bot = await tg.me(cfg.token);
    const recent = await tg.recentChats(cfg.token).catch((e) => ({ error: e.message }));
    return { token: true, bot: `@${bot.username}`, saved, recent,
      hint: "Grup baru: tambahkan bot ke grup, kirim satu pesan di grup itu, lalu panggil ini lagi untuk melihat ID-nya." };
  }

  async tg_add_chat({ alias, chat_id, default: isDefault }) {
    const cfg = tg.load();
    if (!cfg.token) throw new Error("Token bot Telegram belum diisi. Isi di panel (npm run studio) bagian Telegram.");
    // Ask Telegram for the chat: confirms the bot is in it and records its real title.
    const info = await tg.chat(cfg.token, chat_id).catch((e) => {
      throw new Error(`${e.message}. Pastikan bot sudah ditambahkan ke grup itu.`);
    });
    cfg.chats[alias] = { id: info.id, title: info.title, default: Boolean(isDefault) };
    tg.save(cfg);
    return { saved: alias, ...cfg.chats[alias] };
  }

  tg_remove_chat({ alias }) {
    const cfg = tg.load();
    if (!cfg.chats[alias]) throw new Error(`Alias ${alias} tidak ada.`);
    delete cfg.chats[alias];
    tg.save(cfg);
    return { removed: alias };
  }

  async tg_set_token({ token }) {
    const bot = await tg.me(token);
    const cfg = tg.load();
    tg.save({ ...cfg, fileToken: token });
    return { bot: `@${bot.username}`, name: bot.first_name };
  }

  schedule_add({ text, telegram, whatsapp, at, daily, days, label }) {
    if (!!at === !!daily) throw new Error("Isi salah satu: `at` (sekali) atau `daily` (harian).");
    if (days?.length && !daily) throw new Error("`days` hanya dipakai bersama `daily`.");
    // Resolve now, so a mistyped alias fails at scheduling time rather than silently at 08:00.
    const tgTargets = this.tgTargets(telegram).map((t) => t.alias);
    if (!tgTargets.length && !whatsapp) throw new Error("Tidak ada tujuan: pilih grup Telegram dan/atau `whatsapp`.");
    const s = { id: randomBytes(3).toString("hex"), text, telegram: tgTargets, whatsapp, label, created: new Date().toISOString() };
    if (at) {
      const d = parseLocal(at);
      if (d <= new Date()) throw new Error(`Waktu ${at} sudah lewat.`);
      Object.assign(s, { at: local(d), next: local(d) });
    } else {
      Object.assign(s, { daily, days: days?.length ? [...new Set(days)].sort() : undefined });
      s.next = local(nextDaily(s, new Date()));
    }
    this.plan.push(s);
    this.saveSchedules();
    return s;
  }

  schedules() {
    return { schedules: this.plan, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }

  schedule_remove({ id }) {
    const n = this.plan.length;
    this.plan = this.plan.filter((s) => s.id !== id);
    if (this.plan.length === n) throw new Error(`Jadwal ${id} tidak ada.`);
    this.saveSchedules();
    return { removed: id };
  }

  history({ limit = 30 } = {}) {
    if (!existsSync(HISTORY_FILE)) return { entries: [] };
    const lines = readFileSync(HISTORY_FILE, "utf8").trim().split("\n").filter(Boolean);
    return { entries: lines.slice(-limit).reverse().map((l) => JSON.parse(l)) };
  }

  // Called every few seconds by the daemon. Due schedules are claimed (moved on or removed) before sending, so a crash
  // mid-send never sends the same message twice.
  async tick() {
    const now = new Date();
    for (const s of [...this.plan]) {
      if (!s.next || parseLocal(s.next) > now) continue;
      const due = parseLocal(s.next);
      if (s.daily) s.next = local(nextDaily(s, now));
      else this.plan = this.plan.filter((x) => x.id !== s.id);
      this.saveSchedules();
      const lateMin = (now - due) / 60000;
      if (lateMin > LATE_LIMIT_MIN) {
        this.record({ source: `schedule ${s.id}`, to: [...s.telegram.map((a) => `telegram:${a}`), ...(s.whatsapp ? [`whatsapp:${s.whatsapp}`] : [])].join(", "), ok: false, error: `Dilewati: terlambat ${Math.round(lateMin)} menit (komputer mati/tidur).` });
        continue;
      }
      this.announce({ text: s.text, telegram: s.telegram, whatsapp: s.whatsapp }, `schedule ${s.id}`).catch(() => {});
    }
  }
}
