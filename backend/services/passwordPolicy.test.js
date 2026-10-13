import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPasswordPolicySatisfied } from "./passwordPolicy.js";

describe("password policy", () => {
  it("accepts passwords from 8 to 128 characters with all required character classes", () => {
    assert.equal(isPasswordPolicySatisfied("Abcdef1!"), true);
    assert.equal(isPasswordPolicySatisfied(`Abcdef1!${"x".repeat(120)}`), true);
  });

  it("rejects passwords missing length or a required character class", () => {
    assert.equal(isPasswordPolicySatisfied("Abcde1!"), false);
    assert.equal(isPasswordPolicySatisfied("abcdefgh!"), false);
    assert.equal(isPasswordPolicySatisfied("ABCDEFG1!"), false);
    assert.equal(isPasswordPolicySatisfied("Abcdefgh!"), false);
    assert.equal(isPasswordPolicySatisfied(`Abcdef1!${"x".repeat(121)}`), false);
    assert.equal(isPasswordPolicySatisfied(null), false);
  });
});