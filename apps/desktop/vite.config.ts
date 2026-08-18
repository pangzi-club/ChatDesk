import { createRequire } from "node:module";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.VITE_DEV_HOST;
const require = createRequire(import.meta.url);
const monacoRoot = path.dirname(require.resolve("monaco-editor/package.json"));
const chatServerPort = Number(process.env.CHAT_SERVER_PORT || process.env.VITE_CHAT_SERVER_PORT);
const chatServerTarget = `http://127.0.0.1:${
  Number.isInteger(chatServerPort) && chatServerPort >= 1024 && chatServerPort <= 65535
    ? chatServerPort
    : 14317
}`;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Keep renderer build output visible when a desktop host launches Vite.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    fs: {
      allow: [path.resolve(__dirname), monacoRoot],
    },
    proxy: {
      "/health": { target: chatServerTarget, changeOrigin: true },
      "/v1": {
        target: chatServerTarget,
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
}));
