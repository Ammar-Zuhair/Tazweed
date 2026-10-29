import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categories, productById } from '../src/fixtures/catalog';
import { filterCatalog, normalizePhone, piecesOf, priceOf, snapshotLines } from '../src/domain/catalog';
import { bestPreviewPromotion, createInitialState, currentQuote, deliveryFee, isExpired, transition, type PreviewAction } from '../src/domain/customer-model';
import { customerRepository } from '../src/data/customer-repository';
const now = 1_800_000_000_000;
function harness() {
  let state = createInitialState('aden', now);
  return { get state() { return state; }, send(action: PreviewAction, time = now) { state = transition(state, action, time); return state; }, login() { this.send({ type: 'auth-start', purpose: 'login', phone: '770000000', password: 'test-pass' }); this.send({ type: 'otp-verify', code: '000000' }); return state; } };
}
function quoted(kind: 'retail' | 'wholesale' = 'retail') {
  const h = harness(); h.login(); h.send({ type: 'cart-add', line: { productId: 'oil-15', unit: 'carton', quantity: 2 } }); h.send({ type: 'kind', kind }); h.send({ type: 'submit', addressId: 'demo-address-1' }); const id = h.state.orders[0]!.id; h.send({ type: 'quote-issue', orderId: id }); return { h, id, order: () => h.state.orders.find(o => o.id === id)! };
}
function acceptedTransfer(amountDelta = 0) {
  const t = quoted(); t.h.send({ type: 'quote-accept', orderId: t.id, revision: 1 }); t.h.send({ type: 'payment-kind', orderId: t.id, kind: 'transfer' }); const total = currentQuote(t.order())!.total;
  t.h.send({ type: 'receipt', orderId: t.id, imageUri: 'preview:receipt', receiptNumber: 'DEMO-123', amount: total + amountDelta }); return t;
}
test('province has exactly its configured catalog and prices; unavailable never exposes a stock count', () => {
  assert.equal(filterCatalog({ governorateId: 'unconfigured' }).length, 0);
  const p = productById('oil-20')!; assert.equal(p.prices.aden!.available, false); assert.equal(p.prices.sanaa!.available, true); assert.equal(priceOf(p, 'aden', 'piece'), 2100); assert.equal(priceOf(p, 'sanaa', 'piece'), 2250);
  assert(!('stock' in p.prices.aden!)); assert.throws(() => snapshotLines([{ productId: p.id, quantity: 1, unit: 'piece' }], 'aden'), /غير متوفر/);
});
test('every category offers its own attribute filter with OR within it and AND between filters', () => {
  for (const category of categories) { const attribute = category.filters[1]!; const value = attribute.values[0]!.id; const rows = filterCatalog({ governorateId: 'aden', categoryId: category.id, filters: { [attribute.id]: [value] } }); assert(rows.length > 0); assert(rows.every(p => p.categoryId === category.id && p.attributes[attribute.id] === value)); }
  assert.equal(filterCatalog({ governorateId: 'aden', categoryId: 'oils', filters: { brand: ['madar'], viscosity: ['20w50'] } }).length, 0);
  assert.equal(filterCatalog({ governorateId: 'aden', categoryId: 'oils', filters: { viscosity: ['15w40', '20w50'], capacity: ['unknown'] } }).length, 2);
});
test('search and numeric price sorting are deterministic', () => {
  assert.equal(filterCatalog({ governorateId: 'aden', search: 'DEMO-OIL-15' })[0]?.id, 'oil-15');
  const rows = filterCatalog({ governorateId: 'aden', sort: 'price-asc' }); assert(rows.every((p, i) => i === 0 || priceOf(rows[i - 1]!, 'aden', 'piece')! <= priceOf(p, 'aden', 'piece')!));
});
test('carton price is independent; conversion and quantity validation are explicit', () => {
  const line = { productId: 'oil-15', unit: 'carton' as const, quantity: 2 }; assert.equal(piecesOf(line), 24); assert.equal(snapshotLines([line], 'aden')[0]?.unitPrice, 25200); assert.notEqual(25200, 2300 * 12);
  for (const quantity of [0, -1, 1.5, 1000]) assert.throws(() => piecesOf({ ...line, quantity }));
  assert.throws(() => piecesOf({ productId: 'battery-70', unit: 'carton', quantity: 1 }));
});
test('province change retains cart and flags availability, leaving existing order snapshots intact', () => {
  const h = harness(); h.send({ type: 'governorate', id: 'sanaa' }); h.send({ type: 'cart-add', line: { productId: 'oil-20', unit: 'piece', quantity: 1 } }); const old = JSON.stringify(h.state.orders);
  h.send({ type: 'governorate', id: 'aden' }); assert.equal(h.state.cart.length, 1); assert.throws(() => snapshotLines(h.state.cart, 'aden')); assert.equal(JSON.stringify(h.state.orders), old);
});
test('phone normalizes Arabic digits and rejects unknown country, malformed and short numbers', () => {
  assert.equal(normalizePhone('٧٧٠٠٠٠٠٠٠'), '967770000000'); assert.equal(normalizePhone('+967 770-000-000'), '967770000000');
  for (const phone of ['123', '+12025550000', '760000000', '77000000a']) assert.throws(() => normalizePhone(phone));
});
test('OTP commits wrong attempts, limits retries/resend and expires; no password is stored', () => {
  const h = harness(); h.send({ type: 'auth-start', purpose: 'register', phone: '770000000', password: 'test-pass', name: 'مراجع' }); assert(!JSON.stringify(h.state).includes('test-pass'));
  assert.throws(() => h.send({ type: 'otp-resend' })); for (let i = 0; i < 3; i++) h.send({ type: 'otp-verify', code: '111111' }); assert.equal(h.state.otp?.attempts, 3); assert.throws(() => h.send({ type: 'otp-verify', code: '000000' }));
  h.send({ type: 'otp-resend' }, now + 30_000); assert.equal(h.state.otp?.attempts, 0); assert.throws(() => h.send({ type: 'otp-verify', code: '000000' }, now + 160_000)); h.send({ type: 'otp-verify', code: '000000' }, now + 31_000); assert.equal(h.state.profile?.name, 'مراجع');
});
test('password reset requires its own verified OTP and does not log the user in', () => {
  const h = harness(); assert.throws(() => h.send({ type: 'password-reset', password: 'new-pass' })); h.send({ type: 'auth-start', purpose: 'reset', phone: '770000000' }); h.send({ type: 'otp-verify', code: '000000' }); h.send({ type: 'password-reset', password: 'new-pass' }); assert.equal(h.state.profile, null); assert.equal(h.state.resetVerified, false);
});
test('address actions require local login, valid coordinates, preview boundary and matching province', () => {
  const h = harness(); assert.throws(() => h.send({ type: 'address-delete', id: 'demo-address-1' })); h.login(); const address = h.state.addresses[0]!;
  assert.throws(() => h.send({ type: 'address-save', address: { ...address, latitude: NaN } })); assert.throws(() => h.send({ type: 'address-save', address: { ...address, latitude: 0 } }));
  h.send({ type: 'governorate', id: 'sanaa' }); h.send({ type: 'cart-add', line: { productId: 'oil-15', unit: 'piece', quantity: 1 } }); assert.throws(() => h.send({ type: 'submit', addressId: address.id }), /محافظة/);
});
test('submit starts awaiting manager with no quote/hold; editing address never rewrites sent snapshot', () => {
  const h = harness(); h.login(); h.send({ type: 'cart-add', line: { productId: 'oil-15', unit: 'piece', quantity: 2 } }); h.send({ type: 'submit', addressId: 'demo-address-1' }); const order = h.state.orders[0]!; assert.equal(order.stage, 'awaiting_branch'); assert.equal(order.hold, 'none'); assert.equal(order.quotes.length, 0); assert.equal(h.state.cart.length, 0);
  h.send({ type: 'address-save', address: { ...h.state.addresses[0]!, label: 'تعديل' } }); assert.equal(h.state.orders[0]?.address.label, 'منزل تجريبي');
});
test('wholesale quote is a distinct proposal without automatic retail promotion or mutation of sent lines', () => {
  const { order } = quoted('wholesale'); assert.equal(order().lines[0]?.unitPrice, 25200); assert.equal(currentQuote(order())?.lines[0]?.unitPrice, 22680); assert.equal(currentQuote(order())?.promotionId, null);
});
test('road flooring, manual fallback and single largest deterministic promotion', () => {
  assert.deepEqual(deliveryFee(2800, 300, 50), { billedKm: 2, fee: 400 }); assert.equal(deliveryFee(999, 300, 50).fee, 300); assert.throws(() => deliveryFee(-1, 300, 50));
  const offer = bestPreviewPromotion(5000, 400, 'retail')!; assert.equal(offer.id, 'demo-delivery'); assert.equal(offer.productDiscount, 0); assert.equal(bestPreviewPromotion(10000, 400, 'wholesale'), null);
  const t = quoted(); t.h.send({ type: 'quote-issue', orderId: t.id, manual: true }); assert.equal(currentQuote(t.order())?.distanceM, null); assert.equal(currentQuote(t.order())?.deliveryBeforeDiscount, 500);
});
test('same-total branch revision requires fresh acceptance and preserves the original approval snapshot', () => {
  const t = quoted(); t.h.send({ type: 'quote-accept', orderId: t.id, revision: 1 }); const old = JSON.stringify(t.order().quotes[0]); const total = currentQuote(t.order())!.total;
  t.h.send({ type: 'quote-issue', orderId: t.id, changedBranch: true }); assert.equal(currentQuote(t.order())?.total, total); assert.notEqual(currentQuote(t.order())?.branchId, t.order().catalogBranchId); assert.equal(currentQuote(t.order())?.acceptedAt, null); assert.equal(JSON.stringify(t.order().quotes[0]), old);
  assert.throws(() => t.h.send({ type: 'payment-kind', orderId: t.id, kind: 'cash_on_delivery' })); assert.throws(() => t.h.send({ type: 'quote-accept', orderId: t.id, revision: 1 })); t.h.send({ type: 'quote-accept', orderId: t.id, revision: 2 });
});
test('declining current quote releases preview hold but retains immutable history', () => { const t = quoted(); t.h.send({ type: 'quote-decline', orderId: t.id, revision: 1 }); assert.equal(t.order().hold, 'none'); assert.equal(t.order().stage, 'awaiting_quote'); assert.equal(t.order().quotes.length, 1); assert.throws(() => t.h.send({ type: 'quote-accept', orderId: t.id, revision: 1 })); });
test('transfer instructions exist before receipt and are copied into the single payment', () => {
  const t = quoted(); t.h.send({ type: 'quote-accept', orderId: t.id, revision: 1 }); t.h.send({ type: 'payment-kind', orderId: t.id, kind: 'transfer' }); assert.equal(t.order().payment, null); const snapshot = JSON.stringify(t.order().instructions[0]);
  t.h.send({ type: 'receipt', orderId: t.id, imageUri: 'preview:receipt', receiptNumber: 'TEST', amount: currentQuote(t.order())!.total }); assert.equal(JSON.stringify(t.order().payment?.instruction), snapshot);
});
test('receipt protects hold indefinitely; reject/reupload uses one payment and preserves old image attempts', () => {
  const t = acceptedTransfer(); const paymentId = t.order().payment!.id; const total = currentQuote(t.order())!.total; assert.equal(isExpired(t.order(), now + 365 * 86400_000), false);
  for (const type of ['quote-issue', 'preview-expire', 'cancel'] as const) assert.throws(() => t.h.send({ type, orderId: t.id }));
  assert.throws(() => t.h.send({ type: 'receipt', orderId: t.id, imageUri: 'preview:duplicate' })); t.h.send({ type: 'preview-image-reject', orderId: t.id }); t.h.send({ type: 'receipt', orderId: t.id, imageUri: 'preview:clear' }, now + 365 * 86400_000);
  assert.equal(t.order().payment?.id, paymentId); assert.equal(t.order().payment?.attempts.length, 2); assert(t.order().payment!.attempts[0]?.rejectedReason); assert.equal(t.order().payment?.reportedAmount, total); assert.equal(t.order().hold, 'receipt_review');
});
test('receipt does not verify money or allow confirmation, and mismatches remain a financial review', () => {
  const t = acceptedTransfer(-100); assert.equal(t.order().paymentStatus, 'financial_review'); assert.throws(() => t.h.send({ type: 'preview-confirm', orderId: t.id })); assert.throws(() => t.h.send({ type: 'preview-transfer-verify', orderId: t.id }));
  const valid = acceptedTransfer(); valid.h.send({ type: 'preview-transfer-verify', orderId: valid.id }); valid.h.send({ type: 'preview-confirm', orderId: valid.id }); assert.equal(valid.order().status, 'confirmed'); assert.equal(valid.order().paymentStatus, 'verified_transfer');
});
test('COD confirm is not collection; delivery needs explicit cash collection or documented exception', () => {
  const t = quoted(); t.h.send({ type: 'quote-accept', orderId: t.id, revision: 1 }); t.h.send({ type: 'payment-kind', orderId: t.id, kind: 'cash_on_delivery' }); t.h.send({ type: 'preview-confirm', orderId: t.id }); assert.equal(t.order().paymentStatus, 'awaiting_cash_collection'); assert.equal(t.order().payment, null); assert.throws(() => t.h.send({ type: 'cancel', orderId: t.id })); t.h.send({ type: 'preview-dispatch', orderId: t.id }); assert.throws(() => t.h.send({ type: 'preview-deliver', orderId: t.id })); t.h.send({ type: 'preview-cash-exception', orderId: t.id }); t.h.send({ type: 'preview-deliver', orderId: t.id }); assert.equal(t.order().paymentStatus, 'financial_review');
});
test('expired COD needs revalidation of same facts, without rewriting accepted quote', () => {
  const t = quoted(); t.h.send({ type: 'quote-accept', orderId: t.id, revision: 1 }); t.h.send({ type: 'payment-kind', orderId: t.id, kind: 'cash_on_delivery' }); const quote = JSON.stringify(currentQuote(t.order())); t.h.send({ type: 'preview-expire', orderId: t.id }); assert.throws(() => t.h.send({ type: 'preview-confirm', orderId: t.id })); t.h.send({ type: 'preview-revalidate', orderId: t.id }); assert.equal(JSON.stringify(currentQuote(t.order())), quote); t.h.send({ type: 'preview-confirm', orderId: t.id });
});
test('cancellation before receipt is direct, after receipt only a review request without release', () => {
  const t = quoted(); t.h.send({ type: 'cancel', orderId: t.id }); assert.equal(t.order().status, 'cancelled');
  const paid = acceptedTransfer(); paid.h.send({ type: 'cancellation-request', orderId: paid.id }); assert.equal(paid.order().status, 'pending_review'); assert.equal(paid.order().hold, 'receipt_review'); assert.equal(paid.order().cancellationRequested, true);
});
test('delivered-only review once, complaint/photo and treatment states', () => {
  const h = harness(); h.login(); const id = 'TZ-DEMO-1004'; assert.throws(() => h.send({ type: 'review', orderId: 'TZ-DEMO-1002', stars: 5, comment: '' })); assert.throws(() => h.send({ type: 'review', orderId: id, stars: 0, comment: '' })); h.send({ type: 'review', orderId: id, stars: 5, comment: 'جيد' }); assert.throws(() => h.send({ type: 'review', orderId: id, stars: 4, comment: '' })); h.send({ type: 'complaint', orderId: id, text: 'بلاغ تجريبي للمراجعة', imageUri: 'preview:photo' }); h.send({ type: 'complaint-status', id: h.state.complaints[0]!.id, status: 'resolved' }); assert.equal(h.state.complaints[0]?.status, 'resolved');
});
test('maintenance blocks new orders but permits ongoing quote/receipt and delete flows', () => {
  const t = quoted(); t.h.send({ type: 'gate', gate: 'maintenance' }); assert.throws(() => t.h.send({ type: 'cart-add', line: { productId: 'oil-15', unit: 'piece', quantity: 1 } })); assert.throws(() => t.h.send({ type: 'submit', addressId: 'demo-address-1' })); t.h.send({ type: 'quote-accept', orderId: t.id, revision: 1 }); t.h.send({ type: 'payment-kind', orderId: t.id, kind: 'transfer' }); t.h.send({ type: 'receipt', orderId: t.id, imageUri: 'preview:r', receiptNumber: 'x', amount: currentQuote(t.order())!.total }); assert.equal(t.order().hold, 'receipt_review');
  t.h.send({ type: 'auth-start', purpose: 'delete', phone: '770000000' }); t.h.send({ type: 'otp-verify', code: '000000' }); assert.equal(t.h.state.deletionRequest?.status, 'received'); assert.equal(t.h.state.profile, null);
});
test('required update cannot be dismissed; optional update can', () => { const h = harness(); h.send({ type: 'gate', gate: 'required-update' }); assert.throws(() => h.send({ type: 'dismiss-update' })); h.send({ type: 'gate', gate: 'optional-update' }); h.send({ type: 'dismiss-update' }); assert.equal(h.state.updateDismissed, true); });
test('offline mutations fail without losing cart and transitions never mutate input snapshots', () => {
  const h = harness(); h.login(); h.send({ type: 'cart-add', line: { productId: 'oil-15', unit: 'piece', quantity: 1 } }); h.send({ type: 'scenario', scenario: 'offline' }); const before = JSON.stringify(h.state); assert.throws(() => h.send({ type: 'submit', addressId: 'demo-address-1' })); assert.equal(JSON.stringify(h.state), before);
  const next = transition(h.state, { type: 'governorate', id: 'sanaa' }, now); assert.equal(h.state.governorateId, 'aden'); assert.equal(next.governorateId, 'sanaa');
});
test('local catalog adapter separates empty/error/offline and cancels stale requests', async () => {
  assert.equal((await customerRepository.catalog({ governorateId: 'aden' }, 'empty')).length, 0); for (const scenario of ['error', 'offline'] as const) await assert.rejects(customerRepository.catalog({ governorateId: 'aden' }, scenario)); const controller = new AbortController(); const work = customerRepository.catalog({ governorateId: 'aden' }, 'loading', controller.signal); controller.abort(); await assert.rejects(work, /ألغيت/); await assert.rejects(customerRepository.catalog({ governorateId: 'aden' }, 'normal', controller.signal), /ألغيت/);
});
