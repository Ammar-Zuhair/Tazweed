import {
  permissionNames,
  type AdminState,
  type Permission,
  type Staff,
  type Command,
  type Order,
  type Quote,
  type LedgerSource,
  type Product,
  type Line,
  type Promotion,
} from "./types";
import { receiptOutcomes, stockModes } from "./labels";
export const globalOnly: Permission[] = [
  "catalog.write",
  "attributes.write",
  "branches.write",
  "staff.manage",
  "maintenance.write",
  "releases.write",
  "notifications.broadcast",
  "promotions.write",
  "payment-methods.write",
];
export function need(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export const integer = (
  value: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) => Number.isSafeInteger(value) && value >= min && value <= max;
export const text = (value: string) => value.trim().length > 0;
export const currentQuote = (o: Order) => o.quotes.at(-1);
export const money = (n: number) => `${n.toLocaleString("en-US")} ر.ي`;
export const commission = (base: number, bps: number) =>
  Number((BigInt(base) * BigInt(bps) + 5000n) / 10000n);
export function actor(s: AdminState): Staff | undefined {
  return s.staff.find((x) => x.id === s.session && x.active);
}
export function can(
  s: AdminState,
  permission: Permission,
  branchId: string | null = s.selectedBranch,
) {
  const a = actor(s);
  if (!a) return false;
  return a.grants.some(
    (g) =>
      (g.branchId === null ||
        (!globalOnly.includes(permission) && g.branchId === branchId)) &&
      s.roles.find((r) => r.id === g.roleId)?.permissions.includes(permission),
  );
}
export function accessibleBranches(s: AdminState) {
  const a = actor(s);
  return s.branches.filter((b) =>
    a?.grants.some((g) => g.branchId === null || g.branchId === b.id),
  );
}
export function visibleOrders(s: AdminState) {
  return s.orders.filter(
    (o) =>
      can(s, "orders.review", o.branchId ?? o.catalogBranchId) &&
      (!s.selectedBranch ||
        (o.branchId ?? o.catalogBranchId) === s.selectedBranch),
  );
}
export function clientFlags(s: AdminState, o: Order) {
  const flags = s.complaints.filter(
    (f) =>
      f.type === "flag" &&
      s.orders.find((p) => p.id === f.orderId)?.customerId === o.customerId,
  );
  return {
    hasFlags: flags.length > 0,
    details: flags.filter((f) => {
      const previous = s.orders.find((p) => p.id === f.orderId)!;
      return (
        can(s, "customer-flags.read", o.branchId ?? o.catalogBranchId) &&
        can(
          s,
          "customer-flags.read",
          previous.branchId ?? previous.catalogBranchId,
        )
      );
    }),
  };
}
export function totalPieces(items: Line[]) {
  const totals: Record<string, number> = {};
  for (const i of items)
    totals[i.productId] = (totals[i.productId] ?? 0) + i.quantity * i.pieces;
  return totals;
}
export function unitPrice(p: Product, branchId: string, unitId: string) {
  const u = p.units.find((x) => x.id === unitId);
  need(u, "وحدة غير موجودة");
  return p.branchPrices[branchId]?.[unitId] ?? u.price;
}
export function productReady(s: AdminState, p: Product) {
  const cat = s.categories.find((c) => c.id === p.categoryId && c.active);
  return (
    p.active &&
    !!cat &&
    cat.attributes.every((link) => {
      const a = s.attributes.find((a) => a.id === link.attributeId && a.active);
      const value = p.values[link.attributeId];
      return (
        !!a &&
        (!link.required || !!value) &&
        (!value || a.values.some((v) => v.id === value && v.active))
      );
    })
  );
}
export function bestPromotion(
  s: AdminState,
  branchId: string,
  items: Line[],
  delivery: number,
  kind: Order["kind"],
) {
  if (kind === "wholesale")
    return { id: null, productDiscount: 0, deliveryDiscount: 0 };
  const eligible = s.promotions.filter(
    (p) =>
      p.active &&
      p.startsAt <= s.now &&
      p.endsAt > s.now &&
      (!p.branchId || p.branchId === branchId),
  );
  const savings = eligible
    .map((p) => {
      const subtotal = items
        .filter(
          (i) =>
            (!p.productId || p.productId === i.productId) &&
            (!p.categoryId ||
              s.products.find((x) => x.id === i.productId)?.categoryId ===
                p.categoryId),
        )
        .reduce((n, i) => n + i.quantity * i.price, 0);
      const hasTarget = items.some(
        (i) =>
          (!p.productId || p.productId === i.productId) &&
          (!p.categoryId ||
            s.products.find((x) => x.id === i.productId)?.categoryId ===
              p.categoryId),
      );
      const base =
        p.target === "delivery" ? (hasTarget ? delivery : 0) : subtotal;
      const saving = Math.min(
        base,
        p.discountKind === "fixed"
          ? p.value
          : Math.round((base * p.value) / 10000),
      );
      return { p, saving };
    })
    .filter((x) => x.saving > 0)
    .sort((a, b) => b.saving - a.saving || a.p.id.localeCompare(b.p.id));
  const pick = savings[0];
  return {
    id: pick?.p.id ?? null,
    productDiscount: pick?.p.target === "products" ? pick.saving : 0,
    deliveryDiscount: pick?.p.target === "delivery" ? pick.saving : 0,
  };
}
export function availableSources(
  s: AdminState,
  kind: "commission" | "cash",
  courierId: string,
): (LedgerSource & { branchIds?: string[] })[] {
  const records = kind === "commission" ? s.earnings : s.cash;
  const reversals =
    kind === "commission" ? s.commissionReversals : s.cashReversals;
  const payouts = kind === "commission" ? s.settlements : s.remittances;
  const used = new Set(payouts.flatMap((p) => p.sourceIds));
  const permission =
    kind === "commission" ? "commissions.settle" : "cash.remit";
  const originals = records.filter(
    (r) =>
      r.courierId === courierId &&
      !used.has(r.id) &&
      can(s, permission, r.branchId),
  );
  const credits = reversals
    .filter(
      (r) =>
        r.courierId === courierId &&
        !used.has(r.id) &&
        r.branchIds.every((b) => can(s, permission, b)),
    )
    .map((r) => ({
      id: r.id,
      courierId,
      branchId: r.branchIds[0]!,
      orderId: "credit",
      branchIds: r.branchIds,
      amount: r.amount,
      at: r.at,
      reference: `رصيد عكس ${r.payoutId}`,
    }));
  return [...originals, ...credits];
}
export function netApproved(s: AdminState, o: Order) {
  return (
    o.payments.reduce((n, p) => n + (p.approved ?? 0), 0) +
    s.exceptions
      .filter((e) => e.orderId === o.id)
      .reduce(
        (n, e) =>
          n +
          (e.resolution?.direction === "received"
            ? e.resolution.amount
            : e.resolution?.direction === "refund"
              ? -e.resolution.amount
              : 0),
        0,
      )
  );
}
export function transition(
  input: AdminState,
  command: Command,
  now = input.now,
): { state: AdminState; message: string } {
  // Each failure discards the clone. This is a local preview, not a DB transaction/RBAC service.
  const s: AdminState = JSON.parse(JSON.stringify(input));
  s.now = Math.max(now, input.now);
  const id = (prefix: string) => `${prefix}-${++s.counter}`;
  const requirePermission = (
    p: Permission,
    b: string | null = s.selectedBranch,
  ) =>
    need(can(s, p, b), `لا تملك صلاحية ${permissionNames[p]} في هذا النطاق.`);
  const confirmed = (yes: boolean) =>
    need(yes, "يلزم التأكيد الإضافي للعملية.");
  const upsert = <T extends { id: string }>(list: T[], v: T) => {
    const index = list.findIndex((x) => x.id === v.id);
    if (index < 0) list.push(v);
    else list[index] = v;
  };
  const order = (orderId: string, p: Permission) => {
    const o = s.orders.find((x) => x.id === orderId);
    need(o, "الطلب غير موجود.");
    requirePermission(p, o.branchId ?? o.catalogBranchId);
    return o;
  };
  const pending = (o: Order) =>
    need(
      o.status === "pending_review",
      "الطلب المؤكد أو المغلق ثابت ولا يقبل هذا الإجراء.",
    );
  const quote = (o: Order) => {
    const q = currentQuote(o);
    need(q, "أصدر تسعيرة أولًا.");
    return q;
  };
  const event = (o: Order, label: string) => {
    o.events.push({ at: s.now, text: label });
    o.version++;
  };
  const level = (b: string, p: string) => {
    let x = s.stock.find((v) => v.branchId === b && v.productId === p);
    if (!x) {
      x = { branchId: b, productId: p, onHand: 0, reserved: 0 };
      s.stock.push(x);
    }
    return x;
  };
  const release = (o: Order, state: "released" | "expired" = "released") => {
    for (const r of s.reservations.filter(
      (x) => x.orderId === o.id && x.state === "active",
    )) {
      level(r.branchId, r.productId).reserved -= r.pieces;
      r.state = state;
    }
  };
  const reserve = (o: Order, q: Quote) => {
    for (const [p, n] of Object.entries(totalPieces(q.items))) {
      const x = level(q.branchId, p);
      need(
        x.onHand - x.reserved >= n,
        "المخزون الحر لا يكفي؛ لا تصدر عرضًا بحجز غير متاح.",
      );
      x.reserved += n;
      s.reservations.push({
        id: id("hold"),
        orderId: o.id,
        quoteId: q.id,
        branchId: q.branchId,
        productId: p,
        pieces: n,
        state: "active",
        kind: "timed",
        expiresAt: s.now + s.settings.holdMinutes * 60000,
      });
    }
  };
  const exception = (
    o: Order,
    kind: AdminState["exceptions"][number]["kind"],
    amount: number,
    reason: string,
  ) =>
    s.exceptions.push({
      id: id("exception"),
      orderId: o.id,
      kind,
      amount,
      reason,
      at: s.now,
    });
  const requireMeta = (v: {
    reason: string;
    reference: string;
    proof: string;
  }) =>
    need(
      text(v.reason) && text(v.reference) && text(v.proof),
      "السبب والمرجع والإثبات المحلي مطلوبة.",
    );
  const audit = (summary: string, branchId: string | null = s.selectedBranch) =>
    s.audit.push({
      id: id("audit"),
      actor: actor(s)?.name ?? "دخول تجريبي",
      action: command.type,
      branchId,
      summary,
      at: s.now,
    });
  const expireTimed = () => {
    for (const r of s.reservations) {
      if (
        r.state === "active" &&
        r.kind === "timed" &&
        (r.expiresAt ?? Infinity) <= s.now
      ) {
        level(r.branchId, r.productId).reserved -= r.pieces;
        r.state = "expired";
      }
    }
  };
  let message = "حفظت التغييرات محليًا.";
  switch (command.type) {
    case "clock":
      expireTimed();
      message = "";
      break;
    case "login": {
      need(!s.session, "سجل الخروج أولًا.");
      const phone = command.phone.replace(/^\+967/, "");
      const a = s.staff.find((x) => x.phone === phone && x.active);
      need(
        a && command.password === "Tazweed123!",
        "تعذر الدخول. تحقق من بيانات حساب الاختبار.",
      );
      s.challenge = {
        staffId: a.id,
        attempts: 0,
        expiresAt: s.now + 300000,
        resendAt: s.now + 60000,
      };
      message = "تحدي محلي فقط. رمز المعاينة 000000؛ لا SMS.";
      break;
    }
    case "otp": {
      const c = s.challenge;
      need(c, "اطلب رمز الاختبار أولًا.");
      need(
        s.now < c.expiresAt && c.attempts < 5,
        "انتهى التحدي أو نفدت5 محاولات. أعد طلب الرمز.",
      );
      if (command.code !== "000000") {
        c.attempts++;
        return {
          state: s,
          message: `رمز غير صحيح. المتبقي ${5 - c.attempts}.`,
        };
      }
      const a = s.staff.find((x) => x.id === c.staffId && x.active);
      need(a, "الحساب غير متاح.");
      s.session = a.id;
      s.challenge = null;
      s.selectedBranch = a.grants.some((g) => g.branchId === null)
        ? null
        : (a.grants[0]?.branchId ?? null);
      audit("اكتمال دخول اختبار دون جلسة خادم");
      message = "مرحبًا بك في إدارة تزويد التجريبية.";
      break;
    }
    case "resend": {
      need(s.challenge, "لا تحدي قائم.");
      need(s.now >= s.challenge.resendAt, "انتظر مهلة إعادة الإرسال60ث.");
      s.challenge = {
        ...s.challenge,
        attempts: 0,
        expiresAt: s.now + 300000,
        resendAt: s.now + 60000,
      };
      message = "أعيد إنشاء تحدي محلي؛ لم ترسل رسالة.";
      break;
    }
    case "logout":
      s.session = null;
      s.challenge = null;
      s.selectedBranch = null;
      message = "خرجت من جلسة المعاينة.";
      break;
    case "scope":
      need(actor(s), "سجل الدخول.");
      need(
        command.branchId === null
          ? actor(s)!.grants.some((g) => g.branchId === null)
          : accessibleBranches(s).some((b) => b.id === command.branchId),
        "الفرع خارج نطاقك.",
      );
      s.selectedBranch = command.branchId;
      message = "تم تغيير نطاق العرض.";
      break;
    case "attribute": {
      requirePermission("attributes.write", null);
      const v = command.value;
      need(
        text(v.name) && /^[a-z][a-z0-9_]*$/.test(v.code),
        "اسم الخاصية ومفتاح إنجليزي صغير مطلوبان.",
      );
      need(
        !s.attributes.some((x) => x.id !== v.id && x.code === v.code),
        "المفتاح مستخدم.",
      );
      need(
        !s.attributes.some((x) => x.id === v.id && x.code !== v.code),
        "مفتاح الخاصية ثابت؛ أنشئ خاصية بديلة.",
      );
      need(
        v.values.every((x) => text(x.name) && integer(x.order)) &&
          new Set(v.values.map((x) => x.name.trim())).size === v.values.length,
        "قيم الخاصية غير فارغة وفريدة وترتيبها صحيح.",
      );
      const old = s.attributes.find((x) => x.id === v.id);
      if (old)
        need(
          old.values.every((x) => v.values.some((y) => y.id === x.id)),
          "أوقف القيمة بدل حذف تاريخها.",
        );
      upsert(s.attributes, v);
      audit(`حفظ خاصية ${v.name}`);
      break;
    }
    case "category": {
      requirePermission("catalog.write", null);
      const v = command.value;
      need(text(v.name) && integer(v.order), "الاسم والترتيب مطلوبان.");
      let parent = v.parentId;
      const seen = new Set([v.id]);
      while (parent) {
        need(!seen.has(parent), "لا يسمح بدورة أقسام.");
        seen.add(parent);
        const p = s.categories.find((x) => x.id === parent);
        need(p, "قسم أب غير موجود.");
        parent = p.parentId;
      }
      need(
        new Set(v.attributes.map((x) => x.attributeId)).size ===
          v.attributes.length,
        "الخاصية مرتبطة مرة واحدة فقط.",
      );
      need(
        v.attributes.every(
          (a) =>
            s.attributes.some((x) => x.id === a.attributeId && x.active) &&
            integer(a.order),
        ),
        "الخصائص نشطة والترتيب صحيح.",
      );
      upsert(s.categories, v);
      audit(`حفظ قسم وفلاتره: ${v.name}`);
      break;
    }
    case "product": {
      requirePermission("catalog.write", null);
      const v = command.value;
      need(
        text(v.name) && text(v.sku) && text(v.description) && text(v.origin),
        "الاسم وSKU والوصف والمنشأ مطلوبة.",
      );
      need(
        !s.products.some(
          (p) => p.id !== v.id && p.sku.toLowerCase() === v.sku.toLowerCase(),
        ),
        "SKU مستخدم.",
      );
      const cat = s.categories.find((c) => c.id === v.categoryId && c.active);
      need(cat, "اختر قسمًا نشطًا.");
      for (const link of cat.attributes) {
        const a = s.attributes.find(
          (x) => x.id === link.attributeId && x.active,
        );
        need(a, "خاصية القسم غير نشطة.");
        const selected = v.values[a.id];
        need(!link.required || selected, "اختر كل الخصائص المطلوبة.");
        if (selected)
          need(
            a.values.some((x) => x.id === selected && x.active),
            "اختر قيمة نشطة مسجلة للخاصية.",
          );
      }
      need(
        Object.keys(v.values).every((k) =>
          cat.attributes.some((a) => a.attributeId === k),
        ),
        "الخاصية ليست مرتبطة بقسم المنتج.",
      );
      need(
        v.images.length >= 1 && v.images.length <= 3,
        "أضف1–3 رسوم محلية للمعاينة.",
      );
      need(
        v.units.length > 0 &&
          v.units.some((u) => u.kind === "piece" && u.active),
        "وحدة حبة نشطة مطلوبة.",
      );
      need(
        new Set(v.units.map((u) => u.id)).size === v.units.length,
        "معرف وحدة مكرر.",
      );
      for (const u of v.units) {
        need(
          integer(u.price) &&
            integer(u.pieces, 1) &&
            (u.kind === "piece" ? u.pieces === 1 : u.pieces > 1),
          "تحويل الوحدة وسعرها صحيحان؛ الحبة1 والكرتون أكبر من1.",
        );
        const old = s.products
          .find((p) => p.id === v.id)
          ?.units.find((x) => x.id === u.id);
        if (old?.used)
          need(
            u.pieces === old.pieces && u.kind === old.kind && u.used,
            "وحدة مستخدمة: أرشفها وأنشئ بديلًا؛ معاملها ثابت.",
          );
      }
      const old = s.products.find((p) => p.id === v.id);
      if (old)
        need(old.sku === v.sku, "SKU ثابت؛ أنشئ منتجًا آخر للعبوة المختلفة.");
      need(
        !v.units.some((u) =>
          s.products.some(
            (p) => p.id !== v.id && p.units.some((x) => x.id === u.id),
          ),
        ),
        "الوحدة ملك منتج آخر.",
      );
      if (old)
        need(
          old.units
            .filter((u) => u.used)
            .every((u) => v.units.some((x) => x.id === u.id)),
          "لا تحذف وحدة مستخدمة.",
        );
      for (const [b, prices] of Object.entries(v.branchPrices)) {
        need(
          s.branches.some((x) => x.id === b),
          "فرع سعر غير موجود.",
        );
        for (const [unit, n] of Object.entries(prices))
          need(
            v.units.some((u) => u.id === unit) && integer(n),
            "سعر الفرع ووحدته غير صالحين.",
          );
      }
      upsert(s.products, v);
      audit(`حفظ المنتج ${v.sku}`);
      break;
    }
    case "province": {
      requirePermission("branches.write", null);
      const v = command.value;
      need(text(v.name) && integer(v.order), "اسم المحافظة وترتيبها مطلوبان.");
      need(
        !s.provinces.some(
          (p) => p.id !== v.id && p.name.trim() === v.name.trim(),
        ),
        "اسم المحافظة مكرر.",
      );
      need(
        !v.catalogBranchId ||
          s.branches.some(
            (b) =>
              b.id === v.catalogBranchId && b.provinceId === v.id && b.active,
          ),
        "فرع الكتالوج يجب أن يكون نشطًا من المحافظة نفسها.",
      );
      upsert(s.provinces, v);
      audit(`حفظ محافظة ${v.name}`);
      break;
    }
    case "branch": {
      requirePermission("branches.write", null);
      const v = command.value;
      need(
        text(v.name) && s.provinces.some((p) => p.id === v.provinceId),
        "اسم الفرع ومحافظته مطلوبان.",
      );
      need(
        Number.isFinite(v.latitude) &&
          Math.abs(v.latitude) <= 90 &&
          Number.isFinite(v.longitude) &&
          Math.abs(v.longitude) <= 180,
        "إحداثيات غير صالحة.",
      );
      need(
        integer(v.base) &&
          integer(v.perKm) &&
          integer(v.coverage) &&
          integer(v.maxDistance),
        "التعرفة والتغطية أعداد صحيحة غير سالبة.",
      );
      need(
        !v.deliveryEnabled || (v.coverage > 0 && v.maxDistance > 0),
        "حدد النطاق وحد الطريق قبل تفعيل التوصيل.",
      );
      need(
        !v.active ||
          !s.branches.some(
            (b) => b.id !== v.id && b.provinceId === v.provinceId && b.active,
          ),
        "المعتمد حاليًا فرع نشط واحد لكل محافظة.",
      );
      need(
        !s.provinces.some(
          (p) => p.catalogBranchId === v.id && p.id !== v.provinceId,
        ),
        "انقل مؤشر كتالوج المحافظة أولًا؛ الفرع مرتبط بمحافظته.",
      );
      upsert(s.branches, v);
      audit(`حفظ فرع وتعرفة floor_km: ${v.name}`);
      break;
    }
    case "stock": {
      const c = command;
      requirePermission(
        c.mode === "transfer" ? "inventory.transfer" : "inventory.adjust",
        c.branchId,
      );
      confirmed(c.confirmed);
      need(text(c.reason), "سبب الحركة مطلوب.");
      need(
        s.products.some((p) => p.id === c.productId) &&
          s.branches.some((b) => b.id === c.branchId && b.active),
        "منتج أو فرع غير صالح.",
      );
      need(
        integer(c.pieces, c.mode === "adjust" ? -Number.MAX_SAFE_INTEGER : 0),
        "كمية صحيحة مطلوبة.",
      );
      const from = level(c.branchId, c.productId);
      const delta =
        c.mode === "count"
          ? c.pieces - from.onHand
          : c.mode === "transfer"
            ? -c.pieces
            : c.pieces;
      need(delta !== 0, "الحركة بلا تغيير.");
      need(
        from.onHand + delta >= from.reserved,
        "لا يمكن المساس بالمخزون المحجوز أو جعل الرصيد سالبًا.",
      );
      let transferId: string | undefined;
      if (c.mode === "transfer") {
        need(
          c.toBranchId &&
            c.toBranchId !== c.branchId &&
            s.branches.some((b) => b.id === c.toBranchId && b.active),
          "اختر فرعًا آخر نشطًا.",
        );
        requirePermission("inventory.transfer", c.toBranchId);
        transferId = id("transfer");
        level(c.toBranchId, c.productId).onHand += c.pieces;
        s.movements.push({
          id: id("move"),
          branchId: c.toBranchId,
          productId: c.productId,
          delta: c.pieces,
          reason: c.reason,
          at: s.now,
          actor: actor(s)!.id,
          transferId,
        });
      }
      from.onHand += delta;
      s.movements.push({
        id: id("move"),
        branchId: c.branchId,
        productId: c.productId,
        delta,
        reason: c.reason,
        at: s.now,
        actor: actor(s)!.id,
        transferId,
      });
      audit(
        `حركة ${stockModes[c.mode]}: ${delta} حبة — ${c.reason}`,
        c.branchId,
      );
      break;
    }
    case "quote": {
      const c = command,
        o = order(c.orderId, "orders.reprice");
      pending(o);
      confirmed(c.confirmed);
      need(
        o.version === c.expectedVersion,
        "تغير الطلب؛ حدث الصفحة قبل إصدار نسخة.",
      );
      requirePermission("orders.reprice", c.branchId);
      need(text(c.reason), "سبب إصدار النسخة مطلوب.");
      need(
        !s.exceptions.some((e) => e.orderId === o.id && !e.resolution),
        "عالج الاستثناء المالي قبل إصدار نسخة جديدة.",
      );
      need(
        !s.reservations.some(
          (r) =>
            r.orderId === o.id &&
            r.state === "active" &&
            r.kind === "receipt_review",
        ),
        "الإيصال يحمي العرض؛ راجع المال والحجز صراحة قبل نسخة جديدة.",
      );
      const b = s.branches.find(
        (x) => x.id === c.branchId && x.active && x.deliveryEnabled,
      );
      need(
        b && s.provinces.some((p) => p.id === b.provinceId && p.active),
        "فرع ومحافظة نشطان بتغطية وتعرفة لازمان.",
      );
      need(
        c.prices.length === o.items.length && c.prices.every((n) => integer(n)),
        "أسعار كل البنود مطلوبة.",
      );
      const items = o.items.map((i, index) => {
        const p = s.products.find((x) => x.id === i.productId && x.active);
        need(
          p && productReady(s, p),
          "المنتج أو خصائصه المطلوبة غير جاهزة؛ أكمل الكتالوج.",
        );
        const u = p.units.find((x) => x.id === i.unitId && x.active);
        need(u, "وحدة غير نشطة.");
        return {
          ...i,
          price: c.prices[index]!,
          sourcePrice: unitPrice(p, b.id, u.id),
          pieces: u.pieces,
        };
      });
      const distance = c.deliveryMode === "road" ? 2800 : null;
      need(
        distance === null || distance <= b.maxDistance,
        "الطريق التجريبي يتجاوز حد الفرع.",
      );
      const delivery =
        distance === null
          ? c.manualDelivery
          : b.base + Math.floor(distance / 1000) * b.perKm;
      need(integer(delivery), "رسوم توصيل غير صالحة.");
      release(o);
      const promo = bestPromotion(s, b.id, items, delivery, o.kind);
      const subtotal = items.reduce((n, i) => n + i.quantity * i.price, 0);
      need(
        integer(subtotal) && integer(subtotal + delivery),
        "المبلغ تجاوز حد المعاينة الآمن.",
      );
      const previous = currentQuote(o);
      if (previous) previous.status = "superseded";
      const q: Quote = {
        id: id("quote"),
        revision: o.quotes.length + 1,
        branchId: b.id,
        items,
        subtotal,
        delivery,
        deliveryDiscount: promo.deliveryDiscount,
        productDiscount: promo.productDiscount,
        total:
          subtotal + delivery - promo.deliveryDiscount - promo.productDiscount,
        pricingMode: c.deliveryMode,
        distance,
        base: b.base,
        perKm: b.perKm,
        reason: c.reason,
        promotionId: promo.id,
        status: "sent",
        createdAt: s.now,
        expiresAt: s.now + s.settings.holdMinutes * 60000,
      };
      o.quotes.push(q);
      o.branchId = b.id;
      reserve(o, q);
      for (const i of items)
        s.products
          .find((p) => p.id === i.productId)!
          .units.find((u) => u.id === i.unitId)!.used = true;
      event(o, `إصدار النسخة${q.revision} من ${b.name}؛ تنتظر قبول العميل`);
      audit(`إصدار نسخة ${o.id}/${q.revision}`, b.id);
      message =
        "أرسلت نسخة تجريبية جديدة؛ الموافقة السابقة محفوظة ولا تكفي لها.";
      break;
    }
    case "preview-accept": {
      const o = order(command.orderId, "orders.review");
      pending(o);
      const q = quote(o);
      need(
        q.status === "sent" && q.expiresAt > s.now,
        "لا يمكن قبول عرض قديم أو منتهٍ.",
      );
      q.status = "accepted";
      q.acceptedAt = s.now;
      q.acceptedBy = o.customerId;
      o.paymentKind = command.paymentKind;
      event(o, "محاكاة قبول العميل آخر نسخة واختيار الدفع");
      message = "حدث عميل محلي؛ لا ربط بتطبيق العميل.";
      break;
    }
    case "preview-instructions": {
      const o = order(command.orderId, "payments.verify");
      pending(o);
      const q = quote(o);
      need(
        q.status === "accepted" && o.paymentKind === "transfer" && q.total > 0,
        "يلزم عرض تحويل مقبول بمبلغ موجب.",
      );
      const method = s.methods.find(
        (m) =>
          m.id === command.methodId &&
          m.active &&
          (!m.branchId || m.branchId === o.branchId),
      );
      need(method, "وسيلة غير متاحة للفرع.");
      if (
        !o.instructions.some(
          (i) => i.quoteId === q.id && i.methodId === method.id,
        )
      ) {
        o.instructions.push({
          id: id("instruction"),
          quoteId: q.id,
          methodId: method.id,
          at: s.now,
          snapshot: {
            method: method.name,
            beneficiary: method.beneficiary,
            destination: method.destination,
            amount: q.total,
          },
        });
        event(o, "تثبيت تعليمات التحويل قبل عرضها ورفع الإيصال");
      }
      message = "ثبتت تعليمات غير قابلة للدفع قبل عرضها؛ لا تحويل فعلي.";
      break;
    }
    case "preview-receipt": {
      const c = command,
        o = order(c.orderId, "payments.verify");
      pending(o);
      const q = quote(o);
      need(
        q.status === "accepted" && o.paymentKind === "transfer",
        "يلزم قبول آخر عرض واختيار التحويل.",
      );
      need(
        text(c.number) && integer(c.amount, 1),
        "رقم التحويل ومبلغه مطلوبان.",
      );
      const method = s.methods.find(
        (m) =>
          m.id === c.methodId &&
          m.active &&
          (!m.branchId || m.branchId === o.branchId),
      );
      need(method, "وسيلة غير متاحة للفرع.");
      const instruction = o.instructions.find(
        (i) => i.quoteId === q.id && i.methodId === method.id,
      );
      need(instruction, "ثبت تعليمات التحويل قبل عرضها ورفع الإيصال.");
      const number = c.number.replace(/\s/g, "").toUpperCase();
      need(
        !s.orders.some(
          (x) =>
            x.id !== o.id &&
            x.payments.some(
              (p) => p.methodId === method.id && p.number === number,
            ),
        ),
        "تحذير تكرار: رقم التحويل مسجل لطلب آخر.",
      );
      let payment = o.payments.find(
        (p) => p.methodId === method.id && p.number === number,
      );
      if (payment) {
        need(
          !payment.approved &&
            payment.quoteId === q.id &&
            payment.reported === c.amount,
          "المعاملة معتمدة أو بياناتها ثابتة؛ لا تحول إعادة الصورة إلى مال جديد.",
        );
        need(
          payment.attempts.at(-1)?.review?.outcome === "image_rejected",
          "انتظر مراجعة آخر محاولة قبل صورة جديدة.",
        );
      } else {
        need(
          !o.payments.some(
            (p) =>
              !p.approved &&
              p.attempts.at(-1)?.review?.outcome !== "transfer_rejected",
          ),
          "راجع التحويل القائم أولًا.",
        );
        payment = {
          id: id("payment"),
          instructionId: instruction.id,
          quoteId: q.id,
          methodId: method.id,
          number,
          reported: c.amount,
          instructions: { ...instruction.snapshot },
          attempts: [],
        };
        o.payments.push(payment);
      }
      payment.attempts.push({
        id: id("receipt"),
        submittedAt: s.now,
        image: `رسم إيصال تجريبي ${payment.attempts.length + 1}`,
      });
      const active = s.reservations.filter(
        (r) => r.orderId === o.id && r.quoteId === q.id && r.state === "active",
      );
      if (
        !active.length ||
        active.some((r) => r.expiresAt !== null && r.expiresAt <= s.now)
      ) {
        release(o);
        exception(
          o,
          "late_transfer",
          c.amount,
          "وصول تحويل تجريبي بعد انتهاء الحجز",
        );
      } else
        for (const r of active) {
          r.kind = "receipt_review";
          r.expiresAt = null;
          r.protectedAt ??= s.now;
        }
      event(o, "محاولة إيصال لنفس التحويل — لا دفعة أو حجز إضافي");
      break;
    }
    case "receipt-review": {
      const c = command,
        o = order(c.orderId, "payments.verify");
      pending(o);
      confirmed(c.confirmed);
      need(text(c.reason), "سبب المراجعة مطلوب.");
      need(
        c.outcome === "image_rejected" || c.externalChecked,
        "تحقق خارجي مطلوب لاعتماد المال أو نفي وصول التحويل.",
      );
      const p = o.payments.at(-1),
        a = p?.attempts.at(-1);
      need(
        p && a && !a.review && !p.approved,
        "لا محاولة جديدة قابلة للمراجعة؛ لا اعتماد مكرر.",
      );
      if (c.outcome === "transfer_verified") {
        need(
          c.externalChecked,
          "يلزم تأكيد التحقق الخارجي؛ الصورة وحدها لا تثبت المال.",
        );
        need(integer(c.amount, 1), "المبلغ المتحقق منه مطلوب.");
        p.approved = c.amount;
        const total = quote(o).total;
        const net = netApproved(s, o);
        if (net !== total)
          exception(
            o,
            net > total ? "overpayment" : "underpayment",
            Math.abs(net - total),
            "مبلغ التحويل المتحقق لا يطابق العرض",
          );
      }
      a.review = {
        outcome: c.outcome,
        amount: c.outcome === "transfer_verified" ? c.amount : undefined,
        reason: c.reason,
        actor: actor(s)!.id,
        at: s.now,
        holdAction: c.holdAction,
      };
      if (c.holdAction === "release") {
        release(o);
        if (p.approved)
          exception(
            o,
            "stock_unavailable",
            p.approved,
            "تحرير حجز بعد تحقق المال؛ معالجة خارجية مطلوبة",
          );
      }
      event(
        o,
        `مراجعة الإيصال: ${receiptOutcomes[c.outcome]} / الحجز: ${c.holdAction === "keep" ? "إبقاء" : "تحرير صريح"}`,
      );
      audit(`مراجعة مالية ${o.id}`, o.branchId);
      message =
        c.holdAction === "keep"
          ? "المراجعة مسجلة؛ الحجز المحمي باقٍ بلا مهلة تحرير."
          : "سجل إجراء تحرير مسبب، دون محو المعاملة.";
      break;
    }
    case "revalidate": {
      const o = order(command.orderId, "orders.confirm");
      pending(o);
      confirmed(command.confirmed);
      const q = quote(o);
      need(
        o.paymentKind === "cash" &&
          q.status === "accepted" &&
          text(command.reason),
        "إعادة التحقق تخص عرضًا نقديًا مقبولًا وبسبب.",
      );
      need(
        !s.reservations.some(
          (r) =>
            r.orderId === o.id &&
            r.kind === "receipt_review" &&
            r.state === "active",
        ),
        "لا يعاد حجز إيصال محمي بالوقت.",
      );
      const liveBranch = s.branches.find(
        (b) => b.id === q.branchId && b.active && b.deliveryEnabled,
      );
      need(
        liveBranch &&
          (q.pricingMode === "manual" ||
            (liveBranch.base === q.base &&
              liveBranch.perKm === q.perKm &&
              (q.distance ?? 0) <= liveBranch.maxDistance)),
        "تغيرت تعرفة أو أهلية الفرع؛ أصدر نسخة جديدة.",
      );
      for (const i of q.items) {
        const p = s.products.find((x) => x.id === i.productId && x.active);
        need(
          p &&
            productReady(s, p) &&
            p.units.some((u) => u.id === i.unitId && u.active) &&
            unitPrice(p, q.branchId, i.unitId) === i.sourcePrice,
          "تغير السعر أو النشاط؛ أصدر نسخة جديدة وموافقة جديدة.",
        );
      }
      release(o);
      reserve(o, q);
      o.revalidations.push({
        quoteId: q.id,
        at: s.now,
        validUntil: s.now + s.settings.holdMinutes * 60000,
        reason: command.reason,
      });
      event(o, "إعادة تحقق وحجز نقدي لنفس الحقائق دون تغيير snapshot");
      audit(`إعادة تحقق ${o.id}`, o.branchId);
      break;
    }
    case "confirm": {
      const c = command,
        o = order(c.orderId, "orders.confirm");
      pending(o);
      confirmed(c.confirmed);
      need(o.version === c.expectedVersion, "الطلب تغير؛ أعد المراجعة.");
      const q = quote(o);
      need(
        q.status === "accepted" && o.branchId === q.branchId,
        "يجب قبول آخر نسخة وفرعها.",
      );
      const flags = s.complaints.some(
        (x) =>
          x.type === "flag" &&
          s.orders.find((t) => t.id === x.orderId)?.customerId === o.customerId,
      );
      need(
        !flags || c.flagAcknowledged,
        "يوجد تنبيه بلاغ سابق؛ راجعه قبل التأكيد. ليس حظرًا آليًا.",
      );
      need(
        !s.exceptions.some((e) => e.orderId === o.id && !e.resolution),
        "يوجد استثناء مالي مفتوح.",
      );
      if (o.paymentKind === "transfer")
        need(
          netApproved(s, o) === q.total,
          "صافي المال المعتمد لا يطابق آخر إجمالي مقبول.",
        );
      const holds = s.reservations.filter(
        (r) => r.orderId === o.id && r.quoteId === q.id && r.state === "active",
      );
      for (const [pid, n] of Object.entries(totalPieces(q.items))) {
        need(
          holds
            .filter((r) => r.productId === pid)
            .reduce((x, r) => x + r.pieces, 0) === n,
          "الحجز غير كافٍ؛ أعد التحقق.",
        );
      }
      need(
        holds.every(
          (r) => r.kind === "receipt_review" || (r.expiresAt ?? 0) > s.now,
        ),
        "الحجز النقدي منتهٍ؛ أعد التحقق قبل التأكيد.",
      );
      for (const r of holds) {
        const x = level(r.branchId, r.productId);
        x.reserved -= r.pieces;
        x.onHand -= r.pieces;
        need(x.onHand >= x.reserved && x.reserved >= 0, "رصيد غير صالح.");
        r.state = "consumed";
        s.movements.push({
          id: id("sale"),
          branchId: r.branchId,
          productId: r.productId,
          delta: -r.pieces,
          reason: `صرف الطلب ${o.id}`,
          at: s.now,
          actor: actor(s)!.id,
          orderId: o.id,
        });
      }
      o.flagAcknowledged = c.flagAcknowledged;
      o.status = "confirmed";
      o.confirmedAt = s.now;
      event(o, "تم التأكيد وصرف المخزون؛ ليس تحصيل نقد تلقائي");
      audit(`تأكيد ${o.id}`, o.branchId);
      break;
    }
    case "close-order": {
      const c = command,
        o = order(c.orderId, "orders.reject");
      pending(o);
      confirmed(c.confirmed);
      need(text(c.reason), "سبب الإغلاق مطلوب.");
      need(
        c.status !== "cancelled" || o.cancellationRequested,
        "لا طلب إلغاء من العميل.",
      );
      need(
        netApproved(s, o) === 0 &&
          !s.exceptions.some((e) => e.orderId === o.id && !e.resolution),
        "عالج المال والاستثناءات قبل الإغلاق.",
      );
      need(
        !o.payments.some(
          (p) =>
            !p.approved &&
            (!p.attempts.at(-1)?.review ||
              p.attempts.at(-1)?.review?.outcome === "image_rejected"),
        ),
        "تحقق من وصول المال؛ رفض الصورة ليس نفيًا للتحويل.",
      );
      release(o);
      o.status = c.status;
      event(o, `${c.status === "cancelled" ? "إلغاء" : "رفض"}: ${c.reason}`);
      audit(`إغلاق ${o.id}`, o.branchId);
      break;
    }
    case "assign": {
      const c = command,
        o = order(c.orderId, "orders.assign");
      confirmed(c.confirmed);
      need(
        o.status === "confirmed" && text(c.reason),
        "الإسناد بعد التأكيد وقبل الطريق فقط، مع سبب.",
      );
      const courier = s.couriers.find(
        (x) =>
          x.id === c.courierId && x.active && x.branchIds.includes(o.branchId!),
      );
      need(
        courier && courier.bps !== null,
        "موصل نشط ضمن الفرع ونسبة مضبوطة مطلوبان.",
      );
      const old = o.assignments.at(-1);
      need(old?.courierId !== courier.id || old.endedAt, "الموصل مسند بالفعل.");
      if (old) old.endedAt = s.now;
      const q = quote(o);
      o.assignments.push({
        id: id("assignment"),
        courierId: courier.id,
        at: s.now,
        base: q.delivery,
        discount: q.deliveryDiscount,
        bps: courier.bps,
        commission: commission(q.delivery, courier.bps),
      });
      event(o, `إسناد ${courier.name}: ${c.reason}`);
      audit(`إسناد ${o.id}`, o.branchId);
      break;
    }
    case "preview-courier": {
      const c = command,
        o = order(c.orderId, "orders.assign"),
        a = o.assignments.at(-1);
      need(a && !a.endedAt, "لا إسناد نشط.");
      if (c.stage === "on_the_way") {
        need(o.status === "confirmed", "بدء الطريق بعد التأكيد فقط.");
        o.status = "on_the_way";
      } else {
        need(o.status === "on_the_way", "التسليم بعد الطريق مرة واحدة.");
        if (o.paymentKind === "cash") {
          need(
            integer(c.collected) && text(c.reference),
            "سجل مبلغ التحصيل الفعلي ومرجعه؛ التسليم لا ينشئه تلقائيًا.",
          );
          if (c.collected > 0)
            s.cash.push({
              id: id("cash"),
              courierId: a.courierId,
              branchId: o.branchId!,
              orderId: o.id,
              amount: c.collected,
              at: s.now,
              reference: c.reference,
            });
          const total = quote(o).total;
          if (c.collected !== total) {
            need(text(c.reason), "سبب استثناء النقد مطلوب.");
            exception(
              o,
              c.collected > total
                ? "overpayment"
                : c.collected === 0
                  ? "cash_uncollected"
                  : "cash_shortfall",
              Math.abs(total - c.collected),
              c.reason,
            );
          }
        }
        o.status = "delivered";
        o.deliveredAt = s.now;
        if (a.commission > 0)
          s.earnings.push({
            id: id("earning"),
            courierId: a.courierId,
            branchId: o.branchId!,
            orderId: o.id,
            amount: a.commission,
            at: s.now,
            reference: a.id,
          });
      }
      event(
        o,
        `حدث موصل محلي: ${c.stage === "on_the_way" ? "في الطريق" : "تم التسليم"}`,
      );
      message = "محاكاة محلية فقط؛ لم تنفذ مرحلة تطبيق الموصل04.";
      break;
    }
    case "preview-time": {
      requirePermission("orders.review", null);
      need(integer(command.minutes, 1, 1440), "زيادة المعاينة1–1440دقيقة.");
      s.now += command.minutes * 60000;
      expireTimed();
      message = "تقدم وقت المعاينة؛ الحجز المحمي لم يحرر بالوقت.";
      break;
    }
    case "delivery-issue": {
      const c = command,
        o = order(c.orderId, "orders.assign");
      need(o.status === "on_the_way", "بلاغ التعذر يخص طلبًا في الطريق.");
      need(text(c.reason), "سبب البلاغ أو رد الإدارة مطلوب.");
      if (c.preview) {
        o.deliveryIssues.push({
          id: id("delivery-issue"),
          reason: c.reason,
          at: s.now,
        });
        event(o, "محاكاة بلاغ تعذر من الموصل؛ لا تسليم أو إلغاء تلقائي");
      } else {
        confirmed(c.confirmed);
        const issue = o.deliveryIssues.find((x) => !x.response);
        need(issue, "لا بلاغ تعذر مفتوح.");
        issue.response = c.reason;
        issue.reviewedAt = s.now;
        issue.reviewedBy = actor(s)!.id;
        event(o, "رد إداري موثق على تعذر التسليم");
        audit(`مراجعة تعذر التسليم ${o.id}`, o.branchId);
      }
      break;
    }
    case "courier": {
      const c = command,
        v = c.value;
      confirmed(c.confirmed);
      need(
        text(c.reason) && text(v.name) && /^7\d{8}$/.test(v.phone),
        "الاسم والهاتف التجريبي والسبب مطلوبة.",
      );
      need(
        v.bps === null || integer(v.bps, 0, 10000),
        "النسبة0–10000bps أو غير مضبوطة.",
      );
      const old = s.couriers.find((x) => x.id === v.id);
      for (const b of new Set([...(old?.branchIds ?? []), ...v.branchIds])) {
        need(
          s.branches.some((x) => x.id === b),
          "فرع غير موجود.",
        );
        requirePermission("couriers.manage", b);
      }
      need(v.branchIds.length > 0, "نطاق موصل مطلوب.");
      need(
        !s.couriers.some((x) => x.id !== v.id && x.phone === v.phone),
        "هاتف الموصل مستخدم.",
      );
      upsert(s.couriers, v);
      audit(`تعديل موصل ونسبته المستقبلية: ${v.name} / ${c.reason}`);
      break;
    }
    case "payout": {
      const c = command;
      confirmed(c.confirmed);
      requireMeta(c);
      need(
        c.sourceIds.length > 0 &&
          new Set(c.sourceIds).size === c.sourceIds.length,
        "اختر مصادر متاحة غير مكررة.",
      );
      const options = availableSources(s, c.kind, c.courierId);
      const rows = c.sourceIds.map((v) => {
        const r = options.find((x) => x.id === v);
        need(r, "مصدر سبق تخصيصه أو خارج النطاق.");
        return r;
      });
      const amount = rows.reduce((n, r) => n + r.amount, 0);
      need(integer(amount, 1), "إجمالي غير صالح.");
      const list = c.kind === "commission" ? s.settlements : s.remittances;
      list.push({
        id: id(c.kind === "commission" ? "settlement" : "remittance"),
        courierId: c.courierId,
        amount,
        sourceIds: c.sourceIds,
        branchIds: [
          ...new Set(rows.flatMap((r) => r.branchIds ?? [r.branchId])),
        ],
        reference: c.reference,
        reason: c.reason,
        proof: c.proof,
        at: s.now,
        actor: actor(s)!.id,
      });
      audit(
        `قيد ${c.kind === "commission" ? "عمولة" : "توريد نقد"} مستقل ${money(amount)}`,
      );
      break;
    }
    case "reverse": {
      const c = command;
      confirmed(c.confirmed);
      requireMeta(c);
      const list = c.kind === "commission" ? s.settlements : s.remittances,
        reversals =
          c.kind === "commission" ? s.commissionReversals : s.cashReversals;
      const p = list.find((x) => x.id === c.payoutId);
      need(p, "القيد غير موجود.");
      for (const b of p.branchIds)
        requirePermission(
          c.kind === "commission" ? "commissions.settle" : "cash.reverse",
          b,
        );
      need(
        !reversals.some((r) => r.payoutId === p.id),
        "القيد معكوس سابقًا؛ لا عكس مكرر.",
      );
      reversals.push({
        id: id("reversal"),
        payoutId: p.id,
        courierId: p.courierId,
        branchIds: p.branchIds,
        amount: p.amount,
        reference: c.reference,
        reason: c.reason,
        proof: c.proof,
        actor: actor(s)!.id,
        at: s.now,
      });
      audit(`عكس قيد ${p.id} بإثبات دون حذف الأصل`);
      break;
    }
    case "resolve-exception": {
      const c = command,
        e = s.exceptions.find((x) => x.id === c.id);
      need(e && !e.resolution, "استثناء غير موجود أو معالج.");
      order(e.orderId, "financial-exceptions.resolve");
      confirmed(c.confirmed);
      requireMeta(c);
      need(
        integer(c.amount) && c.amount === e.amount,
        "هذه المعاينة تقبل تسوية كاملة لمبلغ الاستثناء.",
      );
      if (e.kind === "overpayment")
        need(c.direction === "refund", "الزائد يعالج برد خارجي موثق.");
      e.resolution = {
        direction: c.direction,
        amount: c.amount,
        reference: c.reference,
        reason: c.reason,
        proof: c.proof,
        actor: actor(s)!.id,
        at: s.now,
      };
      audit(`تسوية خارجية تجريبية ${e.id}`);
      message = "سجلت المعالجة الخارجية محليًا؛ لم تنفذ دفعة أو استردادًا.";
      break;
    }
    case "method": {
      requirePermission("payment-methods.write", null);
      const v = command.value;
      need(
        text(v.name) &&
          text(v.beneficiary) &&
          text(v.destination) &&
          integer(v.order),
        "الوسيلة والمستفيد والرقم والترتيب مطلوبة.",
      );
      need(
        !v.branchId || s.branches.some((x) => x.id === v.branchId),
        "نطاق غير صالح.",
      );
      upsert(s.methods, v);
      audit(`حفظ وسيلة ${v.name} دون تغيير التعليمات التاريخية`);
      break;
    }
    case "promotion": {
      requirePermission("promotions.write", null);
      const v = command.value;
      need(
        text(v.name) &&
          integer(v.value) &&
          Number.isFinite(v.startsAt) &&
          v.endsAt > v.startsAt,
        "اسم وقيمة وتواريخ صحيحة مطلوبة.",
      );
      need(
        v.discountKind !== "percent" || v.value <= 10000,
        "نسبة العرض لا تتجاوز10000bps.",
      );
      need(!v.categoryId || !v.productId, "اختر قسمًا أو منتجًا، لا الاثنين.");
      upsert(s.promotions, v);
      audit(`حفظ عرض منفرد ${v.name}`);
      break;
    }
    case "banner": {
      requirePermission("promotions.write", null);
      const v = command.value;
      need(
        text(v.title) &&
          text(v.image) &&
          integer(v.order) &&
          Number.isFinite(v.startsAt) &&
          v.endsAt > v.startsAt,
        "عنوان ورسم وترتيب وتواريخ صحيحة مطلوبة.",
      );
      need(!(v.categoryId && v.productId), "وجهة قسم أو منتج فقط.");
      upsert(s.banners, v);
      audit(`حفظ بنر ${v.title}`);
      break;
    }
    case "campaign": {
      requirePermission("notifications.broadcast", null);
      confirmed(command.confirmed);
      const v = command.value;
      need(text(v.title) && text(v.body), "عنوان الرسالة ومحتواها مطلوبان.");
      need(
        v.status !== "scheduled_local" || v.scheduledAt > s.now,
        "حدد موعدًا مستقبليًا UTC للجدولة.",
      );
      upsert(s.campaigns, v);
      audit(`حملة ${v.status} محلية دون Push`);
      message = "حفظت جدولة محلية؛ لا إرسال أو عامل خلفية متصل.";
      break;
    }
    case "complaint": {
      const c = command,
        v = s.complaints.find((x) => x.id === c.id);
      need(v, "البلاغ غير موجود.");
      order(
        v.orderId,
        v.type === "flag" ? "customer-flags.read" : "complaints.manage",
      );
      need(text(c.response), "رد إداري مطلوب.");
      v.status = c.status;
      v.response = c.response;
      audit(`مراجعة جودة ${v.id}`);
      break;
    }
    case "role": {
      requirePermission("staff.manage", null);
      confirmed(command.confirmed);
      const v = command.value;
      need(
        text(v.name) &&
          v.permissions.length > 0 &&
          v.permissions.every((p) => p in permissionNames),
        "اسم وصلاحيات مسجلة مطلوبة.",
      );
      const old = s.roles.find((x) => x.id === v.id);
      if (old?.permissions.includes("staff.manage"))
        need(
          v.permissions.includes("staff.manage"),
          "لا تزل إدارة الموظفين من دور المدير الأساسي في المعاينة.",
        );
      upsert(s.roles, v);
      audit(`حفظ دور ${v.name}`);
      break;
    }
    case "staff": {
      requirePermission("staff.manage", null);
      confirmed(command.confirmed);
      const v = command.value;
      need(
        text(v.name) && /^7\d{8}$/.test(v.phone) && v.grants.length > 0,
        "اسم وهاتف ونطاق وصلاحية مطلوبة.",
      );
      need(
        !s.staff.some((x) => x.id !== v.id && x.phone === v.phone),
        "الهاتف مستخدم.",
      );
      need(
        v.grants.every(
          (g) =>
            s.roles.some((r) => r.id === g.roleId) &&
            (g.branchId === null ||
              s.branches.some((b) => b.id === g.branchId)),
        ),
        "دور أو فرع غير صالح.",
      );
      if (v.id === s.session)
        need(
          v.active &&
            v.grants.some(
              (g) =>
                g.branchId === null &&
                s.roles
                  .find((r) => r.id === g.roleId)
                  ?.permissions.includes("staff.manage"),
            ),
          "لا تعطل وصولك الإداري بنفسك.",
        );
      upsert(s.staff, v);
      audit(`موظف داخلي ${v.name} ونطاقه؛ دون دعوة فعلية`);
      break;
    }
    case "maintenance": {
      requirePermission("maintenance.write", null);
      confirmed(command.confirmed);
      need(text(command.message), "رسالة الصيانة مطلوبة.");
      s.maintenance = { enabled: command.enabled, message: command.message };
      audit("صيانة العميل محليًا؛ الإدارة والموصل مستمران");
      break;
    }
    case "release": {
      requirePermission("releases.write", null);
      confirmed(command.confirmed);
      const v = command.value;
      need(
        integer(v.minimum, 1) &&
          integer(v.latest, v.minimum) &&
          text(v.version) &&
          /^https:\/\/[^\s]+$/.test(v.url),
        "أرقام build صحيحة ورابط HTTPS مطلوبان.",
      );
      const i = s.releases.findIndex(
        (x) =>
          x.app === v.app &&
          x.platform === v.platform &&
          x.environment === v.environment,
      );
      if (i < 0) s.releases.push(v);
      else s.releases[i] = v;
      audit(`إعداد إصدار ${v.app}/${v.platform}/${v.environment} محلي`);
      break;
    }
    case "settings": {
      requirePermission("maintenance.write", null);
      confirmed(command.confirmed);
      const v = command.value;
      need(
        v.holdMinutes === 30,
        "مهلة الحجز المعتمدة30 دقيقة؛ لا تغير دون قرار مالك.",
      );
      need(
        integer(v.lateAlertMinutes, 1, 1440),
        "حد تنبيه تأخر1–1440دقيقة، لا حد تحرير.",
      );
      need(
        [v.privacy, v.support].every(
          (x) => !x || x.startsWith("https://") || x.startsWith("/"),
        ),
        "روابط HTTPS أو مسارات عامة فقط.",
      );
      s.settings = v;
      audit("إعداد تنبيه بلا تحرير محمي تلقائي أو نشر سياسة");
      break;
    }
  }
  for (const stock of s.stock)
    need(
      integer(stock.onHand) &&
        integer(stock.reserved) &&
        stock.reserved <= stock.onHand,
      "حارس رصيد المخزون المحلي.",
    );
  return { state: s, message };
}
