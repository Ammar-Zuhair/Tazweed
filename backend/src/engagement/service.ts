import type pg from "pg";
import type { Db } from "../db.js";
import { transaction } from "../db.js";
import type { Config } from "../config.js";
import { ApiError, notFound } from "../http.js";
import { requirePermission, type Identity } from "../identity/access.js";
import { audit } from "../identity/audit.js";
import { task } from "../delivery/core.js";
import { order } from "../orders/core.js";
import { idempotent } from "../catalog/stock.js";
import { deployment, projectFor } from "./provider.js";
import { z } from "zod";
import * as c from "./contracts.js";
export async function registerToken(
  pool: pg.Pool,
  config: Config,
  i: Identity,
  v: z.infer<typeof c.token>,
) {
  if (!projectFor(config, i.app) || projectFor(config, i.app) !== v.projectId)
    throw new ApiError(
      503,
      "PROJECT_UNCONFIGURED",
      "إعداد مشروع الإشعارات لهذا التطبيق غير متاح",
    );
  return transaction(pool, async (db) => {
    const account=(await db.query("SELECT deletion_requested_at,status FROM users WHERE id=$1 FOR UPDATE",[i.id])).rows[0];
    if(!account||account.status!=="active"||account.deletion_requested_at)throw new ApiError(409,"DELETION_PENDING","تسجيل إشعارات جديدة متوقف أثناء حذف الحساب");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1011))", [
      v.token,
    ]);
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1012))", [
      i.sessionId,
    ]);
    const live = (
      await db.query(
        "SELECT * FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE",
        [i.sessionId, i.id],
      )
    ).rows[0];
    if (!live) throw new ApiError(401, "AUTH_FAILED", "انتهت الجلسة");
    const old = (
      await db.query(
        "SELECT p.*,s.revoked_at,s.expires_at FROM push_tokens p LEFT JOIN sessions s ON s.id=p.session_id WHERE token=$1 FOR UPDATE OF p",
        [v.token],
      )
    ).rows[0];
    if (
      old &&
      old.user_id !== i.id &&
      old.active &&
      old.session_id &&
      !old.revoked_at &&
      new Date(old.expires_at) > new Date()
    )
      throw new ApiError(
        409,
        "TOKEN_BOUND",
        "أوقف إشعارات الحساب السابق أولًا",
      );
    if (
      old &&
      (old.app !== i.app ||
        old.project_id !== v.projectId ||
        old.environment !== deployment(config))
    )
      throw new ApiError(
        409,
        "TOKEN_PROJECT_CONFLICT",
        "الرمز مرتبط بتطبيق أو بيئة مختلفة",
      );
    if (
      old &&
      old.user_id === i.id &&
      old.session_id === i.sessionId &&
      old.active &&
      old.sound_enabled === v.soundEnabled &&
      old.platform === v.platform
    )
      return { id: old.id };
    await db.query(
      "UPDATE push_tokens SET active=false,version=version+1,updated_at=now() WHERE session_id=$1 AND active AND token<>$2",
      [i.sessionId, v.token],
    );
    const values = [
      i.id,
      i.app,
      deployment(config),
      v.token,
      v.platform,
      i.sessionId,
      v.projectId,
      v.soundEnabled,
    ];
    const r = (
      await db.query(
        `INSERT INTO push_tokens(user_id,app,environment,token,platform,session_id,project_id,sound_enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,session_id=excluded.session_id,platform=excluded.platform,sound_enabled=excluded.sound_enabled,active=true,version=CASE WHEN push_tokens.active AND push_tokens.user_id=excluded.user_id AND push_tokens.session_id=excluded.session_id THEN push_tokens.version ELSE push_tokens.version+1 END,updated_at=now() RETURNING id`,
        values,
      )
    ).rows[0];
    await audit(
      db,
      i.requestId ?? i.id,
      i.id,
      "notifications.token_registered",
      "push_token",
      r.id,
      { app: i.app },
    );
    return r;
  });
}
export async function revokeTokens(pool: pg.Pool, i: Identity) {
  return transaction(pool, async (db) => {
    const r = await db.query(
      "UPDATE push_tokens SET active=false,version=version+1,updated_at=now() WHERE session_id=$1 AND user_id=$2 AND app=$3 AND active",
      [i.sessionId, i.id, i.app],
    );
    await audit(
      db,
      i.requestId ?? i.id,
      i.id,
      "notifications.token_revoked",
      "session",
      i.sessionId,
      { app: i.app },
    );
    return { ok: true, revoked: r.rowCount };
  });
}
export async function visible(db: Db, i: Identity, n: any) {
  if (n.user_id !== i.id || n.app !== i.app) return false;
  try {
    if (n.permission_code)
      await requirePermission(
        db,
        i,
        n.permission_code,
        n.branch_id ? [n.branch_id] : null,
      );
    if (n.order_id) {
      if (i.kind === "courier") {
        const t = await task(db, i, n.order_id);
        if (n.assignment_id !== t.a.id) return false;
      } else
        await order(db, i, n.order_id, n.permission_code ?? "orders.review");
    }
    return true;
  } catch (e) {
    if (e instanceof ApiError && [403, 404].includes(e.status)) return false;
    throw e;
  }
}
export async function inbox(
  pool: pg.Pool,
  i: Identity,
  q: z.infer<typeof c.page>,
) {
  return transaction(pool, async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const rows = (
      await db.query(
        "SELECT * FROM notification_inbox WHERE user_id=$1 AND app=$2 AND ($3::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM notification_inbox WHERE id=$3 AND user_id=$1 AND app=$2)) ORDER BY created_at DESC,id DESC LIMIT $4",
        [i.id, i.app, q.cursor ?? null, q.limit + 1],
      )
    ).rows;
    const items = [];
    for (const n of rows.slice(0, q.limit))
      if (await visible(db, i, n))
        items.push({
          id: n.id,
          title: n.title_ar,
          body: n.body_ar,
          data: n.data,
          readAt: n.read_at,
          createdAt: n.created_at,
        });
    return {
      items,
      nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      source: "backend",
    };
  });
}
export async function readNotice(pool: pg.Pool, i: Identity, id: string) {
  return transaction(pool, async (db) => {
    const n = (
      await db.query(
        "SELECT * FROM notification_inbox WHERE id=$1 AND user_id=$2 AND app=$3",
        [id, i.id, i.app],
      )
    ).rows[0];
    if (!n || !(await visible(db, i, n))) throw notFound();
    await db.query(
      "UPDATE notification_inbox SET read_at=coalesce(read_at,now()) WHERE id=$1",
      [id],
    );
    return { ok: true };
  });
}
export async function campaignCommand(
  pool: pg.Pool,
  config: Config,
  i: Identity,
  key: string,
  action: "create" | "schedule" | "cancel",
  id: string | null,
  v: any,
) {
  await requirePermission(pool, i, "notifications.broadcast", null);
  return idempotent(
    pool,
    i,
    "campaign:" + action + (id ?? ""),
    key,
    v,
    async (db) => {
      await requirePermission(db, i, "notifications.broadcast", null);
      if (action === "create") {
        if (
          v.audience.branchId &&
          !(
            await db.query("SELECT 1 FROM branches WHERE id=$1 AND active", [
              v.audience.branchId,
            ])
          ).rowCount
        )
          throw new ApiError(422, "INVALID_BRANCH", "الفرع غير متاح");
        const r = (
          await db.query(
            "INSERT INTO notification_campaigns(author_id,title_ar,body_ar,audience,status,environment) VALUES($1,$2,$3,$4,'draft',$5) RETURNING id,version",
            [
              i.id,
              v.title,
              v.body,
              JSON.stringify(v.audience),
              deployment(config),
            ],
          )
        ).rows[0];
        await audit(
          db,
          i.requestId ?? i.id,
          i.id,
          "notifications.campaign_created",
          "campaign",
          r.id,
          { version: r.version },
        );
        return r;
      }
      const old = (
        await db.query(
          "SELECT * FROM notification_campaigns WHERE id=$1 AND environment=$2 FOR UPDATE",
          [id, deployment(config)],
        )
      ).rows[0];
      if (!old) throw notFound();
      if (old.version !== v.expectedVersion)
        throw new ApiError(409, "STALE_VERSION", "حدث الحملة قبل المتابعة");
      if (!["draft", "scheduled"].includes(old.status))
        throw new ApiError(
          409,
          "CAMPAIGN_STARTED",
          "الحملة بدأت أو انتهت ولا يمكن تغييرها",
        );
      if (
        action === "schedule" &&
        (Date.parse(v.scheduledAt) < Date.now() - 5000 ||
          Date.parse(v.scheduledAt) > Date.now() + 366 * 86400000)
      )
        throw new ApiError(
          422,
          "SCHEDULE_INVALID",
          "حدد موعد UTC حاليًا أو خلال سنة",
        );
      const r = (
        await db.query(
          "UPDATE notification_campaigns SET status=$2,scheduled_at=$3,version=version+1 WHERE id=$1 RETURNING id,version",
          [
            id,
            action === "cancel" ? "cancelled" : "scheduled",
            action === "cancel" ? old.scheduled_at : v.scheduledAt,
          ],
        )
      ).rows[0];
      await audit(
        db,
        i.requestId ?? i.id,
        i.id,
        "notifications.campaign_" + action,
        "campaign",
        id,
        { version: r.version },
      );
      return r;
    },
  );
}
export async function getNotice(pool: pg.Pool, i: Identity, id: string) {
  return transaction(pool, async (db) => {
    const n = (
      await db.query(
        "SELECT * FROM notification_inbox WHERE id=$1 AND user_id=$2 AND app=$3",
        [id, i.id, i.app],
      )
    ).rows[0];
    if (!n || !(await visible(db, i, n))) throw notFound();
    return {
      id: n.id,
      title: n.title_ar,
      body: n.body_ar,
      data: n.data,
      readAt: n.read_at,
      createdAt: n.created_at,
    };
  });
}
