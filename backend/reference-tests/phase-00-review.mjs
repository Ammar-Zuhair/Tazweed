// Review diagnostics against the unchanged reference schema, in memory only.
// "allowed" documents a missing SQL guard, NOT a passing application rule.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const schema = readFileSync(new URL('../database/schema.sql', import.meta.url));
const db = new PGlite();
const probes = [];
async function insert(table, data) {
  const keys = Object.keys(data);
  return (await db.query(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    Object.values(data),
  )).rows[0];
}
async function observe(id, label, expected, callback) {
  await db.exec('BEGIN');
  let observed = 'allowed';
  try {
    await callback();
  } catch (error) {
    if (!error.code || !/^\d{5}$|^P0001$/.test(error.code)) throw error;
    observed = error.code;
  } finally {
    await db.exec('ROLLBACK');
  }
  assert.equal(observed, expected, `${id}: schema behavior changed; re-review the finding`);
  probes.push({ id, label, expected, observed });
}

try {
  await db.exec(schema.toString('utf8'));
  const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r => r.tablename);
  assert.equal(tables.length, 56);
  const gov = await insert('governorates', { name_ar: 'محافظة مراجعة وهمية' });
  const branch = await insert('branches', { governorate_id: gov.id, name_ar: 'فرع مراجعة أ', latitude: 15, longitude: 44 });
  const other = await insert('branches', { governorate_id: gov.id, name_ar: 'فرع مراجعة ب', latitude: 15.1, longitude: 44.1 });
  const customer = await insert('users', { phone_e164: '+967777000001', name_ar: 'عميل مراجعة وهمي', password_hash: 'TEST_ONLY', kind: 'customer', status: 'active' });
  const otherCustomer = await insert('users', { phone_e164: '+967777000002', name_ar: 'عميل آخر وهمي', password_hash: 'TEST_ONLY', kind: 'customer', status: 'active' });
  const staff = await insert('users', { phone_e164: '+967777000003', name_ar: 'موظف مراجعة وهمي', password_hash: 'TEST_ONLY', kind: 'staff', status: 'active' });
  const couriers = [];
  for (let i = 0; i < 2; i++) {
    const user = await insert('users', { phone_e164: `+96777700000${i + 4}`, name_ar: 'موصل مراجعة وهمي', password_hash: 'TEST_ONLY', kind: 'courier', status: 'active' });
    await insert('courier_profiles', { user_id: user.id, commission_bps: 2000 });
    couriers.push(user);
  }
  const category = await insert('categories', { name_ar: 'قسم مراجعة' });
  const attribute = await insert('attributes', { code: 'review_required', name_ar: 'خاصية مراجعة إلزامية' });
  await insert('category_attributes', { category_id: category.id, attribute_id: attribute.id, required: true });
  const product = await insert('products', { sku: 'REVIEW-ONLY', category_id: category.id, name_ar: 'منتج مراجعة وهمي' });
  const piece = await insert('product_units', { product_id: product.id, unit_kind: 'piece', pieces_per_unit: 1, price_yer: 5000 });
  const carton = await insert('product_units', { product_id: product.id, unit_kind: 'carton', pieces_per_unit: 12, price_yer: 58000 });
  await insert('stock_levels', { branch_id: branch.id, product_id: product.id, on_hand: 26 });
  const orderData = { customer_id: customer.id, governorate_id: gov.id, branch_id: branch.id, kind: 'retail', address_snapshot: '{}' };
  const order = await insert('orders', orderData);
  const otherOrder = await insert('orders', orderData);
  const quoteData = { order_id: order.id, branch_id: branch.id, revision: 1, subtotal_yer: 5000, delivery_yer: 450, total_yer: 5450, routing_source: 'review_only', delivery_rule_snapshot: '{}', expires_at: '2030-01-01T00:00:00Z' };
  const quote = await insert('order_quotes', quoteData);
  const otherQuote = await insert('order_quotes', { ...quoteData, order_id: otherOrder.id });
  await db.query('UPDATE orders SET current_quote_id=$1 WHERE id=$2', [quote.id, order.id]);
  const line = await insert('quote_items', { quote_id: quote.id, product_id: product.id, unit_id: piece.id, name_snapshot: 'مراجعة', unit_snapshot: 'حبة', pieces_per_unit: 1, quantity: 1, unit_price_yer: 5000, line_total_yer: 5000 });
  await insert('stock_reservations', { order_id: order.id, branch_id: branch.id, product_id: product.id, quote_id: quote.id, pieces: 1, state: 'released', expires_at: '2030-01-01T00:00:00Z' });
  const assignment = await insert('order_assignments', { order_id: order.id, courier_id: couriers[0].id, assigned_by: staff.id, commission_bps: 2000, delivery_fee_yer: 450, commission_yer: 90 });
  const earning = await insert('courier_earnings', { courier_id: couriers[0].id, order_id: order.id, assignment_id: assignment.id, entry_type: 'delivery', amount_yer: 90 });
  const method = await insert('payment_methods', { name_ar: 'وسيلة وهمية', beneficiary: 'اختبار', destination_number: 'TEST_ONLY' });
  const media = await insert('media_objects', { owner_id: customer.id, object_key: 'review/receipt', visibility: 'private', purpose: 'receipt', mime_type: 'image/png', size_bytes: 100, status: 'verified' });
  const paymentData = { order_id: order.id, quote_id: quote.id, method_id: method.id, method_snapshot: '{}', receipt_number: 'REVIEW-001', normalized_receipt_number: 'REVIEW001', receipt_media_id: media.id, amount_yer: 5450 };
  await insert('payments', { ...paymentData, status: 'rejected', reviewer_id: staff.id, reviewed_at: '2026-10-28T00:00:00Z' });

  await observe('R01', 'A persisted quote cannot precede its order', '23503', () => insert('order_quotes', { ...quoteData, order_id: randomUUID() }));
  await observe('R02', 'A released historical reservation prevents changing the order branch', '23503', () => db.query('UPDATE orders SET branch_id=$1 WHERE id=$2', [other.id, order.id]));
  await observe('R03', 'Superseding a quote can retain its historical acceptance', 'allowed', async () => {
    await db.query("UPDATE order_quotes SET status='accepted',accepted_by=$1,accepted_at=now() WHERE id=$2", [customer.id, quote.id]);
    await db.query("UPDATE order_quotes SET status='superseded' WHERE id=$1", [quote.id]);
  });
  await observe('R04', 'A historical carton conversion remains mutable in SQL', 'allowed', async () => {
    await insert('quote_items', { quote_id: quote.id, product_id: product.id, unit_id: carton.id, name_snapshot: 'مراجعة', unit_snapshot: 'كرتون', pieces_per_unit: 12, quantity: 1, unit_price_yer: 58000, line_total_yer: 58000 });
    await db.query('UPDATE product_units SET pieces_per_unit=24 WHERE id=$1', [carton.id]);
  });
  await observe('R05', 'Sent quote lines can be edited and diverge from the subtotal', 'allowed', () => db.query('UPDATE quote_items SET quantity=2,line_total_yer=10000 WHERE id=$1', [line.id]));
  await observe('R06', 'Confirmation has no SQL gate for acceptance, payment or live reservations', 'allowed', () => db.query("UPDATE orders SET status='confirmed' WHERE id=$1", [order.id]));
  await observe('R07', 'Required attributes need a service-level activation guard', 'allowed', () => insert('products', { sku: 'REVIEW-MISSING-ATTRIBUTE', category_id: category.id, name_ar: 'غير مكتمل' }));
  await observe('R08', 'Stock reserved counter can differ from active reservation rows', 'allowed', () => db.query('UPDATE stock_levels SET reserved=1 WHERE branch_id=$1 AND product_id=$2', [branch.id, product.id]));
  await observe('R09', 'Acceptance by a different customer is not rejected by SQL', 'allowed', () => db.query("UPDATE order_quotes SET status='accepted',accepted_by=$1,accepted_at=now() WHERE id=$2", [otherCustomer.id, quote.id]));
  await observe('R10', 'A quote branch can differ from the current order branch', 'allowed', () => insert('order_quotes', { ...quoteData, branch_id: other.id, revision: 2 }));
  await observe('R11', 'An earning can name a courier/order/amount different from its assignment', 'allowed', () => insert('courier_earnings', { courier_id: couriers[1].id, order_id: otherOrder.id, assignment_id: assignment.id, entry_type: 'delivery', amount_yer: 1 }));
  await observe('R12', 'A settlement can allocate another courier earning with a different total', 'allowed', async () => {
    const settlement = await insert('courier_settlements', { courier_id: couriers[1].id, paid_by: staff.id, total_yer: 1, reference: 'REVIEW_ONLY' });
    await insert('settlement_items', { settlement_id: settlement.id, earning_id: earning.id });
  });
  await observe('R13', 'Re-submitting a rejected receipt with the same method/number is blocked', '23505', () => insert('payments', paymentData));
  await observe('R14', 'Zero-commission delivery must omit a zero earning row', '23514', () => insert('courier_earnings', { courier_id: couriers[0].id, order_id: otherOrder.id, assignment_id: assignment.id, entry_type: 'delivery', amount_yer: 0 }));
  await observe('R15', 'The current quote must belong to the order (deferred FK)', '23503', async () => {
    await db.query('UPDATE orders SET current_quote_id=$1 WHERE id=$2', [otherQuote.id, order.id]);
    await db.exec('SET CONSTRAINTS current_quote_belongs_to_order IMMEDIATE');
  });
  await observe('R16', 'Two cartons of 12 plus three pieces need 27; stock 26 rejects reservation', '23514', async () => {
    const result = await db.query('SELECT sum(quantity::bigint * pieces_per_unit)::text AS pieces FROM (VALUES (2,12),(3,1)) AS lines(quantity,pieces_per_unit)');
    assert.equal(result.rows[0].pieces, '27');
    await db.query('UPDATE stock_levels SET reserved=$1 WHERE branch_id=$2 AND product_id=$3', [27, branch.id, product.id]);
  });
  await observe('R17', 'Audit entries reject deletion', 'P0001', async () => {
    const log = await insert('audit_logs', { actor_id: staff.id, action: 'review_only', entity_type: 'review', request_id: 'review' });
    await db.query('DELETE FROM audit_logs WHERE id=$1', [log.id]);
  });

  console.log(JSON.stringify({
    scope: 'Reference schema diagnostics only; allowed operations demonstrate service obligations or design gaps, not working application behavior.',
    engine: 'PGlite PostgreSQL WASM', schemaSha256: createHash('sha256').update(schema).digest('hex'),
    tableCount: tables.length, tables, diagnosticCount: probes.length, probes,
  }, null, 2));
} finally {
  await db.close();
}
