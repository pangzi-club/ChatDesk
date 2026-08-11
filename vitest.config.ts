import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/server/src/**/*.test.ts",
      "packages/shared/src/**/*.test.ts",
      "packages/chat-client/src/**/*.test.ts",
    ],
    exclude: ["scripts/**"],
  },
});
