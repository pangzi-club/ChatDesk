export const AGENT_AVATAR_EMOJIS = [
  "🤖",
  "🧑‍💻",
  "🎨",
  "📊",
  "🔍",
  "✍️",
  "🛠️",
  "🌐",
  "🧠",
  "🚀",
] as const;

export const AGENT_AVATAR_IMAGE_MAX_BYTES = 200 * 1024;
const AGENT_AVATAR_IMAGE_PREFIX = "image:";
const AGENT_AVATAR_TEXT_PREFIX = "text:";
const AGENT_AVATAR_EMOJI_PREFIX = "emoji:";
const imageDataUrlPattern =
  /^data:image\/(?:avif|gif|jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export type AgentAvatar =
  | { type: "default" }
  | { type: "image"; src: string }
  | { type: "text"; text: string }
  | { type: "emoji"; emoji: string };

function codePointLength(value: string) {
  return Array.from(value).length;
}

function validImageDataUrl(value: string) {
  const match = value.match(imageDataUrlPattern);
  if (!match) return false;
  const payloadLength = match[1].replace(/={1,2}$/, "").length;
  return Math.floor((payloadLength * 3) / 4) <= AGENT_AVATAR_IMAGE_MAX_BYTES;
}

export function encodeAgentAvatarText(text: string) {
  const value = text.trim();
  return value && codePointLength(value) <= 2 ? `${AGENT_AVATAR_TEXT_PREFIX}${value}` : "";
}

export function encodeAgentAvatarEmoji(emoji: string) {
  return AGENT_AVATAR_EMOJIS.includes(emoji as (typeof AGENT_AVATAR_EMOJIS)[number])
    ? `${AGENT_AVATAR_EMOJI_PREFIX}${emoji}`
    : "";
}

export function encodeAgentAvatarImage(dataUrl: string) {
  return validImageDataUrl(dataUrl) ? `${AGENT_AVATAR_IMAGE_PREFIX}${dataUrl}` : "";
}

export function normalizeAgentAvatar(value: unknown) {
  if (typeof value !== "string") return "";
  const avatar = value.trim();
  if (!avatar) return "";
  if (avatar.startsWith(AGENT_AVATAR_IMAGE_PREFIX)) {
    return encodeAgentAvatarImage(avatar.slice(AGENT_AVATAR_IMAGE_PREFIX.length));
  }
  if (avatar.startsWith(AGENT_AVATAR_TEXT_PREFIX)) {
    return encodeAgentAvatarText(avatar.slice(AGENT_AVATAR_TEXT_PREFIX.length));
  }
  if (avatar.startsWith(AGENT_AVATAR_EMOJI_PREFIX)) {
    return encodeAgentAvatarEmoji(avatar.slice(AGENT_AVATAR_EMOJI_PREFIX.length));
  }
  if (avatar.startsWith("data:")) return "";
  return avatar.length <= 16 ? avatar : "";
}

export function parseAgentAvatar(value: unknown): AgentAvatar {
  const avatar = normalizeAgentAvatar(value);
  if (!avatar) return { type: "default" };
  if (avatar.startsWith(AGENT_AVATAR_IMAGE_PREFIX)) {
    return { type: "image", src: avatar.slice(AGENT_AVATAR_IMAGE_PREFIX.length) };
  }
  if (avatar.startsWith(AGENT_AVATAR_TEXT_PREFIX)) {
    return { type: "text", text: avatar.slice(AGENT_AVATAR_TEXT_PREFIX.length) };
  }
  if (avatar.startsWith(AGENT_AVATAR_EMOJI_PREFIX)) {
    return { type: "emoji", emoji: avatar.slice(AGENT_AVATAR_EMOJI_PREFIX.length) };
  }
  return { type: "emoji", emoji: avatar };
}
