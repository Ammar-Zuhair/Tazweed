import type pg from "pg";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import type { Config } from "../config.js";
import { transaction } from "../db.js";
import { idempotent } from "../catalog/stock.js";
import { requirePermission, type Identity } from "../identity/access.js";
import { audit } from "../identity/audit.js";
import { ApiError, notFound } from "../http.js";
import { z } from "zod";
export const reportInput = z.strictObject({
  year: z.number().int().min(2020).max(2200),
  month: z.number().int().min(1).max(12),
  branchIds: z
    .array(z.uuid())
    .min(1)
    .max(50)
    .refine((a) => new Set(a).size === a.length),
});
export const columns = [
  ["deliveredOrders", "طلبات مسلّمة"],
  ["subtotal", "قيمة المنتجات قبل الخصم"],
  ["productDiscount", "خصم المنتجات"],
  ["deliveryBefore", "أساس التوصيل قبل الخصم"],
  ["deliveryDiscount", "خصم التوصيل"],
  ["customerDelivery", "رسوم توصيل العميل"],
  ["salesTotal", "إجمالي المبيعات المسلّمة"],
  ["approvedTransfers", "تحويلات معتمدة"],
  ["cashCollected", "النقد المحصل فعليًا"],
  ["cashAdjustments", "تصحيحات التحصيل"],
  ["cashRemitted", "توريد النقد الإجمالي"],
  ["cashRemittanceReversals", "عكس توريد النقد"],
  ["cashRemittedNet", "صافي التوريد"],
  ["commissionEarned", "عمولة التسليم"],
  ["commissionAdjustments", "تصحيحات العمولة"],
  ["commissionPaid", "صرف العمولة الإجمالي"],
  ["commissionReversals", "عكس صرف العمولة"],
  ["commissionPaidNet", "صافي صرف العمولة"],
  ["externalReceived", "تسويات خارجية مستلمة"],
  ["externalRefunded", "تسويات خارجية مردودة"],
  ["externalWriteOff", "شطب محاسبي"],
  ["externalOther", "تسويات خارجية أخرى"],
] as const;
export async function monthlySummary(
  db: pg.PoolClient,
  v: z.infer<typeof reportInput>,
  timeZone: string,
) {
  const start = `${v.year}-${String(v.month).padStart(2, "0")}-01`;
  const range = (
    await db.query(
      `SELECT $1::date::timestamp AT TIME ZONE $2 start,($1::date+interval '1 month')::timestamp AT TIME ZONE $2 finish`,
      [start, timeZone],
    )
  ).rows[0];
  const branches = (
    await db.query(
      "SELECT id,name_ar FROM branches WHERE id=ANY($1::uuid[]) ORDER BY id",
      [v.branchIds],
    )
  ).rows;
  if (branches.length !== v.branchIds.length)
    throw new ApiError(422, "INVALID_BRANCH", "فرع غير معروف");
  const rows: any[] = branches.map((b) => ({
    branchId: b.id,
    branchName: b.name_ar,
    ...Object.fromEntries(columns.map(([k]) => [k, "0"])),
  }));
  const byId = new Map(rows.map((r) => [r.branchId, r]));
  const add = async (sql: string) => {
    for (const r of (
      await db.query(sql, [v.branchIds, range.start, range.finish])
    ).rows) {
      const dest = byId.get(r.branch_id);
      if (dest)
        for (const [k, x] of Object.entries(r))
          if (k !== "branch_id")
            dest[k] = (
              BigInt(dest[k] ?? "0") + BigInt((x ?? "0") as string)
            ).toString();
    }
  };
  await add(
    `SELECT o.branch_id,count(*)::text "deliveredOrders",sum(q.subtotal_yer)::text subtotal,sum(q.product_discount_yer)::text "productDiscount",sum(q.delivery_yer)::text "deliveryBefore",sum(q.delivery_discount_yer)::text "deliveryDiscount",sum(q.delivery_yer-q.delivery_discount_yer)::text "customerDelivery",sum(q.total_yer)::text "salesTotal" FROM orders o JOIN order_quotes q ON q.id=o.current_quote_id WHERE o.branch_id=ANY($1) AND o.status='delivered' AND o.delivered_at >= $2 AND o.delivered_at < $3 GROUP BY o.branch_id`,
  );
  await add(
    `SELECT q.branch_id,sum(r.verified_amount_yer)::text "approvedTransfers" FROM payment_receipt_reviews r JOIN payments p ON p.id=r.payment_id JOIN order_quotes q ON q.id=p.quote_id WHERE q.branch_id=ANY($1) AND r.outcome='transfer_verified' AND r.created_at >= $2 AND r.created_at < $3 GROUP BY q.branch_id`,
  );
  await add(
    `SELECT o.branch_id,sum(c.amount_yer) FILTER(WHERE c.entry_type='collection')::text "cashCollected",coalesce(sum(c.amount_yer) FILTER(WHERE c.entry_type='adjustment'),0)::text "cashAdjustments" FROM cash_collections c JOIN orders o ON o.id=c.order_id WHERE o.branch_id=ANY($1) AND c.collected_at >= $2 AND c.collected_at < $3 GROUP BY o.branch_id`,
  );
  await add(
    `SELECT o.branch_id,coalesce(sum(e.amount_yer) FILTER(WHERE e.entry_type='delivery'),0)::text "commissionEarned",coalesce(sum(e.amount_yer) FILTER(WHERE e.entry_type='adjustment'),0)::text "commissionAdjustments" FROM courier_earnings e JOIN orders o ON o.id=e.order_id WHERE o.branch_id=ANY($1) AND e.earned_at >= $2 AND e.earned_at < $3 GROUP BY o.branch_id`,
  );
  // Allocate every whole payout to the immutable originating sources; never multiply a header total by its item count.
  const payout = `WITH RECURSIVE sources AS (
 SELECT i.id,i.settlement_id,e.order_id,e.amount_yer::numeric weight FROM settlement_items i JOIN courier_earnings e ON e.id=i.earning_id
 UNION ALL SELECT i.id,i.settlement_id,s.order_id,s.weight FROM settlement_items i JOIN courier_settlement_reversals r ON r.id=i.reversal_credit_id JOIN sources s ON s.settlement_id=r.settlement_id
 )`;
  await add(
    `${payout} SELECT o.branch_id,sum(s.weight)::text "commissionPaid" FROM sources s JOIN courier_settlements h ON h.id=s.settlement_id JOIN orders o ON o.id=s.order_id WHERE o.branch_id=ANY($1) AND h.created_at >= $2 AND h.created_at < $3 GROUP BY o.branch_id`,
  );
  await add(
    `${payout} SELECT o.branch_id,sum(s.weight)::text "commissionReversals" FROM courier_settlement_reversals r JOIN sources s ON s.settlement_id=r.settlement_id JOIN orders o ON o.id=s.order_id WHERE o.branch_id=ANY($1) AND r.created_at >= $2 AND r.created_at < $3 GROUP BY o.branch_id`,
  );
  const cash = `WITH RECURSIVE sources AS (
 SELECT i.id,i.remittance_id,c.order_id,c.amount_yer::numeric weight FROM cash_remittance_items i JOIN cash_collections c ON c.id=i.collection_id
 UNION ALL SELECT i.id,i.remittance_id,s.order_id,s.weight FROM cash_remittance_items i JOIN cash_remittance_reversals r ON r.id=i.reversal_credit_id JOIN sources s ON s.remittance_id=r.remittance_id
 )`;
  await add(
    `${cash} SELECT o.branch_id,sum(s.weight)::text "cashRemitted" FROM sources s JOIN cash_remittances h ON h.id=s.remittance_id JOIN orders o ON o.id=s.order_id WHERE o.branch_id=ANY($1) AND h.created_at >= $2 AND h.created_at < $3 GROUP BY o.branch_id`,
  );
  await add(
    `${cash} SELECT o.branch_id,sum(s.weight)::text "cashRemittanceReversals" FROM cash_remittance_reversals r JOIN sources s ON s.remittance_id=r.remittance_id JOIN orders o ON o.id=s.order_id WHERE o.branch_id=ANY($1) AND r.created_at >= $2 AND r.created_at < $3 GROUP BY o.branch_id`,
  );
  await add(
    `SELECT e.branch_id,coalesce(sum(r.amount_yer) FILTER(WHERE r.direction='received_from_customer'),0)::text "externalReceived",coalesce(sum(r.amount_yer) FILTER(WHERE r.direction='refund_to_customer'),0)::text "externalRefunded",coalesce(sum(r.amount_yer) FILTER(WHERE r.direction='write_off'),0)::text "externalWriteOff",coalesce(sum(r.amount_yer) FILTER(WHERE r.direction='other'),0)::text "externalOther" FROM financial_exception_resolutions r JOIN financial_exceptions e ON e.id=r.exception_id WHERE e.branch_id=ANY($1) AND r.occurred_at >= $2 AND r.occurred_at < $3 GROUP BY e.branch_id`,
  );
  for (const r of rows) {
    r.cashRemittedNet = (
      BigInt(r.cashRemitted) - BigInt(r.cashRemittanceReversals)
    ).toString();
    r.commissionPaidNet = (
      BigInt(r.commissionPaid) - BigInt(r.commissionReversals)
    ).toString();
  }
  const totals = Object.fromEntries(
    columns.map(([k]) => [
      k,
      rows.reduce((s, r) => s + BigInt(r[k]), 0n).toString(),
    ]),
  );
  return {
    year: v.year,
    month: v.month,
    timeZone,
    periodStart: range.start.toISOString(),
    periodEnd: range.finish.toISOString(),
    generatedAt: new Date().toISOString(),
    rows,
    totals,
  };
}
export const escapeHtml = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function reportHtml(summary: any) {
  const font = (
    await readFile(new URL("../../public/Tajawal-Medium.ttf", import.meta.url))
  ).toString("base64");
  const table = (r: any, title: string) =>
    `<section><h2>${escapeHtml(title)}</h2><table>${columns.map(([k, t]) => `<tr><th>${t}</th><td dir="ltr">${escapeHtml(r[k])}${k === "deliveredOrders" ? "" : " ر.ي"}</td></tr>`).join("")}</table></section>`;
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>@font-face{font-family:Tajawal;src:url(data:font/ttf;base64,${font})}body{font-family:Tajawal;color:#171b29;font-size:14px}h1{color:#ae3900;font-size:25px}h2{font-size:18px}table{width:100%;border-collapse:collapse}th,td{padding:7px;border-bottom:1px solid #ddd;text-align:right}td{width:35%;text-align:left}section{break-inside:avoid;margin-bottom:30px}footer,p{line-height:1.8;font-size:12px}</style><h1>تزويد — تقرير المبيعات الشهري</h1><p>${summary.year}/${String(summary.month).padStart(2, "0")} · المنطقة الزمنية: <bdi>${escapeHtml(summary.timeZone)}</bdi><br>من <bdi>${summary.periodStart}</bdi> إلى <bdi>${summary.periodEnd}</bdi> (النهاية غير مشمولة). أُعد <bdi>${summary.generatedAt}</bdi>.</p><p>المبيعات للطلبات المسلّمة في الشهر فقط؛ لا يدخل الملغي أو المرفوض. بنود الأموال حسب تاريخ الحركة وقد تخص طلبًا من شهر آخر؛ لا تجمعها مع المبيعات. العمولة قبل خصم التوصيل. عكس الصرف رصيد إعادة صرف، ولا يولد عمولة جديدة. التوريد والصرف موزعان على فروع مصادرهما، دون مقاصة. القيم أعداد صحيحة بالريال اليمني.</p>${table(summary.totals, "الإجمالي")}${summary.rows.map((r: any) => table(r, r.branchName)).join("")}<footer>تقرير إداري خاص · لا أسماء عملاء أو هواتف أو عناوين أو إيصالات · المنطقة الزمنية تخضع لاعتماد المالك قبل التقارير التشغيلية.</footer></html>`;
}
export async function renderPdf(summary: any) {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const deadline = setTimeout(
    () => void browser?.close().catch(() => {}),
    10000,
  );
  try {
    browser = await chromium.launch({ headless: true, timeout: 5000 });
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.route("**/*", (r) => r.abort());
    await page.setContent(await reportHtml(summary), { timeout: 10000 });
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "15mm", right: "15mm" },
    });
  } finally {
    clearTimeout(deadline);
    await browser?.close();
  }
}
export async function createReport(
  pool: pg.Pool,
  c: Config,
  i: Identity,
  key: string,
  v: z.infer<typeof reportInput>,
) {
  await requirePermission(pool, i, "reports.read", v.branchIds);
  return idempotent(pool, i, "reports.monthly", key, v, async (db) => {
    await requirePermission(db, i, "reports.read", v.branchIds);
    if (
      (
        await db.query(
          "SELECT count(*)::int n FROM report_jobs WHERE requested_by=$1 AND created_at>now()-interval '1 hour'",
          [i.id],
        )
      ).rows[0].n >= 6
    )
      throw new ApiError(429, "REPORT_LIMIT", "انتظر قبل إنشاء تقرير جديد");
    const r = (
      await db.query(
        "INSERT INTO report_jobs(requested_by,kind,parameters,state) VALUES($1,'monthly_sales',$2,'pending') RETURNING id",
        [
          i.id,
          JSON.stringify({
            ...v,
            timeZone: c.REPORT_TIME_ZONE,
            sessionId: i.sessionId,
          }),
        ],
      )
    ).rows[0];
    await audit(
      db,
      i.requestId ?? r.id,
      i.id,
      "reports.requested",
      "report",
      r.id,
    );
    return { id: r.id };
  });
}
export async function reportJob(
  pool: pg.Pool,
  i: Identity,
  id: string,
  bytes = false,
) {
  const r = (
    await pool.query(
      `SELECT id,requested_by,parameters,state,error_message,summary,completed_at,expires_at${bytes ? ",pdf_bytes" : ""} FROM report_jobs WHERE id=$1`,
      [id],
    )
  ).rows[0];
  if (
    !r ||
    r.requested_by !== i.id ||
    new Date(r.expires_at).getTime() <= Date.now()
  )
    throw notFound();
  await requirePermission(pool, i, "reports.read", r.parameters.branchIds);
  return r;
}
export async function processReport(pool: pg.Pool, renderer = renderPdf) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const r = (
      await db.query(
        "SELECT * FROM report_jobs WHERE state='pending' AND expires_at>now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
      )
    ).rows[0];
    if (!r) {
      await db.query("COMMIT");
      return false;
    }
    await db.query("SAVEPOINT report_generation");
    const u = (
      await db.query(
        "SELECT u.id,u.kind,u.name_ar,u.phone_e164,s.app,s.id session_id FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=$1 AND s.id=$2 AND u.status='active' AND s.revoked_at IS NULL AND s.expires_at>now()",
        [r.requested_by, r.parameters.sessionId],
      )
    ).rows[0];
    try {
      if (!u) throw new Error("Revoked");
      await requirePermission(
        db,
        { ...u, sessionId: u.session_id },
        "reports.read",
        r.parameters.branchIds,
      );
      const summary = await monthlySummary(
        db,
        r.parameters,
        r.parameters.timeZone,
      );
      const pdf = await renderer(summary);
      await db.query(
        "UPDATE report_jobs SET state='ready',summary=$2,pdf_bytes=$3,completed_at=now(),error_message=NULL WHERE id=$1",
        [r.id, JSON.stringify(summary), pdf],
      );
    } catch {
      await db.query("ROLLBACK TO SAVEPOINT report_generation");
      await db.query(
        "UPDATE report_jobs SET state='failed',error_message='تعذر إنشاء التقرير؛ تحقق من الصلاحية ومحرك PDF ثم أعد الطلب بمفتاح جديد' WHERE id=$1",
        [r.id],
      );
    }
    await db.query("COMMIT");
    return true;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
