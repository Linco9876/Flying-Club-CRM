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

const normaliseHostname = (value: string) => value.toLowerCase().replace(/^\[|\]$/g, "");

const parseIpv6Words = (value: string) => {
  let source = value;
  if (source.includes(".")) {
    const lastColon = source.lastIndexOf(":");
    const ipv4 = source.slice(lastColon + 1).split(".").map(Number);
    if (ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    source = `${source.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  if ((source.match(/::/g) || []).length > 1) return null;
  const [leftSource, rightSource = ""] = source.split("::");
  const left = leftSource ? leftSource.split(":") : [];
  const right = rightSource ? rightSource.split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((source.includes("::") && missing < 1) || (!source.includes("::") && missing !== 0)) return null;
  const parts = source.includes("::") ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
};

export const publicIpAddress = (value: string) => {
  const host = normaliseHostname(value);
  if (host.includes(":")) {
    const words = parseIpv6Words(host);
    if (!words) return false;
    const [first, second] = words;
    const allZero = words.every((word) => word === 0);
    const loopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
    const ipv4Embedded = words.slice(0, 5).every((word) => word === 0)
      && (words[5] === 0 || words[5] === 0xffff);
    const discardOnly = first === 0x0100 && words.slice(1, 4).every((word) => word === 0);
    const nat64 = first === 0x0064 && second === 0xff9b && words.slice(2, 6).every((word) => word === 0);
    return !allZero
      && !loopback
      && !ipv4Embedded
      && !discardOnly
      && !nat64
      && (first & 0xfe00) !== 0xfc00
      && (first & 0xffc0) !== 0xfe80
      && (first & 0xff00) !== 0xff00
      && !(first === 0x2001 && (second === 0 || second === 0x0db8))
      && first !== 0x2002;
  }

  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first !== 0
    && first !== 10
    && first !== 127
    && !(first === 100 && second >= 64 && second <= 127)
    && !(first === 169 && second === 254)
    && !(first === 172 && second >= 16 && second <= 31)
    && !(first === 192 && (second === 0 || second === 168))
    && !(first === 192 && second === 88 && parts[2] === 99)
    && !(first === 198 && (second === 18 || second === 19))
    && !(first === 198 && second === 51 && parts[2] === 100)
    && !(first === 203 && second === 0 && parts[2] === 113)
    && first < 224;
};

export const safePublicWebhookUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") return false;
    const host = normaliseHostname(url.hostname);
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host)) return publicIpAddress(host);
    return /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(host) && host.includes(".");
  } catch {
    return false;
  }
};

export const allowedWebhookHosts = (value: string | undefined) =>
  new Set((value || "").split(",").map((host) => normaliseHostname(host.trim())).filter(Boolean));

type DnsResolver = (hostname: string, recordType: "A" | "AAAA") => Promise<string[]>;

export class WebhookDnsResolutionError extends Error {
  constructor(hostname: string) {
    super(`Webhook hostname could not be resolved: ${hostname}`);
    this.name = "WebhookDnsResolutionError";
  }
}

export const resolvePublicWebhookDestination = async (
  value: string,
  allowedHosts: ReadonlySet<string>,
  resolveDns: DnsResolver = (hostname, recordType) => Deno.resolveDns(hostname, recordType) as Promise<string[]>,
) => {
  if (!safePublicWebhookUrl(value)) return null;
  const url = new URL(value);
  const host = normaliseHostname(url.hostname);
  if (!allowedHosts.has(host)) return null;
  if (host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host)) {
    return publicIpAddress(host) ? { url, addresses: [host] } : null;
  }

  const results = await Promise.allSettled([
    resolveDns(host, "A"),
    resolveDns(host, "AAAA"),
  ]);
  const addresses = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (addresses.length === 0) throw new WebhookDnsResolutionError(host);
  return addresses.length > 0 && addresses.every(publicIpAddress) ? { url, addresses } : null;
};

export const resolvedPublicWebhookUrl = async (
  value: string,
  allowedHosts: ReadonlySet<string>,
  resolveDns?: DnsResolver,
) => Boolean(await resolvePublicWebhookDestination(value, allowedHosts, resolveDns));

const withSocketTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          onTimeout();
          reject(new Error("Webhook connection timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

export const pinnedHttpsPost = async (
  destination: { url: URL; addresses: string[] },
  body: string,
  headers: Record<string, string>,
  timeoutMs = 10_000,
) => {
  const encodedBody = new TextEncoder().encode(body);
  const requestHeaders = {
    ...headers,
    Host: destination.url.hostname,
    Connection: "close",
    "Content-Length": encodedBody.byteLength.toString(),
  };
  for (const [name, value] of Object.entries(requestHeaders)) {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || /[\r\n]/.test(value)) {
      throw new Error("Invalid webhook request header");
    }
  }

  const requestTarget = `${destination.url.pathname || "/"}${destination.url.search}`;
  const requestHead = `POST ${requestTarget} HTTP/1.1\r\n${
    Object.entries(requestHeaders).map(([name, value]) => `${name}: ${value}`).join("\r\n")
  }\r\n\r\n`;
  const encodedHead = new TextEncoder().encode(requestHead);
  let lastError: unknown;

  for (const address of destination.addresses) {
    let connection: Deno.TlsConn | undefined;
    let rawConnection: Deno.TcpConn | undefined;
    const connectController = new AbortController();
    const deadline = Date.now() + timeoutMs;
    const remainingTime = () => Math.max(1, deadline - Date.now());
    const writeAll = async (payload: Uint8Array) => {
      let offset = 0;
      while (offset < payload.byteLength) {
        const written = await withSocketTimeout(
          connection!.write(payload.subarray(offset)),
          remainingTime(),
          () => connection?.close(),
        );
        if (written < 1) throw new Error("Webhook connection closed while sending the request");
        offset += written;
      }
    };
    try {
      rawConnection = await withSocketTimeout(
        Deno.connect({ hostname: address, port: 443, signal: connectController.signal }),
        remainingTime(),
        () => connectController.abort(),
      );
      connection = await withSocketTimeout(
        Deno.startTls(rawConnection, { hostname: normaliseHostname(destination.url.hostname) }),
        remainingTime(),
        () => rawConnection?.close(),
      );
      await writeAll(encodedHead);
      await writeAll(encodedBody);

      const chunks: Uint8Array[] = [];
      let received = 0;
      while (received < 72 * 1024) {
        const chunk = new Uint8Array(8 * 1024);
        const count = await withSocketTimeout(connection.read(chunk), remainingTime(), () => connection?.close());
        if (count === null) break;
        chunks.push(chunk.slice(0, count));
        received += count;
        const preview = new TextDecoder().decode(Uint8Array.from(chunks.flatMap((item) => [...item])));
        const headerEnd = preview.indexOf("\r\n\r\n");
        if (headerEnd >= 0 && preview.length - headerEnd - 4 >= 8 * 1024) break;
      }

      const responseText = new TextDecoder().decode(Uint8Array.from(chunks.flatMap((item) => [...item])));
      const headerEnd = responseText.indexOf("\r\n\r\n");
      if (headerEnd < 0) throw new Error("Webhook endpoint returned an invalid HTTP response");
      const statusLine = responseText.slice(0, responseText.indexOf("\r\n"));
      const match = /^HTTP\/1\.[01] ([1-5]\d{2})(?: |$)/.exec(statusLine);
      if (!match) throw new Error("Webhook endpoint returned an invalid HTTP status");
      const status = Number(match[1]);
      return {
        status,
        ok: status >= 200 && status < 300,
        text: responseText.slice(headerEnd + 4, headerEnd + 4 + 500),
      };
    } catch (error) {
      lastError = error;
    } finally {
      try {
        connection?.close();
      } catch {
        // The timeout path may already have closed the connection.
      }
      try {
        rawConnection?.close();
      } catch {
        // startTls consumes the TCP connection, or the timeout path closed it.
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Webhook endpoint could not be reached");
};
