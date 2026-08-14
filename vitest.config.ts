import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "apps/server/vitest.config.ts",
      "apps/desktop/vitest.config.ts",
      "packages/shared/vitest.config.ts",
      "packages/chat-client/vitest.config.ts",
    ],
  },
});
