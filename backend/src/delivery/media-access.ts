import type { Db } from "../db.js";
import {
  type Identity,
  accessScope,
  requirePermission,
} from "../identity/access.js";
import { forbidden, notFound } from "../http.js";
import { courierScope, task, courierOnly } from "./core.js";
export async function canUploadProof(db: Db, i: Identity) {
  if (i.kind !== "staff") throw forbidden();
  for (const permission of [
    "financial-exceptions.resolve",
    "commissions.reverse",
    "cash.reverse",
    "cash.adjust",
  ]) {
    const s = await accessScope(db, i, permission);
    if (s.global || s.branchIds.length) return;
  }
  throw forbidden();
}
export async function privateDeliveryMedia(db: Db, i: Identity, m: any) {
  if (m.purpose === "financial_proof") {
    let linked = false;
    const rs = (
      await db.query(
        "SELECT e.branch_id,o.branch_id current_branch,o.catalog_branch_id FROM financial_exception_resolutions r JOIN financial_exceptions e ON e.id=r.exception_id JOIN orders o ON o.id=e.order_id WHERE r.proof_media_id=$1",
        [m.id],
      )
    ).rows;
    for (const r of rs) {
      linked = true;
      await requirePermission(db, i, "financial-exceptions.resolve", [
        r.branch_id ?? r.catalog_branch_id,
        r.current_branch ?? r.catalog_branch_id,
      ]);
    }
    for (const [table, permission] of [
      ["courier_settlement_reversals", "commissions.reverse"],
      ["cash_remittance_reversals", "cash.reverse"],
    ] as const) {
      for (const r of (
        await db.query(
          `SELECT courier_id FROM ${table} WHERE proof_media_id=$1`,
          [m.id],
        )
      ).rows) {
        linked = true;
        await courierScope(db, i, r.courier_id, permission);
        if (i.kind !== "staff") throw forbidden();
      }
    }
    for (const r of (
      await db.query(
        "SELECT o.branch_id FROM cash_collections c JOIN orders o ON o.id=c.order_id WHERE c.proof_media_id=$1",
        [m.id],
      )
    ).rows) {
      linked = true;
      await requirePermission(db, i, "cash.adjust", [r.branch_id]);
    }
    if (!linked) {
      if (m.owner_id !== i.id) throw notFound();
      await canUploadProof(db, i);
    }
    return true;
  }
  if (m.purpose === "complaint" || m.purpose === "customer_flag") {
    const flag = m.purpose === "customer_flag",
      table = flag ? "customer_flags" : "complaints";
    const rows = (
      await db.query(
        `SELECT f.order_id,f.customer_id,f.${flag ? "reporter_id" : "customer_id"} author,o.branch_id FROM ${table} f JOIN orders o ON o.id=f.order_id WHERE f.attachment_id=$1`,
        [m.id],
      )
    ).rows;
    if (!rows.length) {
      if (m.owner_id !== i.id) throw notFound();
      if (flag) {
        if (i.kind === "courier") courierOnly(i);
        else {
          const s = await accessScope(db, i, "customer-flags.write");
          if (!s.global && !s.branchIds.length) throw forbidden();
        }
      } else if (i.kind !== "customer") throw forbidden();
      return true;
    }
    for (const r of rows) {
      if (i.kind === "customer" && !flag && r.customer_id === i.id) continue;
      if (i.kind === "courier" && flag && r.author === i.id) {
        await task(db, i, r.order_id);
        continue;
      }
      await requirePermission(
        db,
        i,
        flag ? "customer-flags.read" : "complaints.manage",
        [r.branch_id],
      );
    }
    return true;
  }
  return false;
}
