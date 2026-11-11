# Announce Studio (wa-studio)

Kirim pengumuman dan report ke **grup Telegram** (utama, lewat Bot API resmi) dan, bila perlu untuk pesan
tertentu, **juga ke grup WhatsApp**. Bisa juga kirim ke grup WhatsApp saja. Dipicu dari Claude Code (atau Codex, Antigravity, Gemini CLI, Claude Desktop), dari jadwal,
atau dari panel lokal. Polanya sama seperti Flow Studio: program kecil di komputer ini membuka browser dengan
profilnya sendiri, memakai WhatsApp Web yang sudah Anda tautkan, lalu mengklik tombol aslinya.

```
Claude Code ──stdio──> mcp.js ──HTTP 127.0.0.1──> daemon (jadwal + panel) ─┬─> Telegram Bot API ──> grup Telegram
                                                                          └─> browser ──> WhatsApp Web (opsional)
```

Daemon adalah satu-satunya proses yang memegang tab WhatsApp. MCP server dan panel hanya kliennya, jadi jadwal
tetap jalan walaupun Claude Code tidak dibuka.

> **Penting.** Ini otomasi WhatsApp Web, bukan API resmi. WhatsApp melarang pesan massal/otomatis dan bisa memblokir
> nomor yang dipakai untuk spam. Pakai untuk grup Anda sendiri, dengan frekuensi wajar. Batas bawaan: jeda minimal
> 20 detik antar pesan dan maksimal 30 pesan per jam (`WA_STUDIO_MIN_GAP_S`, `WA_STUDIO_MAX_PER_HOUR`).

## Setup

```bash
npm install
npm run login       # buka browser, scan QR: WhatsApp di HP → Perangkat tertaut → Tautkan perangkat
npm run register    # daftarkan server "whatsapp" ke asisten yang terpasang
npm run autostart   # opsional: nyalakan layanan saat login, agar jadwal jalan tanpa membuka apa pun
```

### Telegram

1. Buat bot di Telegram lewat **@BotFather** (`/newbot`), salin tokennya.
2. `npm run studio` → bagian **Telegram** → tempel token → **Simpan token**. Token hanya disimpan di
   `~/.wa-studio/telegram.json` (atau `WA_STUDIO_TELEGRAM_TOKEN`), tidak pernah lewat Claude.
3. Tambahkan bot ke grup Telegram (mis. grup SBP Branding), kirim satu pesan di grup itu, klik **Cari grup**,
   **Pilih**, beri alias (mis. `sbp-branding`), centang **Default**, **Simpan grup**.

Butuh Node 22+, Chrome/Chromium/Edge/Brave, dan sesi desktop yang menyala (WhatsApp Web perlu jendela browser;
boleh diperkecil, jangan ditutup). `npm run autostart -- remove` mematikan autostart.

## Pemakaian

Di Claude Code, misalnya:

- *"Cek WhatsApp, sudah tertaut?"* → `wa_status`
- *"Umumkan ke SBP: report minggu ini …"* → `announce` ke grup Telegram default saja
- *"Umumkan ke SBP, kirim juga ke WA grup SBP Branding: …"* → `announce` dengan `whatsapp` → dua report, satu di Telegram, satu di WhatsApp
- *"Kirim ke grup WA Tim Konten: Rapat jam 3 sore ya."* → `wa_send` (WhatsApp saja)
- *"Tiap Senin dan Kamis jam 08.00 ingatkan grup Tim Konten untuk setor ide."* → `wa_schedule_add`
- *"Jadwal apa saja yang aktif?"*, *"Hapus jadwal a1b2c3"*, *"Pesan terakhir terkirim?"*

| Tool | Fungsi |
|---|---|
| `wa_status` | Tertaut atau perlu scan QR (QR ikut ditampilkan), pesan 1 jam terakhir, jadwal berikutnya |
| `wa_groups` | Nama semua grup (dari filter Grup WhatsApp) |
| `announce` | Satu teks ke grup Telegram (alias; tanpa `telegram` = grup default) dan opsional `whatsapp`. Hasil per tujuan terpisah |
| `tg_chats`, `tg_add_chat`, `tg_remove_chat` | Status bot, grup Telegram tersimpan, grup yang baru dilihat bot beserta ID-nya |
| `wa_send` | Kirim ke satu grup WhatsApp saja, nama harus persis. `dry_run: true` hanya mencari dan membuka grupnya |
| `wa_schedule_add` | Tujuan sama seperti `announce`. Sekali (`at: "YYYY-MM-DD HH:MM"`) atau harian (`daily: "HH:MM"`, opsional `days`: 1 = Senin … 7 = Minggu) |
| `wa_schedules`, `wa_schedule_remove` | Lihat dan hapus jadwal |
| `wa_history` | Riwayat kirim (manual, dari Claude, terjadwal), termasuk alasan gagal |

Panel: `npm run studio` → http://127.0.0.1:8792 (status dan QR, kirim, jadwal, riwayat).

## Cara kerjanya menjaga dari salah kirim

- Telegram dan WhatsApp dikirim terpisah: kalau satu gagal, yang lain tetap terkirim dan hasilnya dilaporkan per tujuan.
  Format *tebal*/_miring_/~coret~ ala WhatsApp otomatis diubah untuk Telegram.
- Grup WhatsApp dicari lewat kotak cari WhatsApp dan hanya dibuka bila namanya **sama persis** (huruf besar/kecil diabaikan).
  Tidak ada yang cocok, atau ada dua chat bernama sama: tidak dikirim, dan alasannya dilaporkan.
- Setelah dibuka, judul chat dicek lagi. Pesan dianggap terkirim bila gelembung baru muncul dengan centang.
- Jadwal yang terlewat lebih dari 15 menit (komputer mati/tidur) dilewati, tidak dikirim terlambat; tercatat di riwayat.
- Jadwal ditandai terpakai sebelum dikirim, jadi crash di tengah kirim tidak membuat pesan terkirim dua kali.

## Data

Semua di `~/.wa-studio` (folder privat): `browser-profile/` (sesi WhatsApp: siapa pun yang punya folder ini bisa
memakai akun Anda), `telegram.json`, `schedules.json`, `history.jsonl`, `daemon.log`, `token`. Untuk memutus: WhatsApp di HP →
Perangkat tertaut → keluar dari perangkat ini, lalu hapus folder itu.

Variabel: `WA_STUDIO_TELEGRAM_TOKEN`, `WA_STUDIO_HOME`, `WA_STUDIO_PORT` (8792), `WA_STUDIO_CDP_PORT` (9345), `WA_STUDIO_BROWSER`,
`WA_STUDIO_BROWSER_ARGS`, `WA_STUDIO_MIN_GAP_S`, `WA_STUDIO_MAX_PER_HOUR`, `WA_STUDIO_LATE_LIMIT_MIN`.

Diuji di Linux (Fedora, Chrome) dengan WhatsApp Web berbahasa Inggris. Tampilan WhatsApp Web bisa berubah; bila
`wa_send` mulai gagal menemukan kotak cari atau tombol, selector ada di bagian atas `src/wa.js`.
