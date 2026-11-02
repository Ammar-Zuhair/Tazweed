import type pg from "pg";
import type { Identity } from "../identity/access.js";
import {
  requirePermission,
  customerOnly,
  accessScope,
} from "../identity/access.js";
import { idempotent } from "../catalog/stock.js";
import { order, scopes, event, conflict } from "../orders/core.js";
import { task, checkVersion, attachment } from "./core.js";
import { audit } from "../identity/audit.js";
import { forbidden, notFound } from "../http.js";
export async function submitQuality(
  pool: pg.Pool,
  i: Identity,
  id: string,
  key: string,
  kind: "flag" | "review" | "complaint",
  v: any,
) {
  const auth = async (db: any, lock = false) => {
    if (kind === "flag") {
      if (i.kind === "courier") return (await task(db, i, id, lock)).o;
      const o = await order(db, i, id, "customer-flags.write", lock);
      await requirePermission(db, i, "customer-flags.write", scopes(o));
      return o;
    }
    customerOnly(i);
    return order(db, i, id, "orders.review", lock);
  };
  await auth(pool);
  return idempotent(pool, i, `quality.${kind}.${id}`, key, v, async (db) => {
    const o = await auth(db, true);
    checkVersion(o, v.expectedVersion);
    if (kind !== "flag" && o.status !== "delivered")
      throw conflict("DELIVERY_REQUIRED", "التقييم والشكاوى بعد التسليم فقط");
    if (kind === "flag") {
      if (!["confirmed", "on_the_way", "delivered"].includes(o.status))
        throw conflict(
          "FLAG_STATE",
          "سجل البلاغ لطلب مؤكد أو أثناء التوصيل أو بعده",
        );
      await attachment(db, i, v.attachmentId, "customer_flag");
      const r = (
        await db.query(
          "INSERT INTO customer_flags(customer_id,order_id,reporter_id,details_ar,attachment_id,kind) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
          [o.customer_id, id, i.id, v.details, v.attachmentId ?? null, v.kind],
        )
      ).rows[0];
      return {
        ...(await event(db, i, o, "quality.flag_submitted", { flagId: r.id })),
        flagId: r.id,
      };
    }
    if (kind === "review") {
      if (
        (await db.query("SELECT 1 FROM order_reviews WHERE order_id=$1", [id]))
          .rowCount
      )
        throw conflict("ALREADY_REVIEWED", "قيّمت هذا الطلب من قبل");
      await db.query(
        "INSERT INTO order_reviews(order_id,customer_id,rating,comment_ar) VALUES($1,$2,$3,$4)",
        [id, i.id, v.rating, v.comment],
      );
      return event(db, i, o, "quality.review_submitted");
    }
    await attachment(db, i, v.attachmentId, "complaint");
    const r = (
      await db.query(
        "INSERT INTO complaints(order_id,customer_id,details_ar,attachment_id) VALUES($1,$2,$3,$4) RETURNING id",
        [id, i.id, v.details, v.attachmentId ?? null],
      )
    ).rows[0];
    return {
      ...(await event(db, i, o, "quality.complaint_submitted", {
        complaintId: r.id,
      })),
      complaintId: r.id,
    };
  });
}
export async function qualityList(
  db: any,
  i: Identity,
  kind: "flag" | "complaint" | "review",
  cursor: string | null,
  limit: number,
) {
  const permission =
      kind === "flag" ? "customer-flags.read" : "complaints.manage",
    s = await accessScope(db, i, permission);
  if (!s.global && !s.branchIds.length) throw forbidden();
  const table =
    kind === "flag"
      ? "customer_flags"
      : kind === "complaint"
        ? "complaints"
        : "order_reviews";
  const column = kind === "review" ? "order_id" : "id";
  const rows = (
    await db.query(
      `SELECT f.*,o.order_number,o.branch_id FROM ${table} f JOIN orders o ON o.id=f.order_id WHERE ($1::boolean OR o.branch_id=ANY($2::uuid[])) AND ($3::uuid IS NULL OR f.${column}>$3) ORDER BY f.${column} LIMIT $4`,
      [s.global, s.branchIds, cursor, limit + 1],
    )
  ).rows;
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit - 1][column] : null,
    source: "backend",
  };
}
export async function updateQuality(
  pool: pg.Pool,
  i: Identity,
  id: string,
  key: string,
  kind: "flag" | "complaint",
  v: any,
) {
  const table = kind === "flag" ? "customer_flags" : "complaints",
    permission = kind === "flag" ? "customer-flags.write" : "complaints.manage";
  const auth = async (db: any) => {
    const r = (
      await db.query(
        `SELECT f.*,o.branch_id FROM ${table} f JOIN orders o ON o.id=f.order_id WHERE f.id=$1`,
        [id],
      )
    ).rows[0];
    if (!r) throw notFound();
    await requirePermission(db, i, permission, [r.branch_id]);
    return r;
  };
  await auth(pool);
  return idempotent(
    pool,
    i,
    `quality.${kind}.update.${id}`,
    key,
    v,
    async (db) => {
      await db.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
      const r = await auth(db);
      checkVersion(r, v.expectedVersion);
      const result = (
        await db.query(
          `UPDATE ${table} SET status=$2,${kind === "flag" ? "admin_note" : "admin_response"}=$3,version=version+1 ${kind === "complaint" ? ",assigned_to=$4" : ""} WHERE id=$1 RETURNING version`,
          kind === "flag"
            ? [id, v.status, v.note]
            : [id, v.status, v.response, i.id],
        )
      ).rows[0];
      await audit(
        db,
        i.requestId ?? id,
        i.id,
        "quality." + kind + ".reviewed",
        table,
        id,
        {
          from: r.status,
          to: v.status,
          note: kind === "flag" ? v.note : v.response,
          version: result.version,
        },
        r.branch_id,
      );
      await db.query(
        "INSERT INTO outbox_events(event_type,aggregate_id,dedupe_key,payload) VALUES($1,$2,$3,$4)",
        [
          "quality." + kind + ".updated",
          id,
          `${kind}:${id}:${result.version}`,
          JSON.stringify({ id, version: result.version }),
        ],
      );
      return { id, version: result.version };
    },
  );
}
