import { homedir } from "node:os";
import { join } from "node:path";

const env = process.env;

// Private state: browser profile (the WhatsApp session), token, schedules, history.
export const HOME = env.WA_STUDIO_HOME ?? join(homedir(), ".wa-studio");
export const PROFILE_DIR = join(HOME, "browser-profile");
export const TOKEN_FILE = join(HOME, "token");
export const SCHEDULE_FILE = join(HOME, "schedules.json");
export const HISTORY_FILE = join(HOME, "history.jsonl");
export const LOG_FILE = join(HOME, "daemon.log");

export const PORT = Number(env.WA_STUDIO_PORT ?? 8792);
export const CDP_PORT = Number(env.WA_STUDIO_CDP_PORT ?? 9345);
export const WA_URL = "https://web.whatsapp.com/";

// WhatsApp is driven at a person's pace. Bulk or rapid sending gets numbers banned, so these are hard limits.
export const MIN_GAP_S = Number(env.WA_STUDIO_MIN_GAP_S ?? 20);
export const MAX_PER_HOUR = Number(env.WA_STUDIO_MAX_PER_HOUR ?? 30);
export const MAX_TEXT = 4000;
// A scheduled message more than this late (computer asleep or off) is skipped instead of sent stale.
export const LATE_LIMIT_MIN = Number(env.WA_STUDIO_LATE_LIMIT_MIN ?? 15);
