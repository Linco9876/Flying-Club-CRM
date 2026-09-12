import assert from "node:assert/strict";
import test from "node:test";
import {
  prefillRpcDetails,
  rpcRetestWithinWindow,
  rpcRetestDeadline,
  recentRpcRetest,
  rpcRetestGroups,
} from "./rpcReviewWorkflow.ts";

test("prefill fills blanks while preserving saved zero, identifiers and manually entered values", () => {
  assert.deepEqual(
    prefillRpcDetails(
      {
        hours: "0",
        member: "067533",
        expiry: "",
        notes: "Original assessment",
      },
      {
        hours: 20,
        member: "other",
        expiry: "2027-07-08",
        notes: "Replacement",
        invented: "field",
      },
    ),
    {
      hours: "0",
      member: "067533",
      expiry: "2027-07-08",
      notes: "Original assessment",
    },
  );
});
test("retest includes day 30 but excludes day 31 and dates before the original flight", () => {
  assert.equal(rpcRetestWithinWindow("2026-09-11", "2026-10-11"), true);
  assert.equal(rpcRetestWithinWindow("2026-09-11", "2026-10-12"), false);
  assert.equal(rpcRetestWithinWindow("2026-09-11", "2026-09-10"), false);
  assert.equal(rpcRetestWithinWindow("invalid", "2026-09-11"), false);
});
test("the original unsuccessful date determines the window across multiple attempts", () => {
  assert.equal(rpcRetestWithinWindow("2026-09-11", "2026-10-20"), false);
  assert.equal(rpcRetestWithinWindow("2026-10-01", "2026-10-20"), true);
});

const attempt = (overrides = {}) => ({
  id: "first",
  candidateId: "pilot",
  reviewType: "raaus_rpc_flight_test",
  status: "further_training_required",
  reviewDate: "2026-08-01",
  createdAt: "2026-08-01T10:00:00Z",
  flightLogId: "flight-one",
  ...overrides,
});
test("offers a failed test through day 30, excluding wrong candidate, same flight and other review types", () => {
  const first = attempt();
  assert.equal(recentRpcRetest([first], "pilot", "2026-08-31")?.id, "first");
  assert.equal(recentRpcRetest([first], "pilot", "2026-09-01"), undefined);
  assert.equal(
    recentRpcRetest([first], "someone-else", "2026-08-10"),
    undefined,
  );
  assert.equal(
    recentRpcRetest([first], "pilot", "2026-08-10", "flight-one"),
    undefined,
  );
  assert.equal(
    recentRpcRetest(
      [attempt({ reviewType: "raaus_bfr" })],
      "pilot",
      "2026-08-10",
    ),
    undefined,
  );
  assert.equal(recentRpcRetest([first], "pilot", "2026-07-31"), undefined);
});
test("offers the latest unsuccessful child without restarting the original window", () => {
  const chain = [
    attempt(),
    attempt({
      id: "second",
      retestOfId: "first",
      retestRootId: "first",
      reviewDate: "2026-08-20",
      flightLogId: "flight-two",
    }),
  ];
  assert.equal(recentRpcRetest(chain, "pilot", "2026-08-31")?.id, "second");
  assert.equal(recentRpcRetest(chain, "pilot", "2026-09-01"), undefined);
  assert.equal(recentRpcRetest([chain[1]], "pilot", "2026-08-25"), undefined);
  assert.equal(rpcRetestDeadline(chain[0].reviewDate), "2026-08-31");
});
test("a successful retest or newer full pass stops suggesting the old unsuccessful review", () => {
  const first = attempt();
  const pass = attempt({
    id: "pass",
    status: "completed",
    reviewDate: "2026-08-20",
  });
  assert.equal(
    recentRpcRetest([first, pass], "pilot", "2026-08-25"),
    undefined,
  );
  assert.equal(
    recentRpcRetest(
      [first, { ...pass, retestOfId: "first", retestRootId: "first" }],
      "pilot",
      "2026-08-25",
    ),
    undefined,
  );
  assert.equal(
    recentRpcRetest(
      [first, { ...pass, status: "cancelled" }],
      "pilot",
      "2026-08-25",
    )?.id,
    "first",
  );
});
test("an open draft remains resumable rather than hiding the previous unsuccessful attempt", () => {
  assert.equal(
    recentRpcRetest(
      [
        attempt(),
        attempt({ id: "draft", retestOfId: "first", status: "draft" }),
      ],
      "pilot",
      "2026-08-25",
    )?.id,
    "first",
  );
});
test("focused progress excludes carried work and paperwork, and counts a reassessment even if further training remains", () => {
  const item = {
    code: "RPC-COMP-15",
    templateItemKey: "competency",
    section: "Pilot Certificate competency assessment",
    result: "not_assessed",
    required: true,
  };
  const items = [
    item,
    { ...item, code: "RPC-COMP-14", result: "further_training" },
    { ...item, code: "RPC-CMP-01", section: "Examiner completion" },
    { ...item, carriedFromItemId: "original-pass", result: "satisfactory" },
  ];
  const before = JSON.stringify(items);
  const groups = rpcRetestGroups(items);
  assert.equal(groups.competencies.length, 2);
  assert.equal(groups.reassessed, 1);
  assert.equal(groups.completion.length, 1);
  assert.equal(groups.carried.length, 1);
  assert.equal(
    JSON.stringify(items),
    before,
    "Grouping must never mutate assessment evidence",
  );
});
