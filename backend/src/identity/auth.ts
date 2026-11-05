import { randomInt, randomUUID } from "node:crypto";
import type pg from "pg";
import type { z } from "zod";
import { phoneLock, transaction } from "../db.js";
import { ApiError, invalidAuth, invalidChallenge } from "../http.js";
import * as c from "./contracts.js";
import {
  Security,
  digest,
  equal,
  secretToken,
  hashPassword,
  verifyPassword,
} from "./security.js";
import type { OtpProvider } from "./provider.js";
import { audit } from "./audit.js";
import { rateLimit } from "./rate-limit.js";
type Context = { requestId: string; ip: string };
type Purpose = "register" | "login" | "reset_password";
type Challenge = Record<string, any>;
const kindFor = (app: c.App) => (app === "admin" ? "staff" : app);
const validUser = (u: any, app: c.App) =>
  u && u.kind === kindFor(app) && ["active", "pending"].includes(u.status);
export class AuthService {
  constructor(
    public pool: pg.Pool,
    public security: Security,
    public provider: OtpProvider,
  ) {}
  async send(message: Parameters<OtpProvider["send"]>[0]) {
    try {
      await this.provider.send(message);
    } catch {
      throw new ApiError(503, "OTP_UNAVAILABLE", "تعذر إرسال رمز التحقق");
    }
  }
  async start(
    purpose: Purpose,
    input:
      | z.infer<typeof c.loginStart>
      | z.infer<typeof c.registerStart>
      | z.infer<typeof c.resetStart>,
    ctx: Context,
  ) {
    await rateLimit(this.pool, this.security, "start", {
      ip: ctx.ip,
      phone: input.phone,
      device: input.deviceId,
    });
    if (this.provider.mode === "unconfigured")
      throw new ApiError(503, "OTP_UNAVAILABLE", "خدمة التحقق غير مهيأة");
    let payload: {
      name?: string;
      passwordHash?: string;
      userId?: string;
    } | null = null;
    // Equal-cost hash/verify also for duplicate and unknown accounts.
    const before = (
      await this.pool.query("SELECT * FROM users WHERE phone_e164=$1", [
        input.phone,
      ])
    ).rows[0];
    if (purpose === "register") {
      const v = input as z.infer<typeof c.registerStart>;
      const passwordHash = await hashPassword(v.password);
      if (!before) payload = { name: v.name, passwordHash };
    } else if (purpose === "login") {
      const v = input as z.infer<typeof c.loginStart>;
      const correct = await verifyPassword(
        before?.password_hash ?? this.security.dummyHash,
        v.password,
      );
      if (!correct || !validUser(before, v.app)) {
        await audit(
          this.pool,
          ctx.requestId,
          null,
          "auth.password_rejected",
          "auth_attempt",
          null,
          { app: v.app },
        );
        throw invalidAuth();
      }
      payload = { userId: before.id, passwordHash: before.password_hash };
    } else {
      // Same password work, response shape and challenge storage for an unknown number.
      await verifyPassword(this.security.dummyHash, "unmatched-reset-password");
      if (validUser(before, input.app))
        payload = { userId: before.id, passwordHash: before.password_hash };
    }
    const id = randomUUID(),
      preauth = secretToken(),
      code = String(randomInt(0, 1000000)).padStart(6, "0");
    await transaction(this.pool, async (db) => {
      await phoneLock(db, input.phone);
      const recent = await db.query(
        `SELECT 1 FROM otp_challenges WHERE phone_e164=$1 AND purpose=$2 AND app=$3 AND resend_after>now() ORDER BY created_at DESC LIMIT 1`,
        [input.phone, purpose, input.app],
      );
      if (recent.rowCount)
        throw new ApiError(429, "RESEND_TOO_SOON", "انتظر قبل طلب رمز آخر");
      await db.query(
        `UPDATE otp_challenges SET consumed_at=now(),pending_payload_encrypted=NULL WHERE phone_e164=$1 AND purpose=$2 AND app=$3 AND consumed_at IS NULL`,
        [input.phone, purpose, input.app],
      );
      await db.query(
        `INSERT INTO otp_challenges(id,phone_e164,purpose,app,code_hmac,preauth_digest,pending_payload_encrypted,expires_at,resend_after,device_digest,user_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '5 minutes',now()+interval '60 seconds',$8,$9)`,
        [
          id,
          input.phone,
          purpose,
          input.app,
          this.codeHash(
            id,
            input.phone,
            purpose,
            input.app,
            input.deviceId,
            preauth,
            1,
            code,
          ),
          digest(preauth),
          payload ? this.security.encrypt(payload) : null,
          this.device(input.deviceId),
          payload?.userId ?? null,
        ],
      );
      // Bounded send in the same serialized issuance transaction; failed sends roll back challenge changes.
      await this.send({
        phone: input.phone,
        code,
        purpose,
        app: input.app,
        challengeId: id,
      });
      await audit(
        db,
        ctx.requestId,
        null,
        "auth.challenge_started",
        "otp_challenge",
        id,
        { purpose, app: input.app },
      );
    });
    return {
      challengeId: id,
      preauthToken: preauth,
      expiresIn: 300,
      resendAfter: 60,
      message: "إذا كانت البيانات مؤهلة فسيصلك رمز التحقق",
    };
  }
  device(id: string) {
    return this.security.hmac("device", id);
  }
  codeHash(
    id: string,
    phone: string,
    purpose: string,
    app: string,
    device: string,
    preauth: string,
    generation: number,
    code: string,
  ) {
    return this.security.hmac(
      "otp-v1",
      id,
      phone,
      purpose,
      app,
      this.device(device),
      digest(preauth),
      generation,
      code,
    );
  }
  validProof(
    row: Challenge | undefined,
    input: z.infer<typeof c.resend>,
    purpose?: Purpose,
  ) {
    return (
      row &&
      row.app === input.app &&
      (!purpose || row.purpose === purpose) &&
      !row.consumed_at &&
      new Date(row.expires_at).getTime() > Date.now() &&
      row.attempts < 5 &&
      equal(row.preauth_digest, digest(input.preauthToken)) &&
      equal(row.device_digest, this.device(input.deviceId))
    );
  }
  async resend(input: z.infer<typeof c.resend>, ctx: Context) {
    await rateLimit(this.pool, this.security, "resend", {
      ip: ctx.ip,
      device: input.deviceId,
    });
    const preview = (
      await this.pool.query(
        "SELECT phone_e164 FROM otp_challenges WHERE id=$1",
        [input.challengeId],
      )
    ).rows[0];
    if (!preview) throw invalidChallenge();
    await rateLimit(this.pool, this.security, "send-phone", {
      ip: ctx.ip,
      device: input.deviceId,
      phone: preview.phone_e164,
    });
    return transaction(this.pool, async (db) => {
      await phoneLock(db, preview.phone_e164);
      const row = (
        await db.query("SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE", [
          input.challengeId,
        ])
      ).rows[0];
      if (!this.validProof(row, input)) throw invalidChallenge();
      if (new Date(row.resend_after).getTime() > Date.now())
        throw new ApiError(429, "RESEND_TOO_SOON", "انتظر قبل إعادة الإرسال");
      const code = String(randomInt(0, 1000000)).padStart(6, "0"),
        generation = row.generation + 1;
      await this.send({
        phone: row.phone_e164,
        code,
        purpose: row.purpose,
        app: row.app,
        challengeId: row.id,
      });
      await db.query(
        `UPDATE otp_challenges SET code_hmac=$2,generation=$3,expires_at=now()+interval '5 minutes',resend_after=now()+interval '60 seconds' WHERE id=$1`,
        [
          row.id,
          this.codeHash(
            row.id,
            row.phone_e164,
            row.purpose,
            row.app,
            input.deviceId,
            input.preauthToken,
            generation,
            code,
          ),
          generation,
        ],
      );
      await audit(
        db,
        ctx.requestId,
        null,
        "auth.challenge_resent",
        "otp_challenge",
        row.id,
      );
      return { challengeId: row.id, expiresIn: 300, resendAfter: 60 };
    });
  }
  async verify(
    purpose: Purpose,
    input: z.infer<typeof c.proof> | z.infer<typeof c.resetVerify>,
    ctx: Context,
  ) {
    await rateLimit(
      this.pool,
      this.security,
      "verify",
      { ip: ctx.ip, device: input.deviceId },
      { ip: 100, device: 40, phone: 30 },
    );
    const preview = (
      await this.pool.query(
        "SELECT phone_e164 FROM otp_challenges WHERE id=$1",
        [input.challengeId],
      )
    ).rows[0];
    if (!preview) throw invalidChallenge();
    await rateLimit(
      this.pool,
      this.security,
      "verify-phone",
      { ip: ctx.ip, device: input.deviceId, phone: preview.phone_e164 },
      { ip: 100, device: 40, phone: 30 },
    );
    const newHash =
      purpose === "reset_password"
        ? await hashPassword(
            (input as z.infer<typeof c.resetVerify>).newPassword,
          )
        : null;
    const result = await transaction(this.pool, async (db) => {
      await phoneLock(db, preview.phone_e164);
      const row = (
        await db.query("SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE", [
          input.challengeId,
        ])
      ).rows[0];
      if (!this.validProof(row, input, purpose)) return null;
      const correct = equal(
        row.code_hmac,
        this.codeHash(
          row.id,
          row.phone_e164,
          purpose,
          input.app,
          input.deviceId,
          input.preauthToken,
          row.generation,
          input.code,
        ),
      );
      if (!correct || !row.pending_payload_encrypted) {
        await db.query(
          `UPDATE otp_challenges SET attempts=attempts+1,pending_payload_encrypted=CASE WHEN attempts=4 THEN NULL ELSE pending_payload_encrypted END WHERE id=$1`,
          [row.id],
        );
        await audit(
          db,
          ctx.requestId,
          null,
          "auth.challenge_rejected",
          "otp_challenge",
          row.id,
          { attempts: row.attempts + 1 },
        );
        return null; // Commit failed-attempt counters, then return the HTTP error outside the transaction.
      }
      const payload = this.security.decrypt(row.pending_payload_encrypted);
      let user;
      if (purpose === "register") {
        if (
          (
            await db.query("SELECT 1 FROM users WHERE phone_e164=$1", [
              row.phone_e164,
            ])
          ).rowCount
        )
          return null;
        user = (
          await db.query(
            `INSERT INTO users(phone_e164,name_ar,password_hash,kind,status,phone_verified_at) VALUES($1,$2,$3,'customer','active',now()) RETURNING *`,
            [row.phone_e164, payload.name, payload.passwordHash],
          )
        ).rows[0];
      } else {
        user = (
          await db.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
            payload.userId,
          ])
        ).rows[0];
        if (
          !validUser(user, input.app) ||
          user.password_hash !== payload.passwordHash
        )
          return null;
        if (user.status === "pending")
          await db.query(
            `UPDATE users SET status='active',phone_verified_at=now() WHERE id=$1`,
            [user.id],
          );
      }
      await db.query(
        "UPDATE otp_challenges SET consumed_at=now(),pending_payload_encrypted=NULL WHERE id=$1",
        [row.id],
      );
      if (purpose === "reset_password") {
        await db.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
          user.id,
          newHash,
        ]);
        await db.query(
          "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1",
          [user.id],
        );
        await db.query(
          "UPDATE otp_challenges SET consumed_at=coalesce(consumed_at,now()),pending_payload_encrypted=NULL,resend_after=least(resend_after,now()) WHERE phone_e164=$1",
          [row.phone_e164],
        );
        await audit(
          db,
          ctx.requestId,
          user.id,
          "auth.password_reset",
          "user",
          user.id,
        );
        return { passwordReset: true };
      }
      const session = await this.issueSession(
        db,
        user.id,
        input.app,
        input.deviceId,
      );
      await audit(
        db,
        ctx.requestId,
        user.id,
        "auth.session_created",
        "session",
        session.sessionId,
        { app: input.app },
      );
      return session;
    });
    if (!result) throw invalidChallenge();
    return result;
  }
  async issueSession(
    db: pg.PoolClient,
    userId: string,
    app: c.App,
    deviceId: string,
  ) {
    const token = secretToken(),
      id = randomUUID();
    await db.query(
      `INSERT INTO sessions(id,user_id,app,refresh_token_hash,device_digest,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 days')`,
      [id, userId, app, digest(token), this.device(deviceId)],
    );
    await db.query(
      `INSERT INTO session_refresh_tokens(token_hash,session_id,expires_at) SELECT refresh_token_hash,id,expires_at FROM sessions WHERE id=$1`,
      [id],
    );
    return {
      sessionId: id,
      accessToken: await this.security.access(userId, id, app),
      refreshToken: token,
      tokenType: "Bearer",
      expiresIn: 900,
    };
  }
  async refresh(input: z.infer<typeof c.refresh>, ctx: Context) {
    await rateLimit(
      this.pool,
      this.security,
      "refresh",
      { ip: ctx.ip, device: input.deviceId },
      { ip: 200, device: 100, phone: 10 },
    );
    const hash = digest(input.refreshToken);
    const found = (
      await this.pool.query(
        `SELECT s.id,s.user_id FROM sessions s JOIN session_refresh_tokens t ON t.session_id=s.id WHERE t.token_hash=$1`,
        [hash],
      )
    ).rows[0];
    if (!found) throw invalidAuth();
    const result = await transaction(this.pool, async (db) => {
      const user = (
        await db.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
          found.user_id,
        ])
      ).rows[0];
      const s = (
        await db.query("SELECT * FROM sessions WHERE id=$1 FOR UPDATE", [
          found.id,
        ])
      ).rows[0];
      if (
        !s ||
        s.app !== input.app ||
        !equal(s.device_digest, this.device(input.deviceId)) ||
        s.revoked_at ||
        new Date(s.expires_at).getTime() <= Date.now() ||
        user?.status !== "active" ||
        user.kind !== kindFor(input.app)
      )
        return null;
      const spent = (
        await db.query(
          "SELECT used_at FROM session_refresh_tokens WHERE token_hash=$1",
          [hash],
        )
      ).rows[0];
      if (spent?.used_at || !equal(s.refresh_token_hash, hash)) {
        await db.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [
          s.id,
        ]);
        await audit(
          db,
          ctx.requestId,
          user.id,
          "auth.refresh_reuse",
          "session",
          s.id,
        );
        return null;
      }
      const next = secretToken();
      await db.query(
        "UPDATE session_refresh_tokens SET used_at=now() WHERE token_hash=$1",
        [hash],
      );
      await db.query(
        "INSERT INTO session_refresh_tokens(token_hash,session_id,expires_at) VALUES($1,$2,$3)",
        [digest(next), s.id, s.expires_at],
      );
      await db.query("UPDATE sessions SET refresh_token_hash=$2 WHERE id=$1", [
        s.id,
        digest(next),
      ]);
      await audit(
        db,
        ctx.requestId,
        user.id,
        "auth.session_refreshed",
        "session",
        s.id,
      );
      return {
        sessionId: s.id,
        accessToken: await this.security.access(user.id, s.id, input.app),
        refreshToken: next,
        tokenType: "Bearer",
        expiresIn: 900,
      };
    });
    if (!result) throw invalidAuth();
    return result;
  }
  async logout(userId: string, sessionId: string, ctx: Context) {
    await transaction(this.pool, async (db) => {
      await db.query(
        "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND user_id=$2",
        [sessionId, userId],
      );
      await db.query("UPDATE push_tokens SET active=false,version=version+1,updated_at=now() WHERE user_id=$1 AND session_id=$2 AND active",[userId,sessionId]);
      await audit(
        db,
        ctx.requestId,
        userId,
        "auth.logout",
        "session",
        sessionId,
      );
    });
  }
}
