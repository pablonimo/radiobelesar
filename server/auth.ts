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
  return a.length === b.length && timingSafeEqual(a, b);
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
