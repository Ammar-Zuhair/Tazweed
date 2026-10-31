import {
  permissionNames,
  type AdminState,
  type Order,
  type Line,
} from "../domain/types";
export const previewPassword = "Tazweed123!";
export const fixtureImages = ["رسم عبوة زيت", "رسم بطارية", "رسم إطار"];
export function createAdminState(now = Date.now()): AdminState {
  const permissions = Object.keys(
    permissionNames,
  ) as (keyof typeof permissionNames)[];
  const s: AdminState = {
    source: "fake",
    now,
    counter: 100,
    session: null,
    selectedBranch: null,
    challenge: null,
    roles: [
      { id: "owner", name: "مدير عام تجريبي", permissions },
      {
        id: "manager",
        name: "مدير فرع",
        permissions: [
          "orders.review",
          "orders.reprice",
          "orders.confirm",
          "orders.reject",
          "orders.assign",
          "payments.verify",
          "couriers.manage",
          "inventory.adjust",
          "inventory.transfer",
          "reports.read",
          "commissions.settle",
          "cash.remit",
          "customer-flags.read",
          "complaints.manage",
          "financial-exceptions.resolve",
          "audit.read",
        ],
      },
      {
        id: "reviewer",
        name: "مراجع طلبات",
        permissions: ["orders.review", "orders.reprice"],
      },
      {
        id: "warehouse",
        name: "أمين مخزن",
        permissions: ["inventory.adjust", "inventory.transfer"],
      },
    ],
    staff: [
      {
        id: "staff-owner",
        name: "مدير المعاينة",
        phone: "770000001",
        active: true,
        grants: [{ roleId: "owner", branchId: null }],
      },
      {
        id: "staff-manager",
        name: "مدير فرع عدن التجريبي",
        phone: "770000002",
        active: true,
        grants: [{ roleId: "manager", branchId: "aden" }],
      },
      {
        id: "staff-reviewer",
        name: "مراجع تجريبي",
        phone: "770000003",
        active: true,
        grants: [{ roleId: "reviewer", branchId: "aden" }],
      },
      {
        id: "staff-warehouse",
        name: "أمين مخزن تجريبي",
        phone: "770000004",
        active: true,
        grants: [{ roleId: "warehouse", branchId: "aden" }],
      },
    ],
    provinces: [
      {
        id: "gov-aden",
        name: "عدن — تجربة",
        active: true,
        order: 1,
        catalogBranchId: "aden",
      },
      {
        id: "gov-sanaa",
        name: "صنعاء — تجربة",
        active: true,
        order: 2,
        catalogBranchId: "sanaa",
      },
      {
        id: "gov-empty",
        name: "محافظة غير مهيأة",
        active: false,
        order: 3,
        catalogBranchId: null,
      },
    ],
    branches: [
      {
        id: "aden",
        provinceId: "gov-aden",
        name: "فرع عدن التجريبي",
        active: true,
        latitude: 12.79,
        longitude: 45.02,
        coverage: 12000,
        maxDistance: 20000,
        base: 300,
        perKm: 100,
        deliveryEnabled: true,
      },
      {
        id: "sanaa",
        provinceId: "gov-sanaa",
        name: "فرع صنعاء التجريبي",
        active: true,
        latitude: 15.35,
        longitude: 44.2,
        coverage: 10000,
        maxDistance: 16000,
        base: 300,
        perKm: 100,
        deliveryEnabled: true,
      },
    ],
    attributes: [
      {
        id: "brand",
        code: "brand",
        name: "الماركة",
        active: true,
        values: [
          { id: "brand-1", name: "علامة المعاينة", active: true, order: 1 },
          { id: "brand-2", name: "علامة ثانية", active: true, order: 2 },
        ],
      },
      {
        id: "viscosity",
        code: "viscosity",
        name: "اللزوجة",
        active: true,
        values: [
          { id: "v1540", name: "15W-40", active: true, order: 1 },
          { id: "v2050", name: "20W-50", active: true, order: 2 },
        ],
      },
      {
        id: "capacity",
        code: "capacity",
        name: "السعة",
        active: true,
        values: [{ id: "cap70", name: "70 أمبير", active: true, order: 1 }],
      },
    ],
    categories: [
      {
        id: "oil",
        parentId: null,
        name: "الزيوت",
        active: true,
        order: 1,
        image: "رسم عبوة زيت",
        attributes: [
          { attributeId: "brand", required: true, filterable: true, order: 1 },
          {
            attributeId: "viscosity",
            required: true,
            filterable: true,
            order: 2,
          },
        ],
      },
      {
        id: "battery",
        parentId: null,
        name: "البطاريات",
        active: true,
        order: 2,
        image: "رسم بطارية",
        attributes: [
          { attributeId: "brand", required: true, filterable: true, order: 1 },
          {
            attributeId: "capacity",
            required: true,
            filterable: true,
            order: 2,
          },
        ],
      },
    ],
    products: [
      {
        id: "oil-1",
        sku: "DEMO-OIL-1540",
        name: "زيت محركات 15W-40",
        description:
          "عبوة تجريبية لمراجعة الوحدات والتسعير، لا منتج معروض للبيع.",
        origin: "منشأ تجريبي",
        categoryId: "oil",
        active: true,
        images: [...fixtureImages],
        values: { brand: "brand-1", viscosity: "v1540" },
        units: [
          {
            id: "oil-piece",
            kind: "piece",
            pieces: 1,
            price: 1800,
            active: true,
            used: true,
          },
          {
            id: "oil-carton",
            kind: "carton",
            pieces: 12,
            price: 19500,
            active: true,
            used: true,
          },
        ],
        branchPrices: { sanaa: { "oil-piece": 1900, "oil-carton": 20000 } },
      },
      {
        id: "battery-1",
        sku: "DEMO-BAT-70",
        name: "بطارية 70 أمبير",
        description: "بطارية توضيحية، الأرقام والرصيد للمعاينة.",
        origin: "منشأ تجريبي",
        categoryId: "battery",
        active: true,
        images: ["رسم بطارية"],
        values: { brand: "brand-2", capacity: "cap70" },
        units: [
          {
            id: "battery-piece",
            kind: "piece",
            pieces: 1,
            price: 24000,
            active: true,
            used: true,
          },
          {
            id: "battery-carton",
            kind: "carton",
            pieces: 4,
            price: 92000,
            active: true,
            used: false,
          },
        ],
        branchPrices: {},
      },
    ],
    stock: [],
    movements: [],
    orders: [],
    reservations: [],
    couriers: [
      {
        id: "courier-1",
        name: "موصل عدن — تجربة",
        phone: "770000011",
        active: true,
        branchIds: ["aden"],
        bps: 2000,
      },
      {
        id: "courier-2",
        name: "موصل متعدد الفروع — تجربة",
        phone: "770000012",
        active: true,
        branchIds: ["aden", "sanaa"],
        bps: 1500,
      },
      {
        id: "courier-unset",
        name: "موصل دون نسبة",
        phone: "770000013",
        active: true,
        branchIds: ["aden"],
        bps: null,
      },
    ],
    earnings: [],
    cash: [],
    settlements: [],
    remittances: [],
    commissionReversals: [],
    cashReversals: [],
    exceptions: [],
    methods: [
      {
        id: "wallet-demo",
        name: "وسيلة تحويل تجريبية",
        beneficiary: "مستفيد وهمي — لا تحول مالًا",
        destination: "DEMO-NOT-A-PAYMENT",
        instructions: "للمعاينة فقط، لا حساب مالي.",
        active: true,
        branchId: null,
        order: 1,
      },
    ],
    promotions: [
      {
        id: "promo-delivery",
        name: "خصم توصيل تجريبي100",
        target: "delivery",
        discountKind: "fixed",
        value: 100,
        branchId: null,
        categoryId: null,
        productId: null,
        startsAt: now - 86400000,
        endsAt: now + 864000000,
        active: true,
      },
    ],
    banners: [
      {
        id: "banner-1",
        title: "احتياجات مركبتك في مكان واحد",
        image: "رسم عبوة زيت",
        branchId: null,
        categoryId: "oil",
        productId: null,
        active: true,
        order: 1,
        startsAt: now - 86400000,
        endsAt: now + 864000000,
      },
    ],
    campaigns: [],
    complaints: [],
    releases: [],
    maintenance: {
      enabled: false,
      message: "العميل في صيانة تجريبية؛ متابعة الطلبات والدعم متاحة.",
    },
    settings: {
      holdMinutes: 30,
      lateAlertMinutes: 30,
      privacy: "/privacy",
      support: "/support",
    },
    audit: [],
  };
  for (const b of s.branches)
    for (const p of s.products) {
      const n = p.id === "oil-1" ? 240 : 60;
      s.stock.push({ branchId: b.id, productId: p.id, onHand: n, reserved: 0 });
      s.movements.push({
        id: `opening-${b.id}-${p.id}`,
        branchId: b.id,
        productId: p.id,
        delta: n,
        reason: "رصيد افتتاحي تجريبي",
        at: now - 86400000,
        actor: "fixture",
      });
    }
  const oil: Line[] = [
    {
      productId: "oil-1",
      unitId: "oil-carton",
      name: "زيت محركات 15W-40",
      unitName: "كرتون",
      quantity: 2,
      pieces: 12,
      price: 19500,
      sourcePrice: 19500,
    },
    {
      productId: "oil-1",
      unitId: "oil-piece",
      name: "زيت محركات 15W-40",
      unitName: "حبة",
      quantity: 3,
      pieces: 1,
      price: 1800,
      sourcePrice: 1800,
    },
  ];
  const battery: Line[] = [
    {
      productId: "battery-1",
      unitId: "battery-piece",
      name: "بطارية 70 أمبير",
      unitName: "حبة",
      quantity: 1,
      pieces: 1,
      price: 24000,
      sourcePrice: 24000,
    },
  ];
  const addOrder = (
    id: string,
    items: Line[],
    kind: Order["kind"] = "retail",
    branchId = "aden",
  ) => {
    const o: Order = {
      id,
      customerId: id === "TZ-1003" ? "flagged" : "customer-demo",
      customer: id === "TZ-1003" ? "عميل عليه بلاغ تجريبي" : "عميل المعاينة",
      phone: "770000000",
      address: "عنوان تجريبي — لا تتبع أو GPS",
      catalogBranchId: branchId,
      branchId: null,
      kind,
      paymentKind: "cash",
      status: "pending_review",
      version: 1,
      items: JSON.parse(JSON.stringify(items)),
      quotes: [],
      payments: [],
      instructions: [],
      assignments: [],
      createdAt: now - 600000,
      flagAcknowledged: false,
      cancellationRequested: false,
      events: [
        { at: now - 600000, text: "إرسال طلب تجريبي دون حجز أو تسعيرة" },
      ],
      revalidations: [],
      deliveryIssues: [],
    };
    s.orders.push(o);
    return o;
  };
  const seedQuote = (o: Order, protectedHold = false) => {
    o.createdAt = now - 5400000;
    o.events[0]!.at = o.createdAt;
    const items = JSON.parse(JSON.stringify(o.items)) as Line[];
    const subtotal = items.reduce((n, i) => n + i.price * i.quantity, 0);
    const q = {
      id: `q-${o.id}`,
      revision: 1,
      branchId: o.catalogBranchId,
      items,
      subtotal,
      delivery: 500,
      deliveryDiscount: o.kind === "retail" ? 100 : 0,
      productDiscount: 0,
      total: subtotal + 500 - (o.kind === "retail" ? 100 : 0),
      pricingMode: "road" as const,
      distance: 2800,
      base: 300,
      perKm: 100,
      reason: "عرض fixture مقبول للمعاينة",
      promotionId: o.kind === "retail" ? "promo-delivery" : null,
      status: "accepted" as const,
      acceptedAt: now - 4500000,
      acceptedBy: o.customerId,
      createdAt: now - 4800000,
      expiresAt: protectedHold ? now - 3000000 : now + 1800000,
    };
    o.quotes.push(q);
    o.branchId = q.branchId;
    for (const i of items) {
      const x = s.stock.find(
        (x) => x.branchId === q.branchId && x.productId === i.productId,
      )!;
      const pieces = i.quantity * i.pieces;
      x.reserved += pieces;
      s.reservations.push({
        id: `r-${o.id}-${i.unitId}`,
        orderId: o.id,
        quoteId: q.id,
        branchId: q.branchId,
        productId: i.productId,
        pieces,
        state: "active",
        kind: protectedHold ? "receipt_review" : "timed",
        expiresAt: protectedHold ? null : q.expiresAt,
        protectedAt: protectedHold ? now - 3900000 : undefined,
      });
    }
    return q;
  };
  addOrder("TZ-1001", oil, "wholesale");
  addOrder("TZ-1002", battery);
  const protectedOrder = addOrder("TZ-1003", battery);
  const q = seedQuote(protectedOrder, true);
  protectedOrder.paymentKind = "transfer";
  protectedOrder.cancellationRequested = true;
  protectedOrder.payments.push({
    id: "payment-protected",
    instructionId: "instruction-protected",
    quoteId: q.id,
    methodId: "wallet-demo",
    number: "DEMO-1003",
    reported: q.total,
    instructions: {
      method: s.methods[0]!.name,
      beneficiary: s.methods[0]!.beneficiary,
      destination: s.methods[0]!.destination,
      amount: q.total,
    },
    attempts: [
      {
        id: "attempt-1",
        submittedAt: now - 3900000,
        image: "رسم إيصال تجريبي1 — صورة غير واضحة",
        review: {
          outcome: "image_rejected",
          reason: "الصورة غير واضحة؛ لا نفي لوصول المال",
          actor: "staff-owner",
          at: now - 3600000,
          holdAction: "keep",
        },
      },
      {
        id: "attempt-2",
        submittedAt: now - 3500000,
        image: "رسم إيصال تجريبي2 — تصحيح لنفس التحويل",
      },
    ],
  });
  const cashOrder = addOrder("TZ-1004", battery);
  seedQuote(cashOrder);
  cashOrder.quotes[0]!.expiresAt = now - 1000;
  for (const r of s.reservations.filter((r) => r.orderId === cashOrder.id))
    r.expiresAt = now - 1000;
  const inRoad = addOrder("TZ-1005", battery);
  const qr = seedQuote(inRoad);
  inRoad.status = "on_the_way";
  inRoad.confirmedAt = now - 3000000;
  inRoad.assignments.push({
    id: "assignment-road",
    courierId: "courier-1",
    at: now - 2500000,
    base: 500,
    discount: 100,
    bps: 2000,
    commission: 100,
  });
  inRoad.deliveryIssues.push({
    id: "delivery-demo",
    reason: "تعذر تواصل تجريبي مع العميل؛ بانتظار مراجعة الإدارة",
    at: now - 600000,
  });
  const delivered = addOrder("TZ-1006", battery);
  seedQuote(delivered);
  delivered.status = "delivered";
  delivered.confirmedAt = now - 4000000;
  delivered.deliveredAt = now - 2000000;
  delivered.assignments.push({
    id: "assignment-delivered",
    courierId: "courier-1",
    at: now - 3000000,
    base: 500,
    discount: 100,
    bps: 2000,
    commission: 100,
  });
  for (const o of [inRoad, delivered])
    for (const r of s.reservations.filter((r) => r.orderId === o.id)) {
      r.state = "consumed";
      const x = s.stock.find(
        (x) => x.branchId === r.branchId && x.productId === r.productId,
      )!;
      x.onHand -= r.pieces;
      x.reserved -= r.pieces;
      s.movements.push({
        id: `sale-${r.id}`,
        branchId: r.branchId,
        productId: r.productId,
        delta: -r.pieces,
        reason: "صرف fixture سابق",
        at: o.confirmedAt!,
        actor: "fixture",
        orderId: o.id,
      });
    }
  s.earnings.push({
    id: "earning-delivered",
    orderId: delivered.id,
    courierId: "courier-1",
    branchId: "aden",
    amount: 100,
    at: delivered.deliveredAt!,
    reference: "assignment-delivered",
  });
  s.cash.push({
    id: "cash-delivered",
    orderId: delivered.id,
    courierId: "courier-1",
    branchId: "aden",
    amount: 24400,
    at: delivered.deliveredAt!,
    reference: "DEMO-CASH-1006",
  });
  addOrder("TZ-2001", battery, "retail", "sanaa");
  const cancelled = addOrder("TZ-1007", battery);
  const lateQuote = seedQuote(cancelled);
  cancelled.status = "cancelled";
  cancelled.paymentKind = "transfer";
  for (const r of s.reservations.filter((r) => r.orderId === cancelled.id)) {
    r.state = "released";
    s.stock.find(
      (x) => x.branchId === r.branchId && x.productId === r.productId,
    )!.reserved -= r.pieces;
  }
  cancelled.payments.push({
    id: "late-payment",
    instructionId: "instruction-late",
    quoteId: lateQuote.id,
    methodId: "wallet-demo",
    number: "DEMO-LATE",
    reported: 5000,
    approved: 5000,
    instructions: {
      method: s.methods[0]!.name,
      beneficiary: s.methods[0]!.beneficiary,
      destination: s.methods[0]!.destination,
      amount: lateQuote.total,
    },
    attempts: [
      {
        id: "late-attempt",
        submittedAt: now - 400000,
        image: "رسم تحويل متأخر تجريبي",
        review: {
          outcome: "transfer_verified",
          amount: 5000,
          reason: "تحقق خارجي بعد الإلغاء — fixture",
          actor: "fixture",
          at: now - 400000,
          holdAction: "release",
        },
      },
    ],
  });
  s.exceptions.push({
    id: "late-transfer-demo",
    orderId: cancelled.id,
    kind: "late_transfer",
    amount: 5000,
    reason: "تحويل fixture وصل بعد الإلغاء؛ لا يهمل",
    at: now - 400000,
  });
  s.complaints = [
    {
      id: "flag-1",
      orderId: protectedOrder.id,
      type: "flag",
      text: "تعذر التواصل في طلب سابق — بلاغ تجريبي من موظف، ليس حظرًا آليًا",
      status: "open",
      response: "",
    },
    {
      id: "complaint-1",
      orderId: delivered.id,
      type: "complaint",
      text: "ملاحظة تجريبية على التغليف",
      status: "open",
      response: "",
    },
    {
      id: "rating-1",
      orderId: delivered.id,
      type: "rating",
      text: "تقييم طلب تجريبي",
      rating: 4,
      status: "open",
      response: "",
    },
  ];
  s.audit.push({
    id: "audit-opening",
    actor: "fixture",
    action: "seed",
    branchId: null,
    summary: "تهيئة معاينة03 دون خادم أو بيانات متجر فعلية",
    at: now,
  });
  for (const o of s.orders)
    for (const p of o.payments) {
      o.instructions.push({
        id: p.instructionId,
        quoteId: p.quoteId,
        methodId: p.methodId,
        at: p.attempts[0]!.submittedAt - 60000,
        snapshot: { ...p.instructions },
      });
    }
  return s;
}
