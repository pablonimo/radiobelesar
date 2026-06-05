import type { FastifyPluginAsync } from "fastify";
import { COOKIE_NAME, IS_PROD } from "../config.js";
import {
  makeToken,
  requireSession,
  setPassword,
  verifyPassword,
  verifyToken,
} from "../auth.js";

function cookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: IS_PROD,
    maxAge: 60 * 60 * 24 * 365, // 1 ano (tableta de aula: non pide a clave cada vez)
  };
}

const routes: FastifyPluginAsync = async (app) => {
  app.post("/login", async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: string };
    if (!password || !(await verifyPassword(password))) {
      return reply.code(401).send({ ok: false, error: "Clave incorrecta" });
    }
    reply.setCookie(COOKIE_NAME, makeToken(), cookieOptions());
    return { ok: true };
  });

  app.get("/session", async (req) => {
    const token = req.cookies?.[COOKIE_NAME];
    return { authenticated: verifyToken(token) };
  });

  app.post("/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.post("/password", { preHandler: requireSession }, async (req, reply) => {
    const { current, next } = (req.body ?? {}) as {
      current?: string;
      next?: string;
    };
    if (!current || !next) {
      return reply.code(400).send({ error: "Faltan campos" });
    }
    if (next.length < 4) {
      return reply.code(400).send({ error: "A nova clave é demasiado curta" });
    }
    if (!(await verifyPassword(current))) {
      return reply.code(403).send({ error: "A clave actual non é correcta" });
    }
    await setPassword(next);
    return { ok: true };
  });
};

export default routes;
