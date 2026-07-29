import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  createKioskAccessToken,
  createKioskSessionGrant,
  decryptKioskToken,
  encryptKioskToken,
  isKioskAccessToken,
  isKioskSessionGrant,
  kioskSessionExpiry,
  KIOSK_SESSION_PREFIX,
  KIOSK_TOKEN_PREFIX,
  sha256Hex,
} from "./kioskAccess.ts";

Deno.test("kiosk access keys are high-entropy and recognisable", () => {
  const first = createKioskAccessToken();
  const second = createKioskAccessToken();

  assert(first.startsWith(KIOSK_TOKEN_PREFIX));
  assertEquals(first.length, KIOSK_TOKEN_PREFIX.length + 64);
  assert(isKioskAccessToken(first));
  assertNotEquals(first, second);
  assertEquals(isKioskAccessToken("bfc_kiosk_short"), false);
});

Deno.test("kiosk session grants use a separate namespace", () => {
  const grant = createKioskSessionGrant();

  assert(grant.startsWith(KIOSK_SESSION_PREFIX));
  assert(isKioskSessionGrant(grant));
  assertEquals(isKioskAccessToken(grant), false);
});

Deno.test("kiosk secrets use stable one-way hashes", async () => {
  assertEquals(
    await sha256Hex("bfc_kiosk_example"),
    "2a243ba46c76da691d0a4f753be84a6fa1a1e32d6b26b6aedee0b8537c56a18f",
  );
});

Deno.test("stored kiosk keys are encrypted and can be recovered with the separate key", async () => {
  const token = "bfc_kiosk_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const encryptionKey = "11".repeat(32);
  const encrypted = await encryptKioskToken(token, encryptionKey);

  assert(encrypted.startsWith("v1."));
  assertEquals(encrypted.includes(token), false);
  assertEquals(await decryptKioskToken(encrypted, encryptionKey), token);
});

Deno.test("active kiosk sessions receive a 30-day idle window", () => {
  assertEquals(
    kioskSessionExpiry(new Date("2026-07-29T00:00:00.000Z")),
    "2026-08-28T00:00:00.000Z",
  );
});
