import Database from "better-sqlite3";
import { DB_PATH } from "./config.js";

// Disposición do teclado (QWERTY galego). Cada tecla é un pad.
export const KEY_ROWS: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L", "Ñ"],
  ["Z", "X", "C", "V", "B", "N", "M", ",", "."],
  ["SPACE"],
];
export const ALL_KEYS = KEY_ROWS.flat();
const COLORS = ["verde", "mostaza", "terracota"];

export interface PadRow {
  key: string;
  sound_file: string | null;
  display_name: string | null;
  original_name: string | null;
  mime: string | null;
  duration: number | null;
  volume: number;
  mode: string;
  hold: number;
  loop: number;
  trim_start: number | null;
  trim_end: number | null;
  color: string | null;
  peaks: string | null;
  updated_at: number | null;
}

// Forma que se envía ao cliente.
export interface PadDTO {
  key: string;
  soundFile: string | null;
  audioUrl: string | null;
  displayName: string | null;
  mime: string | null;
  duration: number | null;
  volume: number;
  mode: "golpe" | "fundido";
  hold: boolean;
  loop: boolean;
  trimStart: number | null;
  trimEnd: number | null;
  color: string | null;
  peaks: number[] | null;
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS pads (
  key           TEXT PRIMARY KEY,
  sound_file    TEXT,
  display_name  TEXT,
  original_name TEXT,
  mime          TEXT,
  duration      REAL,
  volume        REAL DEFAULT 1.0,
  mode          TEXT DEFAULT 'golpe',
  hold          INTEGER DEFAULT 0,
  loop          INTEGER DEFAULT 0,
  trim_start    REAL,
  trim_end      REAL,
  color         TEXT,
  peaks         TEXT,
  updated_at    INTEGER
);
CREATE TABLE IF NOT EXISTS meta (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  version       INTEGER DEFAULT 1
);
`);

// Sementamos unha fila por cada tecla (idempotente).
const seedStmt = db.prepare("INSERT OR IGNORE INTO pads (key, color) VALUES (?, ?)");
const seedAll = db.transaction(() => {
  ALL_KEYS.forEach((key, i) => seedStmt.run(key, COLORS[i % COLORS.length]));
});
seedAll();

export function toDTO(row: PadRow): PadDTO {
  let peaks: number[] | null = null;
  if (row.peaks) {
    try {
      peaks = JSON.parse(row.peaks);
    } catch {
      peaks = null;
    }
  }
  return {
    key: row.key,
    soundFile: row.sound_file,
    audioUrl: row.sound_file ? `/api/audio/${encodeURIComponent(row.sound_file)}` : null,
    displayName: row.display_name,
    mime: row.mime,
    duration: row.duration,
    volume: row.volume ?? 1,
    mode: row.mode === "fundido" ? "fundido" : "golpe",
    hold: !!row.hold,
    loop: !!row.loop,
    trimStart: row.trim_start,
    trimEnd: row.trim_end,
    color: row.color,
    peaks,
  };
}

export function getAllPads(): PadDTO[] {
  const rows = db.prepare("SELECT * FROM pads").all() as PadRow[];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  // Devolvemos en orde de teclado.
  return ALL_KEYS.map((k) => toDTO(byKey.get(k)!));
}

export function getPad(key: string): PadRow | undefined {
  return db.prepare("SELECT * FROM pads WHERE key = ?").get(key) as PadRow | undefined;
}

export default db;
