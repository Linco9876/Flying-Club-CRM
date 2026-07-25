import { assertEquals } from "jsr:@std/assert@1";
import { hmacSha256Hex, safePublicWebhookUrl, sha256Hex } from "./integrationSecurity.ts";

Deno.test("integration keys use stable SHA-256 hashes", async () => {
  assertEquals(
    await sha256Hex("bfc_example"),
    "a6ba1f6b8edb5e674e032e9051ecaa9e48664ce0315a6d9848f859acb6c265ef",
  );
});

Deno.test("webhook signing follows HMAC-SHA256", async () => {
  assertEquals(
    await hmacSha256Hex("secret", "1721712345.{\"id\":\"event\"}"),
    "b8d40757a80a3c70a0eb405b6acb094f4e0d641b07f027ed6d672b8aa5a6ff7f",
  );
});

Deno.test("webhooks reject local and private network destinations", () => {
  assertEquals(safePublicWebhookUrl("https://hooks.example.com/bfc"), true);
  assertEquals(safePublicWebhookUrl("http://hooks.example.com/bfc"), false);
  assertEquals(safePublicWebhookUrl("https://localhost/hook"), false);
  assertEquals(safePublicWebhookUrl("https://127.0.0.1/hook"), false);
  assertEquals(safePublicWebhookUrl("https://169.254.169.254/latest/meta-data"), false);
  assertEquals(safePublicWebhookUrl("https://100.64.0.1/hook"), false);
  assertEquals(safePublicWebhookUrl("https://192.168.1.2/hook"), false);
  assertEquals(safePublicWebhookUrl("https://172.20.0.1/hook"), false);
  assertEquals(safePublicWebhookUrl("https://[fd00::1]/hook"), false);
  assertEquals(safePublicWebhookUrl("https://[fe80::1]/hook"), false);
  assertEquals(safePublicWebhookUrl("https://[::ffff:127.0.0.1]/hook"), false);
  assertEquals(safePublicWebhookUrl("https://service.local/hook"), false);
});
