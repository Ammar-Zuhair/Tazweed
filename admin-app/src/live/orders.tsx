import { useCallback, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Image, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Page, Txt, Card, Action, Header } from "../ui/components";
import { api, useAuth, Input, LoginPanel } from "./connection";
import { useOperation } from "./operations";
const labels: Record<string, string> = {
  pending_review: "قيد المراجعة",
  on_the_way: "في الطريق",
  delivered: "تم التسليم",
  active: "محجوز",
  consumed: "خصم بعد التأكيد",
  released: "محرر بقرار",
  "order.submitted": "استلم طلب العميل",
  "quote.issued": "أصدر عرض جديد",
  "quote.accepted": "وافق العميل على العرض",
  "quote.declined": "رفض العميل العرض",
  "order.payment_kind": "تغيرت طريقة الدفع",
  "payment.instructions_issued": "ثبتت تعليمات التحويل",
  "payment.reported": "استلم إيصال تحويل",
  "payment.image_corrected": "أرسلت صورة مصححة",
  "payment.reviewed": "روجع إيصال التحويل",
  "finance.exception_opened": "فتح استثناء مالي",
  "finance.settlement_recorded": "سجلت تسوية خارجية",
  "finance.exception_resolved": "أغلق الاستثناء المالي",
  "order.confirmed": "أكد الطلب",
  "order.cancellation_requested": "طلب العميل مراجعة الإلغاء",
  "order.cancelled": "ألغي الطلب",
  "order.rejected": "رفض الطلب",
  "order.cancellation_denied": "رفض طلب الإلغاء",

  confirmed: "مؤكد",
  cancelled: "ملغي",
  rejected: "مرفوض",
  sent: "مرسل للعميل",
  accepted: "مقبول",
  superseded: "سابق",
  declined: "رفضه العميل",
  expired: "منتهي",
  pending: "بانتظار التحقق",
  approved: "تحويل معتمد",
  image_rejected: "الصورة مرفوضة",
  transfer_rejected: "التحويل مرفوض",
  transfer_verified: "التحويل معتمد",
  keep_for_correction: "إبقاء الحجز محميًا للتصحيح",
  release_after_review: "تحرير الحجز بعد المراجعة",
  consume_on_confirmation: "إبقاء الحجز للاستهلاك عند التأكيد",
  overpayment: "زيادة مبلغ",
  underpayment: "نقص مبلغ",
  late_transfer: "تحويل متأخر",
  stock_unavailable: "مخزون غير متاح",
  other: "استثناء آخر",
  refund_to_customer: "رد خارجي للعميل",
  received_from_customer: "استلام خارجي من العميل",
  write_off: "شطب موثق دون تغيير المال",
  open: "مفتوح",
  resolved: "مسوى",
};
export function Orders() {
  const { user } = useAuth();
  return <OrdersView key={user?.id ?? "guest"} />;
}
function OrdersView() {
  const { user } = useAuth(),
    router = useRouter();
  const [rows, setRows] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState("");
  async function load(more = false) {
    try {
      const d = await api(
        "/admin/orders" + (more && next ? "?cursor=" + next : ""),
      );
      setRows((old) => (more ? [...old, ...d.items] : d.items));
      setNext(d.nextCursor);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useFocusEffect(
    useCallback(() => {
      setRows([]);
      if (user) void load();
    }, [user?.id]),
  );
  return (
    <Page>
      <Header title="إدارة الطلبات" subtitle="العرض والقبول والتحويل والنقد" />
      <Action
        secondary
        title="العودة إلى إدارة الكتالوج"
        onPress={() => router.push("/")}
      />
      <Action
        secondary
        title="وسائل التحويل"
        onPress={() => router.push("/methods")}
      />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <Action secondary title="تحديث الطلبات" onPress={() => void load()} />
          {!rows.length && <Txt>لا توجد طلبات ضمن صلاحيتك.</Txt>}
          {rows.map((o) => (
            <Card key={o.id}>
              <Txt weight="bold">
                طلب #{o.order_number} ·{" "}
                {o.kind === "wholesale" ? "جملة" : "تجزئة"}
              </Txt>
              <Txt>
                {labels[o.status] ?? o.status} ·{" "}
                {o.payment_kind === "transfer" ? "تحويل" : "نقد عند الاستلام"}
              </Txt>
              <Action
                title={"مراجعة الطلب " + o.order_number}
                onPress={() =>
                  router.push({ pathname: "/order", params: { id: o.id } })
                }
              />
            </Card>
          ))}
          {next && <Action title="المزيد" onPress={() => void load(true)} />}
        </>
      )}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
    </Page>
  );
}
export default function Order() {
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OrderView key={(user?.id ?? "guest") + ":" + id} />;
}
function OrderView() {
  const { user } = useAuth(),
    { id } = useLocalSearchParams<{ id: string }>(),
    router = useRouter(),
    op = useOperation(user?.id);
  const [data, setData] = useState<any>(null),
    [grants, setGrants] = useState<any[]>([]),
    [branches, setBranches] = useState<any[]>([]),
    [branch, setBranch] = useState(""),
    [addressId, setAddressId] = useState(""),
    [prices, setPrices] = useState<Record<string, string>>({}),
    [manual, setManual] = useState(false),
    [carryMoney, setCarryMoney] = useState(false),
    [delivery, setDelivery] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reviewPid, setReviewPid] = useState(""),
    [outcome, setOutcome] = useState(""),
    [verified, setVerified] = useState(""),
    [stockAction, setStockAction] = useState(""),
    [note, setNote] = useState(""),
    [picture, setPicture] = useState(""),
    [confirmStep, setConfirmStep] = useState(false),
    [exceptionId, setExceptionId] = useState(""),
    [exceptionKind, setExceptionKind] = useState("other"),
    [amount, setAmount] = useState(""),
    [direction, setDirection] = useState(""),
    [reference, setReference] = useState(""),
    [occurred, setOccurred] = useState(new Date().toISOString()),
    [proof, setProof] = useState(""),
    [uploading, setUploading] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  const can = (p: string) =>
    grants.some(
      (g) =>
        g.permissions.includes(p) &&
        (g.global_scope ||
          g.branch_id ===
            (data?.order.branch_id ?? data?.order.catalog_branch_id)),
    );
  async function load() {
    setRefreshing(true);
    setConfirmStep(false);
    try {
      const d = await api("/admin/orders/" + id);
      setData(d);
      setGrants((await api("/admin/access")).grants);
      try {
        setBranches(
          (await api("/admin/access/branches?permission=orders.reprice")).items,
        );
      } catch {
        setBranches([]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  useFocusEffect(
    useCallback(() => {
      if (user && id) void load();
    }, [user?.id, id]),
  );
  async function act(action: string, body: any = {}) {
    setError("");
    setNotice("");
    try {
      const r = await op.execute("/admin/orders/" + id + "/" + action, {
        expectedVersion: data.order.version,
        ...body,
      });
      setNotice("حفظ الخادم العملية");
      await load();
      return r;
    } catch (e) {
      setError((e as Error).message);
      if ((e as any).status < 500) await load();
    }
  }
  async function uploadProof() {
    setUploading(true);
    setError("");
    try {
      const p = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      });
      if (p.canceled) return;
      const a = p.assets[0];
      if (!a) throw Error("لم تختر صورة");
      if (a.fileSize && a.fileSize > 8388608) throw Error("حد الصورة8ميغابايت");
      const blob = await (await fetch(a.uri)).blob(),
        m = await api("/media/uploads", {
          purpose: "financial_proof",
          mime: a.mimeType ?? blob.type,
          size: blob.size,
        });
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 15000);
      try {
        const r = await fetch(m.putUrl, {
          method: "PUT",
          headers: { "Content-Type": a.mimeType ?? blob.type },
          body: blob,
          signal: controller.signal,
        });
        if (!r.ok) throw Error("تعذر رفع الإثبات");
      } finally {
        clearTimeout(timer);
      }
      await api("/media/uploads/" + m.uploadId + "/complete", {});
      setProof(m.uploadId);
      setNotice("تحقق الخادم من الإثبات الخاص");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  const o = data?.order,
    q = data?.quotes.find((q: any) => q.id === o.current_quote_id),
    selected = data?.payments.find((p: any) => p.id === reviewPid),
    locked = op.busy || !!op.command || !op.ready || uploading || refreshing,
    open = o?.status === "pending_review";
  return (
    <Page>
      <Header
        title="مراجعة الطلب"
        subtitle={o ? "طلب #" + o.order_number : "تحميل الطلب"}
      />
      <Action
        secondary
        title="قائمة الطلبات"
        onPress={() => router.push("/orders")}
      />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <Action
            secondary
            title="تحديث بيانات الطلب"
            disabled={refreshing}
            onPress={() => void load()}
          />
          {op.command && (
            <Card>
              <Txt>
                نتيجة العملية غير محسومة؛ أعد المحاولة المحفوظة بالمفتاح نفسه.
              </Txt>
              <Action
                title="إعادة محاولة العملية المحفوظة"
                disabled={op.busy}
                onPress={() =>
                  void op
                    .execute()
                    .then(() => {
                      setNotice("أقر الخادم العملية");
                      void load();
                    })
                    .catch((e) => setError(e.message))
                }
              />
            </Card>
          )}
          {data && (
            <>
              <Card>
                <Txt weight="bold">
                  {labels[o.status]} ·{" "}
                  {o.kind === "wholesale" ? "جملة" : "تجزئة"} ·{" "}
                  {o.payment_kind === "transfer" ? "تحويل" : "نقد عند الاستلام"}
                </Txt>
                <Txt>
                  {data.privateDetails?.contact_snapshot.name_ar} ·{" "}
                  {data.privateDetails?.contact_snapshot.phone_e164}
                </Txt>
                <Txt>
                  {data.privateDetails?.address_snapshot.label} ·{" "}
                  {data.privateDetails?.address_snapshot.description}
                </Txt>
                {data.cashNotice && <Txt>{data.cashNotice}</Txt>}
                {data.hasCustomerFlag && (
                  <Txt>يوجد تنبيه سابق على العميل؛ لا حظر تلقائي.</Txt>
                )}
                {data.flags.map((f: any) => (
                  <Txt key={f.id}>{f.details_ar}</Txt>
                ))}
                {data.openExceptions > 0 && (
                  <Txt>استثناءات مالية مفتوحة: {data.openExceptions}</Txt>
                )}
              </Card>
              {q && (
                <Card>
                  <Txt weight="bold">
                    النسخة{q.revision} · {q.branch_name} · {labels[q.status]}
                  </Txt>
                  {q.items.map((l: any) => (
                    <Txt key={l.id}>
                      {l.name_snapshot} · {l.quantity}{" "}
                      {l.unit_snapshot === "piece"
                        ? "حبة"
                        : `كرتون (${l.pieces_per_unit} حبة)`}{" "}
                      × {l.unit_price_yer} = {l.line_total_yer} ر.ي ·{" "}
                      {l.attributes_snapshot
                        .map((a: any) => a.attribute + ": " + a.value)
                        .join(" · ")}
                    </Txt>
                  ))}
                  <Txt>
                    المنتجات {q.subtotal_yer} · خصم المنتجات{" "}
                    {q.product_discount_yer} ر.ي
                  </Txt>
                  <Txt>
                    التوصيل {q.delivery_yer} · خصم التوصيل{" "}
                    {q.delivery_discount_yer} ر.ي
                  </Txt>
                  <Txt weight="bold">الإجمالي {q.total_yer} ر.ي</Txt>
                  <Txt>
                    القبول:{" "}
                    {q.accepted_at
                      ? new Date(q.accepted_at).toLocaleString("ar")
                      : "لم يقبل العميل"}
                  </Txt>
                </Card>
              )}
              {data.holds.map((h: any) => (
                <Card key={h.id}>
                  <Txt>
                    الحجز: {labels[h.state] ?? "قيد المراجعة"} ·{" "}
                    {h.hold_kind === "receipt_review"
                      ? "محمي بالإيصال دون انتهاء تلقائي"
                      : "أولي30دقيقة"}
                  </Txt>
                  {h.overdue && (
                    <Txt>
                      تأخرت مراجعة الإيصال؛ يلزم قرار إداري مع بقاء الحماية.
                    </Txt>
                  )}
                </Card>
              ))}
              {open && can("orders.reprice") && (
                <Card>
                  <Txt weight="bold">إصدار عرض جديد واختيار فرع التنفيذ</Txt>
                  <Txt>
                    كل نسخة جديدة تحتاج موافقة العميل؛ الحجز والسعر يصدران معًا.
                    لا استبدال للحجز المحمي قبل مراجعة الإيصال.
                  </Txt>
                  {branches.map((b) => (
                    <Action
                      key={b.id}
                      title={b.name_ar}
                      secondary={branch !== b.id}
                      onPress={() => setBranch(b.id)}
                    />
                  ))}
                  {data.availableAddresses.map((a: any) => (
                    <Action
                      key={a.id}
                      title={"تثبيت عنوان " + a.label}
                      secondary={addressId !== a.id}
                      onPress={() => setAddressId(a.id)}
                    />
                  ))}
                  {data.requestedItems.map((l: any) => (
                    <View key={l.unit_id}>
                      <Txt>
                        {l.name_ar} · الكمية{l.quantity} ·{" "}
                        {l.unit_kind === "piece" ? "حبة" : "كرتون"}
                      </Txt>
                      <Input
                        label={
                          "سعر " +
                          l.name_ar +
                          " للوحدة " +
                          (l.unit_kind === "piece" ? "حبة" : "كرتون") +
                          (o.kind === "retail"
                            ? " (فارغ لسعر الكتالوج)"
                            : " للجملة")
                        }
                        value={prices[l.unit_id] ?? ""}
                        numeric
                        onChange={(v) =>
                          setPrices((p) => ({ ...p, [l.unit_id]: v }))
                        }
                      />
                    </View>
                  ))}
                  <Action
                    secondary
                    title={
                      manual
                        ? "التوصيل: رسم يدوي مسبب"
                        : "التوصيل: حساب الطريق من الخادم"
                    }
                    onPress={() => setManual((v) => !v)}
                  />
                  {manual && (
                    <Input
                      label="رسم التوصيل اليدوي بالريال"
                      numeric
                      value={delivery}
                      onChange={setDelivery}
                    />
                  )}
                  <Input
                    label="سبب التسعير أو التغيير أو التجاوز اليدوي"
                    value={reason}
                    onChange={setReason}
                  />
                  {can("payments.verify") &&
                    data.payments.some((p: any) => p.status === "approved") && (
                      <Action
                        secondary={!carryMoney}
                        title={
                          carryMoney
                            ? "سينقل الرصيد المعتمد إلى العرض الجديد"
                            : "نقل الرصيد المعتمد إلى العرض الجديد بعد تسوية الاستثناء"
                        }
                        onPress={() => setCarryMoney((v) => !v)}
                      />
                    )}
                  <Action
                    title="إصدار العرض وحجز المخزون"
                    disabled={
                      locked ||
                      !branch ||
                      !reason.trim() ||
                      (manual && !/^\d+$/.test(delivery))
                    }
                    onPress={() =>
                      void act("quotes", {
                        branchId: branch,
                        carryVerifiedMoney: carryMoney,
                        ...(addressId ? { addressId } : {}),
                        reason,
                        ...(manual ? { manualDeliveryYer: delivery } : {}),
                        unitPrices: data.requestedItems
                          .filter(
                            (l: any) =>
                              prices[l.unit_id] !== undefined &&
                              prices[l.unit_id] !== "",
                          )
                          .map((l: any) => ({
                            unitId: l.unit_id,
                            priceYer: prices[l.unit_id],
                          })),
                      })
                    }
                  />
                </Card>
              )}
              {data.payments.map((p: any) => (
                <Card key={p.id}>
                  <Txt weight="bold">
                    تحويل {p.receipt_number} · مبلغ عنه {p.amount_yer} ر.ي
                  </Txt>
                  <Txt>
                    {labels[p.status]} · المعتمد{" "}
                    {p.approved_amount_yer ?? "لم يعتمد"}
                  </Txt>
                  {p.attempts.map((a: any) => (
                    <View key={a.id}>
                      <Txt>
                        محاولة{a.attempt_number} ·{" "}
                        {labels[a.outcome] ?? "بانتظار المراجعة"} · {a.note}
                      </Txt>
                      {can("payments.verify") && (
                        <Action
                          secondary
                          title={"عرض صورة المحاولة" + a.attempt_number}
                          onPress={() =>
                            void api("/media/" + a.media_id + "/access")
                              .then((r) => setPicture(r.url))
                              .catch((e) => setError(e.message))
                          }
                        />
                      )}
                    </View>
                  ))}
                  {can("payments.verify") &&
                    p.status !== "approved" &&
                    !p.attempts.at(-1)?.outcome && (
                      <Action
                        title="مراجعة أحدث صورة لهذا التحويل"
                        disabled={locked}
                        onPress={() => {
                          setReviewPid(p.id);
                          setOutcome("");
                          setStockAction("");
                          setNote("");
                          setVerified("");
                        }}
                      />
                    )}
                </Card>
              ))}
              {!!picture && (
                <Image
                  source={{ uri: picture }}
                  accessibilityLabel="صورة إيصال خاصة مؤقتة"
                  style={{ width: "100%", height: 240 }}
                  resizeMode="contain"
                />
              )}
              {selected && can("payments.verify") && (
                <Card>
                  <Txt weight="bold">
                    قرار مراجعة التحويل {selected.receipt_number}
                  </Txt>
                  {[
                    "image_rejected",
                    "transfer_verified",
                    "transfer_rejected",
                  ].map((v) => (
                    <Action
                      key={v}
                      title={labels[v] ?? v}
                      secondary={outcome !== v}
                      onPress={() => setOutcome(v)}
                    />
                  ))}
                  {outcome === "transfer_verified" && (
                    <Input
                      label="المبلغ المتحقق منه بالريال"
                      value={verified}
                      numeric
                      onChange={setVerified}
                    />
                  )}
                  <Input
                    label="سبب قرار مراجعة الإيصال والحجز"
                    value={note}
                    onChange={setNote}
                  />
                  <Txt weight="bold">قرار الحجز مطلوب بصورة مستقلة</Txt>
                  {[
                    "keep_for_correction",
                    "release_after_review",
                    "consume_on_confirmation",
                  ].map((v) => (
                    <Action
                      key={v}
                      title={labels[v] ?? v}
                      secondary={stockAction !== v}
                      onPress={() => setStockAction(v)}
                    />
                  ))}
                  <Action
                    title="حفظ مراجعة الإيصال وقرار الحجز"
                    disabled={
                      locked ||
                      !outcome ||
                      !stockAction ||
                      !note.trim() ||
                      (outcome === "transfer_verified" &&
                        !/^\d+$/.test(verified))
                    }
                    onPress={() =>
                      void act("payments/" + selected.id + "/review", {
                        attemptId: selected.attempts.at(-1).id,
                        outcome,
                        note,
                        stockAction,
                        ...(outcome === "transfer_verified"
                          ? { verifiedAmountYer: verified }
                          : {}),
                      }).then((r) => {
                        if (r) setReviewPid("");
                      })
                    }
                  />
                </Card>
              )}
              {open && can("orders.confirm") && (
                <Card>
                  <Txt>
                    التأكيد يستهلك الحجز ويسجل البيع مرة واحدة. النقد يبقى
                    مستحقًا عند الاستلام.
                  </Txt>
                  {confirmStep ? (
                    <>
                      <Txt weight="bold">
                        تأكيد نهائي للنسخة{q?.revision} بقيمة{q?.total_yer} ر.ي
                      </Txt>
                      <Action
                        title="تأكيد الطلب نهائيًا"
                        disabled={locked}
                        onPress={() => void act("confirm")}
                      />
                      <Action
                        secondary
                        title="العودة للمراجعة"
                        onPress={() => setConfirmStep(false)}
                      />
                    </>
                  ) : (
                    <Action
                      title="مراجعة التأكيد النهائي"
                      disabled={locked}
                      onPress={() => setConfirmStep(true)}
                    />
                  )}
                </Card>
              )}
              {can("financial-exceptions.resolve") && (
                <Card>
                  <Txt weight="bold">الاستثناءات والتسويات الخارجية</Txt>
                  {data.exceptions.map((e: any) => (
                    <View key={e.id}>
                      <Txt>
                        {labels[e.kind]} · {e.amount_yer} ر.ي ·{" "}
                        {labels[e.status]} · {e.reason}
                      </Txt>
                      {e.resolutions.map((r: any) => (
                        <Txt key={r.id}>
                          {r.direction === "other"
                            ? "قرار تسوية خارجي آخر"
                            : labels[r.direction]}{" "}
                          · {r.amount_yer} ر.ي · المرجع
                          {r.reference}
                        </Txt>
                      ))}
                      {e.status === "open" && (
                        <Action
                          secondary={exceptionId !== e.id}
                          title={"اختيار استثناء " + labels[e.kind]}
                          onPress={() => setExceptionId(e.id)}
                        />
                      )}
                    </View>
                  ))}
                  {[
                    "overpayment",
                    "underpayment",
                    "late_transfer",
                    "stock_unavailable",
                    "other",
                  ].map((v) => (
                    <Action
                      key={v}
                      secondary={exceptionKind !== v}
                      title={labels[v] ?? v}
                      onPress={() => setExceptionKind(v)}
                    />
                  ))}
                  <Input
                    label="مبلغ الاستثناء أو التسوية بالريال"
                    value={amount}
                    numeric
                    onChange={setAmount}
                  />
                  <Input
                    label="سبب الاستثناء أو التسوية"
                    value={reason}
                    onChange={setReason}
                  />
                  <Action
                    secondary
                    title="فتح استثناء موثق"
                    disabled={locked || !reason.trim() || !/^\d+$/.test(amount)}
                    onPress={() =>
                      void act("exceptions", {
                        kind: exceptionKind,
                        amountYer: amount,
                        reason,
                      })
                    }
                  />
                  {!!exceptionId && (
                    <>
                      <Txt>
                        السجل الخارجي لا يعيد كتابة مبلغ مؤكد، ولا يمثل تحصيلًا
                        للموصل أو عمولة.
                      </Txt>
                      {[
                        "refund_to_customer",
                        "received_from_customer",
                        "write_off",
                        "other",
                      ].map((v) => (
                        <Action
                          key={v}
                          title={
                            v === "other"
                              ? "قرار تسوية خارجي آخر"
                              : (labels[v] ?? v)
                          }
                          secondary={direction !== v}
                          onPress={() => setDirection(v)}
                        />
                      ))}
                      <Input
                        label="مرجع التسوية الخارجية"
                        value={reference}
                        onChange={setReference}
                      />
                      <Input
                        label="وقت وقوع التسوية UTC"
                        value={occurred}
                        onChange={setOccurred}
                      />
                      <Action
                        secondary
                        title="رفع إثبات تسوية خاص"
                        disabled={locked}
                        onPress={() => void uploadProof()}
                      />
                      {!!proof && <Txt>الإثبات متحقق وجاهز للربط</Txt>}
                      <Action
                        title="تسجيل التسوية الخارجية"
                        disabled={
                          locked ||
                          !direction ||
                          !proof ||
                          !reason ||
                          !reference ||
                          !/^\d+$/.test(amount)
                        }
                        onPress={() =>
                          void act("settlements", {
                            exceptionId,
                            direction,
                            amountYer: amount,
                            reason,
                            reference,
                            proofMediaId: proof,
                            occurredAt: occurred,
                          })
                        }
                      />
                      <Action
                        secondary
                        title="إغلاق الاستثناء بعد التسوية"
                        disabled={locked || !reason}
                        onPress={() =>
                          void act("resolve", { exceptionId, reason })
                        }
                      />
                    </>
                  )}
                </Card>
              )}
              {open && can("orders.reject") && (
                <Card>
                  <Input
                    label="سبب الرفض أو مراجعة الإلغاء"
                    value={reason}
                    onChange={setReason}
                  />
                  <Action
                    secondary
                    title="رفض الطلب بعد مراجعة المال والحجز"
                    disabled={locked || !reason}
                    onPress={() => void act("reject", { reason })}
                  />
                  {data.cancellations
                    .filter((c: any) => c.status === "requested")
                    .map((c: any) => (
                      <View key={c.id}>
                        <Txt>طلب الإلغاء: {c.reason}</Txt>
                        <Action
                          title="قبول طلب الإلغاء"
                          disabled={locked || !reason}
                          onPress={() =>
                            void act("cancel-review", {
                              requestId: c.id,
                              approve: true,
                              reason,
                            })
                          }
                        />
                        <Action
                          secondary
                          title="رفض طلب الإلغاء"
                          disabled={locked || !reason}
                          onPress={() =>
                            void act("cancel-review", {
                              requestId: c.id,
                              approve: false,
                              reason,
                            })
                          }
                        />
                      </View>
                    ))}
                </Card>
              )}
              <Card>
                <Txt weight="bold">سجل نسخ العرض والأحداث</Txt>
                {data.quotes.map((q: any) => (
                  <Txt key={q.id}>
                    نسخة{q.revision} · {q.branch_name} · {q.total_yer} ر.ي ·{" "}
                    {labels[q.status]}
                    {q.accepted_at ? " · قبول العميل محفوظ" : ""}
                  </Txt>
                ))}
                {data.events.map((e: any, n: number) => (
                  <Txt key={n}>
                    {labels[e.event_type] ?? "تحديث في الطلب"} ·{" "}
                    {new Date(e.created_at).toLocaleString("ar")}
                  </Txt>
                ))}
              </Card>
            </>
          )}
        </>
      )}
      {!!notice && <Txt accessibilityLiveRegion="polite">{notice}</Txt>}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
    </Page>
  );
}
