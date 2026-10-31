import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpsOtpProvider } from "../src/identity/provider.js";
const message = {
  phone: "+967770000001",
  code: "123456",
  purpose: "login",
  app: "customer",
  challengeId: "test-contract",
};
test("HTTPS gateway transport enforces TLS, rejects redirects/errors/timeouts and does not forward passwords", async () => {
  assert.throws(
    () => new HttpsOtpProvider("http://insecure.example", "test-only"),
  );
  const original = globalThis.fetch;
  const seen: any[] = [];
  try {
    globalThis.fetch = (async (url, init) => {
      seen.push({ url, init });
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    const provider = new HttpsOtpProvider(
      "https://gateway.example/otp",
      "isolated-test-token",
    );
    await provider.send(message);
    assert.deepEqual(JSON.parse(seen[0].init.body), message);
    assert.equal(seen[0].init.redirect, "error");
    assert(!seen[0].init.body.includes("password"));
    for (const response of ["rejected", "redirect", "timeout"]) {
      globalThis.fetch = (async () => {
        if (response === "timeout")
          throw new Error("network secret must not leak");
        return new Response("private gateway body", {
          status: response === "redirect" ? 302 : 500,
        });
      }) as typeof fetch;
      await assert.rejects(
        provider.send(message),
        (e) =>
          (e as any).code === "OTP_UNAVAILABLE" &&
          !(e as Error).message.includes("secret"),
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});
