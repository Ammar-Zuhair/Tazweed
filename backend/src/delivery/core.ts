import type { Db } from "../db.js";
import type pg from "pg";
import { ApiError, forbidden, notFound } from "../http.js";
import { requirePermission, type Identity } from "../identity/access.js";
import { conflict } from "../orders/core.js";
export function courierOnly(i: Identity) {
  if (i.kind !== "courier" || i.app !== "courier") throw forbidden();
}
export async function task(db: Db, i: Identity, id: string, lock = false) {
  courierOnly(i);
  const o = (
    await db.query(
      `SELECT o.* FROM orders o WHERE o.id=$1 ${lock ? "FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!o) throw notFound();
  const a = (
    await db.query(
      "SELECT a.* FROM order_assignments a JOIN courier_profiles p ON p.user_id=a.courier_id JOIN users u ON u.id=p.user_id WHERE a.order_id=$1 AND a.courier_id=$2 AND a.ended_at IS NULL AND p.active AND u.status='active' AND EXISTS(SELECT 1 FROM courier_branches b WHERE b.courier_id=a.courier_id AND b.branch_id=$3)",
      [id, i.id, o.branch_id],
    )
  ).rows[0];
  if (!a) throw notFound();
  return { o, a };
}
export function checkVersion(o: any, v: number) {
  if (o.version !== v)
    throw conflict("STALE_VERSION", "تغير السجل؛ حدّثه قبل المحاولة");
}
export async function courierLock(db: Db, id: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,909))", [
    id,
  ]);
}
// Financial visibility is complete only when ALL historical source branches are authorized.
// Removing a current branch must never hide an old liability or grant its ledger to another branch.
export async function courierScope(
  db: Db,
  i: Identity,
  id: string,
  permission: string,
) {
  const p = (
    await db.query(
      "SELECT u.id,u.name_ar,u.phone_e164,u.status,p.active,p.commission_bps FROM courier_profiles p JOIN users u ON u.id=p.user_id WHERE u.id=$1 AND u.kind='courier'",
      [id],
    )
  ).rows[0];
  if (!p) throw notFound();
  const bs = (
    await db.query(
      `SELECT branch_id FROM courier_branches WHERE courier_id=$1 UNION SELECT o.branch_id FROM order_assignments a JOIN orders o ON o.id=a.order_id WHERE a.courier_id=$1`,
      [id],
    )
  ).rows.map((r) => r.branch_id);
  if (i.kind === "courier") {
    courierOnly(i);
    if (i.id !== id) throw notFound();
  } else await requirePermission(db, i, permission, bs.length ? bs : null);
  return { ...p, branchIds: bs };
}
export async function proof(db: Db, i: Identity, id: string) {
  if (
    !(
      await db.query(
        "SELECT 1 FROM media_objects WHERE id=$1 AND owner_id=$2 AND visibility='private' AND status='verified' AND purpose='financial_proof'",
        [id, i.id],
      )
    ).rowCount
  )
    throw new ApiError(
      422,
      "PROOF_REQUIRED",
      "يلزم إثبات خاص متحقق مملوك للموظف",
    );
}
export function past(date: string) {
  if (Date.parse(date) > Date.now() + 60000)
    throw new ApiError(
      422,
      "INVALID_OCCURRED_AT",
      "لا تسجل عملية بتاريخ مستقبلي",
    );
}
export async function attachment(
  db: Db,
  i: Identity,
  id: string | undefined,
  purpose: string,
) {
  if (!id) return;
  if (
    !(
      await db.query(
        "SELECT 1 FROM media_objects WHERE id=$1 AND owner_id=$2 AND status='verified' AND visibility='private' AND purpose=$3",
        [id, i.id, purpose],
      )
    ).rowCount
  )
    throw new ApiError(
      422,
      "INVALID_ATTACHMENT",
      "يلزم مرفق خاص متحقق يخص حسابك",
    );
}
export async function recorded(
  db: pg.PoolClient,
  i: Identity,
  type: string,
  id: string,
  details: any,
) {
  const { audit } = await import("../identity/audit.js");
  await audit(
    db,
    i.requestId ?? id,
    i.id,
    type,
    "courier_ledger",
    id,
    details,
    null,
  );
  await db.query(
    "INSERT INTO outbox_events(event_type,aggregate_id,dedupe_key,payload) VALUES($1,$2,$3,$4)",
    [type, id, type + ":" + id, JSON.stringify({ id })],
  );
}
export async function cashTotal(db: Db, id: string) {
  return BigInt(
    (
      await db.query(
        "SELECT coalesce(sum(amount_yer),0)::text n FROM cash_collections WHERE order_id=$1",
        [id],
      )
    ).rows[0].n,
  );
}
