import type { ServerState, Task } from "../domain/types";
import { COURIER_ID } from "../domain/courier-model";
export function fixtures(now = Date.now()): ServerState {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const todayAt = Math.min(now, today.getTime() + 60_000);
  const task = (
    id: string,
    number: string,
    override: Partial<Task> = {},
  ): Task => ({
    id,
    number,
    version: 1,
    assignmentId: `assignment-${id}`,
    courierId: COURIER_ID,
    active: true,
    expiresAt: now + 86_400_000,
    assignedAt: now - 60_000,
    seen: false,
    branch: "فرع عدن — تجريبي",
    status: "confirmed",
    customer: "عميل تجريبي",
    phone: "770000000",
    address: {
      description: "عدن، المنصورة، شارع تجريبي 12",
      landmark: "بجوار المعلم التجريبي",
      latitude: 12.8531,
      longitude: 44.9772,
    },
    items: [
      {
        name: "زيت محرك 20W-50 — تجربة",
        sku: "OIL-DEMO",
        unit: "كرتون",
        quantity: 2,
        pieces: 12,
      },
      {
        name: "زيت محرك 20W-50 — تجربة",
        sku: "OIL-DEMO",
        unit: "حبة",
        quantity: 3,
        pieces: 1,
      },
    ],
    total: 24400,
    paymentKind: "cash_on_delivery",
    feeBefore: 500,
    discount: 100,
    bps: 2000,
    commission: 100,
    ...override,
  });
  const tasks = [
    task("t1", "TZ-0401"),
    task("t2", "TZ-0402", {
      paymentKind: "transfer",
      total: 35000,
      customer: "عميل تحويل — تجربة",
      branch: "فرع صنعاء — تجريبي",
      bps: 1500,
      commission: 75,
      address: {
        description: "صنعاء، عنوان تجريبي",
        landmark: "معلم تجريبي",
        latitude: 15.3694,
        longitude: 44.191,
      },
    }),
    task("t3", "TZ-0403", {
      status: "on_the_way",
      customer: "عميل نقد ناقص — تجربة",
      startedAt: now - 600_000,
    }),
    task("t4", "TZ-0404", {
      status: "delivered",
      deliveredAt: todayAt,
      seen: true,
    }),
    task("t5", "TZ-0405", {
      status: "delivered",
      deliveredAt: todayAt,
      paymentKind: "transfer",
      seen: true,
    }),
    task("old", "TZ-0399", {
      status: "delivered",
      deliveredAt: today.getTime() - 3_600_000,
      seen: true,
    }),
    task("other", "TZ-PRIVATE", {
      courierId: "courier-1",
      customer: "غير مسند لهذا الحساب",
      phone: "770000099",
    }),
  ];
  const earnings = tasks
    .filter((t) => t.deliveredAt)
    .map((t) => ({
      id: `earning-${t.id}`,
      orderId: t.id,
      courierId: t.courierId,
      number: t.number,
      base: t.feeBefore,
      discount: t.discount,
      bps: t.bps,
      amount: t.commission,
      at: t.deliveredAt!,
    }));
  return {
    tasks,
    earnings,
    cash: [
      {
        id: "cash-t4",
        orderId: "t4",
        courierId: COURIER_ID,
        assignmentId: "assignment-t4",
        amount: 24400,
        reference: "DEMO-CASH-04",
        at: todayAt,
      },
      {
        id: "cash-old",
        orderId: "old",
        courierId: COURIER_ID,
        assignmentId: "assignment-old",
        amount: 24400,
        reference: "DEMO-CASH-OLD",
        at: today.getTime() - 3_600_000,
      },
    ],
    exceptions: [],
    reports: [],
    settlements: [
      {
        id: "settlement-old",
        courierId: COURIER_ID,
        earningIds: ["earning-old"],
        amount: 100,
        reference: "DEMO-PAYOUT-OLD",
        proof: "إثبات تجريبي محلي",
        actor: "مدير تجريبي",
        at: today.getTime() - 3_500_000,
      },
      {
        id: "settlement-reversed",
        courierId: COURIER_ID,
        earningIds: ["earning-t4"],
        amount: 100,
        reference: "DEMO-PAYOUT-REVERSED",
        proof: "إثبات تجريبي محلي",
        actor: "مدير تجريبي",
        at: todayAt,
        reversal: {
          reference: "DEMO-REV-PAYOUT",
          reason: "خطأ تسوية — تجربة",
          proof: "إثبات عكس تجريبي",
          at: todayAt,
        },
      },
    ],
    remittances: [
      {
        id: "remit-old",
        courierId: COURIER_ID,
        collectionIds: ["cash-old"],
        amount: 24400,
        reference: "DEMO-REMIT-OLD",
        proof: "إثبات توريد تجريبي",
        actor: "مدير تجريبي",
        at: todayAt,
      },
    ],
    notices: [
      {
        id: "notice-1",
        title: "مهمة جديدة TZ-0401",
        body: "أسندت الإدارة مهمة نقدية — بيانات تجريبية.",
        orderId: "t1",
        read: false,
        at: now,
      },
      {
        id: "notice-2",
        title: "تسوية معكوسة",
        body: "عادت 100 ريال إلى العمولة غير المسددة، دون إنشاء استحقاق جديد.",
        read: false,
        at: todayAt,
      },
    ],
    receipts: {},
  };
}
