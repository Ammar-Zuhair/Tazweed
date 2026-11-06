import { randomInt, randomUUID } from "node:crypto";
import type pg from "pg";
import type { Config } from "../config.js";
import { phoneLock, transaction } from "../db.js";
import { ApiError, invalidChallenge, notFound } from "../http.js";
import { AuthService } from "../identity/auth.js";
import { audit } from "../identity/audit.js";
import { digest, equal, secretToken } from "../identity/security.js";
import { rateLimit } from "../identity/rate-limit.js";
import { requirePermission, type Identity } from "../identity/access.js";
import { policy } from "./policy.js";
import type { ObjectStore } from "../catalog/media.js";
const notices: Record<string, string> = {
  shared_attachment_review:
    "يوجد مرفق مشترك مع حساب آخر يحتاج فصلًا أو تعمية موثقة قبل إكمال الحذف.",
  policy_required:
    "استلم طلبك وأبطلت الجلسات؛ يحتاج إكمال إعدادات سياسة الاحتفاظ من الإدارة قبل التنفيذ.",
  open_obligations:
    "استلم طلبك؛ توجد طلبات أو تحويلات أو شكوى جارية تحتاج إغلاقًا قبل إزالة بيانات التنفيذ.",
  courier_balance: "يوجد رصيد نقد أو عمولة يحتاج تسوية قبل إزالة هوية الموصل.",
  last_admin: "يحتاج نقل مسؤولية الإدارة إلى مدير آخر قبل حذف هذا الحساب.",
};
export function deletionDto(r: any) {
  return {
    id: r.id,
    status: r.status,
    verifiedAt: r.verified_at,
    accountErasedAt: r.account_erased_at,
    completedAt: r.completed_at,
    retainedUntil: r.retained_until,
    notice:
      r.retention_notice ??
      "جارٍ تنفيذ حذف الحساب؛ قد تبقى بيانات محدودة وفق السياسة.",
    policyVersion: r.policy_snapshot?.version ?? null,
  };
}
export class DeletionService {
  constructor(
    public auth: AuthService,
    public config: Config,
    public store: ObjectStore,
  ) {}
  async start(v: any, ctx: any, i?: Identity) {
    const { pool, security, provider } = this.auth;
    const phone = i?.phone_e164 ?? v.phone;
    if (i && v.phone !== phone)
      throw new ApiError(422, "PHONE_MISMATCH", "استخدم رقم حسابك المسجل");
    await rateLimit(
      pool,
      security,
      "deletion-start",
      { ip: ctx.ip, phone, device: v.deviceId },
      { ip: 30, device: 8, phone: 5 },
    );
    if (provider.mode === "unconfigured")
      throw new ApiError(503, "OTP_UNAVAILABLE", "خدمة التحقق غير مهيأة");
    const id = randomUUID(),
      preauth = secretToken(),
      code = String(randomInt(0, 1000000)).padStart(6, "0");
    await transaction(pool, async (db) => {
      await phoneLock(db, phone);
      if (
        (
          await db.query(
            "SELECT 1 FROM otp_challenges WHERE phone_e164=$1 AND purpose='delete_account' AND resend_after>now()",
            [phone],
          )
        ).rowCount
      )
        throw new ApiError(
          429,
          "RESEND_TOO_SOON",
          "انتظر60 ثانية قبل طلب رمز جديد",
        );
      const u = (
        await db.query(
          "SELECT id,kind FROM users WHERE phone_e164=$1 AND status<>'deleted'",
          [phone],
        )
      ).rows[0];
      const eligible = u && (!i || u.id === i.id);
      await db.query(
        "UPDATE otp_challenges SET consumed_at=now(),pending_payload_encrypted=NULL WHERE phone_e164=$1 AND purpose='delete_account' AND consumed_at IS NULL",
        [phone],
      );
      await db.query(
        `INSERT INTO otp_challenges(id,phone_e164,purpose,app,code_hmac,preauth_digest,pending_payload_encrypted,expires_at,resend_after,device_digest,user_id) VALUES($1,$2,'delete_account',$3,$4,$5,$6,now()+interval '5 minutes',now()+interval '60 seconds',$7,$8)`,
        [
          id,
          phone,
          v.app,
          this.auth.codeHash(
            id,
            phone,
            "delete_account",
            v.app,
            v.deviceId,
            preauth,
            1,
            code,
          ),
          digest(preauth),
          eligible
            ? security.encrypt({ userId: u.id, source: i ? "app" : "web" })
            : null,
          this.auth.device(v.deviceId),
          eligible ? u.id : null,
        ],
      );
      await this.auth.send({
        phone,
        code,
        purpose: "delete_account",
        app: v.app,
        challengeId: id,
      });
      await audit(
        db,
        ctx.requestId,
        i?.id ?? null,
        "privacy.challenge_started",
        "otp_challenge",
        id,
      );
    });
    return {
      challengeId: id,
      preauthToken: preauth,
      requestId: id,
      receiptToken: security.hmac("deletion-receipt", id, preauth),
      expiresIn: 300,
      resendAfter: 60,
      message: "إذا كانت البيانات مؤهلة فسيصلك رمز التحقق",
    };
  }
  async verify(v: any, ctx: any, i?: Identity) {
    const { pool, security } = this.auth;
    await rateLimit(
      pool,
      security,
      "deletion-verify",
      { ip: ctx.ip, device: v.deviceId },
      { ip: 60, device: 30, phone: 20 },
    );
    const proofDigest = security.hmac(
        "deletion-proof",
        v.challengeId,
        v.preauthToken,
        v.code,
        v.deviceId,
        v.app,
      ),
      receiptToken = security.hmac(
        "deletion-receipt",
        v.challengeId,
        v.preauthToken,
      );
    const preview = (
      await pool.query("SELECT phone_e164 FROM otp_challenges WHERE id=$1", [
        v.challengeId,
      ])
    ).rows[0];
    const result = await transaction(pool, async (db) => {
      if (preview) await phoneLock(db, preview.phone_e164);
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,1101))",
        [v.challengeId],
      );
      const old = (
        await db.query(
          "SELECT * FROM deletion_requests WHERE challenge_id=$1",
          [v.challengeId],
        )
      ).rows[0];
      if (old) {
        if (
          !equal(old.proof_digest, proofDigest) ||
          (i && i.id !== old.user_id)
        )
          return null;
        return { ...deletionDto(old), receiptToken };
      }
      const r = (
        await db.query("SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE", [
          v.challengeId,
        ])
      ).rows[0];
      if (
        !r ||
        r.purpose !== "delete_account" ||
        r.app !== v.app ||
        r.consumed_at ||
        new Date(r.expires_at).getTime() <= Date.now() ||
        r.attempts >= 5 ||
        !equal(r.preauth_digest, digest(v.preauthToken)) ||
        !equal(r.device_digest, this.auth.device(v.deviceId))
      )
        return null;
      if (
        !equal(
          r.code_hmac,
          this.auth.codeHash(
            r.id,
            r.phone_e164,
            "delete_account",
            v.app,
            v.deviceId,
            v.preauthToken,
            r.generation,
            v.code,
          ),
        ) ||
        !r.pending_payload_encrypted
      ) {
        await db.query(
          "UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1",
          [r.id],
        );
        return null;
      }
      const payload = security.decrypt(r.pending_payload_encrypted) as {
          userId: string;
          source: string;
        },
        u = (
          await db.query(
            "SELECT * FROM users WHERE id=$1 AND status<>'deleted' FOR UPDATE",
            [payload.userId],
          )
        ).rows[0];
      if (!u || (i && u.id !== i.id) || u.phone_e164 !== r.phone_e164)
        return null;
      // Same phone-wide lock order as login/refresh verification.
      const p = policy(this.config),
        existing = (
          await db.query(
            "SELECT * FROM deletion_requests WHERE user_id=$1 AND status<>'completed' FOR UPDATE",
            [u.id],
          )
        ).rows[0];
      if (existing) {
        await db.query(
          "UPDATE deletion_requests SET challenge_id=$2,proof_digest=$3,receipt_digest=$4 WHERE id=$1",
          [existing.id, r.id, proofDigest, digest(receiptToken)],
        );
        await db.query(
          "UPDATE otp_challenges SET consumed_at=now(),pending_payload_encrypted=NULL WHERE id=$1",
          [r.id],
        );
        await db.query(
          "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1",
          [u.id],
        );
        await db.query(
          "UPDATE push_tokens SET active=false,version=version+1,updated_at=now() WHERE user_id=$1 AND active",
          [u.id],
        );
        return { ...deletionDto(existing), receiptToken };
      }
      const request = (
        await db.query(
          `INSERT INTO deletion_requests(id,user_id,source,status,verified_at,challenge_id,proof_digest,receipt_digest,policy_snapshot,retention_notice) VALUES($3,$1,$2,'verified',now(),$3,$4,$5,$6,$7) RETURNING *`,
          [
            u.id,
            payload.source,
            r.id,
            proofDigest,
            digest(receiptToken),
            JSON.stringify(p),
            p.approved
              ? "استلم طلب الحذف وأبطلت الجلسات؛ جارٍ فحص الالتزامات وتنفيذ السياسة."
              : notices.policy_required,
          ],
        )
      ).rows[0];
      await db.query(
        "UPDATE users SET deletion_requested_at=coalesce(deletion_requested_at,now()) WHERE id=$1",
        [u.id],
      );
      await db.query(
        "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1",
        [u.id],
      );
      await db.query(
        "UPDATE push_tokens SET active=false,version=version+1,updated_at=now() WHERE user_id=$1 AND active",
        [u.id],
      );
      await db.query(
        "UPDATE otp_challenges SET consumed_at=coalesce(consumed_at,now()),pending_payload_encrypted=NULL,resend_after=least(resend_after,now()) WHERE phone_e164=$1",
        [u.phone_e164],
      );
      await audit(
        db,
        ctx.requestId,
        u.id,
        "privacy.deletion_verified",
        "deletion_request",
        request.id,
      );
      return { ...deletionDto(request), receiptToken };
    });
    if (!result) throw invalidChallenge();
    return result;
  }
  async status(id: string, token: string) {
    const r = (
      await this.auth.pool.query(
        "SELECT * FROM deletion_requests WHERE id=$1 OR challenge_id=$1",
        [id],
      )
    ).rows[0];
    if (!r || !equal(r.receipt_digest, digest(token))) throw notFound();
    return deletionDto(r);
  }
  async processOne(id?: string, actor?: Identity) {
    const pool = this.auth.pool,
      p = policy(this.config);
    return transaction(pool, async (db) => {
      if (actor) await requirePermission(db, actor, "privacy.manage", null);
      const r = (
        await db.query(
          `SELECT * FROM deletion_requests WHERE status<>'completed' AND ($1::uuid IS NULL OR id=$1) AND ($1::uuid IS NOT NULL OR next_attempt_at<=now()) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [id ?? null],
        )
      ).rows[0];
      if (!r) return false;
      if (!r.policy_snapshot?.approved && p.approved)
        await db.query(
          "UPDATE deletion_requests SET policy_snapshot=$2 WHERE id=$1",
          [r.id, JSON.stringify(p)],
        );
      const code = (
        await db.query("SELECT privacy_erase_account($1) code", [r.id])
      ).rows[0].code;
      if (code !== "erased") {
        await db.query(
          "UPDATE deletion_requests SET status='needs_review',review_code=$2,retention_notice=$3,next_attempt_at=now()+interval '5 minutes' WHERE id=$1",
          [r.id, code, notices[code] ?? "تحتاج مراجعة الإدارة"],
        );
        return true;
      }
      await db.query("SELECT privacy_redact_retained($1)", [r.id]);
      const pending = (
        await db.query(
          `SELECT EXISTS(SELECT 1 FROM order_private_details d JOIN orders o ON o.id=d.order_id WHERE o.customer_id=$1 AND d.redacted_at IS NULL) OR EXISTS(SELECT 1 FROM privacy_file_deletions WHERE request_id=$2 AND state='pending') waiting`,
          [r.user_id, r.id],
        )
      ).rows[0].waiting;
      await db.query(
        `UPDATE deletion_requests SET status=$2,completed_at=CASE WHEN $2='completed' THEN now() END,retention_notice=$3,next_attempt_at=now()+interval '5 minutes' WHERE id=$1`,
        [
          r.id,
          pending ? "processing" : "completed",
          pending
            ? "حذفت هوية الحساب والعناوين والجلسات؛ تبقى بيانات أو ملفات تنتظر انتهاء المدة أو حسم التزامات مرتبطة أو نجاح حذف التخزين."
            : "حذفت هوية الحساب والعناوين والجلسات والملفات المشمولة؛ تبقى حقائق مالية وسجل تدقيق بمعرّفات مقيدة كما توضح السياسة.",
        ],
      );
      return true;
    });
  }
  async removeFiles() {
    if (this.store.mode === "unconfigured") return false;
    return transaction(this.auth.pool, async (db) => {
      const rows = (
        await db.query(
          `SELECT f.*,m.object_key,m.staging_key,m.thumbnail_key FROM privacy_file_deletions f JOIN media_objects m ON m.id=f.media_id WHERE f.state='pending' AND f.next_attempt_at<=now() AND NOT EXISTS(SELECT 1 FROM payment_receipt_attempts a JOIN payments p ON p.id=a.payment_id JOIN orders o ON o.id=p.order_id WHERE a.media_id=m.id AND (o.status NOT IN ('delivered','cancelled','rejected') OR p.status='pending' OR EXISTS(SELECT 1 FROM financial_exceptions e WHERE e.order_id=o.id AND e.status='open'))) AND NOT EXISTS(SELECT 1 FROM financial_exception_resolutions er JOIN financial_exceptions e ON e.id=er.exception_id JOIN orders o ON o.id=e.order_id WHERE er.proof_media_id=m.id AND (e.status='open' OR o.status NOT IN ('delivered','cancelled','rejected'))) ORDER BY f.next_attempt_at LIMIT 10 FOR UPDATE OF f,m SKIP LOCKED`,
        )
      ).rows;
      for (const r of rows)
        try {
          for (const key of new Set(
            [r.object_key, r.staging_key, r.thumbnail_key].filter(Boolean),
          ))
            await this.store.remove(key);
          await db.query(
            "UPDATE media_objects SET status='deleted',staging_key=NULL WHERE id=$1",
            [r.media_id],
          );
          await db.query(
            "UPDATE privacy_file_deletions SET state='deleted',deleted_at=now() WHERE media_id=$1",
            [r.media_id],
          );
        } catch {
          await db.query(
            "UPDATE privacy_file_deletions SET attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE media_id=$1",
            [r.media_id],
          );
        }
      return rows.length > 0;
    });
  }
}
