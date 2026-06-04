import { defineConfig } from "vite";

// El frontend se compila a dist/client y lo sirve el backend Fastify.
// En desarrollo, Vite proxya /api al servidor Node (puerto 3000).
export default defineConfig({
  root: ".",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
