import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { HOST, MAX_UPLOAD_BYTES, PORT } from "./config.js";
import { ensurePassword } from "./auth.js";
import authRoutes from "./routes/auth.js";
import padRoutes from "./routes/pads.js";
import audioRoutes from "./routes/audio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Compilado a dist/server/index.js; o cliente está en dist/client.
const clientDir = join(__dirname, "..", "client");

const app = Fastify({ logger: true, bodyLimit: MAX_UPLOAD_BYTES });

await app.register(fastifyCookie);
await app.register(fastifyMultipart, {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

await ensurePassword();

// API
await app.register(authRoutes, { prefix: "/api" });
await app.register(audioRoutes, { prefix: "/api" });
await app.register(padRoutes, { prefix: "/api" });

// Frontend estático (en produción). SPA: calquera ruta non-API devolve index.html.
if (existsSync(clientDir)) {
  await app.register(fastifyStatic, { root: clientDir, prefix: "/" });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith("/api")) {
      return reply.code(404).send({ error: "Non atopado" });
    }
    return reply.sendFile("index.html");
  });
}

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
