import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "chatdesk-cli",
    environment: "node",
    include: ["src/**/*.test.ts"],
    server: {
      deps: {
        inline: ["ink-testing-library"],
      },
    },
  },
});
