# WhatsApp Studio

Kirim pesan ke grup WhatsApp dari Claude Code (atau Codex, Antigravity, Gemini CLI, Claude Desktop), dari jadwal,
atau dari panel lokal. Polanya sama seperti Flow Studio: program kecil di komputer ini membuka browser dengan
profilnya sendiri, memakai WhatsApp Web yang sudah Anda tautkan, lalu mengklik tombol aslinya.

```
Claude Code ──stdio──> mcp.js ──HTTP 127.0.0.1──> daemon (jadwal + panel) ──DevTools──> browser ──> WhatsApp Web
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

Butuh Node 22+, Chrome/Chromium/Edge/Brave, dan sesi desktop yang menyala (WhatsApp Web perlu jendela browser;
boleh diperkecil, jangan ditutup). `npm run autostart -- remove` mematikan autostart.

## Pemakaian

Di Claude Code, misalnya:

- *"Cek WhatsApp, sudah tertaut?"* → `wa_status`
- *"Kirim ke grup Tim Konten: Rapat jam 3 sore ya."* → Claude menunjukkan grup dan isi pesan, minta persetujuan, lalu `wa_send`
- *"Tiap Senin dan Kamis jam 08.00 ingatkan grup Tim Konten untuk setor ide."* → `wa_schedule_add`
- *"Jadwal apa saja yang aktif?"*, *"Hapus jadwal a1b2c3"*, *"Pesan terakhir terkirim?"*

| Tool | Fungsi |
|---|---|
| `wa_status` | Tertaut atau perlu scan QR (QR ikut ditampilkan), pesan 1 jam terakhir, jadwal berikutnya |
| `wa_groups` | Nama semua grup (dari filter Grup WhatsApp) |
| `wa_send` | Kirim satu pesan teks ke satu grup, nama harus persis. `dry_run: true` hanya mencari dan membuka grupnya |
| `wa_schedule_add` | Sekali (`at: "YYYY-MM-DD HH:MM"`) atau harian (`daily: "HH:MM"`, opsional `days`: 1 = Senin … 7 = Minggu) |
| `wa_schedules`, `wa_schedule_remove` | Lihat dan hapus jadwal |
| `wa_history` | Riwayat kirim (manual, dari Claude, terjadwal), termasuk alasan gagal |

Panel: `npm run studio` → http://127.0.0.1:8792 (status dan QR, kirim, jadwal, riwayat).

## Cara kerjanya menjaga dari salah kirim

- Grup dicari lewat kotak cari WhatsApp dan hanya dibuka bila namanya **sama persis** (huruf besar/kecil diabaikan).
  Tidak ada yang cocok, atau ada dua chat bernama sama: tidak dikirim, dan alasannya dilaporkan.
- Setelah dibuka, judul chat dicek lagi. Pesan dianggap terkirim bila gelembung baru muncul dengan centang.
- Jadwal yang terlewat lebih dari 15 menit (komputer mati/tidur) dilewati, tidak dikirim terlambat; tercatat di riwayat.
- Jadwal ditandai terpakai sebelum dikirim, jadi crash di tengah kirim tidak membuat pesan terkirim dua kali.

## Data

Semua di `~/.wa-studio` (folder privat): `browser-profile/` (sesi WhatsApp: siapa pun yang punya folder ini bisa
memakai akun Anda), `schedules.json`, `history.jsonl`, `daemon.log`, `token`. Untuk memutus: WhatsApp di HP →
Perangkat tertaut → keluar dari perangkat ini, lalu hapus folder itu.

Variabel: `WA_STUDIO_HOME`, `WA_STUDIO_PORT` (8792), `WA_STUDIO_CDP_PORT` (9345), `WA_STUDIO_BROWSER`,
`WA_STUDIO_BROWSER_ARGS`, `WA_STUDIO_MIN_GAP_S`, `WA_STUDIO_MAX_PER_HOUR`, `WA_STUDIO_LATE_LIMIT_MIN`.

Diuji di Linux (Fedora, Chrome) dengan WhatsApp Web berbahasa Inggris. Tampilan WhatsApp Web bisa berubah; bila
`wa_send` mulai gagal menemukan kotak cari atau tombol, selector ada di bagian atas `src/wa.js`.
