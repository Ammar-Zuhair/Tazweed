import type pg from "pg";
import { idempotent } from "../catalog/stock.js";
import { requirePermission, type Identity } from "../identity/access.js";
import { order, scopes, event, conflict } from "../orders/core.js";
import { ApiError, notFound } from "../http.js";
import { cashState } from "./cash-state.js";
import {
  task,
  checkVersion,
  courierLock,
  courierScope,
  cashTotal,
  past,
  proof,
} from "./core.js";
export async function assign(
  pool: pg.Pool,
  i: Identity,
  id: string,
  key: string,
  v: any,
) {
  const pre = await order(pool, i, id, "orders.assign");
  await requirePermission(pool, i, "orders.assign", scopes(pre));
  return idempotent(pool, i, "dispatch." + id, key, v, async (db) => {
    const o = await order(db, i, id, "orders.assign", true);
    await requirePermission(db, i, "orders.assign", scopes(o));
    checkVersion(o, v.expectedVersion);
    if (o.status !== "confirmed")
      throw conflict("ASSIGNMENT_STATE", "الإسناد وإعادته قبل بدء الطريق فقط");
    await courierLock(db, v.courierId);
    const p = (
      await db.query(
        "SELECT p.* FROM courier_profiles p JOIN users u ON u.id=p.user_id JOIN courier_branches b ON b.courier_id=p.user_id WHERE p.user_id=$1 AND p.active AND u.status='active' AND u.kind='courier' AND b.branch_id=$2 FOR SHARE OF p,u",
        [v.courierId, o.branch_id],
      )
    ).rows[0];
    if (!p || p.commission_bps === null)
      throw conflict(
        "COURIER_UNCONFIGURED",
        "اختر موصلًا نشطًا له نطاق الفرع ونسبة عمولة صريحة",
      );
    if (
      (await db.query("SELECT 1 FROM cash_collections WHERE order_id=$1", [id]))
        .rowCount
    )
      throw conflict("CASH_ALREADY_COLLECTED", "لا تعِد إسناد طلب ذي نقد محصل");
    const old = (
      await db.query(
        "SELECT * FROM order_assignments WHERE order_id=$1 AND ended_at IS NULL",
        [id],
      )
    ).rows[0];
    if (old?.courier_id === v.courierId)
      throw conflict("ALREADY_ASSIGNED", "الطلب مسند إلى الموصل نفسه");
    await db.query(
      "UPDATE order_assignments SET ended_at=now() WHERE order_id=$1 AND ended_at IS NULL",
      [id],
    );
    const a = (
      await db.query(
        `INSERT INTO order_assignments(order_id,courier_id,assigned_by,commission_bps,delivery_fee_before_discount_yer,delivery_discount_yer,commission_yer) SELECT $1,$2,$3,$4,delivery_yer,delivery_discount_yer,round(delivery_yer::numeric*$4::int/10000)::bigint FROM order_quotes WHERE id=$5 RETURNING id`,
        [id, v.courierId, i.id, p.commission_bps, o.current_quote_id],
      )
    ).rows[0];
    return {
      ...(await event(db, i, o, "delivery.assigned", {
        assignmentId: a.id,
        reason: v.reason,
      })),
      assignmentId: a.id,
    };
  });
}
export async function courierCommand(
  pool: pg.Pool,
  i: Identity,
  id: string,
  key: string,
  action: "start" | "deliver" | "collect" | "exception",
  v: any,
) {
  await task(pool, i, id);
  return idempotent(pool, i, `courier.${id}.${action}`, key, v, async (db) => {
    let { o, a } = await task(db, i, id, true);
    await courierLock(db, i.id);
    ({ o, a } = await task(db, i, id));
    checkVersion(o, v.expectedVersion);
    if (action === "start") {
      if (o.status !== "confirmed")
        throw conflict("DELIVERY_STATE", "بدء التوصيل لطلب مؤكد فقط");
      await db.query("UPDATE orders SET status='on_the_way' WHERE id=$1", [id]);
      return event(db, i, o, "delivery.started");
    }
    if (!["on_the_way", "delivered"].includes(o.status))
      throw conflict("DELIVERY_STATE", "ابدأ التوصيل أولًا");
    const q = (
      await db.query("SELECT total_yer FROM order_quotes WHERE id=$1", [
        o.current_quote_id,
      ])
    ).rows[0];
    const total = BigInt(q.total_yer);
    if (action === "collect") {
      if (o.payment_kind !== "cash_on_delivery" || total === 0n)
        throw conflict("NOT_CASH_DUE", "هذا الطلب لا يحتاج تحصيلًا نقديًا");
      past(v.collectedAt);
      if (
        (
          await db.query(
            "SELECT 1 FROM cash_collections WHERE order_id=$1 AND entry_type='collection'",
            [id],
          )
        ).rowCount
      )
        throw conflict(
          "COLLECTION_EXISTS",
          "التحصيل مسجل؛ التصحيح الموثق من الإدارة",
        );
      const c = (
        await db.query(
          "INSERT INTO cash_collections(order_id,assignment_id,courier_id,amount_yer,reference,recorded_by,collected_at) VALUES($1,$2,$3,$4,$5,$3,$6) RETURNING id",
          [id, a.id, i.id, v.amountYer, v.reference, v.collectedAt],
        )
      ).rows[0];
      if (o.status === "delivered") {
        const state = await cashState(db, id, total);
        if (state.gap !== 0n)
          await db.query(
            "INSERT INTO financial_exceptions(order_id,branch_id,kind,amount_yer,reason,opened_by) VALUES($1,$2,$3,$4,$5,$6)",
            [
              id,
              o.branch_id,
              state.gap < 0n ? "overpayment" : "cash_shortfall",
              (state.gap < 0n ? -state.gap : state.gap).toString(),
              "فرق النقد بعد تسجيل تحصيل متأخر؛ يحتاج مراجعة الإدارة",
              i.id,
            ],
          );
      }
      return {
        ...(await event(db, i, o, "cash.collected", { collectionId: c.id })),
        collectionId: c.id,
      };
    }
    const state = await cashState(db, id, total),
      actual = state.collected,
      delta = state.gap;
    if (action === "exception") {
      if (o.payment_kind !== "cash_on_delivery" || delta === 0n)
        throw conflict("NO_CASH_DIFFERENCE", "لا يوجد فرق نقدي يستدعي استثناء");
      const kind =
        delta < 0n
          ? "overpayment"
          : actual === 0n
            ? "cash_uncollected"
            : "cash_shortfall";
      // A fresh snapshot after any adjustment: never use a stale exception as proof of another difference.
      const e = (
        await db.query(
          "INSERT INTO financial_exceptions(order_id,branch_id,kind,amount_yer,reason,opened_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
          [
            id,
            o.branch_id,
            kind,
            (delta < 0n ? -delta : delta).toString(),
            v.reason,
            i.id,
          ],
        )
      ).rows[0];
      return {
        ...(await event(db, i, o, "cash.exception_reported", {
          exceptionId: e.id,
        })),
        exceptionId: e.id,
      };
    }
    if (o.status !== "on_the_way")
      throw conflict("DELIVERY_STATE", "سجل التسليم مرة واحدة بعد بدء الطريق");
    if (o.payment_kind === "cash_on_delivery" && delta !== 0n) {
      const e = (
        await db.query(
          "SELECT * FROM financial_exceptions WHERE id=$1 AND order_id=$2 AND branch_id=$3 AND kind=$4 AND amount_yer=$5 ",
          [
            v.cashExceptionId ?? null,
            id,
            o.branch_id,
            delta < 0n
              ? "overpayment"
              : actual === 0n
                ? "cash_uncollected"
                : "cash_shortfall",
            (delta < 0n ? -delta : delta).toString(),
          ],
        )
      ).rows[0];
      if (!e)
        throw conflict(
          "CASH_EXCEPTION_REQUIRED",
          "سجل التحصيل الفعلي أو استثناء الفرق الحالي للإدارة قبل التسليم",
        );
    } else if (v.cashExceptionId)
      throw new ApiError(
        422,
        "UNEXPECTED_EXCEPTION",
        "لا يلزم استثناء نقدي لهذا التسليم",
      );
    await db.query(
      "UPDATE orders SET status='delivered',delivered_at=now() WHERE id=$1",
      [id],
    );
    if (BigInt(a.commission_yer) > 0n)
      await db.query(
        "INSERT INTO courier_earnings(courier_id,order_id,assignment_id,entry_type,amount_yer) VALUES($1,$2,$3,'delivery',$4)",
        [i.id, id, a.id, a.commission_yer],
      );
    return event(db, i, o, "delivery.delivered", { assignmentId: a.id });
  });
}
export async function adjustCash(
  pool: pg.Pool,
  i: Identity,
  id: string,
  key: string,
  v: any,
) {
  const get = async (db: any) => {
    const c = (
      await db.query("SELECT * FROM cash_collections WHERE id=$1", [id])
    ).rows[0];
    if (!c) throw notFound();
    const o = await order(db, i, c.order_id, "cash.adjust");
    await requirePermission(db, i, "cash.adjust", scopes(o));
    return { c, o };
  };
  await get(pool);
  return idempotent(pool, i, "cash.adjust." + id, key, v, async (db) => {
    const p = await get(db);
    const o = await order(db, i, p.o.id, "cash.adjust", true);
    await courierLock(db, p.c.courier_id);
    await get(db);
    past(v.collectedAt);
    await proof(db, i, v.proofMediaId);
    if (p.c.entry_type !== "collection")
      throw conflict("ADJUST_ORIGINAL", "اربط التصحيح بأصل التحصيل");
    if ((await cashTotal(db, o.id)) + BigInt(v.amountYer) < 0n)
      throw conflict("NEGATIVE_CASH", "لا يصبح صافي التحصيل سالبًا");
    const c = (
      await db.query(
        "INSERT INTO cash_collections(order_id,assignment_id,courier_id,entry_type,amount_yer,related_collection_id,reason,reference,recorded_by,collected_at,proof_media_id) VALUES($1,$2,$3,'adjustment',$4,$5,$6,$7,$8,$9,$10) RETURNING id",
        [
          o.id,
          p.c.assignment_id,
          p.c.courier_id,
          v.amountYer,
          id,
          v.reason,
          v.reference,
          i.id,
          v.collectedAt,
          v.proofMediaId,
        ],
      )
    ).rows[0];
    const total = BigInt(
        (
          await db.query("SELECT total_yer FROM order_quotes WHERE id=$1", [
            o.current_quote_id,
          ])
        ).rows[0].total_yer,
      ),
      state = await cashState(db, o.id, total),
      actual = state.collected,
      gap = state.gap;
    if (gap !== 0n)
      await db.query(
        "INSERT INTO financial_exceptions(order_id,branch_id,kind,amount_yer,reason,opened_by) VALUES($1,$2,$3,$4,$5,$6)",
        [
          o.id,
          o.branch_id,
          gap < 0n
            ? "overpayment"
            : actual === 0n
              ? "cash_uncollected"
              : "cash_shortfall",
          (gap < 0n ? -gap : gap).toString(),
          v.reason,
          i.id,
        ],
      );
    return {
      ...(await event(db, i, o, "cash.adjusted", { collectionId: c.id })),
      collectionId: c.id,
    };
  });
}
