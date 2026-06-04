import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PORT = Number(process.env.PORT ?? 3000);
export const HOST = process.env.HOST ?? "0.0.0.0";
export const IS_PROD = process.env.NODE_ENV === "production";

export const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
export const AUDIO_DIR = join(DATA_DIR, "audio");
export const DB_PATH = join(DATA_DIR, "radiobelesar.db");

export const MAX_UPLOAD_BYTES = Number(
  process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024,
);
export const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD ?? "belesar";
export const COOKIE_NAME = "rb_session";

export const ALLOWED_MIME = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/webm",
]);

// Aseguramos que existen as carpetas de datos antes de abrir a base de datos.
mkdirSync(AUDIO_DIR, { recursive: true });

export const SESSION_SECRET = loadOrCreateSecret();

function loadOrCreateSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const path = join(DATA_DIR, ".session_secret");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const secret = randomBytes(48).toString("hex");
  writeFileSync(path, secret, { mode: 0o600 });
  return secret;
}
