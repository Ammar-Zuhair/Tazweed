import type pg from "pg";
import { transaction } from "../db.js";
import { ApiError } from "../http.js";
import { digest } from "../identity/security.js";
import { requirePermission, type Identity } from "../identity/access.js";
import { audit } from "../identity/audit.js";
import type { z } from "zod";
import type * as c from "./contracts.js";
const conflict = (code: string, message: string) =>
  new ApiError(409, code, message);
export async function idempotent<T>(
  pool: pg.Pool,
  i: Identity,
  scope: string,
  key: string,
  body: unknown,
  fn: (db: pg.PoolClient) => Promise<T>,
) {
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key))
    throw new ApiError(
      422,
      "IDEMPOTENCY_REQUIRED",
      "يلزم مفتاح عملية ثابت من16إلى100محرف",
    );
  const hash = digest(JSON.stringify(body));
  return transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,606))", [
      i.id + scope + key,
    ]);
    const old = (
      await db.query(
        "SELECT * FROM idempotency_records WHERE actor_id=$1 AND scope=$2 AND key=$3",
        [i.id, scope, key],
      )
    ).rows[0];
    if (old) {
      if (old.request_hash !== hash)
        throw conflict("IDEMPOTENCY_CONFLICT", "المفتاح مستخدم لمحتوى آخر");
      return old.response_body as T;
    }
    const result = await fn(db);
    await db.query(
      `INSERT INTO idempotency_records(actor_id,scope,key,request_hash,response_status,response_body,expires_at) VALUES($1,$2,$3,$4,200,$5,now()+interval '30 days')`,
      [i.id, scope, key, hash, JSON.stringify(result)],
    );
    return result;
  });
}
// Every stock writer must use the same global catalog lock then sorted stock locks.
export async function lockStock(
  db: pg.PoolClient,
  pairs: { branch: string; product: string }[],
) {
  await db.query("SELECT pg_advisory_xact_lock_shared(606,1)");
  for (const p of [...pairs].sort((a, b) =>
    (a.branch + a.product).localeCompare(b.branch + b.product),
  )) {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,607))", [
      p.branch + p.product,
    ]);
    await db.query(
      `INSERT INTO stock_levels(branch_id,product_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [p.branch, p.product],
    );
    await db.query(
      "SELECT 1 FROM stock_levels WHERE branch_id=$1 AND product_id=$2 FOR UPDATE",
      [p.branch, p.product],
    );
  }
}
export async function reconcile(
  db: pg.PoolClient,
  branch: string,
  product: string,
) {
  const s = (
    await db.query(
      `SELECT s.*,(SELECT coalesce(sum(delta_pieces),0) FROM stock_movements m WHERE m.branch_id=s.branch_id AND m.product_id=s.product_id)::text ledger,(SELECT coalesce(sum(pieces),0) FROM stock_reservations r WHERE r.branch_id=s.branch_id AND r.product_id=s.product_id AND state='active')::text holds FROM stock_levels s WHERE branch_id=$1 AND product_id=$2`,
      [branch, product],
    )
  ).rows[0];
  if (
    BigInt(s.on_hand) !== BigInt(s.ledger) ||
    BigInt(s.reserved) !== BigInt(s.holds)
  )
    throw conflict(
      "STOCK_INCONSISTENT",
      "الرصيد لا يطابق الدفتر والحجوزات؛ يلزم مراجعة",
    );
  return s;
}
export async function expire(db: pg.PoolClient, b: string, p: string) {
  const r = await db.query(
    `UPDATE stock_reservations SET state='expired' WHERE branch_id=$1 AND product_id=$2 AND state='active' AND hold_kind='timed' AND expires_at<=now() RETURNING pieces`,
    [b, p],
  );
  const released = r.rows.reduce((n, r) => n + BigInt(r.pieces), 0n);
  if (released)
    await db.query(
      "UPDATE stock_levels SET reserved=reserved-$3,version=version+1 WHERE branch_id=$1 AND product_id=$2",
      [b, p, released.toString()],
    );
  return reconcile(db, b, p);
}
async function pieces(
  db: pg.PoolClient,
  product: string,
  unit: string,
  qty: number,
) {
  const u = (
    await db.query(
      "SELECT pieces_per_unit FROM product_units WHERE id=$1 AND product_id=$2 AND active AND archived_at IS NULL FOR SHARE",
      [unit, product],
    )
  ).rows[0];
  if (!u) throw new ApiError(422, "INVALID_UNIT", "وحدة غير متاحة لهذا المنتج");
  return BigInt(qty) * BigInt(u.pieces_per_unit);
}
async function active(
  db: pg.PoolClient,
  branches: string[],
  products: string[],
) {
  if (
    (
      await db.query(
        "SELECT id FROM branches WHERE id=ANY($1::uuid[]) AND active",
        [branches],
      )
    ).rowCount !== new Set(branches).size ||
    (
      await db.query(
        "SELECT id FROM products WHERE id=ANY($1::uuid[]) AND active",
        [products],
      )
    ).rowCount !== new Set(products).size
  )
    throw new ApiError(422, "INACTIVE_REFERENCE", "فرع أو منتج غير متاح");
}
async function move(
  db: pg.PoolClient,
  i: Identity,
  b: string,
  p: string,
  delta: bigint,
  reason: string,
  note: string,
  transferId: string | null,
) {
  const s = await expire(db, b, p);
  if (BigInt(s.on_hand) + delta < BigInt(s.reserved))
    throw conflict("INSUFFICIENT_STOCK", "المخزون الحر لا يكفي");
  await db.query(
    "UPDATE stock_levels SET on_hand=on_hand+$3,version=version+1 WHERE branch_id=$1 AND product_id=$2",
    [b, p, delta.toString()],
  );
  await db.query(
    "INSERT INTO stock_movements(branch_id,product_id,delta_pieces,reason,actor_id,note,transfer_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [b, p, delta.toString(), reason, i.id, note, transferId],
  );
  await reconcile(db, b, p);
}
export async function changeStock(
  pool: pg.Pool,
  i: Identity,
  v: z.infer<typeof c.stock>,
  key: string,
  requestId: string,
) {
  await requirePermission(pool, i, "inventory.adjust", [v.branch_id]);
  return idempotent(pool, i, "stock-adjust", key, v, async (db) => {
    await requirePermission(db, i, "inventory.adjust", [v.branch_id]);
    await lockStock(db, [{ branch: v.branch_id, product: v.product_id }]);
    await active(db, [v.branch_id], [v.product_id]);
    const delta = await pieces(db, v.product_id, v.unit_id, v.quantity);
    if (v.reason === "receipt" && delta < 0n)
      throw new ApiError(422, "INVALID_QUANTITY", "الاستلام موجب");
    await move(db, i, v.branch_id, v.product_id, delta, v.reason, v.note, null);
    await audit(
      db,
      requestId,
      i.id,
      "inventory." + v.reason,
      "product",
      v.product_id,
      { delta: delta.toString() },
      v.branch_id,
    );
    await db.query(
      `INSERT INTO outbox_events(event_type,aggregate_id,dedupe_key,payload) VALUES('inventory.changed',$1,$2,$3)`,
      [
        v.product_id,
        i.id + ":adjust:" + key,
        JSON.stringify({ branchId: v.branch_id, productId: v.product_id }),
      ],
    );
    return { ok: true, delta_pieces: delta.toString() };
  });
}
export async function transferStock(
  pool: pg.Pool,
  i: Identity,
  v: z.infer<typeof c.transfer>,
  key: string,
  requestId: string,
) {
  await requirePermission(pool, i, "inventory.transfer", [
    v.from_branch_id,
    v.to_branch_id,
  ]);
  return idempotent(pool, i, "stock-transfer", key, v, async (db) => {
    await requirePermission(db, i, "inventory.transfer", [
      v.from_branch_id,
      v.to_branch_id,
    ]);
    await lockStock(
      db,
      v.items.flatMap((p) =>
        [v.from_branch_id, v.to_branch_id].map((b) => ({
          branch: b,
          product: p.product_id,
        })),
      ),
    );
    await active(
      db,
      [v.from_branch_id, v.to_branch_id],
      v.items.map((p) => p.product_id),
    );
    const t = (
      await db.query(
        "INSERT INTO stock_transfers(from_branch_id,to_branch_id,actor_id,reason) VALUES($1,$2,$3,$4) RETURNING id",
        [v.from_branch_id, v.to_branch_id, i.id, v.reason],
      )
    ).rows[0];
    for (const item of v.items) {
      const n = await pieces(db, item.product_id, item.unit_id, item.quantity);
      await move(
        db,
        i,
        v.from_branch_id,
        item.product_id,
        -n,
        "transfer_out",
        v.reason,
        t.id,
      );
      await move(
        db,
        i,
        v.to_branch_id,
        item.product_id,
        n,
        "transfer_in",
        v.reason,
        t.id,
      );
      await db.query(
        "INSERT INTO stock_transfer_items(transfer_id,product_id,pieces) VALUES($1,$2,$3)",
        [t.id, item.product_id, n.toString()],
      );
    }
    for (const b of [v.from_branch_id, v.to_branch_id])
      await audit(
        db,
        requestId,
        i.id,
        "inventory.transfer",
        "stock_transfer",
        t.id,
        null,
        b,
      );
    await db.query(
      `INSERT INTO outbox_events(event_type,aggregate_id,dedupe_key,payload) VALUES('inventory.transferred',$1,$2,$3)`,
      [
        t.id,
        i.id + ":transfer:" + key,
        JSON.stringify({ from: v.from_branch_id, to: v.to_branch_id }),
      ],
    );
    return { id: t.id };
  });
}
export async function expireTimed(pool: pg.Pool) {
  const pairs = (
    await pool.query(
      `SELECT DISTINCT branch_id,product_id FROM stock_reservations WHERE state='active' AND hold_kind='timed' AND expires_at<=now() LIMIT 100`,
    )
  ).rows;
  for (const p of pairs)
    await transaction(pool, async (db) => {
      await lockStock(db, [{ branch: p.branch_id, product: p.product_id }]);
      await reconcile(db, p.branch_id, p.product_id);
      await expire(db, p.branch_id, p.product_id);
    });
  return pairs.length;
}
