// WhatsApp Web driver: reads the screen and clicks the same controls a person would. One action at a time; the
// caller (core.js) serialises calls and enforces the sending pace.
import { getWaPage } from "./browser.js";

const SEL = {
  qr: 'canvas[aria-label*="QR"], div[data-ref] canvas',
  side: "#side",
  chatList: "#pane-side",
  search: '#side input[role="textbox"], #side [contenteditable="true"][role="textbox"], #side input[type="text"]',
  // Each chat row has the chat name as its first span[title]; a later one holds the last-message preview.
  rows: '#pane-side [role="row"]',
  header: "#main header",
  composer: '#main footer [contenteditable="true"]',
  // Every message bubble carries a data-id; ours has a status label (aria-label "Sent", "Delivered", "Read").
  messages: "#main [role=\"row\"] [data-id]",
};

export class WaError extends Error {}

// WhatsApp wraps some names in bidi marks (U+202A..U+202E, U+2066..U+2069); they are invisible, so ignore them.
const norm = (s) => String(s ?? "").normalize("NFC").replace(/[\u202a-\u202e\u2066-\u2069\u200e\u200f]/g, "").replace(/\s+/g, " ").trim();
const same = (a, b) => norm(a).toLocaleLowerCase() === norm(b).toLocaleLowerCase();

// "ready" (chats loaded), "qr" (needs linking), "loading", or "offline" (no WhatsApp tab could be opened).
export async function state(page) {
  return page.evaluate((sel) => {
    if (document.querySelector(sel.chatList)) return "ready";
    if (document.querySelector(sel.qr)) return "qr";
    return "loading";
  }, SEL);
}

async function waitState(page, ms = 45000) {
  const end = Date.now() + ms;
  let s = await state(page);
  while (s === "loading" && Date.now() < end) {
    await page.waitForTimeout(500);
    s = await state(page);
  }
  return s;
}

export async function status() {
  const page = await getWaPage();
  const s = await waitState(page);
  const out = { state: s };
  if (s === "qr") {
    out.hint = "Scan QR di jendela browser WhatsApp Studio: WhatsApp di HP → Perangkat tertaut → Tautkan perangkat.";
    const qr = page.locator(SEL.qr).first();
    out.qr_png = (await qr.screenshot({ timeout: 5000 }).catch(() => null))?.toString("base64") ?? null;
  }
  if (s === "loading") out.hint = "WhatsApp Web belum selesai memuat. Coba lagi sebentar lagi.";
  return out;
}

async function readyPage() {
  const page = await getWaPage();
  const s = await waitState(page);
  if (s === "qr") throw new WaError("WhatsApp belum ditautkan. Jalankan `npm run login` (atau buka panel) lalu scan QR dari HP.");
  if (s !== "ready") throw new WaError("WhatsApp Web belum siap (masih memuat). Coba lagi sebentar lagi.");
  return page;
}

async function clearSearch(page) {
  const box = page.locator(SEL.search).first();
  await box.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press("Backspace");
  return box;
}

async function visibleTitles(page) {
  return page.$$eval(SEL.rows, (rows) => [...new Set(rows.map((r) => r.querySelector("span[title]")?.getAttribute("title")).filter(Boolean))]);
}

// Opens the chat whose name matches exactly (ignoring case and extra spaces). Never picks a "close enough" chat.
async function openChat(page, name) {
  const box = await clearSearch(page);
  await box.pressSequentially(norm(name), { delay: 40 });
  await page.waitForTimeout(1500);
  const titles = await visibleTitles(page);
  const hits = titles.filter((t) => same(t, name));
  if (hits.length === 0) {
    await clearSearch(page);
    throw new WaError(`Grup "${name}" tidak ditemukan. Nama yang mirip: ${titles.slice(0, 8).join(", ") || "(tidak ada)"}.`);
  }
  if (hits.length > 1) {
    await clearSearch(page);
    throw new WaError(`Ada ${hits.length} chat bernama "${name}". Ganti nama salah satunya di WhatsApp supaya tidak salah kirim.`);
  }
  const row = await page.$$eval(SEL.rows, (rows, want) => rows.findIndex((r) => r.querySelector("span[title]")?.getAttribute("title") === want), hits[0]);
  await page.locator(SEL.rows).nth(row).click();
  await page.locator(SEL.composer).first().waitFor({ timeout: 15000 });
  const header = norm(await page.locator(SEL.header).first().innerText());
  if (!header.toLocaleLowerCase().includes(norm(hits[0]).toLocaleLowerCase())) {
    throw new WaError(`Chat yang terbuka bukan "${name}" (judul: ${header.slice(0, 60)}). Pesan tidak dikirim.`);
  }
  await clearSearch(page);
  return hits[0];
}

// Types the text (Shift+Enter between lines), sends it with Enter, then waits until WhatsApp shows it as sent.
// dryRun stops after opening and checking the chat.
export async function send(name, text, { dryRun = false } = {}) {
  const page = await readyPage();
  const chat = await openChat(page, name);
  if (dryRun) return { chat, status: "dry-run: grup ditemukan dan dibuka, tidak ada yang diketik atau dikirim" };
  const composer = page.locator(SEL.composer).first();
  await composer.click();
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i) await page.keyboard.press("Shift+Enter");
    if (lines[i]) await page.keyboard.insertText(lines[i]);
  }
  const typed = norm(await composer.innerText());
  if (!typed) throw new WaError("Kotak pesan tetap kosong setelah mengetik. Pesan tidak dikirim.");
  await page.keyboard.press("Enter");

  // Sent = a new message of ours whose status label (Pending → Sent → Delivered → Read) has moved past pending.
  const end = Date.now() + 30000;
  let tick = "pending";
  while (Date.now() < end) {
    await page.waitForTimeout(700);
    const r = await page.evaluate(([sel, probe]) => {
      // The message list is virtualised, so counting bubbles is unreliable. Find ours among the newest few by its
      // text and status label (only our own messages have one); a reply may already have arrived below it.
      const STATUS = /^(pending|sent|delivered|read|menunggu|terkirim|diterima|dibaca)$/;
      const labelsOf = (e) => [...e.querySelectorAll("[aria-label]")].map((x) => x.getAttribute("aria-label").trim().toLowerCase());
      const mine = [...document.querySelectorAll(sel)].slice(-6).reverse()
        .find((e) => e.innerText.replace(/\s+/g, " ").includes(probe) && labelsOf(e).some((l) => STATUS.test(l)));
      if (!mine) return null;
      const labels = labelsOf(mine);
      if (labels.some((l) => /^(read|dibaca)$/.test(l))) return "read";
      if (labels.some((l) => /^(delivered|diterima)$/.test(l))) return "delivered";
      if (labels.some((l) => /^(sent|terkirim)$/.test(l))) return "sent";
      return "pending";
    }, [SEL.messages, norm(lines.find((l) => l.trim()) ?? "").slice(0, 60)]);
    if (r) tick = r;
    if (r && r !== "pending") break;
  }
  const left = norm(await composer.innerText().catch(() => ""));
  if (left) throw new WaError("Pesan masih ada di kotak ketik setelah Enter; WhatsApp tidak mengirimnya. Cek jendela browser.");
  return { chat, status: tick };
}

// Group names, from WhatsApp's own "Groups" filter while scrolling the chat list.
export async function groups() {
  const page = await readyPage();
  await clearSearch(page);
  const chip = page.locator("#side button, #side [role='tab']").filter({ hasText: /^\s*(Groups|Grup)(\s|\d|$)/ }).first();
  const filtered = await chip.click({ timeout: 4000 }).then(() => true, () => false);
  await page.waitForTimeout(1200);
  const names = new Set();
  const pane = page.locator(SEL.chatList);
  for (let i = 0; i < 60; i++) {
    const before = names.size;
    for (const t of await visibleTitles(page)) names.add(t);
    const atEnd = await pane.evaluate((el) => {
      const at = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
      el.scrollTop += el.clientHeight * 0.8;
      return at;
    });
    await page.waitForTimeout(400);
    if (atEnd && names.size === before) break;
  }
  await pane.evaluate((el) => (el.scrollTop = 0));
  if (filtered) {
    await page.locator("#side button, #side [role='tab']").filter({ hasText: /^\s*(All|Semua)\s*$/ }).first().click({ timeout: 4000 }).catch(() => {});
  }
  return {
    groups: [...names].sort((a, b) => a.localeCompare(b)),
    note: filtered ? undefined : "Filter Grup tidak ditemukan; daftar ini berisi semua chat, bukan hanya grup.",
  };
}
