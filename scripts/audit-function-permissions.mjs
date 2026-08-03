import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifestUrl = new URL("../config/database-function-permissions.json", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20260803200000_enforce_function_permission_manifest.sql", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const migration = await readFile(migrationUrl, "utf8");
const classifications = new Set([
  "anonymous_token_public",
  "authenticated_self_service",
  "staff_aal2",
  "service_worker",
  "trigger_internal",
]);
const roles = new Set(["anon", "authenticated", "service_role"]);

assert.equal(manifest.schema_version, 1);
assert.equal(manifest.functions.length, 178, "Manifest must classify all reviewed functions");
const signatures = new Set();
for (const entry of manifest.functions) {
  assert.match(entry.signature, /^public\.[a-z0-9_]+\(.*\)$/i);
  assert.ok(classifications.has(entry.classification), `Unknown class: ${entry.signature}`);
  assert.equal(signatures.has(entry.signature), false, `Duplicate: ${entry.signature}`);
  signatures.add(entry.signature);
  for (const role of entry.allowed_roles) {
    assert.ok(roles.has(role), `Unknown role ${role}: ${entry.signature}`);
  }
  assert.equal(entry.allowed_roles.includes("public"), false);
  if (entry.classification === "trigger_internal") {
    assert.deepEqual(entry.allowed_roles, [], `Trigger exposed: ${entry.signature}`);
  }
  assert.equal(
    entry.allowed_roles.includes("anon"),
    entry.classification === "anonymous_token_public",
    `Anonymous classification mismatch: ${entry.signature}`,
  );
  assert.ok(
    migration.includes(`('${entry.signature.replaceAll("'", "''")}'`),
    `Migration missing ${entry.signature}`,
  );
}
assert.equal(
  manifest.functions.filter((entry) => entry.classification === "anonymous_token_public").length,
  5,
);
assert.match(migration, /alter default privileges[\s\S]+revoke execute on functions from public,anon,authenticated,service_role/i);
assert.match(migration, /revoke all privileges on function %s from public,anon,authenticated,service_role/i);
assert.match(migration, /Unmanifested public function/);

console.log(
  `Function permission manifest passed: ${manifest.functions.length} signatures; ` +
    "PUBLIC removed, five anonymous RPCs retained, triggers closed.",
);
