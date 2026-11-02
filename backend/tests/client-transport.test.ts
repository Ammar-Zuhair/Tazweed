import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { jsonRequest as customer } from "../../customer-app/src/live/transport.js";
import { jsonRequest as courier } from "../../courier-app/src/live/transport.js";
import { jsonRequest as admin } from "../../admin-app/src/live/transport.js";
const require = createRequire(
  new URL("../../customer-app/package.json", import.meta.url),
);
const NativeAbortController = require("abort-controller").AbortController;
for (const [name, request] of [
  ["customer", customer],
  ["admin", admin],
  ["courier", courier],
] as const)
  test(
    name +
      " JSON transport supports the actual React Native abort polyfill and aborts a stalled body",
    async () => {
      const original = globalThis.AbortController;
      globalThis.AbortController = NativeAbortController;
      const server = http
        .createServer((req, res) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          if (req.url === "/slow") {
            res.write('{"source":');
            setTimeout(() => res.end('"server"}'), 300);
          } else res.end('{"source":"server"}');
        })
        .listen(0, "127.0.0.1");
      try {
        assert.equal(
          typeof (new NativeAbortController().signal.constructor as any)
            .timeout,
          "undefined",
        );
        await new Promise<void>((resolve) => server.once("listening", resolve));
        const address = server.address();
        assert(address && typeof address !== "string");
        const base = "http://127.0.0.1:" + address.port;
        assert.deepEqual(
          (await request(base + "/fast", { method: "GET" }, 5000)).data,
          { source: "server" },
        );
        await assert.rejects(
          () => request(base + "/slow", { method: "GET" }, 40),
          { message: "انتهت مهلة الاتصال؛ حاول مجددًا" },
        );
      } finally {
        globalThis.AbortController = original;
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
