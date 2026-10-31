import {
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomUUID,
} from "node:crypto";
import argon2 from "argon2";
import { importPKCS8, importSPKI, SignJWT, jwtVerify } from "jose";
import type { Config } from "../config.js";
import type { App } from "./contracts.js";
export const secretToken = () => randomBytes(32).toString("base64url");
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const hashPassword = (p: string) =>
  argon2.hash(p, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
export class Security {
  private constructor(
    private config: Config,
    private privateKey: CryptoKey,
    private publicKey: CryptoKey,
    public dummyHash: string,
  ) {}
  static async create(config: Config) {
    const privateKey = await importPKCS8(config.JWT_PRIVATE_KEY, "EdDSA");
    const publicKey = await importSPKI(config.JWT_PUBLIC_KEY, "EdDSA");
    const s = new Security(
      config,
      privateKey,
      publicKey,
      await hashPassword(secretToken()),
    );
    const probe = await s.access(randomUUID(), randomUUID(), "customer");
    await s.readAccess(probe, "customer");
    return s;
  }
  hmac(...values: unknown[]) {
    return createHmac("sha256", Buffer.from(this.config.OTP_HMAC_SECRET, "hex"))
      .update(JSON.stringify(values))
      .digest("hex");
  }
  encrypt(payload: unknown) {
    const key = Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(this.config.OTP_HMAC_SECRET, "hex"),
        Buffer.alloc(0),
        "tazweed-pending-identity-v1",
        32,
      ),
    );
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
      "base64url",
    );
  }
  decrypt(payload: string) {
    const key = Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(this.config.OTP_HMAC_SECRET, "hex"),
        Buffer.alloc(0),
        "tazweed-pending-identity-v1",
        32,
      ),
    );
    const packed = Buffer.from(payload, "base64url"),
      decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(packed.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    ) as { name?: string; passwordHash?: string; userId?: string };
  }
  access(userId: string, sessionId: string, app: App) {
    return new SignJWT({ sid: sessionId, app })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .setSubject(userId)
      .setIssuer("tazweed-identity-v1")
      .setAudience(app)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(this.privateKey);
  }
  async readAccess(token: string, app: App) {
    const { payload, protectedHeader } = await jwtVerify(
      token,
      this.publicKey,
      {
        algorithms: ["EdDSA"],
        issuer: "tazweed-identity-v1",
        audience: app,
        requiredClaims: ["exp", "iat", "sub", "jti"],
      },
    );
    if (
      protectedHeader.typ !== "JWT" ||
      payload.app !== app ||
      typeof payload.sid !== "string" ||
      typeof payload.sub !== "string"
    )
      throw new Error("Invalid access token");
    return { userId: payload.sub, sessionId: payload.sid };
  }
}
