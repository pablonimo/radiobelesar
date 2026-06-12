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

// Bancos de sons: a fila de números (banco 0) é COMÚN a todos os bancos;
// o resto das teclas teñen un son distinto en cada banco (1..4).
export const SHARED_KEYS = new Set(KEY_ROWS[0]);
export const BANKS = [1, 2, 3, 4];

const COLORS = ["verde", "mostaza", "terracota"];

export interface PadRow {
  bank: number;
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
  bank: number;
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

// Migración: as bases de datos antigas non tiñan a columna `bank`.
// Reconstruímos a táboa conservando os datos (compartidos -> banco 0; resto -> banco 1).
const oldCols = db.prepare("PRAGMA table_info(pads)").all() as { name: string }[];
const hadTable = oldCols.length > 0;
const needsMigration = hadTable && !oldCols.some((c) => c.name === "bank");
if (needsMigration) {
  db.exec("ALTER TABLE pads RENAME TO pads_old");
}

db.exec(`
CREATE TABLE IF NOT EXISTS pads (
  bank          INTEGER NOT NULL DEFAULT 1,
  key           TEXT NOT NULL,
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
  updated_at    INTEGER,
  PRIMARY KEY (bank, key)
);
CREATE TABLE IF NOT EXISTS meta (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  version       INTEGER DEFAULT 1
);
`);

if (needsMigration) {
  const placeholders = [...SHARED_KEYS].map(() => "?").join(",");
  db.prepare(
    `INSERT INTO pads (bank, key, sound_file, display_name, original_name, mime,
       duration, volume, mode, hold, loop, trim_start, trim_end, color, peaks, updated_at)
     SELECT CASE WHEN key IN (${placeholders}) THEN 0 ELSE 1 END, key, sound_file,
       display_name, original_name, mime, duration, volume, mode, hold, loop,
       trim_start, trim_end, color, peaks, updated_at
     FROM pads_old`,
  ).run(...SHARED_KEYS);
  db.exec("DROP TABLE pads_old");
}

// Sementamos unha fila por cada (banco, tecla) (idempotente).
const seedStmt = db.prepare(
  "INSERT OR IGNORE INTO pads (bank, key, color) VALUES (?, ?, ?)",
);
const seedAll = db.transaction(() => {
  let i = 0;
  for (const key of ALL_KEYS) {
    if (SHARED_KEYS.has(key)) {
      seedStmt.run(0, key, COLORS[i++ % COLORS.length]);
    } else {
      for (const bank of BANKS) seedStmt.run(bank, key, COLORS[i++ % COLORS.length]);
    }
  }
});
seedAll();

/** As teclas compartidas viven sempre no banco 0. */
export function resolveBank(key: string, bank: number): number {
  return SHARED_KEYS.has(key) ? 0 : bank;
}

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
    bank: row.bank,
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
  const rows = db
    .prepare("SELECT * FROM pads ORDER BY bank, key")
    .all() as PadRow[];
  return rows.map(toDTO);
}

export function getPad(bank: number, key: string): PadRow | undefined {
  return db
    .prepare("SELECT * FROM pads WHERE bank = ? AND key = ?")
    .get(bank, key) as PadRow | undefined;
}

export default db;
