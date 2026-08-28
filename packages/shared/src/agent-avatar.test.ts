import { describe, expect, it } from "vitest";
import {
  AGENT_AVATAR_IMAGE_MAX_BYTES,
  encodeAgentAvatarEmoji,
  encodeAgentAvatarImage,
  encodeAgentAvatarText,
  normalizeAgentAvatar,
  parseAgentAvatar,
} from "./agent-avatar.ts";

const imageDataUrl = (bytes: number) =>
  `data:image/webp;base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;

describe("agent avatars", () => {
  it("encodes and parses text and preset emoji avatars", () => {
    expect(encodeAgentAvatarText("智能")).toBe("text:智能");
    expect(encodeAgentAvatarText("三个字啊")).toBe("");
    expect(parseAgentAvatar(encodeAgentAvatarEmoji("🤖"))).toEqual({ type: "emoji", emoji: "🤖" });
    expect(encodeAgentAvatarEmoji("😀")).toBe("");
  });

  it("keeps legacy emoji avatars readable", () => {
    expect(parseAgentAvatar("🚀")).toEqual({ type: "emoji", emoji: "🚀" });
  });

  it("only accepts bounded image data URLs", () => {
    const image = imageDataUrl(12);
    expect(parseAgentAvatar(encodeAgentAvatarImage(image))).toEqual({ type: "image", src: image });
    expect(encodeAgentAvatarImage("data:text/html;base64,PHNjcmlwdD4=")).toBe("");
    expect(encodeAgentAvatarImage(imageDataUrl(AGENT_AVATAR_IMAGE_MAX_BYTES + 1))).toBe("");
    expect(normalizeAgentAvatar(`image:data:text/html;base64,PHNjcmlwdD4=`)).toBe("");
    expect(normalizeAgentAvatar("data:text/html;base64,PHNjcmlwdD4=")).toBe("");
  });
});
