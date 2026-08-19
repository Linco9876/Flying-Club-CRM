import { assertEquals } from "jsr:@std/assert@1";
import { provisioningAccessFor } from "./userProvisioningRules.ts";

Deno.test("admins retain the full account-provisioning workflow", () => {
  assertEquals(provisioningAccessFor(["admin"], ["admin"]).allowed, true);
  assertEquals(
    provisioningAccessFor(["admin"], ["pilot", "instructor"]).allowed,
    true,
  );
});

Deno.test("instructors can provision exactly one Student or Pilot role", () => {
  for (const callerRole of ["instructor", "senior_instructor", "cfi"]) {
    assertEquals(provisioningAccessFor([callerRole], ["student"]).allowed, true);
    assertEquals(provisioningAccessFor([callerRole], ["pilot"]).allowed, true);
    assertEquals(provisioningAccessFor([callerRole], ["instructor"]), {
      allowed: false,
      isAdmin: false,
      isInstructorCreator: true,
      error: "Instructors can add Student or Pilot users only",
    });
    assertEquals(provisioningAccessFor([callerRole], ["student", "pilot"]).allowed, false);
  }
});

Deno.test("non-staff cannot provision accounts", () => {
  assertEquals(provisioningAccessFor(["pilot"], ["student"]), {
    allowed: false,
    isAdmin: false,
    isInstructorCreator: false,
    error: "Only admins and instructors can add portal users",
  });
});
