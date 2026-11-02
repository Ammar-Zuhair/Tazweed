import type { Db } from "../db.js";
import type { Identity } from "../identity/access.js";
import { task, cashTotal } from "./core.js";
import { cashState } from "./cash-state.js";
export async function taskDetail(db: Db, i: Identity, id: string) {
  const { o, a } = await task(db, i, id);
  const q = (
    await db.query(
      "SELECT q.*,b.name_ar branch_name FROM order_quotes q JOIN branches b ON b.id=q.branch_id WHERE q.id=$1",
      [o.current_quote_id],
    )
  ).rows[0];
  const p = (
    await db.query(
      "SELECT address_snapshot,contact_snapshot FROM order_private_details WHERE id=$1 AND redacted_at IS NULL",
      [q.private_details_id],
    )
  ).rows[0];
  const items = (
    await db.query(
      "SELECT name_snapshot,unit_snapshot,quantity,pieces_per_unit FROM quote_items WHERE quote_id=$1 ORDER BY unit_id",
      [q.id],
    )
  ).rows;
  const collections = (
    await db.query(
      "SELECT id,entry_type,amount_yer,reference,collected_at,reason FROM cash_collections WHERE order_id=$1 AND courier_id=$2 ORDER BY collected_at,id",
      [id, i.id],
    )
  ).rows;
  const actual = await cashTotal(db, id),
    due = BigInt(q.total_yer),
    state = await cashState(db, id, due);
  const exceptions = (
    await db.query(
      "SELECT id,kind,amount_yer,status,reason FROM financial_exceptions WHERE order_id=$1 AND opened_by=$2 AND kind IN ('cash_shortfall','cash_uncollected','overpayment') ORDER BY created_at,id",
      [id, i.id],
    )
  ).rows;
  return {
    source: "backend",
    order: {
      id: o.id,
      order_number: o.order_number,
      status: o.status,
      version: o.version,
      payment_kind: o.payment_kind,
      delivered_at: o.delivered_at,
    },
    assignment: a,
    branch: { id: o.branch_id, name: q.branch_name },
    privateDetails: p ?? null,
    items,
    totalYer: q.total_yer,
    cashCollectedYer: actual.toString(),
    cashExternalReceivedYer: state.received.toString(),
    cashRefundedYer: state.refunded.toString(),
    cashWrittenOffYer: state.writtenOff.toString(),
    cashDueYer:
      o.payment_kind === "cash_on_delivery" ? state.gap.toString() : "0",
    collections,
    exceptions,
    allowedActions:
      o.status === "confirmed"
        ? ["start", "flag"]
        : o.status === "on_the_way"
          ? ["deliver", "collect", "cash_exception", "flag"]
          : ["flag"],
  };
}
