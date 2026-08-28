import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import { ChatConfigStore } from "./chat-config.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function agent(avatar: string) {
  return {
    id: "agent",
    name: "Agent",
    avatar,
    modelId: "model",
    systemPrompt: "",
    toolPackIds: [],
    mcpServerIds: [],
    skillIds: [],
    createdAt: "",
    updatedAt: "",
  };
}

describe("ChatConfigStore agent avatar normalization", () => {
  it("retains valid structured avatars and clears invalid image URLs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chatdesk-config-"));
    directories.push(directory);
    const config = new ChatConfigStore(directory);
    await config.init();

    await config.update({
      agents: [agent("text:助手"), agent("image:data:text/html;base64,PHNjcmlwdD4=")],
    });

    const saved = config.get().agents;
    assert.equal(saved[0]?.avatar, "text:助手");
    assert.equal(saved[1]?.avatar, "");
  });
});
