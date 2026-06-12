import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { extname, join } from "node:path";
import { ALLOWED_MIME, AUDIO_DIR } from "../config.js";
import db, {
  ALL_KEYS,
  BANKS,
  getPad,
  getAllPads,
  resolveBank,
  toDTO,
  type PadRow,
} from "../db.js";
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

interface Target {
  bank: number;
  key: string;
}

/** Valida e normaliza (banco, tecla). As teclas compartidas van sempre ao banco 0. */
function parseTarget(params: unknown): Target | null {
  const { bank: rawBank, key } = params as { bank: string; key: string };
  if (!ALL_KEYS.includes(key)) return null;
  const requested = Number(rawBank);
  if (!Number.isInteger(requested)) return null;
  const bank = resolveBank(key, requested);
  if (bank !== 0 && !BANKS.includes(bank)) return null;
  return { bank, key };
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
  // O ficheiro vai en STREAMING directo a disco (sen cargalo enteiro en RAM).
  app.post("/pads/:bank/:key/sound", { preHandler: requireSession }, async (req, reply) => {
    const target = parseTarget(req.params);
    if (!target) return reply.code(404).send({ error: "Pad descoñecido" });
    const { bank, key } = target;

    let storedName: string | null = null;
    let originalName = "son";
    let mime = "";
    let badMime: string | null = null;
    let truncated = false;
    const fields: Record<string, string> = {};

    for await (const part of req.parts()) {
      if (part.type === "file") {
        mime = part.mimetype;
        originalName = part.filename || originalName;
        if (!ALLOWED_MIME.has(mime)) {
          badMime = mime;
          part.file.resume(); // descartamos o contido
          continue;
        }
        const ext = EXT_BY_MIME[mime] ?? extname(originalName) ?? ".bin";
        const name = `${bank}_${key.replace(/[^A-Za-z0-9]/g, "_")}_${randomUUID()}${ext}`;
        await pipeline(part.file, createWriteStream(join(AUDIO_DIR, name)));
        if (part.file.truncated) {
          truncated = true;
          await removeFile(name);
        } else {
          storedName = name;
        }
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    if (badMime) return reply.code(415).send({ error: `Formato non admitido (${badMime})` });
    if (truncated) return reply.code(413).send({ error: "O ficheiro é demasiado grande" });
    if (!storedName) return reply.code(400).send({ error: "Non se recibiu ningún ficheiro" });

    // Borramos o ficheiro anterior, se o había.
    const prev = getPad(bank, key);
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
       WHERE bank = ? AND key = ?`,
    ).run(
      storedName,
      displayName,
      originalName,
      mime,
      Number.isFinite(duration) ? duration : null,
      peaks,
      color,
      Date.now(),
      bank,
      key,
    );

    return { pad: toDTO(getPad(bank, key)!) };
  });

  // Actualizar a configuración dun pad (volume, modo, recorte, etc.).
  app.put("/pads/:bank/:key", { preHandler: requireSession }, async (req, reply) => {
    const target = parseTarget(req.params);
    if (!target) return reply.code(404).send({ error: "Pad descoñecido" });
    const row = getPad(target.bank, target.key);
    if (!row) return reply.code(404).send({ error: "Pad descoñecido" });
    if (!row.sound_file) return reply.code(400).send({ error: "O pad está baleiro" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const merged: PadRow = { ...row };

    if (typeof body.displayName === "string") merged.display_name = body.displayName;
    if (typeof body.volume === "number" && Number.isFinite(body.volume)) {
      merged.volume = clamp(body.volume, 0, 1);
    }
    if (body.mode === "golpe" || body.mode === "fundido") merged.mode = body.mode;
    if (typeof body.hold === "boolean") merged.hold = body.hold ? 1 : 0;
    if (typeof body.loop === "boolean") merged.loop = body.loop ? 1 : 0;
    if (typeof body.color === "string") merged.color = body.color;

    // Validación dos puntos de recorte: numéricos, >= 0 e coherentes entre si.
    if ("trimStart" in body) {
      const v = trimValue(body.trimStart);
      if (v === undefined) return reply.code(400).send({ error: "Recorte non válido" });
      merged.trim_start = v;
    }
    if ("trimEnd" in body) {
      const v = trimValue(body.trimEnd);
      if (v === undefined) return reply.code(400).send({ error: "Recorte non válido" });
      merged.trim_end = v;
    }
    if (merged.duration != null && merged.trim_end != null) {
      merged.trim_end = Math.min(merged.trim_end, merged.duration);
    }
    if (
      merged.trim_start != null &&
      merged.trim_end != null &&
      merged.trim_start >= merged.trim_end
    ) {
      return reply
        .code(400)
        .send({ error: "O inicio do recorte debe ser anterior ao fin" });
    }

    db.prepare(
      `UPDATE pads SET
        display_name = ?, volume = ?, mode = ?, hold = ?, loop = ?,
        color = ?, trim_start = ?, trim_end = ?, updated_at = ?
       WHERE bank = ? AND key = ?`,
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
      target.bank,
      target.key,
    );

    return { pad: toDTO(getPad(target.bank, target.key)!) };
  });

  // Baleirar un pad (borra ficheiro e configuración).
  app.delete("/pads/:bank/:key/sound", { preHandler: requireSession }, async (req, reply) => {
    const target = parseTarget(req.params);
    if (!target) return reply.code(404).send({ error: "Pad descoñecido" });
    const row = getPad(target.bank, target.key);
    if (!row) return reply.code(404).send({ error: "Pad descoñecido" });

    await removeFile(row.sound_file);
    db.prepare(
      `UPDATE pads SET
        sound_file = NULL, display_name = NULL, original_name = NULL, mime = NULL,
        duration = NULL, peaks = NULL, volume = 1.0, mode = 'golpe',
        hold = 0, loop = 0, trim_start = NULL, trim_end = NULL, updated_at = ?
       WHERE bank = ? AND key = ?`,
    ).run(Date.now(), target.bank, target.key);

    return { pad: toDTO(getPad(target.bank, target.key)!) };
  });
};

/** null queda como null; número finito >= 0 vale; calquera outra cousa é inválida. */
function trimValue(v: unknown): number | null | undefined {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export default routes;
