import {
  assert,
  assertEquals,
} from "jsr:@std/assert@1";
import {
  aircraftMatchesTrialVoucherProduct,
  instructorHasTrialVoucherAircraftEndorsement,
  trialVoucherProductBookingSetup,
} from "./trialVoucherReadiness.ts";

Deno.test("matches Tecnam voucher products to any Tecnam aircraft", () => {
  assert(aircraftMatchesTrialVoucherProduct(
    { id: "a1", registration: "24-4851", make: "Tecnam", model: "P92" },
    { aircraft_mode: "tecnam", aircraft_ids: [] },
  ));

  assert(!aircraftMatchesTrialVoucherProduct(
    { id: "a2", registration: "VH-ABC", make: "Piper", model: "PA-28 Archer" },
    { aircraft_mode: "tecnam", aircraft_ids: [] },
  ));
});

Deno.test("matches Archer voucher products to Archer and PA-28 labels", () => {
  assert(aircraftMatchesTrialVoucherProduct(
    { id: "a1", registration: "VH-ABC", make: "Piper", model: "PA-28-181" },
    { aircraft_mode: "archer", aircraft_ids: [] },
  ));

  assert(aircraftMatchesTrialVoucherProduct(
    { id: "a2", registration: "VH-XYZ", make: "Piper", model: "Archer III" },
    { aircraft_mode: "archer", aircraft_ids: [] },
  ));
});

Deno.test("explicit aircraft IDs override aircraft mode matching", () => {
  assert(aircraftMatchesTrialVoucherProduct(
    { id: "selected-archer", registration: "VH-ABC", make: "Piper", model: "Archer" },
    { aircraft_mode: "tecnam", aircraft_ids: ["selected-archer"] },
  ));

  assert(!aircraftMatchesTrialVoucherProduct(
    { id: "other-archer", registration: "VH-DEF", make: "Piper", model: "Archer" },
    { aircraft_mode: "archer", aircraft_ids: ["selected-archer"] },
  ));
});

Deno.test("instructor endorsement is required only when the aircraft requires one", () => {
  const endorsements = new Map<string, any[]>([
    ["instructor-1", [{ type: "pa28", is_active: true, expiry_date: "2099-01-01" }]],
    ["instructor-2", [{ type: "pa28", is_active: false, expiry_date: "2099-01-01" }]],
    ["instructor-3", [{ type: "pa28", is_active: true, expiry_date: "2000-01-01" }]],
  ]);

  assert(instructorHasTrialVoucherAircraftEndorsement(
    "instructor-1",
    { required_endorsement_type: "PA28" },
    endorsements,
  ));
  assert(!instructorHasTrialVoucherAircraftEndorsement(
    "instructor-2",
    { required_endorsement_type: "PA28" },
    endorsements,
  ));
  assert(!instructorHasTrialVoucherAircraftEndorsement(
    "instructor-3",
    { required_endorsement_type: "PA28" },
    endorsements,
  ));
  assert(instructorHasTrialVoucherAircraftEndorsement(
    "instructor-4",
    { required_endorsement_type: "" },
    endorsements,
  ));
});

Deno.test("booking setup requires serviceable aircraft and a qualified selected instructor", () => {
  const product = {
    aircraft_mode: "archer",
    aircraft_ids: [],
    instructor_ids: ["instructor-1", "instructor-2"],
  };
  const aircraftRows = [
    { id: "archer-1", registration: "VH-ABC", make: "Piper", model: "PA-28 Archer", status: "serviceable", required_endorsement_type: "pa28" },
    { id: "tecnam-1", registration: "24-4851", make: "Tecnam", model: "P92", status: "serviceable" },
  ];
  const endorsementRows = [
    { student_id: "instructor-1", type: "pa28", is_active: true, expiry_date: "2099-01-01" },
  ];

  assertEquals(trialVoucherProductBookingSetup(product, aircraftRows, endorsementRows), {
    bookingAvailable: true,
    aircraftCount: 1,
    serviceableAircraftCount: 1,
    instructorCount: 2,
    qualifiedInstructorCount: 1,
    issue: "",
  });
});

Deno.test("booking setup reports clear setup issues", () => {
  const noAircraft = trialVoucherProductBookingSetup(
    { aircraft_mode: "archer", aircraft_ids: [], instructor_ids: ["instructor-1"] },
    [{ id: "tecnam-1", make: "Tecnam", model: "P92", status: "serviceable" }],
    [],
  );
  assertEquals(noAircraft.bookingAvailable, false);
  assert(noAircraft.issue.includes("No eligible aircraft"));

  const noServiceableAircraft = trialVoucherProductBookingSetup(
    { aircraft_mode: "archer", aircraft_ids: [], instructor_ids: ["instructor-1"] },
    [{ id: "archer-1", make: "Piper", model: "Archer", status: "maintenance" }],
    [],
  );
  assertEquals(noServiceableAircraft.bookingAvailable, false);
  assert(noServiceableAircraft.issue.includes("No eligible aircraft are currently serviceable"));

  const noQualifiedInstructor = trialVoucherProductBookingSetup(
    { aircraft_mode: "archer", aircraft_ids: [], instructor_ids: ["instructor-1"] },
    [{ id: "archer-1", make: "Piper", model: "Archer", status: "serviceable", required_endorsement_type: "pa28" }],
    [{ student_id: "instructor-1", type: "tecnam", is_active: true, expiry_date: "2099-01-01" }],
  );
  assertEquals(noQualifiedInstructor.bookingAvailable, false);
  assert(noQualifiedInstructor.issue.includes("No selected instructor currently holds the required aircraft endorsement"));
});
