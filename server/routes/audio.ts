import type { FastifyPluginAsync } from "fastify";
import fastifyStatic from "@fastify/static";
import { AUDIO_DIR } from "../config.js";
import { requireSession } from "../auth.js";

// Serve os ficheiros de audio desde a carpeta de datos persistente.
// @fastify/static xa xestiona Range requests e cabeceiras de caché, o que
// permite ao navegador precargar de forma eficiente (clave para a latencia).
const routes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", requireSession);
  await app.register(fastifyStatic, {
    root: AUDIO_DIR,
    prefix: "/audio/",
    decorateReply: false, // o estático do cliente xa decora reply.sendFile
    cacheControl: true,
    maxAge: "7d",
    immutable: true, // os nomes inclúen un UUID, así que o contido nunca cambia
  });
};

export default routes;
