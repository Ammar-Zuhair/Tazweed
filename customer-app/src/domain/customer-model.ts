import { governorateById, productById } from '../fixtures/catalog';
import { demand, normalizePhone, piecesOf, priceOf, snapshotLines, subtotalOf } from './catalog';
import type { Address, CartLine, Complaint, CustomerState, Gate, Order, OrderKind, PaymentKind, PreviewScenario, Quote } from './types';

export const demoOtpCode = '000000';
export const previewGovernorateKey = 'tazweed.preview.governorate.v1';
export const statusLabels = { pending_review: 'قيد المراجعة', confirmed: 'تم التأكيد', on_the_way: 'في الطريق', delivered: 'تم التسليم', rejected: 'مرفوض', cancelled: 'ملغي' } as const;
export const stageLabels = { awaiting_branch: 'بانتظار اختيار المدير لفرع التنفيذ', awaiting_quote: 'بانتظار عرض جديد من الإدارة', awaiting_acceptance: 'بانتظار موافقتك على التسعيرة', awaiting_payment: 'بانتظار التحويل', checking_receipt: 'الإيصال قيد المراجعة', awaiting_confirmation: 'بانتظار تأكيد الإدارة' } as const;
export function currentQuote(order: Order) { return order.quotes.find(quote => quote.revision === order.currentRevision) ?? null; }
export function isExpired(order: Order, now = Date.now()) {
  const quote = currentQuote(order);
  return order.hold !== 'receipt_review' && order.hold !== 'consumed' && !!quote && (order.previewExpired || (order.revalidatedUntil ?? quote.expiresAt) <= now);
}
export function needsAcceptance(order: Order) { return !currentQuote(order)?.acceptedAt; }
export function deliveryFee(distanceM: number, baseFee: number, perKm: number) {
  demand(Number.isFinite(distanceM) && distanceM >= 0 && baseFee >= 0 && perKm >= 0, 'بيانات مسافة المعاينة غير صحيحة.');
  return { billedKm: Math.floor(distanceM / 1000), fee: baseFee + Math.floor(distanceM / 1000) * perKm };
}
export function bestPreviewPromotion(subtotal: number, delivery: number, kind: OrderKind) {
  if (kind === 'wholesale') return null;
  const offers = [{ id: 'demo-products', name: 'توفير المنتجات التجريبي', productDiscount: Math.floor(subtotal * 0.03), deliveryDiscount: 0 }, { id: 'demo-delivery', name: 'توفير التوصيل التجريبي', productDiscount: 0, deliveryDiscount: Math.min(150, delivery) }];
  return offers.sort((a, b) => (b.productDiscount + b.deliveryDiscount) - (a.productDiscount + a.deliveryDiscount) || a.id.localeCompare(b.id))[0] ?? null;
}
export function buildPreviewQuote(order: Order, now: number, options: { changedBranch?: boolean; manual?: boolean } = {}): Quote {
  const previous = currentQuote(order);
  const lines = order.lines.map(line => ({ ...line, unitPrice: order.kind === 'wholesale' ? Math.round(line.unitPrice * 0.9) : line.unitPrice }));
  const subtotal = subtotalOf(lines);
  const road = deliveryFee(2800, 300, 50);
  const fee = options.manual ? 500 : road.fee;
  const offer = bestPreviewPromotion(subtotal, fee, order.kind);
  // The alternative branch exists only in this explicit revision fixture, never as a second active catalog branch.
  return {
    revision: (previous?.revision ?? 0) + 1,
    branchId: options.changedBranch ? (previous?.branchId === 'demo-revision-branch' ? order.catalogBranchId : 'demo-revision-branch') : order.catalogBranchId,
    branchName: options.changedBranch && previous?.branchId !== 'demo-revision-branch' ? 'فرع بديل — سيناريو مراجعة تجريبي' : order.catalogBranchName,
    lines, subtotal, pricingMode: options.manual ? 'manual' : 'road', distanceM: options.manual ? null : 2800,
    billedKm: options.manual ? null : road.billedKm, baseFee: 300, perKmFee: 50, deliveryBeforeDiscount: fee,
    productDiscount: offer?.productDiscount ?? 0, deliveryDiscount: offer?.deliveryDiscount ?? 0,
    total: subtotal + fee - (offer?.productDiscount ?? 0) - (offer?.deliveryDiscount ?? 0), promotionId: offer?.id ?? null, promotionName: offer?.name ?? null,
    reason: options.changedBranch ? 'تغيير فرع التنفيذ في المعاينة؛ موافقة جديدة مطلوبة ولو لم يتغير الإجمالي.' : options.manual ? 'تعذر مسار الطريق في المعاينة؛ رسوم إدارية تجريبية بسبب موثق.' : order.kind === 'wholesale' ? 'عرض جملة تجريبي خاص بهذا الطلب، ولا يعدل الكتالوج.' : 'عرض تجريبي من الإدارة بعد مراجعة الفرع والتوفر.',
    createdAt: now, expiresAt: now + 30 * 60_000, acceptedAt: null, declinedAt: null,
  };
}
export const sampleAddress: Address = { id: 'demo-address-1', label: 'منزل تجريبي', governorateId: 'aden', latitude: 12.803, longitude: 45.031, description: 'وصف عنوان تجريبي للمراجعة فقط', landmark: 'معلم تجريبي', accuracy: null, source: 'demo-pin' };
function emptyOrder(id: string, lines: Order['lines'], address: Address, governorateId: string, kind: OrderKind, now: number): Order {
  const branch = governorateById(governorateId)?.catalogBranch; demand(branch, 'فرع الكتالوج غير مهيأ.');
  return { id, governorateId, catalogBranchId: branch.id, catalogBranchName: branch.name, kind, lines, address: { ...address }, status: 'pending_review', stage: 'awaiting_branch', quotes: [], instructions: [], revalidatedUntil: null, previewExpired: false, currentRevision: null, paymentKind: null, payment: null, hold: 'none', cancellationRequested: false, paymentStatus: 'not_selected', createdAt: now, events: [{ label: 'أرسل طلب تجريبي؛ بانتظار اختيار المدير للفرع', at: now }], rejectionReason: null, rating: null };
}
export function createInitialState(governorateId: string | null = null, now = Date.now()): CustomerState {
  const statuses: Order['status'][] = ['pending_review', 'confirmed', 'on_the_way', 'delivered', 'rejected', 'cancelled'];
  const orders = statuses.map((status, index) => {
    const created = now - (index + 1) * 60_000;
    const order = emptyOrder(`TZ-DEMO-${1001 + index}`, snapshotLines([{ productId: 'oil-15', unit: 'piece', quantity: 1 }], 'aden'), sampleAddress, 'aden', 'retail', created);
    order.status = status;
    if (['confirmed', 'on_the_way', 'delivered'].includes(status)) {
      const quote = buildPreviewQuote(order, now); quote.acceptedAt = now;
      order.quotes = [quote]; order.currentRevision = 1; order.paymentKind = 'cash_on_delivery'; order.paymentStatus = status === 'delivered' ? 'collected' : 'awaiting_cash_collection'; order.hold = 'consumed'; order.stage = 'awaiting_confirmation';
      order.events.push({ label: 'قُبل العرض التجريبي ثم أكدت الإدارة الطلب', at: created + 1000 });
      if (status !== 'confirmed') order.events.push({ label: 'بدأ التوصيل التجريبي', at: created + 2000 });
      if (status === 'delivered') order.events.push({ label: 'سُجل تحصيل نقدي تجريبي ثم التسليم', at: created + 3000 });
    }
    if (status === 'rejected') order.rejectionReason = 'تعذر توفير المنتج في سيناريو المعاينة.';
    if (status === 'cancelled') order.events.push({ label: 'ألغى العميل الطلب قبل التأكيد دون إيصال', at: created + 1000 });
    return order;
  });
  return { governorateId: governorateById(governorateId) ? governorateId : null, profile: null, cart: [], kind: 'retail', addresses: [{ ...sampleAddress }], orders, notifications: [{ id: 'notice-welcome', title: 'أهلًا بك في تزويد', body: 'هذه مساحة تجريبية لمراجعة رحلة العميل.', orderId: null, read: false }, { id: 'notice-order', title: 'تحديث طلب تجريبي', body: 'يمكنك متابعة تفاصيل طلبك من هنا.', orderId: 'TZ-DEMO-1002', read: false }], complaints: [], gate: 'normal', updateDismissed: false, scenario: 'normal', otp: null, resetVerified: false, deletionRequest: null, nextId: 1007 };
}
export type PreviewAction =
  | { type: 'governorate'; id: string }
  | { type: 'cart-add'; line: CartLine } | { type: 'cart-quantity'; productId: string; unit: CartLine['unit']; quantity: number } | { type: 'cart-remove'; productId: string; unit: CartLine['unit'] }
  | { type: 'kind'; kind: OrderKind } | { type: 'address-save'; address: Address } | { type: 'address-delete'; id: string }
  | { type: 'auth-start'; purpose: 'login' | 'register' | 'reset' | 'delete'; phone: string; password?: string; name?: string }
  | { type: 'otp-verify'; code: string } | { type: 'otp-resend' } | { type: 'otp-clear' } | { type: 'password-reset'; password: string }
  | { type: 'logout' } | { type: 'submit'; addressId: string }
  | { type: 'quote-issue'; orderId: string; changedBranch?: boolean; manual?: boolean }
  | { type: 'quote-accept' | 'quote-decline'; orderId: string; revision: number }
  | { type: 'payment-kind'; orderId: string; kind: PaymentKind }
  | { type: 'receipt'; orderId: string; imageUri: string; receiptNumber?: string; amount?: number }
  | { type: 'cancel' | 'cancellation-request' | 'preview-image-reject' | 'preview-transfer-verify' | 'preview-confirm' | 'preview-dispatch' | 'preview-collect' | 'preview-cash-exception' | 'preview-deliver' | 'preview-reject' | 'preview-expire' | 'preview-revalidate'; orderId: string }
  | { type: 'review'; orderId: string; stars: number; comment: string }
  | { type: 'complaint'; orderId: string; text: string; imageUri: string | null }
  | { type: 'complaint-status'; id: string; status: Complaint['status'] }
  | { type: 'notice-read'; id: string } | { type: 'notices-read-all' }
  | { type: 'gate'; gate: Gate } | { type: 'dismiss-update' } | { type: 'scenario'; scenario: PreviewScenario } | { type: 'reset-demo' };

export function transition(state: CustomerState, action: PreviewAction, now = Date.now()): CustomerState {
  if (action.type === 'reset-demo') return createInitialState(state.governorateId, now);
  const next: CustomerState = JSON.parse(JSON.stringify(state));
  const id = (prefix: string) => `${prefix}-${next.nextId++}`;
  const networkMutation = ['submit', 'quote-accept', 'quote-decline', 'receipt', 'review', 'complaint', 'auth-start'];
  if (networkMutation.includes(action.type)) demand(next.scenario !== 'offline' && next.scenario !== 'error', 'تعذر الاتصال في سيناريو المعاينة. أعد المحاولة بعد استعادة الاتصال التجريبي.');
  if (['cart-add', 'cart-quantity', 'kind', 'submit'].includes(action.type)) demand(next.gate !== 'maintenance' && next.gate !== 'required-update', 'الطلبات الجديدة متوقفة في وضع الصيانة أو التحديث الإجباري.');
  const order = 'orderId' in action ? next.orders.find(row => row.id === action.orderId) : undefined;
  if ('orderId' in action) demand(order && next.profile, 'سجل الدخول التجريبي للوصول إلى هذا الطلب.');
  const event = (label: string) => { order!.events.push({ label, at: now }); next.notifications.unshift({ id: id('notice'), title: 'تحديث طلب تجريبي', body: label, orderId: order!.id, read: false }); };
  const pending = () => demand(order?.status === 'pending_review', 'هذا الإجراء متاح قبل تأكيد الطلب فقط.');
  const accepted = () => { const quote = currentQuote(order!); demand(quote?.acceptedAt && !quote.declinedAt, 'وافق أولًا على أحدث تسعيرة وفرع التنفيذ.'); demand(!isExpired(order!, now), 'انتهت صلاحية الحجز الأولي؛ اطلب إعادة التحقق.'); return quote; };
  switch (action.type) {
    case 'governorate': demand(governorateById(action.id), 'المحافظة غير موجودة.'); next.governorateId = action.id; break;
    case 'cart-add': {
      const product = productById(action.line.productId); demand(product && next.governorateId, 'اختر المحافظة أولًا.');
      demand(product.prices[next.governorateId]?.available, 'المنتج غير متوفر في فرع الكتالوج المختار.');
      demand(priceOf(product, next.governorateId, action.line.unit) != null, 'الوحدة غير متاحة.'); piecesOf(action.line);
      const line = next.cart.find(row => row.productId === action.line.productId && row.unit === action.line.unit);
      if (line) { line.quantity += action.line.quantity; piecesOf(line); } else next.cart.push({ ...action.line });
      break;
    }
    case 'cart-quantity': { const line = next.cart.find(row => row.productId === action.productId && row.unit === action.unit); demand(line, 'بند السلة غير موجود.'); line.quantity = action.quantity; piecesOf(line); break; }
    case 'cart-remove': next.cart = next.cart.filter(row => row.productId !== action.productId || row.unit !== action.unit); break;
    case 'kind': next.kind = action.kind; break;
    case 'address-save': {
      demand(next.profile, 'سجل الدخول التجريبي لإدارة العناوين.'); const a = action.address;
      demand(a.label.trim() && governorateById(a.governorateId), 'أكمل اسم العنوان والمحافظة.');
      demand(Number.isFinite(a.latitude) && Number.isFinite(a.longitude) && a.latitude >= -90 && a.latitude <= 90 && a.longitude >= -180 && a.longitude <= 180, 'إحداثيات غير صحيحة.');
      const center = governorateById(a.governorateId)!.center;
      demand(Math.abs(center.latitude - a.latitude) <= 0.15 && Math.abs(center.longitude - a.longitude) <= 0.15, 'الدبوس خارج نطاق المعاينة لهذه المحافظة. الحدود تجريبية وليست تغطية تشغيلية.');
      const value = { ...a, id: a.id || id('address'), label: a.label.trim() };
      next.addresses = next.addresses.filter(row => row.id !== value.id).concat(value); break;
    }
    case 'address-delete': demand(next.profile, 'سجل الدخول.'); next.addresses = next.addresses.filter(row => row.id !== action.id); break;
    case 'auth-start': {
      const phone = normalizePhone(action.phone);
      if (action.purpose === 'delete') demand(next.profile && next.profile.phone === phone, 'تحقق من رقم الحساب الحالي لحذف المعاينة.');
      if (action.purpose === 'login' || action.purpose === 'register') demand((action.password ?? '').length >= 8, 'كلمة مرور المعاينة 8 أحرف على الأقل.');
      if (action.purpose === 'register') demand((action.name ?? '').trim().length >= 2, 'أدخل اسمًا من حرفين على الأقل.');
      next.otp = { purpose: action.purpose, phone, name: action.name?.trim() || next.profile?.name || 'عميل تجريبي', attempts: 0, issuedAt: now, resendAt: now + 30_000, expiresAt: now + 120_000 }; next.resetVerified = false; break;
    }
    case 'otp-verify': {
      const challenge = next.otp; demand(challenge, 'ابدأ طلب التحقق أولًا.'); demand(now <= challenge.expiresAt, 'انتهت صلاحية رمز المعاينة. أعد إرساله.'); demand(challenge.attempts < 3, 'بلغت حد المحاولات التجريبي. أعد الإرسال بعد المهلة.');
      // Wrong attempts are committed as local state instead of being lost by throwing.
      if (action.code !== demoOtpCode) { challenge.attempts += 1; return next; }
      if (challenge.purpose === 'reset') next.resetVerified = true;
      else if (challenge.purpose === 'delete') { next.deletionRequest = { id: id('delete'), status: 'received', at: now }; next.profile = null; next.addresses = []; next.cart = []; }
      else next.profile = { name: challenge.name, phone: challenge.phone };
      next.otp = null; break;
    }
    case 'otp-resend': { demand(next.otp, 'لا يوجد تحقق مفتوح.'); demand(now >= next.otp.resendAt, 'انتظر مهلة إعادة إرسال الرمز التجريبي.'); next.otp = { ...next.otp, attempts: 0, issuedAt: now, resendAt: now + 30_000, expiresAt: now + 120_000 }; break; }
    case 'otp-clear': next.otp = null; break;
    case 'password-reset': demand(next.resetVerified && action.password.length >= 8, 'تحقق برمز الاسترداد وأدخل كلمة مرور من 8 أحرف على الأقل.'); next.resetVerified = false; break;
    case 'logout': next.profile = null; next.otp = null; next.resetVerified = false; break;
    case 'submit': {
      demand(next.profile, 'سجل الدخول وتحقق بالرمز لإرسال الطلب.'); demand(next.governorateId, 'اختر المحافظة.');
      const address = next.addresses.find(row => row.id === action.addressId); demand(address && address.governorateId === next.governorateId, 'اختر عنوانًا من محافظة الكتالوج نفسها.');
      const lines = snapshotLines(next.cart, next.governorateId);
      const created = emptyOrder(`TZ-DEMO-${next.nextId++}`, lines, address, next.governorateId, next.kind, now);
      next.orders.unshift(created); next.cart = []; next.notifications.unshift({ id: id('notice'), title: 'استلم طلبك التجريبي', body: 'بانتظار اختيار المدير لفرع التنفيذ، دون حجز في المعاينة.', orderId: created.id, read: false }); break;
    }
    case 'quote-issue': {
      pending(); demand(order!.hold !== 'receipt_review' && !order!.payment, 'يوجد إيصال محمي؛ لا تغيير أو انتهاء صامتًا قبل المراجعة.');
      const quote = buildPreviewQuote(order!, now, action); order!.quotes.push(quote); order!.currentRevision = quote.revision; order!.hold = 'timed'; order!.stage = 'awaiting_acceptance'; order!.previewExpired = false; order!.revalidatedUntil = null; order!.paymentKind = null; order!.paymentStatus = 'not_selected'; event('وصل عرض تجريبي جديد يحتاج موافقتك'); break;
    }
    case 'quote-accept': { pending(); const quote = currentQuote(order!); demand(quote && quote.revision === action.revision && !quote.declinedAt, 'العرض قديم؛ افتح أحدث نسخة.'); demand(!isExpired(order!, now), 'انتهت صلاحية العرض التجريبي.'); demand(!quote.acceptedAt, 'سبق قبول هذه النسخة.'); quote.acceptedAt = now; order!.stage = 'awaiting_confirmation'; event('وافق العميل على التسعيرة وفرع التنفيذ التجريبيين'); break; }
    case 'quote-decline': { pending(); const quote = currentQuote(order!); demand(quote && quote.revision === action.revision && !quote.acceptedAt && order!.hold !== 'receipt_review', 'لا يمكن رفض عرض قديم أو مقبول أو محمي.'); quote.declinedAt = now; order!.stage = 'awaiting_quote'; order!.hold = 'none'; event('رفض العميل العرض التجريبي؛ بانتظار مراجعة الإدارة'); break; }
    case 'payment-kind': {
      pending(); const quote = accepted(); demand(!order!.payment, 'هناك تحويل مبلغ عنه؛ لا تبدل مسار الدفع أثناء مراجعته.'); order!.paymentKind = action.kind;
      order!.stage = action.kind === 'transfer' ? 'awaiting_payment' : 'awaiting_confirmation'; order!.paymentStatus = action.kind === 'transfer' ? 'awaiting_transfer' : 'awaiting_cash_collection';
      if (action.kind === 'transfer' && !order!.instructions.some(instruction => instruction.quoteRevision === quote.revision)) order!.instructions.push({ id: id('instruction'), quoteRevision: quote.revision, destination: 'DEMO-NOT-A-PAYMENT', beneficiary: 'مستفيد تجريبي — لا تحول أموالًا', method: 'وسيلة تحويل تجريبية', expectedAmount: quote.total }); break;
    }
    case 'receipt': {
      pending(); const quote = accepted(); demand(order!.paymentKind === 'transfer', 'الإيصال لمسار التحويل فقط.'); demand(action.imageUri && !/^https?:/i.test(action.imageUri), 'اختر صورة اختبار محلية.');
      if (order!.payment) { demand(order!.payment.status === 'image_rejected', 'الصورة الحالية قيد المراجعة أو معتمدة؛ لا تكرر التحويل.'); order!.payment.attempts.push({ id: id('attempt'), imageUri: action.imageUri, at: now, rejectedReason: null }); order!.payment.status = order!.payment.reportedAmount === quote.total ? 'checking_receipt' : 'amount_mismatch'; }
      else {
        demand(action.receiptNumber?.trim() && Number.isSafeInteger(action.amount) && action.amount! > 0, 'أدخل رقم الإيصال ومبلغًا صحيحًا موجبًا.');
        const instruction = order!.instructions.find(row => row.quoteRevision === quote.revision); demand(instruction, 'تعليمات التحويل لم تثبت لهذا العرض.');
        order!.payment = { id: id('payment'), instruction: { ...instruction }, receiptNumber: action.receiptNumber!.trim(), reportedAmount: action.amount!, attempts: [{ id: id('attempt'), imageUri: action.imageUri, at: now, rejectedReason: null }], status: action.amount === quote.total ? 'checking_receipt' : 'amount_mismatch' };
      }
      order!.hold = 'receipt_review'; order!.stage = 'checking_receipt'; order!.paymentStatus = order!.payment.status === 'amount_mismatch' ? 'financial_review' : 'checking_receipt'; event('استلم الإيصال التجريبي؛ الحجز والسعر محميان حتى المراجعة'); break;
    }
    case 'cancel': pending(); demand(!order!.payment, 'بعد الإيصال يلزم طلب إلغاء تراجعه الإدارة.'); order!.status = 'cancelled'; order!.hold = 'none'; event('ألغي الطلب التجريبي قبل التأكيد دون إيصال'); break;
    case 'cancellation-request': pending(); demand(order!.payment && !order!.cancellationRequested, 'لا يوجد إيصال أو سبق إرسال طلب الإلغاء.'); order!.cancellationRequested = true; event('أرسل طلب إلغاء تجريبي للمراجعة؛ لا تحرير تلقائي للحجز'); break;
    case 'preview-image-reject': { pending(); const payment = order!.payment; demand(payment && payment.status !== 'verified_transfer', 'لا يوجد إيصال قابل للمراجعة.'); payment.status = 'image_rejected'; payment.attempts[payment.attempts.length - 1]!.rejectedReason = 'الصورة غير واضحة — سبب تجريبي؛ لا يعني أن المال لم يصل.'; order!.paymentStatus = 'checking_receipt'; event('طلبت الإدارة صورة أوضح في المعاينة؛ الحجز محمي'); break; }
    case 'preview-transfer-verify': { pending(); const quote = accepted(); const payment = order!.payment; demand(payment && payment.status !== 'image_rejected' && payment.status !== 'verified_transfer', 'لا يوجد إيصال حالي قابل للاعتماد التجريبي.'); demand(payment.reportedAmount === quote.total, 'المبلغ غير مطابق؛ تبقى مراجعة مالية دون تأكيد تلقائي.'); payment.status = 'verified_transfer'; order!.paymentStatus = 'verified_transfer'; order!.stage = 'awaiting_confirmation'; event('حاكت المعاينة تحقق الإدارة من التحويل؛ ليس ربطًا ماليًا حقيقيًا'); break; }
    case 'preview-confirm': { pending(); accepted(); demand(!order!.cancellationRequested, 'طلب الإلغاء يحتاج مراجعة الإدارة أولًا.'); demand(order!.paymentKind === 'cash_on_delivery' || order!.paymentStatus === 'verified_transfer', 'التحويل يحتاج مبلغًا متحققًا مطابقًا، أو اختر النقد دون إيصال.'); order!.status = 'confirmed'; order!.hold = 'consumed'; event('أكدت الإدارة الطلب التجريبي؛ النقد لا يعد محصلًا بالتأكيد'); break; }
    case 'preview-dispatch': demand(order!.status === 'confirmed', 'يلزم تأكيد الطلب أولًا.'); order!.status = 'on_the_way'; event('بدأ التوصيل التجريبي دون تتبع مباشر'); break;
    case 'preview-collect': demand(order!.paymentKind === 'cash_on_delivery' && ['on_the_way', 'delivered'].includes(order!.status), 'التحصيل النقدي لهذا السيناريو يكون أثناء التوصيل.'); order!.paymentStatus = 'collected'; event('سجل تحصيل نقدي تجريبي مستقل عن تأكيد الطلب'); break;
    case 'preview-cash-exception': demand(order!.paymentKind === 'cash_on_delivery' && order!.status === 'on_the_way', 'الاستثناء النقدي لهذا السيناريو أثناء التوصيل.'); order!.paymentStatus = 'financial_review'; event('استثناء نقدي تجريبي موثق: تعذر تحصيل المبلغ؛ مراجعة الإدارة'); break;
    case 'preview-deliver': demand(order!.status === 'on_the_way', 'ابدأ التوصيل أولًا.'); demand(order!.paymentKind !== 'cash_on_delivery' || ['collected', 'financial_review'].includes(order!.paymentStatus), 'حاكِ تحصيلًا نقديًا أو استثناء صريحًا قبل التسليم.'); order!.status = 'delivered'; event('سجل التسليم التجريبي دون اختلاق مبلغ تحصيل'); break;
    case 'preview-reject': pending(); demand(!order!.payment, 'لا رفض صامت بعد التحويل؛ المراجعة المالية مطلوبة.'); order!.status = 'rejected'; order!.hold = 'none'; order!.rejectionReason = 'تعذر توفير المنتج — قرار تجريبي.'; event('رفضت الإدارة الطلب في المعاينة بسبب موثق'); break;
    case 'preview-expire': pending(); demand(order!.hold === 'timed', 'لا مهلة تحرير لحجز الإيصال المحمي.'); order!.previewExpired = true; event('حاكِ انتهاء الحجز الأولي دون إيصال؛ يلزم إعادة تحقق'); break;
    case 'preview-revalidate': pending(); demand(order!.paymentKind === 'cash_on_delivery' && isExpired(order!, now), 'إعادة التحقق في هذا السيناريو لنقد انتهى حجزه.'); order!.revalidatedUntil = now + 30 * 60_000; order!.previewExpired = false; order!.hold = 'timed'; event('إعادة تحقق تجريبية لنفس الحقائق دون تغيير snapshot العرض'); break;
    case 'review': demand(order!.status === 'delivered' && !order!.rating, 'التقييم مرة واحدة لطلب مسلم.'); demand(Number.isInteger(action.stars) && action.stars >= 1 && action.stars <= 5 && action.comment.length <= 500, 'اختر من نجمة إلى خمس وملاحظة حتى500حرف.'); order!.rating = { stars: action.stars, comment: action.comment.trim() }; break;
    case 'complaint': demand(order!.status === 'delivered' && action.text.trim().length >= 5 && action.text.length <= 1000, 'البلاغ لطلب مسلم، بوصف من5 إلى1000حرف.'); next.complaints.unshift({ id: id('complaint'), orderId: order!.id, text: action.text.trim(), imageUri: action.imageUri, status: 'new' }); break;
    case 'complaint-status': { const complaint = next.complaints.find(row => row.id === action.id); demand(complaint, 'البلاغ غير موجود.'); complaint.status = action.status; break; }
    case 'notice-read': { const notice = next.notifications.find(row => row.id === action.id); demand(notice, 'الإشعار غير موجود.'); notice.read = true; break; }
    case 'notices-read-all': next.notifications.forEach(notice => { notice.read = true; }); break;
    case 'gate': next.gate = action.gate; next.updateDismissed = false; break;
    case 'dismiss-update': demand(next.gate === 'optional-update', 'لا يمكن تجاوز التحديث الإجباري بهذا الإجراء.'); next.updateDismissed = true; break;
    case 'scenario': next.scenario = action.scenario; break;
  }
  return next;
}
