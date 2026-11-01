import type pg from "pg";
// Durable notification intent only. Push transport belongs to10. Protected stock never expires here.
export async function alertOverdueReceipts(pool: pg.Pool, minutes: number) {
  return (
    await pool.query(
      `INSERT INTO outbox_events(event_type,aggregate_id,dedupe_key,payload)
 SELECT 'payment.review_overdue',r.order_id,'receipt-overdue:'||r.quote_id,jsonb_build_object('orderId',r.order_id,'quoteId',r.quote_id)
 FROM stock_reservations r WHERE r.state='active' AND r.hold_kind='receipt_review' AND r.protected_at<now()-($1::int*interval '1 minute') GROUP BY r.order_id,r.quote_id ON CONFLICT(dedupe_key) DO NOTHING`,
      [minutes],
    )
  ).rowCount;
}
export function startReceiptAlerts(pool: pg.Pool, minutes: number) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await alertOverdueReceipts(pool, minutes);
    } catch {
      console.error(JSON.stringify({ event: "receipt_alert_failed" }));
    } finally {
      busy = false;
    }
  }, 60000);
  timer.unref();
  return () => clearInterval(timer);
}
