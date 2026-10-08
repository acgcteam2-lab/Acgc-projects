import { describe, expect, it } from "vitest";
import { getInstallationDateError, getMinimumInstallationDate } from "./installationSchedule";

describe("installation schedule date rules", () => {
  it("sets the minimum selectable installation date to the day after inspection", () => {
    expect(getMinimumInstallationDate("2026-10-10")).toBe("2026-10-11");
  });

  it("requires the estimated installation date to be strictly after inspection", () => {
    expect(getInstallationDateError("2026-10-10", "2026-10-09")).toMatch(/must be after/);
    expect(getInstallationDateError("2026-10-10", "2026-10-10")).toMatch(/must be after/);
    expect(getInstallationDateError("2026-10-10", "2026-10-11")).toBe("");
  });

  it("rejects invalid date values but allows an omitted optional estimate", () => {
    expect(getInstallationDateError("2026-10-10", "2026-02-30")).toMatch(/valid Est/);
    expect(getInstallationDateError("2026-10-10", "")).toBe("");
  });
});