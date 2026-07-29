const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const decodeConfiguredKey = () => {
  const configured = String(Deno.env.get("XERO_TOKEN_ENCRYPTION_KEY") || "")
    .trim();
  if (!configured) {
    throw new Error("XERO_TOKEN_ENCRYPTION_KEY is not configured.");
  }
  if (/^[0-9a-f]{64}$/i.test(configured)) {
    return Uint8Array.from(
      configured.match(/.{2}/g) || [],
      (pair) => Number.parseInt(pair, 16),
    );
  }
  const decoded = base64ToBytes(configured);
  if (decoded.length !== 32) {
    throw new Error("XERO_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return decoded;
};

const encryptionKey = async () =>
  await crypto.subtle.importKey(
    "raw",
    decodeConfiguredKey(),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );

export const encryptSecret = async (plaintext: string) => {
  if (!plaintext) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await encryptionKey(),
      encoder.encode(plaintext),
    ),
  );
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(encrypted)}`;
};

export const decryptSecret = async (ciphertext?: string | null) => {
  if (!ciphertext) return "";
  const [version, encodedIv, encodedPayload] = ciphertext.split(".");
  if (version !== "v1" || !encodedIv || !encodedPayload) {
    throw new Error("Unsupported encrypted Xero token format.");
  }
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(encodedIv) },
    await encryptionKey(),
    base64ToBytes(encodedPayload),
  );
  return decoder.decode(decrypted);
};

