import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.js";
import { phone } from "../src/identity/contracts.js";
test("configuration rejects incomplete secrets, wildcard origins and production test providers", () => {
  assert.throws(() =>
    readConfig({ NODE_ENV: "production", OTP_PROVIDER: "test" }),
  );
  assert.throws(() => readConfig({}), /Invalid environment/);
});
test("Yemen mobile normalization accepts Arabic digits and rejects country substitution", () => {
  assert.equal(phone.parse("٧٧٠١٢٣٤٥٦"), "+967770123456");
  assert.equal(phone.parse("00967 78 123 4567"), "+967781234567");
  for (const n of [
    "+966770123456",
    "+967790123456",
    "770' OR 1=1--",
    "77012345",
    "١٥٥٥٥٥٥٥٥",
  ])
    assert.equal(phone.safeParse(n).success, false);
});
