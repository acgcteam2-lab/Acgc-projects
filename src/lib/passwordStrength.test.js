import { describe, expect, it } from "vitest";
import { getPasswordStrength } from "./passwordStrength";

describe("getPasswordStrength", () => {
  it("returns no level for an empty password", () => {
    expect(getPasswordStrength("")).toEqual({ score: 0, label: "", color: "#cbd5e1" });
  });

  it("uses the same weak, fair, good, and strong levels as signup", () => {
    expect(getPasswordStrength("abc").label).toBe("Weak");
    expect(getPasswordStrength("abcdefgh1234").label).toBe("Fair");
    expect(getPasswordStrength("Abcdef1!").label).toBe("Good");
    expect(getPasswordStrength("Abcdefgh123!").label).toBe("Strong");
  });
});