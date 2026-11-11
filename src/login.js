#!/usr/bin/env node
// One-time setup: opens WhatsApp Web in the tool's own browser profile so you can link it by scanning the QR code.
import { findBrowser, getWaPage } from "./browser.js";
import { PROFILE_DIR } from "./config.js";
import { state } from "./wa.js";

console.log(`Browser: ${findBrowser()}`);
const page = await getWaPage();
await page.bringToFront();
console.log(`Profile: ${PROFILE_DIR}`);
console.log("Di HP: WhatsApp → Perangkat tertaut → Tautkan perangkat, lalu scan QR di jendela browser itu.");
console.log("Centang 'Stay logged in' bila ada. Menunggu sampai tertaut (maks. 5 menit)...");
for (let i = 0; i < 300; i++) {
  if ((await state(page)) === "ready") {
    console.log("Tertaut. Biarkan jendela browser itu terbuka (boleh diperkecil).");
    process.exit(0);
  }
  await page.waitForTimeout(1000);
}
console.log("Belum tertaut. Jalankan `npm run login` lagi.");
process.exit(1);
