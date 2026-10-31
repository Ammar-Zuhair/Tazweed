import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuantity } from '../src/domain/catalog';
import { createInitialState, transition } from '../src/domain/customer-model';
import { customerRepository } from '../src/data/customer-repository';

const set = (quantity: number, unit: 'piece' | 'carton' = 'piece', productId = 'oil-15') => ({ type: 'cart-set' as const, productId, unit, quantity });
test('absolute quantities replace 3 with 5, keep units independent, and zero removes only that unit', () => {
  let state = transition(createInitialState('aden'), set(3)); const original = state;
  state = transition(state, set(5)); assert.equal(state.cart[0]!.quantity, 5); assert.equal(original.cart[0]!.quantity, 3);
  state = transition(state, set(2, 'carton')); assert.equal(state.cart.length, 2);
  state = transition(state, set(0)); assert.deepEqual(state.cart, [{ productId: 'oil-15', unit: 'carton', quantity: 2 }]);
  state = transition(state, set(0, 'carton')); assert.deepEqual(state.cart, []);
  assert.deepEqual(transition(state, set(0)).cart, []);
});
test('quantity text accepts Arabic/English integers, rejects empty/fractions/signs and bounds', () => {
  for (const [input, expected] of [['1', 1], ['٩٩٩', 999], ['۳۵', 35], [' ٥ ', 5]] as const) assert.equal(parseQuantity(input), expected);
  for (const input of ['', ' ', '-1', '+2', '0', '٠', '1000', '1.5', '١٫٥', '1e2', 'NaN', '5x']) assert.equal(parseQuantity(input), null, input);
  for (const quantity of [-1, 1.5, 1000, NaN, Infinity]) assert.throws(() => transition(createInitialState('aden'), set(quantity)));
});
test('unavailable product/unit cannot be added or increased; retained lines can decrease or be deleted', () => {
  assert.throws(() => transition(createInitialState('aden'), set(1, 'piece', 'oil-20')), /غير متوفر/);
  assert.throws(() => transition(createInitialState('aden'), set(1, 'carton', 'battery-70')), /الكرتون/);
  assert.throws(() => transition(createInitialState('unconfigured'), set(1)), /محافظة/);
  let state = transition(createInitialState('sanaa'), set(3, 'piece', 'oil-20'));
  state = transition(state, { type: 'governorate', id: 'aden' });
  assert.throws(() => transition(state, set(4, 'piece', 'oil-20')), /غير متوفر/);
  assert.throws(() => transition(state, { ...set(4, 'piece', 'oil-20'), type: 'cart-quantity' }), /غير متوفر/);
  state = transition(state, set(2, 'piece', 'oil-20')); assert.equal(state.cart[0]!.quantity, 2);
  state = transition(state, set(0, 'piece', 'oil-20')); assert.deepEqual(state.cart, []);
});
test('daily rank is independent, governorate-specific, bounded to six, and explicitly preview UTC data', async () => {
  const day = '2026-10-31';
  const aden = await customerRepository.popularToday('aden', day, 'normal'); const sanaa = await customerRepository.popularToday('sanaa', day, 'normal');
  assert.equal(aden.day, day); assert.equal(aden.timezone, 'UTC'); assert.equal(aden.source, 'local-preview'); assert.equal(aden.rows.length, 6);
  assert.notEqual(aden.rows[0]!.product.id, sanaa.rows[0]!.product.id);
  assert(aden.rows.every((row, index) => index === 0 || aden.rows[index - 1]!.demoOrders > row.demoOrders));
  assert.equal((await customerRepository.popularToday('unconfigured', day, 'normal')).rows.length, 0);
  assert.equal((await customerRepository.promotions('aden', 'normal')).length, 3);
  assert.equal((await customerRepository.promotions('unconfigured', 'normal')).length, 0);
});
test('home reads expose empty/error/offline and cancel old governorate results', async () => {
  assert.deepEqual(await customerRepository.promotions('aden', 'empty'), []);
  assert.equal((await customerRepository.popularToday('aden', '2026-10-31', 'empty')).rows.length, 0);
  await assert.rejects(customerRepository.promotions('aden', 'error'));
  await assert.rejects(customerRepository.popularToday('aden', '2026-10-31', 'offline'));
  const controller = new AbortController(); const request = customerRepository.popularToday('aden', '2026-10-31', 'loading', controller.signal); controller.abort();
  await assert.rejects(request, /ألغيت/);
});
