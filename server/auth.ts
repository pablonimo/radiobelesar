import argon2 from "argon2";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import db from "./db.js";
import { COOKIE_NAME, DEFAULT_PASSWORD, SESSION_SECRET } from "./config.js";

interface MetaRow {
  password_hash: string;
}

/** Crea a clave por defecto a primeira vez (se aínda non existe). */
export async function ensurePassword(): Promise<void> {
  const row = db.prepare("SELECT id FROM meta WHERE id = 1").get();
  if (!row) {
    const hash = await argon2.hash(DEFAULT_PASSWORD);
    db.prepare("INSERT INTO meta (id, password_hash) VALUES (1, ?)").run(hash);
  }
}

export async function verifyPassword(password: string): Promise<boolean> {
  const row = db.prepare("SELECT password_hash FROM meta WHERE id = 1").get() as
    | MetaRow
    | undefined;
  if (!row) return false;
  try {
    return await argon2.verify(row.password_hash, password);
  } catch {
    return false;
  }
}

export async function setPassword(password: string): Promise<void> {
  const hash = await argon2.hash(password);
  db.prepare("UPDATE meta SET password_hash = ? WHERE id = 1").run(hash);
}

// ---- Token de sesión (HMAC sobre o segredo do servidor) ----

// Mesma vida que a cookie (1 ano): un token roubado non vale para sempre.
const TOKEN_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function sign(payload: string): string {
  return createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

export function makeToken(): string {
  const payload = `s:${Date.now()}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function verifyToken(token?: string): boolean {
  if (!token) return false;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return false;
  const payload = Buffer.from(encoded, "base64url").toString();
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  // Comprobamos a antigüidade do token (o payload é "s:<timestamp>").
  if (!payload.startsWith("s:")) return false;
  const issuedAt = Number(payload.slice(2));
  if (!Number.isFinite(issuedAt)) return false;
  const age = Date.now() - issuedAt;
  return age >= 0 && age <= TOKEN_MAX_AGE_MS;
}

/** preHandler de Fastify: corta calquera petición sen sesión válida. */
export async function requireSession(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = req.cookies?.[COOKIE_NAME];
  if (!verifyToken(token)) {
    await reply.code(401).send({ error: "Non autorizado" });
  }
}
