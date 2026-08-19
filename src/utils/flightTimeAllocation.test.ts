import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultFlightTimeAllocation,
  getFlightTimeAllocationLabel,
  updateFlightTimeAllocation,
  validateFlightTimeAllocation,
} from "./flightTimeAllocation.ts";

test("flight time defaults to dual with an instructor and solo without one", () => {
  assert.deepEqual(defaultFlightTimeAllocation(1.2, true), { dualTime: 1.2, soloTime: 0 });
  assert.deepEqual(defaultFlightTimeAllocation(1.2, false), { dualTime: 0, soloTime: 1.2 });
});

test("entering either part automatically calculates the remaining student time", () => {
  assert.deepEqual(updateFlightTimeAllocation({
    durationHours: 1.2,
    changedField: "soloTime",
    value: 0.4,
  }), { dualTime: 0.8, soloTime: 0.4 });
  assert.deepEqual(updateFlightTimeAllocation({
    durationHours: 1.2,
    changedField: "dualTime",
    value: 0.7,
  }), { dualTime: 0.7, soloTime: 0.5 });
});

test("mixed instructed time is valid and labelled clearly", () => {
  assert.equal(validateFlightTimeAllocation({
    durationHours: 1.2,
    dualTime: 0.8,
    soloTime: 0.4,
    hasInstructor: true,
  }), null);
  assert.equal(getFlightTimeAllocationLabel({ dualTime: 0.8, soloTime: 0.4 }), "Mixed dual / solo");
});

test("invalid or impossible allocations are rejected", () => {
  assert.match(validateFlightTimeAllocation({
    durationHours: 1.2,
    dualTime: 0.8,
    soloTime: 0.1,
    hasInstructor: true,
  }) || "", /must add up/);
  assert.match(validateFlightTimeAllocation({
    durationHours: 1.2,
    dualTime: 0.2,
    soloTime: 1,
    hasInstructor: false,
  }) || "", /requires an instructor/);
});
