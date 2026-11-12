import { expect, it } from "vitest";
import { pointsApplicationName } from "./points-application-name.js";

it("keeps the CI lock-monitor identity within PostgreSQL's 63-byte limit and preserves its UUID", () => {
  const name = pointsApplicationName("ds_points_originals_3989");
  expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63);
  expect(name).toMatch(/^points-ds_points_originals-/);
  expect(name).toMatch(
    /-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(pointsApplicationName("ds_points_originals_3989")).not.toBe(name);
});
