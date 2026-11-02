import type { Db } from "../db.js";
import { cashTotal } from "./core.js";
export async function cashState(db: Db, id: string, total: bigint) {
  const rows = (
    await db.query(
      `SELECT r.direction,r.amount_yer FROM financial_exception_resolutions r JOIN financial_exceptions e ON e.id=r.exception_id WHERE e.order_id=$1 AND e.kind IN ('cash_shortfall','cash_uncollected','overpayment')`,
      [id],
    )
  ).rows;
  const collected = await cashTotal(db, id);
  const received: bigint = rows
    .filter((r) => r.direction === "received_from_customer")
    .reduce((n, r) => n + BigInt(r.amount_yer), 0n);
  const refunded: bigint = rows
    .filter((r) => r.direction === "refund_to_customer")
    .reduce((n, r) => n + BigInt(r.amount_yer), 0n);
  const writtenOff: bigint = rows
    .filter((r) => r.direction === "write_off")
    .reduce((n, r) => n + BigInt(r.amount_yer), 0n);
  return {
    collected,
    received,
    refunded,
    writtenOff,
    net: collected + received - refunded,
    gap: total - collected - received + refunded - writtenOff,
  };
}
