import test from "node:test";
import assert from "node:assert/strict";
import { isCustomerPermissionEnabled } from "./customerPermissions.js";

test("global restrictions override an enabled account permission", () => {
  assert.equal(isCustomerPermissionEnabled("can_request_orders", { can_request_orders: true }, { can_request_orders: false }), false);
});

test("global access never enables a permission disabled for one account", () => {
  assert.equal(isCustomerPermissionEnabled("can_upload_feedback", { can_upload_feedback: false }, { can_upload_feedback: true }), false);
});

test("view-only access restricts every customer action at either scope", () => {
  assert.equal(isCustomerPermissionEnabled("can_track_products", { can_track_products: true }, { view_only_access: true }), false);
  assert.equal(isCustomerPermissionEnabled("can_estimate_pricing", { view_only_access: true }, { can_estimate_pricing: true }), false);
});

test("missing legacy permission values remain allowed unless either scope is view-only", () => {
  assert.equal(isCustomerPermissionEnabled("can_request_orders"), true);
});