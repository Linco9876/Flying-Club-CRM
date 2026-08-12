import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const manifestUrl = new URL("../config/database-function-permissions.json", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20260803200000_enforce_function_permission_manifest.sql", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const migration = await readFile(migrationUrl, "utf8");
const migrationsDirectoryUrl = new URL("../supabase/migrations/", import.meta.url);
const manifestMigrationName = migrationUrl.pathname.split("/").at(-1);
const migrationNames = (await readdir(migrationsDirectoryUrl))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const allMigrationSql = (
  await Promise.all(
    migrationNames.map((name) => readFile(new URL(name, migrationsDirectoryUrl), "utf8")),
  )
).join("\n");
const classifications = new Set([
  "anonymous_token_public",
  "authenticated_self_service",
  "staff_aal2",
  "service_worker",
  "trigger_internal",
]);
const roles = new Set(["anon", "authenticated", "service_role"]);

assert.equal(manifest.schema_version, 1);
assert.ok(manifest.functions.length >= 178, "Manifest must classify all reviewed functions");
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
    allMigrationSql.includes(`'${entry.signature.replaceAll("'", "''")}'`),
    `Migrations missing ${entry.signature}`,
  );
}
assert.equal(
  manifest.functions.filter((entry) => entry.classification === "anonymous_token_public").length,
  5,
);
assert.match(migration, /alter default privileges[\s\S]+revoke execute on functions from public,anon,authenticated,service_role/i);
assert.match(migration, /revoke all privileges on function %s from public,anon,authenticated,service_role/i);
assert.match(migration, /Unmanifested public function/);
assert.match(migration, /has_function_privilege\(permission_record\.role_name,permission_record\.function_oid,'EXECUTE'\)/i);
assert.match(migration, /select private\.assert_function_permission_manifest\(\)/i);

const laterMigrationNames = migrationNames.filter((name) => name > manifestMigrationName);
for (const name of laterMigrationNames) {
  const sql = await readFile(new URL(name, migrationsDirectoryUrl), "utf8");
  const changesPublicFunctionPermissions =
    /\bcreate\s+(?:or\s+replace\s+)?function\s+public\./i.test(sql)
    || /\b(?:grant|revoke)\b[\s\S]{0,160}\bon\s+function\s+public\./i.test(sql);
  if (changesPublicFunctionPermissions) {
    assert.match(
      sql,
      /select\s+private\.assert_function_permission_manifest\s*\(\s*\)\s*;/i,
      `${name} changes a public function but does not enforce the permission manifest afterward`,
    );
  }
}

console.log(
  `Function permission manifest passed: ${manifest.functions.length} signatures; ` +
    "PUBLIC removed, five anonymous RPCs retained, triggers closed.",
);
