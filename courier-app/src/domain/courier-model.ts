import type {
  Cash,
  Challenge,
  Command,
  Earning,
  ServerState,
  Snapshot,
  Task,
} from "./types";
export const DEMO_PHONE = "770000012";
export const DEMO_PASSWORD = "Tazweed123!";
export const COURIER_ID = "courier-2";
export const CACHE_TTL = 5 * 60_000; // Local preview cache limit; not a retention policy.
export const labels = {
  confirmed: "تم التأكيد",
  on_the_way: "في الطريق",
  delivered: "تم التسليم",
};
function requireValue(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function login(phone: string, password: string, now: number): Challenge {
  requireValue(
    phone === DEMO_PHONE && password === DEMO_PASSWORD,
    "بيانات حساب المعاينة غير صحيحة؛ لا تسجيل عام.",
  );
  return {
    phone,
    expiresAt: now + 300_000,
    resendAt: now + 60_000,
    attempts: 0,
    used: false,
  };
}
export function verify(
  challenge: Challenge,
  code: string,
  now: number,
): boolean {
  requireValue(
    !challenge.used && now < challenge.expiresAt,
    "انتهى الرمز؛ اطلب رمزًا جديدًا.",
  );
  requireValue(challenge.attempts < 5, "بلغت حد محاولات المعاينة.");
  challenge.attempts++;
  if (code !== "000000") return false;
  challenge.used = true;
  return true;
}
export function resend(challenge: Challenge, now: number): Challenge {
  requireValue(now >= challenge.resendAt, "انتظر انتهاء عداد إعادة الإرسال.");
  return {
    ...challenge,
    attempts: 0,
    used: false,
    expiresAt: now + 300_000,
    resendAt: now + 60_000,
  };
}
export function active(task: Task, actor: string, now: number) {
  return task.courierId === actor && task.active && task.expiresAt > now;
}
export function collected(cash: Cash[], id: string) {
  return cash.filter((x) => x.orderId === id).reduce((n, x) => n + x.amount, 0);
}
export function paymentState(
  state: Pick<ServerState, "cash" | "exceptions">,
  task: Task,
) {
  if (task.paymentKind === "transfer") return "تحويل متحقق لدى الإدارة";
  const amount = collected(state.cash, task.id);
  if (amount === task.total) return "محصل بالكامل";
  if (
    state.exceptions.some(
      (x) => x.orderId === task.id && x.collected === amount,
    )
  )
    return "استثناء نقدي مسجل للإدارة";
  return amount === 0 ? "بانتظار التحصيل" : "تحصيل غير مطابق";
}
export function project(
  state: ServerState,
  actor: string,
  now: number,
): Snapshot {
  const tasks = state.tasks.filter((t) => active(t, actor, now));
  const ids = new Set(tasks.map((t) => t.id));
  return clone({
    source: "fake",
    syncedAt: now,
    validUntil: now + CACHE_TTL,
    tasks,
    cash: state.cash.filter((x) => x.courierId === actor),
    exceptions: state.exceptions.filter(
      (x) => x.courierId === actor && ids.has(x.orderId),
    ),
    reports: state.reports.filter(
      (x) => x.courierId === actor && ids.has(x.orderId),
    ),
    earnings: state.earnings.filter((x) => x.courierId === actor),
    settlements: state.settlements.filter((x) => x.courierId === actor),
    remittances: state.remittances.filter((x) => x.courierId === actor),
    notices: state.notices.filter((x) => !x.orderId || ids.has(x.orderId)),
  });
}
export function prune(snapshot: Snapshot, now: number): Snapshot | null {
  if (now >= snapshot.validUntil) return null;
  const tasks = snapshot.tasks.filter((t) => t.active && t.expiresAt > now);
  const ids = new Set(tasks.map((t) => t.id));
  return {
    ...snapshot,
    tasks,
    reports: snapshot.reports.filter((x) => ids.has(x.orderId)),
    exceptions: snapshot.exceptions.filter((x) => ids.has(x.orderId)),
    notices: snapshot.notices.filter((x) => !x.orderId || ids.has(x.orderId)),
  };
}
export function execute(
  state: ServerState,
  actor: string,
  command: Command,
  now: number,
): ServerState {
  requireValue(command.key.trim().length > 0, "مفتاح العملية مطلوب.");
  requireValue(
    ["start", "deliver", "collect", "cash_exception", "report"].includes(
      command.type,
    ),
    "إجراء غير متاح للموصل.",
  );
  const payload = JSON.stringify(command);
  const receipt = state.receipts[command.key];
  if (receipt) {
    requireValue(
      receipt.actor === actor && receipt.payload === payload,
      "تعارض مفتاح العملية مع محتوى مختلف.",
    );
    // Replay is safe, but never restore an expired assignment's private data.
    return state;
  }
  const next: ServerState = clone(state);
  const task = next.tasks.find((x) => x.id === command.orderId);
  requireValue(
    task &&
      active(task, actor, now) &&
      task.assignmentId === command.assignmentId,
    "الإسناد غير متاح لهذا الحساب؛ امسح النسخة وأعد التحديث.",
  );
  requireValue(
    task.version === command.expectedVersion,
    "تغير الطلب؛ حدّث البيانات قبل إجراء جديد.",
  );
  if (command.type === "start") {
    requireValue(
      task.status === "confirmed",
      "بدء التوصيل متاح للطلب المؤكد فقط.",
    );
    task.status = "on_the_way";
    task.startedAt = now;
  } else if (command.type === "deliver") {
    requireValue(
      task.status === "on_the_way",
      "ابدأ التوصيل أولًا؛ لا تكرار للتسليم.",
    );
    const actual = collected(next.cash, task.id);
    requireValue(
      task.paymentKind !== "cash_on_delivery" ||
        actual === task.total ||
        next.exceptions.some(
          (x) =>
            x.orderId === task.id &&
            x.assignmentId === task.assignmentId &&
            x.collected === actual &&
            x.expected === task.total,
        ),
      "سجل النقد الحقيقي أو الاستثناء قبل التسليم.",
    );
    task.status = "delivered";
    task.deliveredAt = now;
    if (
      task.commission > 0 &&
      !next.earnings.some((x) => x.orderId === task.id)
    ) {
      next.earnings.push({
        id: `earning-${task.id}`,
        orderId: task.id,
        courierId: actor,
        number: task.number,
        base: task.feeBefore,
        discount: task.discount,
        bps: task.bps,
        amount: task.commission,
        at: now,
      });
    }
  } else if (command.type === "collect") {
    requireValue(
      task.status === "on_the_way" && task.paymentKind === "cash_on_delivery",
      "تسجيل النقد لطلب نقدي في الطريق فقط.",
    );
    requireValue(
      Number.isSafeInteger(command.amount) &&
        command.amount > 0 &&
        command.amount <= 100_000_000,
      "أدخل مبلغًا صحيحًا موجبًا بالريال.",
    );
    requireValue(command.reference.trim().length >= 3, "مرجع التحصيل مطلوب.");
    requireValue(
      !next.cash.some((x) => x.orderId === task.id),
      "التحصيل مسجل؛ التصحيح بقيد لدى الإدارة، دون استبدال الأصل.",
    );
    requireValue(
      !next.cash.some(
        (x) =>
          x.courierId === actor &&
          x.reference.trim() === command.reference.trim(),
      ),
      "مرجع التحصيل مستخدم.",
    );
    next.cash.push({
      id: `cash-${command.key}`,
      orderId: task.id,
      courierId: actor,
      assignmentId: task.assignmentId,
      amount: command.amount,
      reference: command.reference.trim(),
      at: now,
    });
  } else if (command.type === "cash_exception") {
    requireValue(
      task.status === "on_the_way" && task.paymentKind === "cash_on_delivery",
      "الاستثناء لطلب نقدي في الطريق فقط.",
    );
    const actual = collected(next.cash, task.id);
    requireValue(actual !== task.total, "النقد مطابق؛ لا استثناء مالي.");
    requireValue(
      command.reason.trim().length >= 8,
      "وضح سبب الاستثناء في 8 أحرف على الأقل.",
    );
    requireValue(
      !next.exceptions.some(
        (x) => x.orderId === task.id && x.collected === actual,
      ),
      "الاستثناء مسجل بالفعل.",
    );
    next.exceptions.push({
      id: `exception-${command.key}`,
      orderId: task.id,
      courierId: actor,
      assignmentId: task.assignmentId,
      expected: task.total,
      collected: actual,
      amount: Math.abs(task.total - actual),
      kind:
        actual === 0
          ? "cash_uncollected"
          : actual < task.total
            ? "cash_shortfall"
            : "overpayment",
      reason: command.reason.trim(),
      at: now,
    });
  } else if (command.type === "report") {
    requireValue(
      command.reason.trim().length >= 3 && command.details.trim().length >= 8,
      "اختر سببًا واكتب تفاصيل البلاغ في 8 أحرف على الأقل.",
    );
    requireValue(
      !command.image ||
        /^(data:image\/|file:|blob:|https?:\/\/localhost)/.test(command.image),
      "صورة محلية فقط في المعاينة.",
    );
    next.reports.push({
      id: `report-${command.key}`,
      orderId: task.id,
      courierId: actor,
      kind: command.kind,
      reason: command.reason.trim(),
      details: command.details.trim(),
      image: command.image,
      status: "open",
      at: now,
    });
  }
  task.version++;
  next.receipts[command.key] = { payload, actor };
  return next;
}
export function finances(
  state: Pick<Snapshot, "earnings" | "settlements" | "cash" | "remittances">,
  day: string,
) {
  const sum = (xs: { amount: number }[]) =>
    xs.reduce((n, x) => n + x.amount, 0);
  const daily = state.earnings.filter(
    (x) => new Date(x.at).toISOString().slice(0, 10) === day,
  );
  const earned = sum(state.earnings);
  const paid = sum(state.settlements.filter((x) => !x.reversal));
  const cash = sum(state.cash);
  const remitted = sum(state.remittances.filter((x) => !x.reversal));
  return {
    daily: sum(daily),
    earned,
    paid,
    unpaid: earned - paid,
    cash,
    remitted,
    outstanding: cash - remitted,
  };
}
export function earningPaid(
  state: Pick<Snapshot, "settlements">,
  earning: Earning,
) {
  return state.settlements.some(
    (x) => !x.reversal && x.earningIds.includes(earning.id),
  );
}
export function externalLinks(task: Task) {
  requireValue(
    Number.isFinite(task.address.latitude) &&
      Math.abs(task.address.latitude) <= 90 &&
      Number.isFinite(task.address.longitude) &&
      Math.abs(task.address.longitude) <= 180,
    "إحداثيات غير صالحة.",
  );
  requireValue(/^7\d{8}$/.test(task.phone), "رقم غير صالح.");
  const phone = `967${task.phone}`;
  return {
    call: `tel:+${phone}`,
    whatsapp: `https://wa.me/${phone}?text=${encodeURIComponent(`بخصوص طلب تزويد ${task.number}`)}`,
    navigation: `https://www.google.com/maps/dir/?api=1&destination=${task.address.latitude},${task.address.longitude}&travelmode=driving`,
  };
}
