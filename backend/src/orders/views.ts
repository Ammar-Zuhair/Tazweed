import type { Db } from "../db.js";
import { accessScope, type Identity } from "../identity/access.js";
import { cashState } from "../delivery/cash-state.js";
import { cashTotal } from "../delivery/core.js";
import { order, scopes, net } from "./core.js";
export async function detail(
  db: Db,
  i: Identity,
  id: string,
  alertMinutes: number,
) {
  const o = await order(db, i, id);
  const customer = i.kind === "customer";
  const can = async (permission: string, branches: string[]) => {
    if (customer) return true;
    const s = await accessScope(db, i, permission);
    return s.global || branches.every((b) => s.branchIds.includes(b));
  };
  const quotes: any[] = [];
  for (const q of (
    await db.query(
      "SELECT q.*,b.name_ar branch_name FROM order_quotes q JOIN branches b ON b.id=q.branch_id WHERE q.order_id=$1 ORDER BY revision DESC",
      [id],
    )
  ).rows) {
    if (!(await can("orders.review", scopes(o, q.branch_id)))) continue;
    const items = (
      await db.query(
        "SELECT id,product_id,unit_id,name_snapshot,attributes_snapshot,unit_snapshot,pieces_per_unit,quantity,unit_price_yer::text,line_total_yer::text FROM quote_items WHERE quote_id=$1 ORDER BY unit_id",
        [q.id],
      )
    ).rows;
    quotes.push({ ...q, items });
  }
  const payments = [];
  for (const p of (
    await db.query(
      "SELECT p.*,q.branch_id historical_branch FROM payments p JOIN order_quotes q ON q.id=p.quote_id WHERE p.order_id=$1 ORDER BY p.created_at,p.id",
      [id],
    )
  ).rows) {
    if (!(await can("payments.verify", scopes(o, p.historical_branch))))
      continue;
    const attempts = (
      await db.query(
        "SELECT a.id,a.attempt_number,a.media_id,a.submitted_at,r.outcome,r.verified_amount_yer::text,r.note FROM payment_receipt_attempts a LEFT JOIN payment_receipt_reviews r ON r.attempt_id=a.id WHERE a.payment_id=$1 ORDER BY attempt_number",
        [p.id],
      )
    ).rows;
    payments.push({
      id: p.id,
      quote_id: p.quote_id,
      instruction_id: p.instruction_id,
      receipt_number: p.receipt_number,
      amount_yer: p.amount_yer,
      approved_amount_yer: p.approved_amount_yer,
      status: p.status,
      attempts,
    });
  }
  const exceptions = [];
  let openExceptions = 0;
  for (const e of (
    await db.query(
      "SELECT * FROM financial_exceptions WHERE order_id=$1 ORDER BY created_at,id",
      [id],
    )
  ).rows) {
    if (e.status === "open") openExceptions++;
    if (!(await can("financial-exceptions.resolve", scopes(o, e.branch_id))))
      continue;
    const resolutions = (
      await db.query(
        "SELECT * FROM financial_exception_resolutions WHERE exception_id=$1 ORDER BY created_at,id",
        [e.id],
      )
    ).rows;
    // Staff proof is private to authorized staff. Customer sees the financial direction/reference only.
    exceptions.push({
      ...e,
      resolutions: resolutions.map((r) =>
        customer
          ? {
              id: r.id,
              direction: r.direction,
              amount_yer: r.amount_yer,
              reason: r.reason,
              reference: r.reference,
              occurred_at: r.occurred_at,
            }
          : r,
      ),
    });
  }
  const instructions = [];
  for (const ins of (
    await db.query(
      "SELECT p.*,q.branch_id FROM payment_instructions p JOIN order_quotes q ON q.id=p.quote_id WHERE p.order_id=$1 ORDER BY revision DESC",
      [id],
    )
  ).rows) {
    if (await can("payments.verify", scopes(o, ins.branch_id)))
      instructions.push(ins);
  }
  const holds = (
    await db.query(
      `SELECT id,quote_id,branch_id,product_id,pieces::text,state,hold_kind,expires_at,protected_at,(state='active' AND hold_kind='receipt_review' AND protected_at<now()-($2::int * interval '1 minute')) overdue FROM stock_reservations WHERE order_id=$1 ORDER BY created_at,id`,
      [id, alertMinutes],
    )
  ).rows.filter((r) => customer || quotes.some((q) => q.id === r.quote_id));
  const privateDetails = (
    await db.query(
      "SELECT address_snapshot,contact_snapshot,redacted_at FROM order_private_details WHERE order_id=$1 ORDER BY revision DESC LIMIT 1",
      [id],
    )
  ).rows[0];
  const requestedItems = (
    await db.query(
      "SELECT i.product_id,i.unit_id,i.quantity,p.name_ar,u.unit_kind,u.pieces_per_unit FROM order_request_items i JOIN products p ON p.id=i.product_id JOIN product_units u ON u.id=i.unit_id WHERE order_id=$1 ORDER BY unit_id",
      [id],
    )
  ).rows;
  const cancellations = (
    await db.query(
      "SELECT * FROM order_cancellation_requests WHERE order_id=$1 ORDER BY created_at,id",
      [id],
    )
  ).rows;
  const events = (
    await db.query(
      "SELECT event_type,created_at FROM order_events WHERE order_id=$1 ORDER BY created_at,id",
      [id],
    )
  ).rows;
  const flags: any[] = [];
  let hasCustomerFlag = false;
  if (!customer) {
    for (const f of (
      await db.query(
        "SELECT f.id,f.details_ar,f.attachment_id,f.kind,f.status,f.admin_note,f.version,coalesce(o.branch_id,o.catalog_branch_id) branch_id FROM customer_flags f LEFT JOIN orders o ON o.id=f.order_id WHERE f.customer_id=$1 AND f.status<>'dismissed'",
        [o.customer_id],
      )
    ).rows) {
      hasCustomerFlag = true;
      if (
        f.branch_id &&
        (await can("customer-flags.read", scopes(o, f.branch_id)))
      )
        flags.push(f);
    }
  }
  const current = quotes.find((q) => q.id === o.current_quote_id),
    amount = await net(db, id);
  const quoteValidity = !current
    ? "none"
    : holds.some(
          (h) =>
            h.quote_id === current.id &&
            h.state === "active" &&
            h.hold_kind === "receipt_review",
        )
      ? "protected"
      : new Date(current.expires_at).getTime() > Date.now()
        ? "valid"
        : "expired";
  const cash = await cashTotal(db, id);
  const cashOpen = (
    await db.query(
      "SELECT 1 FROM financial_exceptions WHERE order_id=$1 AND status='open' AND kind IN ('cash_shortfall','cash_uncollected','overpayment')",
      [id],
    )
  ).rowCount;
  const cashAccounting = await cashState(
    db,
    id,
    BigInt(current?.total_yer ?? 0),
  );
  const paymentStatus =
    current?.total_yer === "0"
      ? "no_payment_due"
      : o.payment_kind === "cash_on_delivery"
        ? cashOpen
          ? "cash_exception"
          : current && cash === BigInt(current.total_yer)
            ? "collected"
            : cashAccounting.gap === 0n
              ? "cash_resolved"
              : cash > 0n
                ? "partially_collected"
                : "awaiting_cash_collection"
        : payments.some((p) => p.status === "pending")
          ? "checking_receipt"
          : current && amount === BigInt(current.total_yer)
            ? "verified_transfer"
            : "awaiting_transfer";
  const allowedActions: string[] = [];
  if (customer && o.payment_kind === "transfer" && instructions.length)
    allowedActions.push("report_receipt");
  if (
    customer &&
    payments.some((p) => p.attempts.at(-1)?.outcome === "image_rejected")
  )
    allowedActions.push("correct_image");
  if (!customer) {
    for (const [permission, action] of [
      ["payments.verify", "review_receipt"],
      ["financial-exceptions.resolve", "resolve_finance"],
    ])
      if (await can(permission!, scopes(o))) allowedActions.push(action!);
  }
  if (o.status === "pending_review") {
    if (customer) {
      allowedActions.push("cancel");
      if (current?.status === "sent" && quoteValidity === "valid")
        allowedActions.push("accept_quote", "decline_quote");
      if (!payments.length) allowedActions.push("payment_kind");
      if (
        current?.status === "accepted" &&
        o.payment_kind === "transfer" &&
        paymentStatus !== "no_payment_due"
      )
        allowedActions.push("issue_instructions");
    } else
      for (const [p, a] of [
        ["orders.reprice", "issue_quote"],
        ["orders.confirm", "confirm"],
        ["orders.reject", "reject"],
      ])
        if (await can(p!, scopes(o))) allowedActions.push(a!);
  }
  if (
    !customer &&
    o.status === "confirmed" &&
    (await can("orders.assign", scopes(o)))
  )
    allowedActions.push("assign");
  const assignment = !customer
    ? (
        await db.query(
          "SELECT a.*,u.name_ar FROM order_assignments a JOIN users u ON u.id=a.courier_id WHERE order_id=$1 ORDER BY assigned_at",
          [id],
        )
      ).rows
    : [];
  const review =
    (
      await db.query(
        "SELECT rating,comment_ar,created_at FROM order_reviews WHERE order_id=$1",
        [id],
      )
    ).rows[0] ?? null;
  const complaints =
    customer || (await can("complaints.manage", scopes(o)))
      ? (
          await db.query(
            "SELECT id,details_ar,attachment_id,status,admin_response,version,created_at FROM complaints WHERE order_id=$1 ORDER BY created_at,id",
            [id],
          )
        ).rows
      : [];
  const availableAddresses =
    !customer && (await can("orders.reprice", scopes(o)))
      ? (
          await db.query(
            "SELECT id,label,description FROM addresses WHERE user_id=$1 AND governorate_id=$2 AND archived_at IS NULL ORDER BY id",
            [o.customer_id, o.governorate_id],
          )
        ).rows
      : [];
  return {
    source: "backend",
    order: o,
    catalogBranchId: o.catalog_branch_id,
    executionBranchId: o.branch_id,
    quoteRevision: current?.revision ?? null,
    paymentKind: o.payment_kind,
    quoteValidity,
    paymentStatus,
    allowedActions,
    availableAddresses,
    privateDetails,
    requestedItems,
    quotes,
    payments,
    instructions,
    holds,
    exceptions,
    openExceptions,
    cancellations,
    events,
    hasCustomerFlag,
    flags,
    assignments: assignment,
    review,
    complaints,
    cashCollected: cash > 0n,
    cashCollectedYer: cash.toString(),
    cashExternalReceivedYer: cashAccounting.received.toString(),
    cashRefundedYer: cashAccounting.refunded.toString(),
    cashWrittenOffYer: cashAccounting.writtenOff.toString(),
    cashNotice:
      o.payment_kind === "cash_on_delivery"
        ? "المبلغ مستحق عند الاستلام؛ التأكيد لا يعني التحصيل."
        : null,
  };
}
