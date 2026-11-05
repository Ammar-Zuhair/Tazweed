import type pg from "pg";
import { idempotent, reconcile } from "../catalog/stock.js";
import {
  requirePermission,
  customerOnly,
  type Identity,
} from "../identity/access.js";
import { catalogContext, customerMaintenance } from "../checkout/service.js";
import type { RoutingProvider } from "../checkout/routing.js";
import { ApiError, notFound } from "../http.js";
import { quotePrice } from "./pricing.js";
import {
  order,
  pending,
  event,
  scopes,
  stockLocks,
  release,
  reserve,
  net,
  exception,
  noExceptions,
  noUnreviewed,
  conflict,
} from "./core.js";
export async function submitOrder(
  pool: pg.Pool,
  i: Identity,
  key: string,
  v: any,
) {
  customerOnly(i);
  return idempotent(pool, i, "orders.submit", key, v, async (db) => {
    await customerMaintenance(db,true);
    const b = await catalogContext(db, v.governorateId);
    const a = (
      await db.query(
        "SELECT id,label,governorate_id,latitude::float8,longitude::float8,description FROM addresses WHERE id=$1 AND user_id=$2 AND archived_at IS NULL",
        [v.addressId, i.id],
      )
    ).rows[0];
    if (!a) throw notFound();
    if (a.governorate_id !== v.governorateId)
      throw new ApiError(
        422,
        "ADDRESS_GOVERNORATE_MISMATCH",
        "العنوان لا يخص المحافظة",
      );
    const o = (
      await db.query(
        "INSERT INTO orders(customer_id,governorate_id,catalog_branch_id,kind,payment_kind) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [i.id, v.governorateId, b.catalog_branch_id, v.kind, v.paymentKind],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO order_private_details(order_id,revision,address_snapshot,contact_snapshot) VALUES($1,1,$2,$3)",
      [
        o.id,
        JSON.stringify(a),
        JSON.stringify({ name_ar: i.name_ar, phone_e164: i.phone_e164 }),
      ],
    );
    for (const x of v.items) {
      const u = (
        await db.query(
          "SELECT u.product_id FROM product_units u JOIN products p ON p.id=u.product_id JOIN categories c ON c.id=p.category_id WHERE u.id=$1 AND u.active AND u.archived_at IS NULL AND p.active AND c.active AND NOT EXISTS(SELECT 1 FROM category_attributes ca JOIN attributes a ON a.id=ca.attribute_id WHERE ca.category_id=p.category_id AND ca.required AND (NOT a.active OR NOT EXISTS(SELECT 1 FROM product_attribute_values pa JOIN attribute_values av ON av.id=pa.value_id AND av.active WHERE pa.product_id=p.id AND pa.attribute_id=ca.attribute_id)))",
          [x.unitId],
        )
      ).rows[0];
      if (!u) throw conflict("ITEM_UNAVAILABLE", "وحدة غير متاحة؛ راجع السلة");
      await db.query(
        "INSERT INTO order_request_items(order_id,product_id,unit_id,quantity) VALUES($1,$2,$3,$4)",
        [o.id, u.product_id, x.unitId, x.quantity],
      );
    }
    return event(db, i, o, "order.submitted");
  });
}
async function run(
  pool: pg.Pool,
  i: Identity,
  id: string,
  key: string,
  action: string,
  v: any,
  permission: string,
  fn: (db: pg.PoolClient, o: any) => Promise<any>,
) {
  const before = await order(pool, i, id, permission);
  if (permission !== "orders.review")
    await requirePermission(pool, i, permission, scopes(before));
  return idempotent(
    pool,
    i,
    "order." + id + "." + action,
    key,
    v,
    async (db) => {
      const o = await order(db, i, id, permission, true);
      if (permission !== "orders.review")
        await requirePermission(db, i, permission, scopes(o));
      pending(o, v.expectedVersion);
      return fn(db, o);
    },
  );
}
export async function issueQuote(
  pool: pg.Pool,
  routing: RoutingProvider,
  i: Identity,
  id: string,
  key: string,
  v: any,
) {
  const before = await order(pool, i, id, "orders.reprice");
  await requirePermission(
    pool,
    i,
    "orders.reprice",
    scopes(before, v.branchId),
  );
  const moneyScope = async (db: any, o: any) => {
    if ((await net(db, id)) > 0n) {
      if (!v.carryVerifiedMoney)
        throw conflict(
          "VERIFIED_MONEY_DECISION_REQUIRED",
          "يوجد مال معتمد؛ اختر نقل رصيده إلى النسخة الجديدة صراحة أو سوّ رده أولًا",
        );
      const branches = (
        await db.query(
          "SELECT DISTINCT q.branch_id FROM payments p JOIN order_quotes q ON q.id=p.quote_id WHERE p.order_id=$1",
          [id],
        )
      ).rows.map((r: any) => r.branch_id);
      await requirePermission(
        db,
        i,
        "payments.verify",
        scopes(o, v.branchId, ...branches),
      );
    }
  };
  await moneyScope(pool, before);
  return run(pool, i, id, key, "quote", v, "orders.reprice", async (db, o) => {
    await requirePermission(db, i, "orders.reprice", scopes(o, v.branchId));
    await noUnreviewed(db, id);
    await noExceptions(db, id);
    await moneyScope(db, o);
    if (
      (
        await db.query(
          "SELECT 1 FROM stock_reservations WHERE order_id=$1 AND state='active' AND hold_kind='receipt_review'",
          [id],
        )
      ).rowCount
    )
      throw conflict(
        "PROTECTED_QUOTE",
        "يلزم قرار صريح بعد مراجعة الإيصال لتحرير الحجز",
      );
    await stockLocks(db, o, v.branchId);
    let priv = (
      await db.query(
        "SELECT * FROM order_private_details WHERE order_id=$1 ORDER BY revision DESC LIMIT 1",
        [id],
      )
    ).rows[0];
    if (v.addressId) {
      const a = (
        await db.query(
          "SELECT id,label,description,governorate_id,latitude::float8,longitude::float8 FROM addresses WHERE id=$1 AND user_id=$2 AND governorate_id=$3 AND archived_at IS NULL",
          [v.addressId, o.customer_id, o.governorate_id],
        )
      ).rows[0];
      if (!a) throw notFound();
      priv = (
        await db.query(
          "INSERT INTO order_private_details(order_id,revision,address_snapshot,contact_snapshot) VALUES($1,$2,$3,$4) RETURNING *",
          [
            id,
            priv.revision + 1,
            JSON.stringify(a),
            JSON.stringify(priv.contact_snapshot),
          ],
        )
      ).rows[0];
    }
    const p = await quotePrice(db, routing, o, v.branchId, priv, v);
    await release(db, o);
    await db.query(
      "UPDATE order_quotes SET status='superseded' WHERE id=$1 AND status IN ('sent','accepted')",
      [o.current_quote_id],
    );
    const revision = Number(
      (
        await db.query(
          "SELECT coalesce(max(revision),0)+1 n FROM order_quotes WHERE order_id=$1",
          [id],
        )
      ).rows[0].n,
    );
    const q = (
      await db.query(
        `INSERT INTO order_quotes(order_id,branch_id,private_details_id,revision,subtotal_yer,product_discount_yer,delivery_yer,delivery_discount_yer,total_yer,pricing_mode,distance_m,base_yer,per_km_yer,routing_source,delivery_rule_snapshot,promotion_id,promotion_snapshot,author_id,expires_at,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now()+interval '30 minutes',$19) RETURNING *`,
        [
          id,
          v.branchId,
          priv.id,
          revision,
          p.subtotal,
          p.productDiscount,
          p.delivery.fee_yer,
          p.deliveryDiscount,
          p.total,
          p.delivery.pricingMode,
          p.delivery.distance_m,
          p.delivery.base_yer,
          p.delivery.per_km_yer,
          p.delivery.routing_source,
          JSON.stringify({
            ...p.snapshot,
            carryVerifiedMoney: v.carryVerifiedMoney,
          }),
          p.promotion?.id ?? null,
          p.promotion ? JSON.stringify(p.promotion) : null,
          i.id,
          v.reason,
        ],
      )
    ).rows[0];
    for (const l of p.lines)
      await db.query(
        "INSERT INTO quote_items(quote_id,product_id,unit_id,name_snapshot,attributes_snapshot,unit_snapshot,pieces_per_unit,quantity,unit_price_yer,line_total_yer) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          q.id,
          l.productId,
          l.unitId,
          l.name_ar,
          JSON.stringify(l.attributes),
          l.unitKind,
          l.piecesPerUnit,
          l.quantity,
          l.unitPriceYer,
          l.lineTotalYer,
        ],
      );
    await db.query("UPDATE order_quotes SET status='sent' WHERE id=$1", [q.id]);
    await db.query(
      "UPDATE orders SET branch_id=$2,branch_selected_by=$3,branch_selected_at=now(),current_quote_id=$4 WHERE id=$1",
      [id, v.branchId, i.id, q.id],
    );
    o.branch_id = v.branchId;
    await reserve(db, o, q, q.expires_at);
    const carried = await net(db, id);
    if (carried > 0n && carried !== BigInt(q.total_yer))
      await exception(
        db,
        i,
        o,
        carried > BigInt(q.total_yer) ? "overpayment" : "underpayment",
        (carried > BigInt(q.total_yer)
          ? carried - BigInt(q.total_yer)
          : BigInt(q.total_yer) - carried
        ).toString(),
        "فرق الرصيد المعتمد المنقول إلى نسخة جديدة؛ يلزم تسوية موثقة",
      );
    return {
      ...(await event(
        db,
        i,
        o,
        "quote.issued",
        { quoteId: q.id, revision, reason: v.reason },
        "awaiting_customer",
      )),
      quoteId: q.id,
    };
  });
}
export async function decideQuote(
  pool: pg.Pool,
  i: Identity,
  id: string,
  key: string,
  v: any,
) {
  customerOnly(i);
  return run(
    pool,
    i,
    id,
    key,
    "decision",
    v,
    "orders.review",
    async (db, o) => {
      if (o.current_quote_id !== v.quoteId)
        throw conflict("OLD_QUOTE", "هذا العرض سابق؛ افتح أحدث نسخة");
      const q = (
        await db.query("SELECT * FROM order_quotes WHERE id=$1", [v.quoteId])
      ).rows[0];
      if (q.status !== "sent" || new Date(q.expires_at).getTime() <= Date.now())
        throw conflict(
          "QUOTE_EXPIRED",
          "العرض غير صالح للقبول؛ اطلب إعادة التسعير",
        );
      await stockLocks(db, o, o.branch_id);
      await db.query(
        `UPDATE order_quotes SET status=$2,accepted_by=$3,accepted_at=CASE WHEN $3::uuid IS NULL THEN NULL ELSE now() END WHERE id=$1`,
        [q.id, v.accept ? "accepted" : "declined", v.accept ? i.id : null],
      );
      if (!v.accept) {
        await release(db, o);
        const amount = await net(db, id);
        if (amount > 0n)
          await exception(
            db,
            i,
            o,
            "stock_unavailable",
            amount.toString(),
            "رفض العميل النسخة البديلة مع وجود مال معتمد؛ يلزم حسمه",
          );
      } else if (
        o.payment_kind === "transfer" &&
        q.delivery_rule_snapshot.carryVerifiedMoney &&
        (await net(db, id)) > 0n
      ) {
        await noUnreviewed(db, id);
        await db.query(
          "UPDATE stock_reservations SET hold_kind='receipt_review',expires_at=NULL,protected_at=now() WHERE quote_id=$1 AND state='active' AND hold_kind='timed' AND expires_at>now()",
          [q.id],
        );
      }
      return event(
        db,
        i,
        o,
        v.accept ? "quote.accepted" : "quote.declined",
        { quoteId: q.id },
        v.accept
          ? o.payment_kind === "transfer"
            ? "awaiting_transfer"
            : "ready_to_confirm"
          : "awaiting_quote",
      );
    },
  );
}
export async function setPaymentKind(
  pool: pg.Pool,
  i: Identity,
  id: string,
  key: string,
  v: any,
) {
  customerOnly(i);
  return run(
    pool,
    i,
    id,
    key,
    "payment-kind",
    v,
    "orders.review",
    async (db, o) => {
      await db.query("UPDATE orders SET payment_kind=$2 WHERE id=$1", [
        id,
        v.paymentKind,
      ]);
      const q = (
        await db.query("SELECT status FROM order_quotes WHERE id=$1", [
          o.current_quote_id,
        ])
      ).rows[0];
      return event(
        db,
        i,
        o,
        "order.payment_kind",
        { kind: v.paymentKind },
        q?.status === "accepted"
          ? v.paymentKind === "transfer"
            ? "awaiting_transfer"
            : "ready_to_confirm"
          : undefined,
      );
    },
  );
}
export async function issueInstructions(
  pool: pg.Pool,
  i: Identity,
  id: string,
  key: string,
  v: any,
) {
  customerOnly(i);
  return run(
    pool,
    i,
    id,
    key,
    "instructions",
    v,
    "orders.review",
    async (db, o) => {
      await stockLocks(db, o, o.branch_id);
      const q = (
        await db.query("SELECT * FROM order_quotes WHERE id=$1", [
          o.current_quote_id,
        ])
      ).rows[0];
      if (!q || q.status !== "accepted" || o.payment_kind !== "transfer")
        throw conflict(
          "ACCEPT_QUOTE_FIRST",
          "اقبل العرض الحالي واختر التحويل أولًا",
        );
      const valid = (
        await db.query(
          "SELECT 1 FROM stock_reservations WHERE quote_id=$1 AND state='active' AND (hold_kind='receipt_review' OR expires_at>now())",
          [q.id],
        )
      ).rowCount;
      if (!valid)
        throw conflict(
          "HOLD_EXPIRED",
          "انتهى الحجز الأولي؛ يلزم عرض صالح قبل تحويل المال",
        );
      const m = (
        await db.query(
          "SELECT id,name_ar,beneficiary,destination_number,instructions_ar FROM payment_methods WHERE id=$1 AND active AND (branch_id IS NULL OR branch_id=$2) FOR SHARE",
          [v.methodId, q.branch_id],
        )
      ).rows[0];
      if (!m) throw notFound();
      const old = (
        await db.query(
          "SELECT id FROM payment_instructions WHERE order_id=$1 AND quote_id=$2 AND method_id=$3 ORDER BY revision DESC LIMIT 1",
          [id, q.id, m.id],
        )
      ).rows[0];
      const instructionId =
        old?.id ??
        (
          await db.query(
            "INSERT INTO payment_instructions(order_id,quote_id,method_id,revision,method_snapshot,expected_amount_yer) SELECT $1,$2,$3,coalesce(max(revision),0)+1,$4,$5 FROM payment_instructions WHERE order_id=$1 RETURNING id",
            [id, q.id, m.id, JSON.stringify(m), q.total_yer],
          )
        ).rows[0].id;
      return {
        ...(await event(db, i, o, "payment.instructions_issued", {
          instructionId,
        })),
        instructionId,
      };
    },
  );
}
export function normalizeReceipt(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
    .replace(/[\s\p{P}\p{Cf}]/gu, "")
    .toUpperCase();
}
export async function reportReceipt(
  pool: pg.Pool,
  i: Identity,
  id: string,
  key: string,
  v: any,
  limit: number,
) {
  customerOnly(i);
  await order(pool, i, id);
  // Late receipts must still be recorded even for a closed order: no automatic re-reservation.
  return idempotent(pool, i, "order." + id + ".receipt", key, v, async (db) => {
    const o = await order(db, i, id, "orders.review", true);
    if (o.version !== v.expectedVersion)
      throw conflict("STALE_VERSION", "تغير الطلب؛ حدّثه");
    if (o.payment_kind !== "transfer")
      throw conflict("NOT_TRANSFER", "الطلب ليس تحويلًا");
    const instruction = (
      await db.query(
        "SELECT * FROM payment_instructions WHERE id=$1 AND order_id=$2",
        [v.instructionId, id],
      )
    ).rows[0];
    if (!instruction) throw notFound();
    await stockLocks(db, o);
    await receiptLimit(db, i, limit);
    const normalized = normalizeReceipt(v.receiptNumber);
    if (!normalized)
      throw new ApiError(
        422,
        "INVALID_RECEIPT_NUMBER",
        "أدخل رقم التحويل الفعلي",
      );
    const payment = (
      await db.query(
        "INSERT INTO payments(order_id,quote_id,method_id,instruction_id,receipt_number,normalized_receipt_number,amount_yer) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [
          id,
          instruction.quote_id,
          instruction.method_id,
          instruction.id,
          v.receiptNumber,
          normalized,
          v.amountYer,
        ],
      )
    ).rows[0];
    const a = (
      await db.query(
        "INSERT INTO payment_receipt_attempts(payment_id,attempt_number,media_id,submitted_by) VALUES($1,1,$2,$3) RETURNING id",
        [payment.id, v.mediaId, i.id],
      )
    ).rows[0];
    const protectedHold = (
      await db.query(
        "SELECT 1 FROM stock_reservations WHERE quote_id=$1 AND state='active' AND hold_kind='receipt_review'",
        [instruction.quote_id],
      )
    ).rowCount;
    if (
      !protectedHold ||
      instruction.quote_id !== o.current_quote_id ||
      o.status !== "pending_review"
    )
      await exception(
        db,
        i,
        o,
        "late_transfer",
        v.amountYer,
        "وصل إيصال خارج الحجز الحالي؛ يلزم التحقق وتسوية موثقة",
        (
          await db.query("SELECT branch_id FROM order_quotes WHERE id=$1", [
            instruction.quote_id,
          ])
        ).rows[0].branch_id,
      );
    return {
      ...(await event(
        db,
        i,
        o,
        "payment.reported",
        { paymentId: payment.id, attemptId: a.id, late: !protectedHold },
        o.status === "pending_review" ? "checking_receipt" : undefined,
      )),
      paymentId: payment.id,
    };
  });
}
async function receiptLimit(db: pg.PoolClient, i: Identity, limit: number) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,808))", [
    i.id,
  ]);
  if (
    Number(
      (
        await db.query(
          "SELECT count(*) n FROM payment_receipt_attempts WHERE submitted_by=$1 AND submitted_at>now()-interval '1 hour'",
          [i.id],
        )
      ).rows[0].n,
    ) >= limit
  )
    throw new ApiError(
      429,
      "RECEIPT_RATE_LIMIT",
      "تجاوزت محاولات الإيصال المسموحة؛ حاول لاحقًا",
    );
}
export async function retryImage(
  pool: pg.Pool,
  i: Identity,
  id: string,
  pid: string,
  key: string,
  v: any,
  limit: number,
) {
  customerOnly(i);
  await order(pool, i, id);
  return idempotent(
    pool,
    i,
    "payment." + pid + ".image",
    key,
    v,
    async (db) => {
      const o = await order(db, i, id, "orders.review", true);
      if (o.version !== v.expectedVersion)
        throw conflict("STALE_VERSION", "تغير الطلب؛ حدّثه");
      const p = (
        await db.query(
          "SELECT * FROM payments WHERE id=$1 AND order_id=$2 FOR UPDATE",
          [pid, id],
        )
      ).rows[0];
      if (!p) throw notFound();
      const last = (
        await db.query(
          "SELECT a.*,r.outcome FROM payment_receipt_attempts a LEFT JOIN payment_receipt_reviews r ON r.attempt_id=a.id WHERE a.payment_id=$1 ORDER BY attempt_number DESC LIMIT 1",
          [pid],
        )
      ).rows[0];
      if (last?.outcome !== "image_rejected")
        throw conflict(
          "IMAGE_CORRECTION_UNAVAILABLE",
          "التصحيح متاح لصورة مرفوضة فقط؛ لا تنشئ تحويلًا جديدًا للصورة نفسها",
        );
      await stockLocks(db, o);
      await receiptLimit(db, i, limit);
      await db.query(
        "INSERT INTO payment_receipt_attempts(payment_id,attempt_number,media_id,submitted_by) VALUES($1,$2,$3,$4)",
        [pid, last.attempt_number + 1, v.mediaId, i.id],
      );
      if (
        !(
          await db.query(
            "SELECT 1 FROM stock_reservations WHERE quote_id=$1 AND state='active' AND hold_kind='receipt_review'",
            [p.quote_id],
          )
        ).rowCount ||
        p.quote_id !== o.current_quote_id ||
        o.status !== "pending_review"
      )
        await exception(
          db,
          i,
          o,
          "late_transfer",
          p.amount_yer,
          "تصحيح صورة بعد انتهاء أو تحرير الحجز؛ لا إعادة حجز تلقائيًا",
          (
            await db.query("SELECT branch_id FROM order_quotes WHERE id=$1", [
              p.quote_id,
            ])
          ).rows[0].branch_id,
        );
      return event(
        db,
        i,
        o,
        "payment.image_corrected",
        { paymentId: pid },
        o.status === "pending_review" ? "checking_receipt" : undefined,
      );
    },
  );
}
export async function reviewReceipt(
  pool: pg.Pool,
  i: Identity,
  id: string,
  pid: string,
  key: string,
  v: any,
) {
  const check = async (db: any, o: any) => {
    const p = (
      await db.query(
        "SELECT p.*,q.branch_id historical_branch FROM payments p JOIN order_quotes q ON q.id=p.quote_id WHERE p.id=$1 AND p.order_id=$2",
        [pid, id],
      )
    ).rows[0];
    if (!p) throw notFound();
    await requirePermission(
      db,
      i,
      "payments.verify",
      scopes(o, p.historical_branch),
    );
    return p;
  };
  await check(pool, await order(pool, i, id, "payments.verify"));
  // Permit reviewing a late transfer on a closed order, without changing its confirmed invoice.
  return idempotent(
    pool,
    i,
    "payment." + pid + ".review",
    key,
    v,
    async (db) => {
      const o = await order(db, i, id, "payments.verify", true);
      if (o.version !== v.expectedVersion)
        throw conflict("STALE_VERSION", "تغير الطلب؛ حدّثه");
      const p = await check(db, o);
      await stockLocks(db, o);
      await db.query(
        "INSERT INTO payment_receipt_reviews(payment_id,attempt_id,reviewer_id,outcome,verified_amount_yer,note) VALUES($1,$2,$3,$4,$5,$6)",
        [
          pid,
          v.attemptId,
          i.id,
          v.outcome,
          v.verifiedAmountYer ?? null,
          v.note,
        ],
      );
      if (v.stockAction === "release_after_review") {
        await noUnreviewed(db, id);
        await release(db, o);
        if ((await net(db, id)) > 0n)
          await exception(
            db,
            i,
            o,
            "stock_unavailable",
            (await net(db, id)).toString(),
            "حرر الحجز بعد مراجعة الإيصال؛ يلزم إعادة المال أو قرار تسوية موثق",
            p.historical_branch,
          );
      }
      if (v.outcome === "transfer_verified") {
        const q = (
          await db.query("SELECT total_yer FROM order_quotes WHERE id=$1", [
            o.current_quote_id,
          ])
        ).rows[0];
        const actual = await net(db, id),
          target =
            o.status === "pending_review"
              ? BigInt(q?.total_yer ?? 0)
              : o.status === "cancelled" || o.status === "rejected"
                ? 0n
                : BigInt(q?.total_yer ?? 0);
        if (actual !== target)
          await exception(
            db,
            i,
            o,
            actual > target ? "overpayment" : "underpayment",
            (actual > target ? actual - target : target - actual).toString(),
            "المبلغ المعتمد لا يساوي المبلغ المطلوب؛ لا تأكيد قبل تسوية موثقة",
            p.historical_branch,
          );
      }
      return event(
        db,
        i,
        o,
        "payment.reviewed",
        {
          paymentId: pid,
          attemptId: v.attemptId,
          outcome: v.outcome,
          stockAction: v.stockAction,
          note: v.note,
        },
        o.status === "pending_review"
          ? v.outcome === "image_rejected"
            ? "awaiting_transfer"
            : "ready_to_confirm"
          : undefined,
      );
    },
  );
}
export async function confirmOrder(
  pool: pg.Pool,
  routing: RoutingProvider,
  i: Identity,
  id: string,
  key: string,
  v: any,
) {
  return run(
    pool,
    i,
    id,
    key,
    "confirm",
    v,
    "orders.confirm",
    async (db, o) => {
      const q = (
        await db.query("SELECT * FROM order_quotes WHERE id=$1", [
          o.current_quote_id,
        ])
      ).rows[0];
      if (!q || q.status !== "accepted")
        throw conflict("ACCEPT_QUOTE_FIRST", "يلزم قبول العميل لأحدث عرض");
      await stockLocks(db, o, o.branch_id);
      await noExceptions(db, id);
      await noUnreviewed(db, id);
      const protectedHold = (
        await db.query(
          "SELECT 1 FROM stock_reservations WHERE quote_id=$1 AND state='active' AND hold_kind='receipt_review'",
          [q.id],
        )
      ).rowCount;
      if (new Date(q.expires_at).getTime() <= Date.now() && !protectedHold) {
        const priv = (
          await db.query("SELECT * FROM order_private_details WHERE id=$1", [
            q.private_details_id,
          ])
        ).rows[0];
        const p = await quotePrice(
          db,
          routing,
          o,
          o.branch_id,
          priv,
          q.delivery_rule_snapshot.options,
        );
        // JSONB key order is not significant; PostgreSQL compares canonical facts.
        const same = (
          await db.query("SELECT $1::jsonb=$2::jsonb same", [
            JSON.stringify(p.snapshot.fingerprint),
            JSON.stringify(q.delivery_rule_snapshot.fingerprint),
          ])
        ).rows[0].same;
        if (!same)
          throw conflict(
            "NEW_QUOTE_REQUIRED",
            "تغيرت حقائق السعر أو المنتج؛ أصدر نسخة جديدة واقبلها من العميل",
          );
        await release(db, o);
        const until = (
          await db.query(
            "INSERT INTO quote_revalidations(quote_id,checked_by,valid_until,reason) VALUES($1,$2,now()+interval '30 minutes','إعادة تحقق ذرية من السعر والمخزون قبل التأكيد') RETURNING valid_until",
            [q.id, i.id],
          )
        ).rows[0].valid_until;
        await reserve(db, o, q, until);
      }
      if (
        o.payment_kind === "transfer" &&
        (await net(db, id)) !== BigInt(q.total_yer)
      )
        throw conflict(
          "PAYMENT_MISMATCH",
          "صافي التحويل المعتمد لا يطابق العرض",
        );
      // The SQL state guard checks active holds before consumption. All writes commit together.
      await db.query(
        "UPDATE orders SET status='confirmed',confirmed_at=now(),review_stage='closed' WHERE id=$1",
        [id],
      );
      const holds = (
        await db.query(
          "UPDATE stock_reservations SET state='consumed' WHERE quote_id=$1 AND state='active' RETURNING *",
          [q.id],
        )
      ).rows;
      for (const h of holds) {
        await db.query(
          "UPDATE stock_levels SET on_hand=on_hand-$3,reserved=reserved-$3,version=version+1 WHERE branch_id=$1 AND product_id=$2",
          [h.branch_id, h.product_id, h.pieces],
        );
        await db.query(
          "INSERT INTO stock_movements(branch_id,product_id,delta_pieces,reason,order_id,actor_id,note) VALUES($1,$2,-$3::bigint,'sale',$4,$5,'تأكيد الطلب')",
          [h.branch_id, h.product_id, h.pieces, id, i.id],
        );
        await reconcile(db, h.branch_id, h.product_id);
      }
      return event(db, i, o, "order.confirmed", {
        paymentKind: o.payment_kind,
        cashCollected: false,
      });
    },
  );
}
export async function cancelOrder(
  pool: pg.Pool,
  i: Identity,
  id: string,
  key: string,
  v: any,
) {
  customerOnly(i);
  return run(pool, i, id, key, "cancel", v, "orders.review", async (db, o) => {
    const receipts = (
      await db.query("SELECT 1 FROM payments WHERE order_id=$1", [id])
    ).rowCount;
    if (receipts) {
      const requestId = (
        await db.query(
          "INSERT INTO order_cancellation_requests(order_id,requested_by,reason) VALUES($1,$2,$3) RETURNING id",
          [id, i.id, v.reason],
        )
      ).rows[0].id;
      return {
        ...(await event(db, i, o, "order.cancellation_requested", {
          requestId,
        })),
        requestId,
      };
    }
    await noExceptions(db, id);
    await stockLocks(db, o);
    await release(db, o);
    await db.query(
      "UPDATE orders SET status='cancelled',review_stage='closed',closed_reason=$2 WHERE id=$1",
      [id, v.reason],
    );
    return event(db, i, o, "order.cancelled");
  });
}
export async function closeOrder(
  pool: pg.Pool,
  i: Identity,
  id: string,
  key: string,
  v: any,
  cancellation = false,
) {
  return run(
    pool,
    i,
    id,
    key,
    cancellation ? "cancel-review" : "reject",
    v,
    "orders.reject",
    async (db, o) => {
      if (cancellation) {
        const request = (
          await db.query(
            "SELECT * FROM order_cancellation_requests WHERE id=$1 AND order_id=$2 AND status='requested' FOR UPDATE",
            [v.requestId, id],
          )
        ).rows[0];
        if (!request) throw notFound();
        await db.query(
          "UPDATE order_cancellation_requests SET status=$2,reviewed_by=$3,review_note=$4,reviewed_at=now() WHERE id=$1",
          [request.id, v.approve ? "approved" : "denied", i.id, v.reason],
        );
        if (!v.approve)
          return event(db, i, o, "order.cancellation_denied", {
            requestId: request.id,
          });
      }
      await noUnreviewed(db, id);
      await noExceptions(db, id);
      if ((await net(db, id)) !== 0n)
        throw conflict("UNSETTLED_MONEY", "سوّ الأموال قبل إغلاق الطلب");
      await stockLocks(db, o);
      await release(db, o);
      await db.query(
        "UPDATE orders SET status=$2,review_stage='closed',closed_reason=$3 WHERE id=$1",
        [id, cancellation ? "cancelled" : "rejected", v.reason],
      );
      return event(
        db,
        i,
        o,
        cancellation ? "order.cancelled" : "order.rejected",
        { reason: v.reason },
      );
    },
  );
}
