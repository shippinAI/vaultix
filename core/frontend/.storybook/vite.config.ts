import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// Stories do not need the application's route generator, API proxy or CDN runtime.
export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  resolve: { alias: { "@app": fileURLToPath(new URL("../src", import.meta.url)) } },
  plugins: [nodePolyfills({ globals: { Buffer: true } })],
  server: { host: "127.0.0.1" }
});
