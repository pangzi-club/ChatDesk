/**
 * 文本加解密工具
 *
 * 方案：PBKDF2(SHA-256) 从用户密钥派生 AES-GCM-256 密钥。
 * 输出格式：base64url( salt(16B) | iv(12B) | ciphertext )，一段可直接分享的字符串。
 * 另一个用户拿到该字符串 + 相同密钥即可还原明文。
 */

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 100_000;

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptText(plainText: string, passphrase: string) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt);

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plainText),
  );

  const payload = new Uint8Array(SALT_LENGTH + IV_LENGTH + cipherBuffer.byteLength);
  payload.set(salt, 0);
  payload.set(iv, SALT_LENGTH);
  payload.set(new Uint8Array(cipherBuffer), SALT_LENGTH + IV_LENGTH);

  return toBase64Url(payload);
}

async function decryptText(payloadText: string, passphrase: string) {
  let payload: Uint8Array;
  try {
    payload = fromBase64Url(payloadText.trim());
  } catch {
    throw new Error("密文格式不正确，请检查是否完整复制。");
  }

  if (payload.length <= SALT_LENGTH + IV_LENGTH) {
    throw new Error("密文长度不足，可能不是本工具生成的字符串。");
  }

  const salt = new Uint8Array(payload.slice(0, SALT_LENGTH));
  const iv = new Uint8Array(payload.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH));
  const ciphertext = new Uint8Array(payload.slice(SALT_LENGTH + IV_LENGTH));

  const key = await deriveKey(passphrase, salt);

  try {
    const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plainBuffer);
  } catch {
    throw new Error("解密失败：密钥不正确或密文已被修改。");
  }
}

export { decryptText, encryptText };
