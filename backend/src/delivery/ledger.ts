import type pg from "pg";
import type { Db } from "../db.js";
import type { Identity } from "../identity/access.js";
import { idempotent } from "../catalog/stock.js";
import { courierLock, courierScope, proof, recorded } from "./core.js";
import { conflict } from "../orders/core.js";
import { notFound } from "../http.js";
// Table identifiers are constants selected here, never interpolated request fields.
const tables = (cash: boolean) =>
  cash
    ? {
        source: "cash_collections",
        head: "cash_remittances",
        items: "cash_remittance_items",
        reversals: "cash_remittance_reversals",
        parent: "remittance_id",
        column: "collection_id",
        actor: "received_by",
        permission: "cash.remit",
        reverse: "cash.reverse",
      }
    : {
        source: "courier_earnings",
        head: "courier_settlements",
        items: "settlement_items",
        reversals: "courier_settlement_reversals",
        parent: "settlement_id",
        column: "earning_id",
        actor: "paid_by",
        permission: "commissions.settle",
        reverse: "commissions.reverse",
      };
export async function ledger(db: Db, i: Identity, id: string, cash: boolean) {
  const t = tables(cash);
  await courierScope(db, i, id, t.permission);
  const sources = (
    await db.query(
      `SELECT s.*,o.order_number,o.branch_id,${cash ? "NULL::integer" : "a.commission_bps"} commission_bps,${cash ? "NULL::bigint" : "a.delivery_fee_before_discount_yer"} delivery_fee_before_discount_yer,${cash ? "NULL::bigint" : "a.delivery_discount_yer"} delivery_discount_yer,i.${t.parent} allocated_to FROM ${t.source} s JOIN orders o ON o.id=s.order_id ${cash ? "" : "LEFT JOIN order_assignments a ON a.id=s.assignment_id"} LEFT JOIN ${t.items} i ON i.${t.column}=s.id WHERE s.courier_id=$1 ORDER BY s.${cash ? "collected_at" : "earned_at"},s.id`,
      [id],
    )
  ).rows;
  const credits = (
    await db.query(
      `SELECT r.*,i.${t.parent} allocated_to FROM ${t.reversals} r LEFT JOIN ${t.items} i ON i.reversal_credit_id=r.id WHERE r.courier_id=$1 ORDER BY r.created_at,r.id`,
      [id],
    )
  ).rows;
  const payouts = (
    await db.query(
      `SELECT h.*, (SELECT jsonb_agg(jsonb_build_object('sourceId',i.${t.column},'reversalCreditId',i.reversal_credit_id)) FROM ${t.items} i WHERE i.${t.parent}=h.id) allocations FROM ${t.head} h WHERE courier_id=$1 ORDER BY created_at,id`,
      [id],
    )
  ).rows;
  const sum = (rows: any[], field: string) =>
    rows.reduce((n, r) => n + BigInt(r[field]), 0n);
  const amount = sum(sources, "amount_yer"),
    reversed = sum(credits, "amount_yer"),
    paid = sum(payouts, "total_yer");
  const today = new Date().toISOString().slice(0, 10),
    todayEarned = sources
      .filter((s) =>
        new Date(s[cash ? "collected_at" : "earned_at"])
          .toISOString()
          .startsWith(today),
      )
      .reduce((n, s) => n + BigInt(s.amount_yer), 0n);
  return {
    source: "backend",
    todayEarnedYer: todayEarned.toString(),
    dayBasis: "UTC",
    kind: cash ? "cash" : "commission",
    courierId: id,
    totalYer: amount.toString(),
    reversedYer: reversed.toString(),
    paidYer: paid.toString(),
    balanceYer: (amount + reversed - paid).toString(),
    sources,
    credits,
    payouts,
  };
}
export async function allocate(
  pool: pg.Pool,
  i: Identity,
  key: string,
  v: any,
  cash: boolean,
) {
  const t = tables(cash);
  await courierScope(pool, i, v.courierId, t.permission);
  return idempotent(pool, i, t.head, key, v, async (db) => {
    await courierLock(db, v.courierId);
    await courierScope(db, i, v.courierId, t.permission);
    const ss = (
      await db.query(
        `SELECT * FROM ${t.source} WHERE id=ANY($1::uuid[]) AND courier_id=$2 ORDER BY id`,
        [v.sourceIds, v.courierId],
      )
    ).rows;
    const cr = (
      await db.query(
        `SELECT * FROM ${t.reversals} WHERE id=ANY($1::uuid[]) AND courier_id=$2 ORDER BY id`,
        [v.reversalCreditIds, v.courierId],
      )
    ).rows;
    if (
      ss.length !== v.sourceIds.length ||
      cr.length !== v.reversalCreditIds.length
    )
      throw notFound();
    if (
      (
        await db.query(
          `SELECT 1 FROM ${t.items} WHERE ${t.column}=ANY($1::uuid[]) OR reversal_credit_id=ANY($2::uuid[])`,
          [v.sourceIds, v.reversalCreditIds],
        )
      ).rowCount
    )
      throw conflict("ALREADY_ALLOCATED", "بند مختار سبق تخصيصه؛ حدّث الدفتر");
    const total = [...ss, ...cr].reduce((n, r) => n + BigInt(r.amount_yer), 0n);
    if (total !== BigInt(v.totalYer) || total <= 0n)
      throw conflict(
        "TOTAL_MISMATCH",
        "الإجمالي يجب أن يطابق مجموع البنود المختارة",
      );
    const head = (
      await db.query(
        `INSERT INTO ${t.head}(courier_id,${t.actor},total_yer,reference) VALUES($1,$2,$3,$4) RETURNING id`,
        [v.courierId, i.id, v.totalYer, v.reference],
      )
    ).rows[0];
    for (const s of ss)
      await db.query(
        `INSERT INTO ${t.items}(${t.parent},${t.column}) VALUES($1,$2)`,
        [head.id, s.id],
      );
    for (const c of cr)
      await db.query(
        `INSERT INTO ${t.items}(${t.parent},reversal_credit_id) VALUES($1,$2)`,
        [head.id, c.id],
      );
    await recorded(
      db,
      i,
      cash ? "cash.remitted" : "commission.settled",
      head.id,
      { courierId: v.courierId, totalYer: v.totalYer },
    );
    return { id: head.id };
  });
}
export async function reverse(
  pool: pg.Pool,
  i: Identity,
  id: string,
  key: string,
  v: any,
  cash: boolean,
) {
  const t = tables(cash);
  const auth = async (db: Db) => {
    const h = (await db.query(`SELECT * FROM ${t.head} WHERE id=$1`, [id]))
      .rows[0];
    if (!h) throw notFound();
    await courierScope(db, i, h.courier_id, t.reverse);
    return h;
  };
  await auth(pool);
  return idempotent(pool, i, t.reversals + "." + id, key, v, async (db) => {
    const h = await auth(db);
    await courierLock(db, h.courier_id);
    await auth(db);
    await proof(db, i, v.proofMediaId);
    if (
      (
        await db.query(`SELECT 1 FROM ${t.reversals} WHERE ${t.parent}=$1`, [
          id,
        ])
      ).rowCount
    )
      throw conflict("ALREADY_REVERSED", "الأصل معكوس؛ لا يُنشأ رصيد ثان");
    const r = (
      await db.query(
        `INSERT INTO ${t.reversals}(${t.parent},courier_id,amount_yer,actor_id,reason,reference,proof_media_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          id,
          h.courier_id,
          h.total_yer,
          i.id,
          v.reason,
          v.reference,
          v.proofMediaId,
        ],
      )
    ).rows[0];
    await recorded(
      db,
      i,
      cash ? "cash.remittance_reversed" : "commission.settlement_reversed",
      r.id,
      { originalId: id, courierId: h.courier_id },
    );
    return { id: r.id };
  });
}
