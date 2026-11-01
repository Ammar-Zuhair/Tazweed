import type pg from "pg";
import type { Db } from "../db.js";
import { ApiError, notFound } from "../http.js";
import {
  requirePermission,
  customerOnly,
  type Identity,
} from "../identity/access.js";
import { audit } from "../identity/audit.js";
import { lockStock, expire, reconcile } from "../catalog/stock.js";
export const conflict = (code: string, message: string) =>
  new ApiError(409, code, message);
export const scopes = (o: any, ...others: (string | null | undefined)[]) =>
  [
    ...new Set([o.branch_id ?? o.catalog_branch_id, ...others].filter(Boolean)),
  ] as string[];
export async function order(
  db: Db,
  i: Identity,
  id: string,
  permission = "orders.review",
  lock = false,
) {
  const o = (
    await db.query(
      "SELECT * FROM orders WHERE id=$1" + (lock ? " FOR UPDATE" : ""),
      [id],
    )
  ).rows[0];
  if (!o) throw notFound();
  if (i.kind === "customer") {
    customerOnly(i);
    if (o.customer_id !== i.id) throw notFound();
  } else await requirePermission(db, i, permission, scopes(o));
  return o;
}
export function pending(o: any, version: number) {
  if (o.version !== version)
    throw conflict("STALE_VERSION", "تغير الطلب؛ حدّثه قبل المحاولة");
  if (o.status !== "pending_review")
    throw conflict("ORDER_CLOSED", "هذا الإجراء متاح أثناء المراجعة فقط");
}
export async function event(
  db: pg.PoolClient,
  i: Identity,
  o: any,
  type: string,
  details: Record<string, unknown> = {},
  stage?: string,
) {
  const result = (
    await db.query(
      "UPDATE orders SET version=version+1,review_stage=coalesce($2,review_stage) WHERE id=$1 RETURNING version",
      [o.id, stage ?? null],
    )
  ).rows[0];
  await db.query(
    "INSERT INTO order_events(order_id,actor_id,event_type,details) VALUES($1,$2,$3,$4)",
    [o.id, i.id, type, JSON.stringify(details)],
  );
  await db.query(
    "INSERT INTO outbox_events(event_type,aggregate_id,dedupe_key,payload) VALUES($1,$2,$3,$4)",
    [
      type,
      o.id,
      `${o.id}:${result.version}:${type}`,
      JSON.stringify({ orderId: o.id, version: result.version }),
    ],
  );
  await audit(
    db,
    i.requestId ?? "order-" + o.id,
    i.id,
    type,
    "order",
    o.id,
    { version: result.version },
    o.branch_id,
  );
  return { id: o.id, version: result.version };
}
export async function stockLocks(
  db: pg.PoolClient,
  o: any,
  newBranch?: string,
) {
  const old = (
    await db.query(
      "SELECT DISTINCT branch_id branch,product_id product FROM stock_reservations WHERE order_id=$1 AND state='active'",
      [o.id],
    )
  ).rows;
  const products = (
    await db.query(
      "SELECT DISTINCT product_id FROM order_request_items WHERE order_id=$1",
      [o.id],
    )
  ).rows;
  const pairs = [
    ...old,
    ...(newBranch
      ? products.map((p) => ({ branch: newBranch, product: p.product_id }))
      : []),
  ];
  await lockStock(db, pairs);
  for (const p of pairs) {
    await reconcile(db, p.branch, p.product);
    await expire(db, p.branch, p.product);
  }
  return pairs;
}
export async function release(db: pg.PoolClient, o: any) {
  const rows = (
    await db.query(
      "UPDATE stock_reservations SET state='released' WHERE order_id=$1 AND state='active' RETURNING branch_id,product_id,pieces",
      [o.id],
    )
  ).rows;
  for (const r of rows) {
    await db.query(
      "UPDATE stock_levels SET reserved=reserved-$3,version=version+1 WHERE branch_id=$1 AND product_id=$2",
      [r.branch_id, r.product_id, r.pieces],
    );
    await reconcile(db, r.branch_id, r.product_id);
  }
}
export async function reserve(
  db: pg.PoolClient,
  o: any,
  q: any,
  expires: Date,
) {
  const items = (
    await db.query(
      "SELECT product_id,sum(quantity::bigint*pieces_per_unit)::text pieces FROM quote_items WHERE quote_id=$1 GROUP BY product_id ORDER BY product_id",
      [q.id],
    )
  ).rows;
  for (const x of items) {
    const s = await reconcile(db, q.branch_id, x.product_id);
    if (
      !s.sellable ||
      BigInt(s.on_hand) - BigInt(s.reserved) < BigInt(x.pieces)
    )
      throw conflict(
        "INSUFFICIENT_STOCK",
        "المخزون المتاح لا يكفي؛ لم يصدر عرض أو حجز جزئي",
      );
    await db.query(
      "INSERT INTO stock_reservations(order_id,branch_id,product_id,quote_id,pieces,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
      [o.id, q.branch_id, x.product_id, q.id, x.pieces, expires],
    );
    await db.query(
      "UPDATE stock_levels SET reserved=reserved+$3,version=version+1 WHERE branch_id=$1 AND product_id=$2",
      [q.branch_id, x.product_id, x.pieces],
    );
    await reconcile(db, q.branch_id, x.product_id);
  }
}
export async function net(db: Db, id: string) {
  return BigInt(
    (
      await db.query(
        `SELECT (coalesce((SELECT sum(approved_amount_yer) FROM payments WHERE order_id=$1 AND status='approved'),0)+coalesce((SELECT sum(CASE WHEN r.direction='refund_to_customer' THEN -r.amount_yer WHEN r.direction='received_from_customer' THEN r.amount_yer ELSE 0 END) FROM financial_exception_resolutions r JOIN financial_exceptions e ON e.id=r.exception_id WHERE e.order_id=$1),0))::text net`,
        [id],
      )
    ).rows[0].net,
  );
}
export async function exception(
  db: pg.PoolClient,
  i: Identity,
  o: any,
  kind: string,
  amount: string,
  reason: string,
  branch?: string,
) {
  const old = (
    await db.query(
      "SELECT id FROM financial_exceptions WHERE order_id=$1 AND kind=$2 AND status='open'",
      [o.id, kind],
    )
  ).rows[0];
  if (old) return old.id;
  return (
    await db.query(
      "INSERT INTO financial_exceptions(order_id,kind,amount_yer,reason,opened_by,branch_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [
        o.id,
        kind,
        amount,
        reason,
        i.id,
        branch ?? o.branch_id ?? o.catalog_branch_id,
      ],
    )
  ).rows[0].id;
}
export async function noUnreviewed(db: Db, id: string) {
  if (
    (
      await db.query(
        "SELECT 1 FROM payments p JOIN payment_receipt_attempts a ON a.payment_id=p.id WHERE p.order_id=$1 AND NOT EXISTS(SELECT 1 FROM payment_receipt_reviews r WHERE r.attempt_id=a.id)",
        [id],
      )
    ).rowCount
  )
    throw conflict(
      "RECEIPT_AWAITING_REVIEW",
      "راجع صورة الإيصال أولًا قبل تغيير الحجز أو إغلاق الطلب",
    );
}
export async function noExceptions(db: Db, id: string) {
  if (
    (
      await db.query(
        "SELECT 1 FROM financial_exceptions WHERE order_id=$1 AND status='open'",
        [id],
      )
    ).rowCount
  )
    throw conflict("FINANCIAL_EXCEPTION_OPEN", "توجد تسوية مالية لم تغلق بعد");
}
