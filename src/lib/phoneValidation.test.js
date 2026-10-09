import { describe, expect, it } from "vitest";
import { getPhilippinePhoneError, isValidPhilippinePhone, normalizePhoneInput } from "./phoneValidation";

describe("Philippine phone validation", () => {
  it.each(["09171234567", "+639171234567", "639171234567"])("accepts %s", (phone) => {
    expect(isValidPhilippinePhone(phone)).toBe(true);
    expect(getPhilippinePhoneError(phone)).toBe("");
  });

  it.each(["", "9171234567", "091712345678", "+63917123456", "+631234567890"])("rejects %s", (phone) => {
    expect(isValidPhilippinePhone(phone)).toBe(false);
    expect(getPhilippinePhoneError(phone)).toContain("Enter an 11-digit PH mobile number");
  });

  it("preserves an international prefix and removes separators", () => {
    expect(normalizePhoneInput(" +63 917-123-4567 ")).toBe("+639171234567");
    expect(normalizePhoneInput("0917 123 4567")).toBe("09171234567");
  });
});