import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDates, validTimezone } from "../src/server/time";

const now = new Date("2026-11-10T15:00:00.000Z");
test("resolves the challenge's relative dates against the actual clock", () => {
  assert.equal(
    resolveDates("On Monday we shortlisted 5 CRM tools", "Asia/Kolkata", now)[0]?.date,
    "2026-11-09",
  );
  assert.equal(
    resolveDates("Last Tuesday I asked about Postgres", "Asia/Kolkata", now)[0]?.date,
    "2026-11-03",
  );
  assert.equal(
    resolveDates("What did I ask on 3 November?", "Asia/Kolkata", now)[0]?.date,
    "2026-11-03",
  );
  assert.equal(
    resolveDates("What did I ask yesterday?", "Asia/Kolkata", now)[0]?.date,
    "2026-11-09",
  );
});
test("date windows follow the user's timezone and include local midnight", () => {
  const anchor = resolveDates("3 November", "Asia/Kolkata", now)[0];
  assert.equal(anchor.start, "2026-11-02T18:30:00.000Z");
  assert.equal(anchor.end, "2026-11-03T18:30:00.000Z");
  assert.equal(
    resolveDates("today", "America/Los_Angeles", new Date("2026-11-10T01:00:00Z"))[0].date,
    "2026-11-09",
  );
});
test("DST days use calendar boundaries, not fixed 24-hour offsets", () => {
  const anchor = resolveDates("1 November 2026", "America/New_York", now)[0];
  assert.equal((Date.parse(anchor.end) - Date.parse(anchor.start)) / 3600000, 25);
});
test("yearless history dates in the future resolve to the previous year", () => {
  assert.equal(resolveDates("What did I ask on 12 December?", "UTC", now)[0]?.date, "2025-12-12");
  assert.equal(validTimezone("garbage"), false);
  assert.equal(validTimezone("Asia/Calcutta"), true);
});
