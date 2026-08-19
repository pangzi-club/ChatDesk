import { describe, expect, it } from "vitest";
import { chatServerLaunchArgs, chatServerRuntimeRoot } from "./chat-server-launch.js";

describe("Chat Server launch configuration", () => {
  it("runs TypeScript source through Node watch in development", () => {
    expect(chatServerLaunchArgs("/repo/apps/server/src/server.ts", true)).toEqual([
      "--watch",
      "--experimental-strip-types",
      "/repo/apps/server/src/server.ts",
    ]);
  });

  it("keeps packaged workers on the static launch path", () => {
    expect(chatServerLaunchArgs("/app/workers/chat-server.cjs", false)).toEqual([
      "/app/workers/chat-server.cjs",
    ]);
  });

  it("allows development source to reuse the generated runtime resources", () => {
    expect(
      chatServerRuntimeRoot(
        "/repo/apps/server/src/server.ts",
        "/repo/apps/desktop/assets/resources/node-runtime",
      ),
    ).toBe("/repo/apps/desktop/assets/resources/node-runtime");
    expect(chatServerRuntimeRoot("/app/node-runtime/workers/chat-server.cjs")).toBe(
      "/app/node-runtime",
    );
  });
});
