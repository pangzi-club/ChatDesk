import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/desktop-plugin-sdk/src/**/*.test.ts"] },
});
