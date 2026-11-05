import { randomUUID } from "node:crypto";
import type pg from "pg";
import { transaction, type Db } from "../db.js";
import type { Config } from "../config.js";
import { requirePermission, type Identity } from "../identity/access.js";
import { ApiError } from "../http.js";
import {
  deployment,
  projectFor,
  type PushProvider,
  type PushResult,
} from "./provider.js";
import { visible } from "./service.js";
const staffIdentity = (id: string): Identity => ({
  id,
  app: "admin",
  kind: "staff",
  sessionId: "",
  name_ar: "",
  phone_e164: "",
});
export async function enqueue(
  db: Db,
  config: Config,
  n: {
    userId: string;
    app: string;
    key: string;
    title: string;
    body: string;
    orderId?: string;
    assignmentId?: string;
    branchId?: string;
    permission?: string;
    kind?: string;
  },
) {
  const row = (
    await db.query(
      `INSERT INTO notification_inbox(user_id,app,event_key,title_ar,body_ar,data,order_id,assignment_id,branch_id,permission_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,app,event_key) DO NOTHING RETURNING id`,
      [
        n.userId,
        n.app,
        n.key,
        n.title,
        n.body,
        JSON.stringify({
          kind: n.kind ?? "message",
          ...(n.orderId ? { orderId: n.orderId } : {}),
        }),
        n.orderId ?? null,
        n.assignmentId ?? null,
        n.branchId ?? null,
        n.permission ?? null,
      ],
    )
  ).rows[0];
  if (!row) return;
  await db.query(
    `INSERT INTO notification_deliveries(notification_id,push_token_id,status,token_version,next_attempt_at) SELECT $1,p.id,'pending',p.version,now() FROM push_tokens p JOIN sessions s ON s.id=p.session_id JOIN users u ON u.id=p.user_id WHERE p.user_id=$2 AND p.app=$3 AND p.environment=$4 AND p.project_id=$5 AND p.active AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active' ON CONFLICT(notification_id,push_token_id) DO NOTHING`,
    [
      row.id,
      n.userId,
      n.app,
      deployment(config),
      projectFor(config, n.app) ?? null,
    ],
  );
}
const orderMessages: Record<string, string> = {
  "quality.complaint.updated": "لديك رد جديد على الشكوى؛ راجع الطلب.",
  "order.submitted": "استلمنا طلبك وهو بانتظار مراجعة الإدارة.",
  "quote.issued": "لديك عرض جديد يحتاج موافقتك؛ راجع تفاصيل طلبك.",
  "order.confirmed": "تم تأكيد طلبك.",
  "order.rejected": "تم تحديث قرار طلبك؛ راجع التفاصيل.",
  "order.cancelled": "تم إلغاء طلبك.",
  "order.cancellation_denied": "تمت مراجعة طلب الإلغاء؛ راجع تفاصيل الطلب.",
  "payment.reviewed": "تمت مراجعة التحويل؛ راجع تفاصيل طلبك.",
  "delivery.started": "طلبك في الطريق.",
  "delivery.delivered": "تم تسجيل تسليم طلبك. يمكنك التقييم أو تقديم شكوى.",
};
const adminMessages: Record<string, { text: string; permission: string }> = {
  "order.submitted": {
    text: "وصل طلب جديد للمراجعة.",
    permission: "orders.review",
  },
  "quote.accepted": {
    text: "وافق العميل على العرض.",
    permission: "orders.review",
  },
  "quote.declined": {
    text: "لم يوافق العميل على العرض؛ راجع الطلب.",
    permission: "orders.review",
  },
  "payment.reported": {
    text: "وصل إيصال تحويل يحتاج مراجعة.",
    permission: "payments.verify",
  },
  "payment.image_corrected": {
    text: "وصلت صورة تحويل مصححة.",
    permission: "payments.verify",
  },
  "payment.review_overdue": {
    text: "تأخرت مراجعة إيصال؛ الحجز والسعر ما زالا محميين.",
    permission: "payments.verify",
  },
  "order.cancellation_requested": {
    text: "طلب العميل مراجعة إلغاء الطلب.",
    permission: "orders.review",
  },
  "cash.exception_reported": {
    text: "يوجد استثناء تحصيل يحتاج مراجعة.",
    permission: "financial-exceptions.resolve",
  },
  "quality.complaint_submitted": {
    text: "وصلت شكوى جديدة.",
    permission: "orders.review",
  },
  "quality.flag_submitted": {
    text: "وصل بلاغ يحتاج مراجعة.",
    permission: "orders.review",
  },
};
async function projectEvent(db: pg.PoolClient, config: Config, e: any) {
  const complaint =
    e.event_type === "quality.complaint.updated"
      ? (
          await db.query("SELECT order_id FROM complaints WHERE id=$1", [
            e.aggregate_id,
          ])
        ).rows[0]
      : null;
  const o = (
    await db.query("SELECT * FROM orders WHERE id=$1", [
      complaint?.order_id ?? e.payload.orderId ?? e.aggregate_id,
    ])
  ).rows[0];
  if (!o) return true;
  const branch = o.branch_id ?? o.catalog_branch_id;
  const common = {
    key: e.dedupe_key,
    orderId: o.id,
    branchId: branch,
    kind: e.event_type,
    title: "تحديث طلب تزويد",
  };
  if (orderMessages[e.event_type])
    await enqueue(db, config, {
      ...common,
      userId: o.customer_id,
      app: "customer",
      body: orderMessages[e.event_type]!,
    });
  const a = adminMessages[e.event_type];
  let complete = true;
  if (a) {
    const users = (
      await db.query(
        `SELECT DISTINCT u.id FROM users u JOIN staff_grants g ON g.user_id=u.id JOIN role_permissions rp ON rp.role_id=g.role_id WHERE u.kind='staff' AND u.status='active' AND rp.permission_code=$1 AND (g.global_scope OR g.branch_id=$2) AND ($3::uuid IS NULL OR u.id>$3) ORDER BY u.id LIMIT 201`,
        [a.permission, branch, e.audience_cursor],
      )
    ).rows;
    complete = users.length <= 200;
    if (!complete)
      await db.query(
        "UPDATE outbox_events SET audience_cursor=$2 WHERE id=$1",
        [e.id, users[199].id],
      );
    for (const u of users.slice(0, 200))
      await enqueue(db, config, {
        ...common,
        userId: u.id,
        app: "admin",
        body: a.text,
        permission: a.permission,
      });
  }
  if (e.event_type === "delivery.assigned") {
    const a = (
      await db.query(
        "SELECT a.* FROM order_assignments a JOIN courier_branches b ON b.courier_id=a.courier_id AND b.branch_id=$2 JOIN courier_profiles p ON p.user_id=a.courier_id AND p.active WHERE a.order_id=$1 AND a.ended_at IS NULL AND a.assigned_at<=(SELECT created_at FROM outbox_events WHERE id=$3)",
        [o.id, branch, e.id],
      )
    ).rows[0];
    if (a)
      await enqueue(db, config, {
        ...common,
        userId: a.courier_id,
        app: "courier",
        assignmentId: a.id,
        title: "مهمة توصيل جديدة",
        body: "أُسندت إليك مهمة جديدة. افتح المهام للاطلاع على التفاصيل.",
      });
  }
  return complete;
}
export async function projectOutbox(pool: pg.Pool, config: Config, limit = 25) {
  let count = 0;
  for (let n = 0; n < limit; n++) {
    let eventId: string | null = null;
    try {
      const processed = await transaction(pool, async (db) => {
        const e = (
          await db.query(
            "SELECT * FROM outbox_events WHERE state='pending' AND available_at<=now() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
          )
        ).rows[0];
        if (!e) return false;
        eventId = e.id;
        const complete = await projectEvent(db, config, e);
        await db.query(
          "UPDATE outbox_events SET state=$2,locked_at=NULL WHERE id=$1",
          [e.id, complete ? "done" : "pending"],
        );
        return true;
      });
      if (!processed) break;
      count++;
    } catch {
      if (eventId)
        await pool.query(
          "UPDATE outbox_events SET attempts=attempts+1,state=CASE WHEN attempts>=4 THEN 'dead' ELSE 'pending' END,available_at=now()+interval '1 minute',locked_at=NULL WHERE id=$1 AND state='pending'",
          [eventId],
        );
      else throw Error("Outbox unavailable");
    }
  }
  return count;
}
export async function dispatchCampaigns(
  pool: pg.Pool,
  config: Config,
  limit = 5,
) {
  let count = 0;
  for (let n = 0; n < limit; n++) {
    const progressed = await transaction(pool, async (db) => {
      const c = (
        await db.query(
          "SELECT * FROM notification_campaigns WHERE environment=$1 AND status IN ('scheduled','sending') AND scheduled_at<=now() ORDER BY scheduled_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
          [deployment(config)],
        )
      ).rows[0];
      if (!c) return false;
      try {
        await requirePermission(
          db,
          staffIdentity(c.author_id),
          "notifications.broadcast",
          null,
        );
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 403) throw e;
        await db.query(
          "UPDATE notification_campaigns SET status='failed',error_code='AUTHOR_REVOKED',finished_at=now(),version=version+1 WHERE id=$1",
          [c.id],
        );
        return true;
      }
      const a = c.audience;
      const users = (
        await db.query(
          `SELECT u.id,u.kind FROM users u WHERE u.status='active' AND ($1::text='all' OR u.kind=CASE WHEN $1='customers' THEN 'customer' ELSE 'courier' END) AND (u.kind<>'courier' OR EXISTS(SELECT 1 FROM courier_profiles p WHERE p.user_id=u.id AND p.active)) AND ($2::uuid IS NULL OR (u.kind='customer' AND EXISTS(SELECT 1 FROM orders o WHERE o.customer_id=u.id AND (o.branch_id=$2 OR o.catalog_branch_id=$2))) OR (u.kind='courier' AND EXISTS(SELECT 1 FROM courier_branches b WHERE b.courier_id=u.id AND b.branch_id=$2)) OR (u.kind='staff' AND EXISTS(SELECT 1 FROM staff_grants g WHERE g.user_id=u.id AND (g.global_scope OR g.branch_id=$2)))) AND ($3::uuid IS NULL OR u.id>$3) ORDER BY u.id LIMIT 201`,
          [a.kind, a.branchId, c.audience_cursor],
        )
      ).rows;
      for (const u of users.slice(0, 200))
        await enqueue(db, config, {
          userId: u.id,
          app: u.kind === "staff" ? "admin" : u.kind,
          key: "campaign:" + c.id,
          title: c.title_ar,
          body: c.body_ar,
          kind: "campaign",
        });
      const more = users.length > 200;
      await db.query(
        "UPDATE notification_campaigns SET status=$2,audience_cursor=$3,finished_at=CASE WHEN $4 THEN NULL ELSE now() END,version=version+1 WHERE id=$1",
        [
          c.id,
          more ? "sending" : "sent",
          users[Math.min(users.length, 200) - 1]?.id ?? c.audience_cursor,
          more,
        ],
      );
      return true;
    });
    if (!progressed) break;
    count++;
  }
  return count;
}
async function eligible(db: Db, config: Config, d: any) {
  const n = (
    await db.query(
      `SELECT n.*,p.token,p.sound_enabled,p.platform,p.user_id token_user,p.app token_app,p.version,p.active,p.environment,p.project_id,p.session_id,s.revoked_at,s.expires_at,u.kind,u.status AS user_status FROM notification_inbox n JOIN push_tokens p ON p.id=$2 JOIN sessions s ON s.id=p.session_id JOIN users u ON u.id=p.user_id WHERE n.id=$1`,
      [d.notification_id, d.push_token_id],
    )
  ).rows[0];
  if (
    !n ||
    !n.active ||
    n.version !== d.token_version ||
    n.token_user !== n.user_id ||
    n.token_app !== n.app ||
    n.revoked_at ||
    new Date(n.expires_at) <= new Date() ||
    n.user_status !== "active" ||
    n.environment !== deployment(config) ||
    n.project_id !== projectFor(config, n.app)
  )
    return null;
  if (
    n.kind === "courier" &&
    !(
      await db.query(
        "SELECT 1 FROM courier_profiles WHERE user_id=$1 AND active",
        [n.user_id],
      )
    ).rowCount
  )
    return null;
  const i: Identity = {
    id: n.user_id,
    kind: n.kind,
    app: n.app,
    sessionId: n.session_id,
    name_ar: "",
    phone_e164: "",
  };
  return (await visible(db, i, n)) ? n : null;
}
export async function deliverPush(
  pool: pg.Pool,
  config: Config,
  provider: PushProvider,
  limit = 20,
  shouldStop = () => false,
) {
  if (
    provider.mode === "test" &&
    (config.NODE_ENV !== "test" || config.production)
  )
    throw Error("Test push restricted");
  if (provider.mode === "unconfigured") return 0;
  let count = 0;
  for (let x = 0; x < limit; x++) {
    if (shouldStop()) break;
    const d = await transaction(pool, async (db) => {
      const row = (
        await db.query(
          "SELECT d.* FROM notification_deliveries d JOIN push_tokens p ON p.id=d.push_token_id WHERE p.environment=$1 AND d.status IN ('pending','sent') AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=now()) AND (d.locked_until IS NULL OR d.locked_until<now()) ORDER BY d.next_attempt_at NULLS FIRST,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 1",
          [deployment(config)],
        )
      ).rows[0];
      if (!row) return null;
      row.lease_id = randomUUID();
      await db.query(
        "UPDATE notification_deliveries SET lease_id=$2,locked_until=now()+interval '90 seconds' WHERE id=$1",
        [row.id, row.lease_id],
      );
      return row;
    });
    if (!d) break;
    const n = await eligible(pool, config, d);
    let r: PushResult | null;
    if (!n)
      r = { status: "error", code: "TOKEN_OR_SCOPE_REVOKED", retryable: false };
    else if (d.status === "sent") r = await provider.receipt(d.ticket_id);
    else
      r = await provider.send({
        to: n.token,
        title: n.title_ar,
        body: n.body_ar,
        data: { notificationId: n.id, app: n.app, userId: n.user_id },
        ...(n.sound_enabled
          ? { sound: "default", channelId: "tazweed-alerts-v1" }
          : { channelId: "tazweed-silent-v1" }),
      });
    await transaction(pool, async (db) => {
      const live = await eligible(db, config, d);
      if (!live)
        r = {
          status: "error",
          code: "TOKEN_OR_SCOPE_REVOKED",
          retryable: false,
        };
      const receipt = d.status === "sent",
        attempts = d.attempts + (receipt ? 0 : 1),
        checks = d.receipt_checks + (receipt ? 1 : 0);
      let status = "failed",
        error: string | null = null,
        ticket = d.ticket_id,
        next: Date | null = null;
      if (!r) {
        status = checks < 96 ? "sent" : "failed";
        error = checks < 96 ? null : "RECEIPT_EXPIRED";
        next = new Date(Date.now() + 15 * 60000);
      } else if (r.status === "ok") {
        status = receipt ? "delivered" : "sent";
        ticket = r.id ?? ticket;
        next = receipt ? null : new Date(Date.now() + 15 * 60000);
      } else {
        error = r.code;
        if (r.retryable && (receipt ? checks < 96 : attempts < 5)) {
          status = receipt ? "sent" : "pending";
          next = new Date(
            Date.now() +
              (receipt ? 15 * 60000 : Math.min(3600000, 30000 * 2 ** attempts)),
          );
        }
      }
      const updated = await db.query(
        "UPDATE notification_deliveries SET status=$3,error_code=$4,ticket_id=$5,attempts=$6,receipt_checks=$7,next_attempt_at=$8,locked_until=NULL,lease_id=NULL,updated_at=now() WHERE id=$1 AND lease_id=$2",
        [d.id, d.lease_id, status, error, ticket, attempts, checks, next],
      );
      if (
        updated.rowCount &&
        r?.status === "error" &&
        r.code === "DeviceNotRegistered"
      )
        await db.query(
          "UPDATE push_tokens SET active=false,version=version+1,updated_at=now() WHERE id=$1 AND version=$2",
          [d.push_token_id, d.token_version],
        );
    });
    count++;
  }
  return count;
}
export function startEngagement(
  pool: pg.Pool,
  config: Config,
  provider: PushProvider,
) {
  let busy = false;
  let task: Promise<void> = Promise.resolve();
  let stopped = false;
  const tick = () => {
    if (busy || stopped) return;
    busy = true;
    task = (async () => {
      try {
        await projectOutbox(pool, config);
        if (!stopped) await dispatchCampaigns(pool, config);
        if (!stopped)
          await deliverPush(pool, config, provider, 20, () => stopped);
      } catch {
        console.error(JSON.stringify({ event: "engagement_worker_failed" }));
      } finally {
        busy = false;
      }
    })();
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await task;
  };
}
