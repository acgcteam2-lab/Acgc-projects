import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPasswordPolicySatisfied } from "./passwordPolicy.js";

describe("password policy", () => {
  it("accepts passwords from 12 to 128 characters with all required character classes", () => {
    assert.equal(isPasswordPolicySatisfied("Abcdefgh123!"), true);
    assert.equal(isPasswordPolicySatisfied(`Abcdefgh123!${"x".repeat(116)}`), true);
  });

  it("rejects passwords missing length or a required character class", () => {
    assert.equal(isPasswordPolicySatisfied("Abcdef1!"), false);
    assert.equal(isPasswordPolicySatisfied("Abcde1!"), false);
    assert.equal(isPasswordPolicySatisfied("abcdefgh!"), false);
    assert.equal(isPasswordPolicySatisfied("ABCDEFG1!"), false);
    assert.equal(isPasswordPolicySatisfied("Abcdefgh!"), false);
    assert.equal(isPasswordPolicySatisfied(`Abcdefgh123!${"x".repeat(117)}`), false);
    assert.equal(isPasswordPolicySatisfied(null), false);
  });
});