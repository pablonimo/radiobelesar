import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { ALLOWED_MIME, AUDIO_DIR } from "../config.js";
import db, { ALL_KEYS, getPad, getAllPads, toDTO, type PadRow } from "../db.js";
import { requireSession } from "../auth.js";

const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/webm": ".webm",
};

function isValidKey(key: string): boolean {
  return ALL_KEYS.includes(key);
}

async function removeFile(soundFile: string | null): Promise<void> {
  if (!soundFile) return;
  const path = join(AUDIO_DIR, soundFile);
  if (existsSync(path)) {
    try {
      await unlink(path);
    } catch {
      /* ignoramos: o ficheiro pode xa non existir */
    }
  }
}

const routes: FastifyPluginAsync = async (app) => {
  // A lista de pads é PÚBLICA (a app úsase sen clave; a clave só protexe a edición).
  app.get("/pads", async () => ({ pads: getAllPads() }));

  // Subir / substituír o son dun pad (multipart: ficheiro + campos).
  app.post("/pads/:key/sound", { preHandler: requireSession }, async (req, reply) => {
    const { key } = req.params as { key: string };
    if (!isValidKey(key)) return reply.code(404).send({ error: "Tecla descoñecida" });

    let buffer: Buffer | null = null;
    let originalName = "son";
    let mime = "";
    const fields: Record<string, string> = {};

    for await (const part of req.parts()) {
      if (part.type === "file") {
        mime = part.mimetype;
        originalName = part.filename || originalName;
        buffer = await part.toBuffer();
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    if (!buffer) return reply.code(400).send({ error: "Non se recibiu ningún ficheiro" });
    if (!ALLOWED_MIME.has(mime)) {
      return reply.code(415).send({ error: `Formato non admitido (${mime})` });
    }

    const ext = EXT_BY_MIME[mime] ?? extname(originalName) ?? ".bin";
    const storedName = `${key.replace(/[^A-Za-z0-9]/g, "_")}_${randomUUID()}${ext}`;
    await writeFile(join(AUDIO_DIR, storedName), buffer);

    // Borramos o ficheiro anterior, se o había.
    const prev = getPad(key);
    await removeFile(prev?.sound_file ?? null);

    const duration = fields.duration ? Number(fields.duration) : null;
    const peaks = fields.peaks ?? null; // JSON xa serializado polo cliente
    const displayName = fields.displayName || originalName.replace(/\.[^.]+$/, "");
    const color = fields.color || prev?.color || "verde";

    db.prepare(
      `UPDATE pads SET
        sound_file = ?, display_name = ?, original_name = ?, mime = ?,
        duration = ?, peaks = ?, color = ?,
        volume = 1.0, mode = 'golpe', hold = 0, loop = 0,
        trim_start = NULL, trim_end = NULL, updated_at = ?
       WHERE key = ?`,
    ).run(storedName, displayName, originalName, mime, duration, peaks, color, Date.now(), key);

    return { pad: toDTO(getPad(key)!) };
  });

  // Actualizar a configuración dun pad (volume, modo, recorte, etc.).
  app.put("/pads/:key", { preHandler: requireSession }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const row = getPad(key);
    if (!row) return reply.code(404).send({ error: "Tecla descoñecida" });
    if (!row.sound_file) return reply.code(400).send({ error: "O pad está baleiro" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const merged: PadRow = { ...row };

    if (typeof body.displayName === "string") merged.display_name = body.displayName;
    if (typeof body.volume === "number") merged.volume = clamp(body.volume, 0, 1);
    if (body.mode === "golpe" || body.mode === "fundido") merged.mode = body.mode;
    if (typeof body.hold === "boolean") merged.hold = body.hold ? 1 : 0;
    if (typeof body.loop === "boolean") merged.loop = body.loop ? 1 : 0;
    if (typeof body.color === "string") merged.color = body.color;
    if ("trimStart" in body)
      merged.trim_start = body.trimStart === null ? null : Number(body.trimStart);
    if ("trimEnd" in body)
      merged.trim_end = body.trimEnd === null ? null : Number(body.trimEnd);

    db.prepare(
      `UPDATE pads SET
        display_name = ?, volume = ?, mode = ?, hold = ?, loop = ?,
        color = ?, trim_start = ?, trim_end = ?, updated_at = ?
       WHERE key = ?`,
    ).run(
      merged.display_name,
      merged.volume,
      merged.mode,
      merged.hold,
      merged.loop,
      merged.color,
      merged.trim_start,
      merged.trim_end,
      Date.now(),
      key,
    );

    return { pad: toDTO(getPad(key)!) };
  });

  // Baleirar un pad (borra ficheiro e configuración).
  app.delete("/pads/:key/sound", { preHandler: requireSession }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const row = getPad(key);
    if (!row) return reply.code(404).send({ error: "Tecla descoñecida" });

    await removeFile(row.sound_file);
    db.prepare(
      `UPDATE pads SET
        sound_file = NULL, display_name = NULL, original_name = NULL, mime = NULL,
        duration = NULL, peaks = NULL, volume = 1.0, mode = 'golpe',
        hold = 0, loop = 0, trim_start = NULL, trim_end = NULL, updated_at = ?
       WHERE key = ?`,
    ).run(Date.now(), key);

    return { pad: toDTO(getPad(key)!) };
  });
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export default routes;
