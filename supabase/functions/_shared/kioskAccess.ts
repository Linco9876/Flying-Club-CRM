const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const KIOSK_TOKEN_PREFIX = "bfc_kiosk_";
export const KIOSK_SESSION_PREFIX = "bfc_kiosk_session_";
export const KIOSK_SESSION_IDLE_DAYS = 30;

const bytesToHex = (bytes: Uint8Array) =>
  [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const configuredKioskEncryptionKey = (configuredValue?: string): Uint8Array<ArrayBuffer> => {
  const configured = String(
    configuredValue === undefined
      ? Deno.env.get("KIOSK_TOKEN_ENCRYPTION_KEY") || ""
      : configuredValue,
  ).trim();
  if (!configured) {
    throw new Error("KIOSK_TOKEN_ENCRYPTION_KEY is not configured.");
  }
  if (/^[0-9a-f]{64}$/i.test(configured)) {
    const decoded = new Uint8Array(32);
    (configured.match(/.{2}/g) || []).forEach((pair, index) => {
      decoded[index] = Number.parseInt(pair, 16);
    });
    return decoded;
  }
  let decoded: Uint8Array<ArrayBuffer>;
  try {
    decoded = base64ToBytes(configured);
  } catch {
    throw new Error(
      "KIOSK_TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters or Base64 encoding exactly 32 bytes.",
    );
  }
  if (decoded.length !== 32) {
    throw new Error(
      "KIOSK_TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters or Base64 encoding exactly 32 bytes.",
    );
  }
  return decoded;
};

const encryptionKey = async (configuredValue?: string) =>
  await crypto.subtle.importKey(
    "raw",
    configuredKioskEncryptionKey(configuredValue),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );

export const randomSecret = (prefix: string) => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${prefix}${bytesToHex(bytes)}`;
};

export const createKioskAccessToken = () => randomSecret(KIOSK_TOKEN_PREFIX);
export const createKioskSessionGrant = () => randomSecret(KIOSK_SESSION_PREFIX);

export const isKioskAccessToken = (value: unknown) =>
  new RegExp(`^${KIOSK_TOKEN_PREFIX}[0-9a-f]{64}$`, "i").test(String(value || "").trim());

export const isKioskSessionGrant = (value: unknown) =>
  new RegExp(`^${KIOSK_SESSION_PREFIX}[0-9a-f]{64}$`, "i").test(String(value || "").trim());

export const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
};

export const encryptKioskToken = async (plaintext: string, configuredKey?: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await encryptionKey(configuredKey),
      encoder.encode(plaintext),
    ),
  );
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(encrypted)}`;
};

export const decryptKioskToken = async (ciphertext: string, configuredKey?: string) => {
  const [version, encodedIv, encodedPayload] = String(ciphertext || "").split(".");
  if (version !== "v1" || !encodedIv || !encodedPayload) {
    throw new Error("Unsupported encrypted kiosk token format.");
  }
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(encodedIv) },
    await encryptionKey(configuredKey),
    base64ToBytes(encodedPayload),
  );
  return decoder.decode(decrypted);
};

export const kioskSessionExpiry = (from = new Date()) => {
  const expiry = new Date(from);
  expiry.setUTCDate(expiry.getUTCDate() + KIOSK_SESSION_IDLE_DAYS);
  return expiry.toISOString();
};
