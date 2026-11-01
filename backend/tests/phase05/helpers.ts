import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { once } from "node:events";
import { createPool } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { readConfig } from "../../src/config.js";
import { Security, hashPassword } from "../../src/identity/security.js";
import type { OtpProvider, OtpMessage } from "../../src/identity/provider.js";
import { createApp } from "../../src/app.js";
import { responseContracts } from "./contracts.js";
export const device = "phase05-test-device-identity-0000000000001";
export const pass = "Isolated-Password-05!";
export class CaptureProvider implements OtpProvider {
  readonly mode = "test" as const;
  messages: OtpMessage[] = [];
  fail = false;
  async send(v: OtpMessage) {
    if (this.fail) throw new Error("Test transport unavailable");
    this.messages.push({ ...v });
  }
  code(id: string) {
    const m = this.messages.findLast((x) => x.challengeId === id);
    assert(m);
    return m.code;
  }
}
export async function fixture(extra:Record<string,any>={}) {
  const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL,
    url = process.env.TEST_DATABASE_URL;
  assert(
    ownerUrl && url,
    "Run npm run test:phase05 against real isolated PostgreSQL",
  );
  for (const u of [ownerUrl, url])
    assert.match(new URL(u).pathname, /^\/tazweed_test_auth_[a-f0-9]+$/);
  await migrate(ownerUrl);
  const owner = createPool(ownerUrl),
    pool = createPool(url);
  await owner.query(
    await readFile(
      new URL("../../database/runtime-grants.sql", import.meta.url),
      "utf8",
    ),
  );
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const config = readConfig({
    NODE_ENV: "test",
    APP_ENV: "test",
    DATABASE_URL: url,
    JWT_PRIVATE_KEY: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    JWT_PUBLIC_KEY: publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
    OTP_HMAC_SECRET: randomBytes(32).toString("hex"),
    CORS_ALLOWED_ORIGINS: "https://test.example",
  });
  const security = await Security.create(config),
    provider = new CaptureProvider(),
    logs: Record<string, unknown>[] = [];
  const app = createApp({
    ...extra,
    config,
    pool,
    security,
    provider,
    log: (entry) => logs.push(entry),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert(addr && typeof addr !== "string");
  const origin = `http://127.0.0.1:${addr.port}`;
  const contracts = responseContracts();
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    token?: string,
    app = "customer",
    headers: Record<string, string> = {},
  ) => {
    const r = await fetch(origin + path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token
          ? { Authorization: "Bearer " + token, "X-Client-App": app }
          : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await r.text(),
      bodyResult = text ? JSON.parse(text) : null;
    contracts.check(method, path, r.status, bodyResult);
    return { status: r.status, body: bodyResult, headers: r.headers, text };
  };
  const hash = await hashPassword(pass);
  const user = async (
    phone = "770001001",
    kind = "customer",
    status = "active",
  ) =>
    (
      await owner.query(
        `INSERT INTO users(phone_e164,name_ar,password_hash,kind,status,phone_verified_at) VALUES($1,'حساب اختبار صريح',$2,$3,$4,CASE WHEN $4='active' THEN now() END) RETURNING *`,
        ["+967" + phone, hash, kind, status],
      )
    ).rows[0];
  const login = async (u: any, app = "customer", d = device) => {
    const start = await request("POST", "/api/v1/auth/login/start", {
      phone: u.phone_e164,
      password: pass,
      app,
      deviceId: d,
    });
    assert.equal(start.status, 202, JSON.stringify(start.body));
    const proof = {
      app,
      deviceId: d,
      challengeId: start.body.challengeId,
      preauthToken: start.body.preauthToken,
      code: provider.code(start.body.challengeId),
    };
    const verified = await request("POST", "/api/v1/auth/login/verify", proof);
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    return { ...verified.body, proof, user: u };
  };
  const reset = async () => {
    // This is a freshly created disposable DB, checked above. No runtime/production reset path exists.
    await owner.query(
      `TRUNCATE audit_logs; DELETE FROM session_refresh_tokens; DELETE FROM sessions; DELETE FROM otp_challenges; DELETE FROM staff_grants; DELETE FROM courier_branches; DELETE FROM courier_profiles; DELETE FROM addresses; DELETE FROM users; DELETE FROM auth_rate_buckets;`,
    );
    await owner.query(
      `DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code<>'general_admin')`,
    );
    await owner.query(`DELETE FROM roles WHERE code<>'general_admin'`);
    await owner.query("DELETE FROM branches; DELETE FROM governorates");
    provider.messages = [];
    provider.fail = false;
    logs.length = 0;
  };
  return {
    owner,
    pool,
    config,
    security,
    provider,
    logs,
    origin,
    server,
    request,
    user,
    login,
    reset,
    ownerUrl,
    contracts,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await pool.end();
      await owner.end();
    },
  };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
