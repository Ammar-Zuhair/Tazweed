import type pg from "pg";
import { idempotent } from "../catalog/stock.js";
import { requirePermission, type Identity } from "../identity/access.js";
import { notFound, ApiError } from "../http.js";
import { order, scopes, event, exception, net, conflict } from "./core.js";
async function base(pool: pg.Pool, i: Identity, id: string, eid?: string) {
  const o = await order(pool, i, id, "financial-exceptions.resolve");
  await requirePermission(pool, i, "financial-exceptions.resolve", scopes(o));
  if (eid) {
    const e = (
      await pool.query(
        "SELECT branch_id FROM financial_exceptions WHERE id=$1 AND order_id=$2",
        [eid, id],
      )
    ).rows[0];
    if (!e) throw notFound();
    await requirePermission(
      pool,
      i,
      "financial-exceptions.resolve",
      scopes(o, e.branch_id),
    );
  }
}
export async function finance(
  pool: pg.Pool,
  i: Identity,
  id: string,
  key: string,
  action: "open" | "settle" | "resolve",
  v: any,
) {
  await base(pool, i, id, v.exceptionId);
  return idempotent(
    pool,
    i,
    `order.${id}.finance.${action}`,
    key,
    v,
    async (db) => {
      const o = await order(db, i, id, "financial-exceptions.resolve", true);
      await requirePermission(db, i, "financial-exceptions.resolve", scopes(o));
      if (o.version !== v.expectedVersion)
        throw conflict("STALE_VERSION", "تغير الطلب؛ حدّثه");
      if (action === "open") {
        const eid = await exception(db, i, o, v.kind, v.amountYer, v.reason);
        return {
          ...(await event(db, i, o, "finance.exception_opened", {
            exceptionId: eid,
          })),
          exceptionId: eid,
        };
      }
      const e = (
        await db.query(
          "SELECT * FROM financial_exceptions WHERE id=$1 AND order_id=$2 FOR UPDATE",
          [v.exceptionId, id],
        )
      ).rows[0];
      if (!e) throw notFound();
      await requirePermission(
        db,
        i,
        "financial-exceptions.resolve",
        scopes(o, e.branch_id),
      );
      if (e.status !== "open")
        throw conflict(
          "EXCEPTION_CLOSED",
          "الاستثناء مغلق؛ يبقى تاريخه ثابتًا",
        );
      if (action === "settle") {
        const proof = (
          await db.query(
            "SELECT 1 FROM media_objects WHERE id=$1 AND owner_id=$2 AND visibility='private' AND status='verified' AND purpose='financial_proof'",
            [v.proofMediaId, i.id],
          )
        ).rowCount;
        if (!proof)
          throw new ApiError(
            422,
            "PROOF_REQUIRED",
            "يلزم إثبات خاص متحقق مملوك للموظف",
          );
        if (Date.parse(v.occurredAt) > Date.now() + 60000)
          throw new ApiError(
            422,
            "INVALID_OCCURRED_AT",
            "لا تسجل تسوية بتاريخ مستقبلي",
          );
        const actual = await net(db, id),
          q = (
            await db.query("SELECT total_yer FROM order_quotes WHERE id=$1", [
              o.current_quote_id,
            ])
          ).rows[0],
          total = BigInt(q?.total_yer ?? 0),
          amount = BigInt(v.amountYer);
        if (["confirmed", "on_the_way", "delivered"].includes(o.status)) {
          // External late money may be refunded; never change a confirmed invoice or invent a collection.
          if (
            v.direction === "received_from_customer" ||
            (v.direction === "refund_to_customer" && amount > actual - total)
          )
            throw conflict(
              "CONFIRMED_AMOUNT_FROZEN",
              "لا تغير تسوية استثنائية مبلغ الطلب المؤكد",
            );
        }
        if (
          v.direction === "refund_to_customer" &&
          (amount === 0n || amount > actual)
        )
          throw conflict(
            "REFUND_EXCEEDS_NET",
            "لا يتجاوز الرد صافي المال المعتمد",
          );
        if (
          v.direction === "received_from_customer" &&
          (o.payment_kind !== "transfer" ||
            o.status !== "pending_review" ||
            amount === 0n ||
            amount > total - actual)
        )
          throw conflict(
            "RECEIVED_EXCEEDS_DUE",
            "لا يتجاوز الاستلام الخارجي الفرق المستحق للتحويل",
          );
        await db.query(
          "INSERT INTO financial_exception_resolutions(exception_id,direction,amount_yer,reason,reference,proof_media_id,actor_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            e.id,
            v.direction,
            v.amountYer,
            v.reason,
            v.reference,
            v.proofMediaId,
            i.id,
            v.occurredAt,
          ],
        );
        return event(db, i, o, "finance.settlement_recorded", {
          exceptionId: e.id,
          direction: v.direction,
        });
      }
      const rows = (
        await db.query(
          "SELECT * FROM financial_exception_resolutions WHERE exception_id=$1",
          [e.id],
        )
      ).rows;
      if (!rows.length)
        throw conflict(
          "RESOLUTION_REQUIRED",
          "وثق تسوية خارجية وإثباتها أولًا",
        );
      const actual = await net(db, id),
        q = (
          await db.query("SELECT total_yer FROM order_quotes WHERE id=$1", [
            o.current_quote_id,
          ])
        ).rows[0],
        total = BigInt(q?.total_yer ?? 0);
      // write_off/other are evidence, not money. They cannot bypass the exact-net confirmation guard.
      if (
        ["overpayment", "underpayment"].includes(e.kind) &&
        actual !== total &&
        actual !== 0n
      )
        throw conflict(
          "UNRESOLVED_DIFFERENCE",
          "فرق المال ما زال قائمًا؛ لا تغلقه بتغيير المبلغ المؤكد",
        );
      if (
        ["late_transfer", "stock_unavailable"].includes(e.kind) &&
        actual !== 0n &&
        actual !== total
      )
        throw conflict(
          "UNRESOLVED_DIFFERENCE",
          "يلزم رد المال أو مطابقته للعرض الحالي",
        );
      await db.query(
        "UPDATE financial_exceptions SET status='resolved' WHERE id=$1",
        [e.id],
      );
      return event(db, i, o, "finance.exception_resolved", {
        exceptionId: e.id,
        reason: v.reason,
      });
    },
  );
}
