import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFrontendUrl, getFrontendBaseUrl } from "./frontendUrl.js";

describe("frontend email URLs", () => {
  it("uses the configured production domain and normalizes slashes and query values", () => {
    const url = buildFrontendUrl("/verify-email", { token: "token/value" }, {
      NODE_ENV: "production",
      FRONTEND_URL: "https://acgc.example.com///",
    });
    assert.equal(url, "https://acgc.example.com/verify-email?token=token%2Fvalue");
  });

  it("keeps localhost fallback for local development only", () => {
    assert.equal(buildFrontendUrl("verify-email", { token: "local" }, { NODE_ENV: "development" }), "http://localhost:5173/verify-email?token=local");
  });

  it("requires FRONTEND_URL in production and rejects invalid URLs", () => {
    assert.throws(() => getFrontendBaseUrl({ NODE_ENV: "production" }), /FRONTEND_URL must be set/);
    assert.throws(() => getFrontendBaseUrl({ NODE_ENV: "production", FRONTEND_URL: "acgc.example.com" }), /valid absolute/);
  });
});