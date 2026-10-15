import { describe, expect, it } from "vitest";
import { getPasswordStrength, isPasswordPolicySatisfied } from "./passwordStrength";

describe("getPasswordStrength", () => {
  it("returns no level for an empty password", () => {
    expect(getPasswordStrength("")).toEqual({ score: 0, label: "", color: "#cbd5e1" });
  });

  it("marks a 12-character password meeting the complete policy as strong", () => {
    expect(getPasswordStrength("abc").label).toBe("Weak");
    expect(getPasswordStrength("abcdefgh1234").label).toBe("Fair");
    expect(getPasswordStrength("Abcdef1!").label).toBe("Weak");
    expect(getPasswordStrength("Abcdefgh123!").label).toBe("Strong");
  });

  it("requires 12-128 characters with mixed case, a number, and a symbol", () => {
    expect(isPasswordPolicySatisfied("Abcdef1!")).toBe(false);
    expect(isPasswordPolicySatisfied("Abcdefgh123!")).toBe(true);
    expect(isPasswordPolicySatisfied("Abcde1!")).toBe(false);
    expect(isPasswordPolicySatisfied("abcdefgh!")).toBe(false);
    expect(isPasswordPolicySatisfied("ABCDEFG1!")).toBe(false);
    expect(isPasswordPolicySatisfied(`Abcdefgh123!${"x".repeat(116)}`)).toBe(true);
    expect(isPasswordPolicySatisfied(`Abcdefgh123!${"x".repeat(117)}`)).toBe(false);
  });
});