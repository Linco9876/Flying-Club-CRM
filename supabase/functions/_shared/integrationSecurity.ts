const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");

export const sha256Hex = async (value: string) =>
  toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

export const hmacSha256Hex = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
};

export const safePublicWebhookUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".local")) return false;

    if (host.includes(":")) {
      const compact = host.replaceAll(":", "");
      return host !== "::"
        && host !== "::1"
        && !host.startsWith("fc")
        && !host.startsWith("fd")
        && !/^fe[89ab]/.test(host)
        && !host.startsWith("::ffff:")
        && compact !== "";
    }

    const parts = host.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return true;
    }
    const [first, second] = parts;
    return first !== 0
      && first !== 10
      && first !== 127
      && !(first === 100 && second >= 64 && second <= 127)
      && !(first === 169 && second === 254)
      && !(first === 172 && second >= 16 && second <= 31)
      && !(first === 192 && (second === 0 || second === 168))
      && !(first === 198 && (second === 18 || second === 19))
      && first < 224;
  } catch {
    return false;
  }
};
