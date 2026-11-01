import { useState, useCallback } from "react";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Image, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { Page, Txt, Card, Action, Header } from "../ui/components";
import { api, useAuth, Input, LoginPanel } from "./connection";
import { useOperation } from "./operations";
const states: Record<string, string> = {
  pending_review: "قيد المراجعة",
  confirmed: "مؤكد",
  on_the_way: "في الطريق",
  delivered: "تم التسليم",
  cancelled: "ملغي",
  rejected: "مرفوض",
  awaiting_branch: "بانتظار اختيار فرع التنفيذ",
  awaiting_customer: "بانتظار موافقتك",
  awaiting_quote: "بانتظار عرض جديد",
  awaiting_transfer: "بانتظار التحويل أو تصحيح الصورة",
  checking_receipt: "الإيصال قيد المراجعة",
  ready_to_confirm: "بانتظار تأكيد الإدارة",
  closed: "انتهت المراجعة",
  sent: "بانتظار القبول",
  accepted: "مقبول",
  declined: "رفضته",
  superseded: "نسخة سابقة",
  expired: "منتهي",
  pending: "قيد التحقق",
  approved: "تحويل معتمد",
  image_rejected: "الصورة غير واضحة؛ أعد رفعها لنفس التحويل",
  transfer_rejected: "لم يعتمد التحويل",
  transfer_verified: "اعتمد التحويل",
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
      const d = await api("/orders" + (more && next ? "?cursor=" + next : ""));
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
      <Header title="طلباتي" subtitle="تحديثات الطلب من المتجر" />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <Action title="تحديث الطلبات" secondary onPress={() => void load()} />
          {!rows.length && <Txt>لا توجد طلبات حتى الآن.</Txt>}
          {rows.map((o) => (
            <Card key={o.id}>
              <Txt weight="bold">
                طلب #{o.order_number} ·{" "}
                {o.kind === "wholesale" ? "جملة" : "تجزئة"}
              </Txt>
              <Txt>
                {states[o.status]} · {states[o.review_stage]}
              </Txt>
              <Action
                title={"فتح الطلب " + o.order_number}
                onPress={() =>
                  router.push({ pathname: "/order", params: { id: o.id } })
                }
              />
            </Card>
          ))}
          {next && (
            <Action title="المزيد من الطلبات" onPress={() => void load(true)} />
          )}
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
  const { id } = useLocalSearchParams<{ id: string }>(),
    { user } = useAuth(),
    router = useRouter(),
    op = useOperation(user?.id);
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [methods, setMethods] = useState<any[]>([]),
    [method, setMethod] = useState(""),
    [instruction, setInstruction] = useState(""),
    [number, setNumber] = useState(""),
    [amount, setAmount] = useState(""),
    [image, setImage] = useState(""),
    [imageUri, setImageUri] = useState(""),
    [uploading, setUploading] = useState(false),
    [correction, setCorrection] = useState(""),
    [reason, setReason] = useState(""),
    [refreshing, setRefreshing] = useState(false);
  async function load() {
    setRefreshing(true);
    try {
      const d = await api("/orders/" + id);
      setData(d);
      if (
        d.paymentStatus !== "no_payment_due" &&
        d.order.payment_kind === "transfer" &&
        d.order.status === "pending_review" &&
        d.quotes.find((q: any) => q.id === d.order.current_quote_id)?.status ===
          "accepted"
      )
        setMethods((await api("/orders/" + id + "/payment-methods")).items);
      else setMethods([]);
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
  async function act(path: string, body: any) {
    setError("");
    setNotice("");
    try {
      const r = await op.execute("/orders/" + id + "/" + path, {
        expectedVersion: data.order.version,
        ...body,
      });
      if (r.instructionId) setInstruction(r.instructionId);
      setNotice("حفظ المتجر العملية");
      await load();
      return r;
    } catch (e) {
      setError((e as Error).message);
      if ((e as any).status < 500) await load();
    }
  }
  async function upload() {
    setError("");
    setUploading(true);
    try {
      const p = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      });
      if (p.canceled) return;
      const asset = p.assets[0];
      if (!asset) throw Error("لم تختر صورة");
      if (asset.fileSize && asset.fileSize > 8388608)
        throw Error("حد الصورة8ميغابايت");
      const blob = await (await fetch(asset.uri)).blob();
      const m = await api("/media/uploads", {
        purpose: "receipt",
        mime: asset.mimeType ?? blob.type,
        size: blob.size,
      });
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 15000);
      try {
        const r = await fetch(m.putUrl, {
          method: "PUT",
          headers: { "Content-Type": asset.mimeType ?? blob.type },
          body: blob,
          signal: controller.signal,
        });
        if (!r.ok) throw Error("تعذر رفع الصورة");
      } finally {
        clearTimeout(timer);
      }
      await api("/media/uploads/" + m.uploadId + "/complete", {});
      setImage(m.uploadId);
      setImageUri(asset.uri);
      setNotice("تم التحقق من الصورة؛ أرسل الإيصال لربطها بالتحويل");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  const locked =
      op.busy || !!op.command || !op.ready || uploading || refreshing,
    o = data?.order,
    q = data?.quotes.find((q: any) => q.id === o?.current_quote_id),
    ins = data?.instructions.find((x: any) => x.id === instruction),
    open = o?.status === "pending_review";
  return (
    <Page>
      <Header
        title="تفاصيل الطلب"
        subtitle={o ? "طلب #" + o.order_number : "متابعة الطلب"}
      />
      <Action
        secondary
        title="العودة إلى طلباتي"
        onPress={() => router.push("/orders")}
      />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <Action
            secondary
            title="تحديث حالة الطلب"
            disabled={refreshing}
            onPress={() => void load()}
          />
          {!!op.command && (
            <Card>
              <Txt>
                العملية لم تحسم بعد. أعد إرسال المحاولة المحفوظة بالمفتاح نفسه.
              </Txt>
              <Action
                title="إعادة محاولة العملية المحفوظة"
                disabled={op.busy}
                onPress={() =>
                  void op
                    .execute()
                    .then(() => {
                      setNotice("أقر المتجر العملية المحفوظة");
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
                  {states[o.status]} · {states[o.review_stage]}
                </Txt>
                <Txt>
                  {o.kind === "wholesale" ? "طلب جملة" : "طلب تجزئة"} ·{" "}
                  {o.payment_kind === "transfer"
                    ? "تحويل بنكي"
                    : "نقد عند الاستلام"}
                </Txt>
                {data.cashNotice && <Txt>{data.cashNotice}</Txt>}
                {data.paymentStatus === "no_payment_due" && (
                  <Txt>لا مبلغ مستحق على هذا العرض.</Txt>
                )}
                <Txt>
                  {data.privateDetails?.address_snapshot.label} ·{" "}
                  {data.privateDetails?.address_snapshot.description}
                </Txt>
                {data.openExceptions > 0 && (
                  <Txt>
                    توجد مراجعة مالية مفتوحة؛ تواصل مع المتجر قبل التحويل
                    مجددًا.
                  </Txt>
                )}
              </Card>
              {!q && (
                <Card>
                  <Txt>
                    وصل الطلب إلى المتجر؛ يختار المدير الفرع ويصدر عرضًا
                    نهائيًا. لا تحول مبلغًا اعتمادًا على معاينة السلة.
                  </Txt>
                  {data.requestedItems.map((l: any) => (
                    <Txt key={l.unit_id}>
                      {l.name_ar} · {l.quantity}{" "}
                      {l.unit_kind === "piece" ? "حبة" : "كرتون"}
                    </Txt>
                  ))}
                </Card>
              )}
              {q && (
                <Card>
                  <Txt weight="bold">
                    العرض الحالي · النسخة{q.revision} · {q.branch_name}
                  </Txt>
                  <Txt>
                    {states[q.status]} · الحجز الأولي حتى{" "}
                    {new Date(q.expires_at).toLocaleString("ar")}
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
                    المنتجات: {q.subtotal_yer} · خصم المنتجات:{" "}
                    {q.product_discount_yer} ر.ي
                  </Txt>
                  <Txt>
                    التوصيل: {q.delivery_yer} · خصم التوصيل:{" "}
                    {q.delivery_discount_yer} ر.ي
                  </Txt>
                  <Txt weight="bold">الإجمالي النهائي: {q.total_yer} ر.ي</Txt>
                  <Txt>سبب التسعير: {q.reason}</Txt>
                  {data.quotes[1] && (
                    <Txt>
                      النسخة السابقة{data.quotes[1].revision}:{" "}
                      {data.quotes[1].total_yer} ر.ي ·{" "}
                      {data.quotes[1].branch_name}. تغيير الفرع يتطلب قبولًا
                      جديدًا حتى عند تساوي المبلغ.
                    </Txt>
                  )}
                  {open && data.quoteValidity === "expired" && (
                    <Txt>
                      انتهت مهلة العرض؛ يلزم مراجعة السعر والمخزون من المتجر قبل
                      الدفع أو القبول.
                    </Txt>
                  )}
                  {open && data.allowedActions.includes("accept_quote") && (
                    <>
                      <Action
                        title="أوافق على هذا العرض والفرع"
                        disabled={locked}
                        onPress={() =>
                          void act("decision", { quoteId: q.id, accept: true })
                        }
                      />
                      <Action
                        secondary
                        title="رفض العرض وطلب المراجعة"
                        disabled={locked}
                        onPress={() =>
                          void act("decision", { quoteId: q.id, accept: false })
                        }
                      />
                    </>
                  )}
                </Card>
              )}
              {data.holds
                .filter((h: any) => h.state === "active")
                .map((h: any) => (
                  <Card key={h.id}>
                    <Txt>
                      {h.hold_kind === "receipt_review"
                        ? "الإيصال يحمي السعر والحجز حتى قرار الإدارة؛ لا انتهاء تلقائي."
                        : "حجز أولي30دقيقة فقط؛ انتهاء المهلة يستلزم مراجعة السعر والمخزون."}
                    </Txt>
                    {h.overdue && (
                      <Txt>
                        تأخرت المراجعة؛ أرسل تنبيه للمتجر مع بقاء الحماية.
                      </Txt>
                    )}
                  </Card>
                ))}
              {open && !data.payments.length && (
                <Card>
                  <Txt weight="bold">طريقة الدفع</Txt>
                  <Action
                    secondary={o.payment_kind !== "cash_on_delivery"}
                    title="اختيار النقد عند الاستلام"
                    disabled={locked}
                    onPress={() =>
                      void act("payment-kind", {
                        paymentKind: "cash_on_delivery",
                      })
                    }
                  />
                  <Action
                    secondary={o.payment_kind !== "transfer"}
                    title="اختيار التحويل"
                    disabled={locked}
                    onPress={() =>
                      void act("payment-kind", { paymentKind: "transfer" })
                    }
                  />
                </Card>
              )}
              {!!methods.length && (
                <Card>
                  <Txt weight="bold">إصدار تعليمات ثابتة قبل التحويل</Txt>
                  {methods.map((m) => (
                    <Action
                      key={m.id}
                      title={m.name_ar}
                      secondary={method !== m.id}
                      onPress={() => setMethod(m.id)}
                    />
                  ))}
                  <Action
                    title="إظهار تعليمات التحويل المثبتة"
                    disabled={locked || !method}
                    onPress={() =>
                      void act("instructions", { methodId: method })
                    }
                  />
                </Card>
              )}
              {o.payment_kind === "transfer" &&
                data.instructions.length > 0 && (
                  <Card>
                    <Txt weight="bold">تعليمات التحويل الصادرة</Txt>
                    {data.instructions.map((x: any) => (
                      <Action
                        key={x.id}
                        title={
                          "تعليمات النسخة" +
                          data.quotes.find((q: any) => q.id === x.quote_id)
                            ?.revision +
                          " · " +
                          x.method_snapshot.name_ar
                        }
                        secondary={instruction !== x.id}
                        onPress={() => setInstruction(x.id)}
                      />
                    ))}
                    {ins && (
                      <>
                        <Txt>
                          {ins.method_snapshot.name_ar} · المستفيد:{" "}
                          {ins.method_snapshot.beneficiary}
                        </Txt>
                        <Txt selectable>
                          رقم التحويل إليه:{" "}
                          {ins.method_snapshot.destination_number}
                        </Txt>
                        <Txt>
                          المبلغ: {ins.expected_amount_yer} ر.ي ·{" "}
                          {ins.method_snapshot.instructions_ar}
                        </Txt>
                        <Action
                          secondary
                          title="نسخ رقم جهة التحويل"
                          onPress={() =>
                            void Clipboard.setStringAsync(
                              ins.method_snapshot.destination_number,
                            ).then(() => setNotice("نسخ رقم الجهة"))
                          }
                        />
                        {(ins.quote_id !== o.current_quote_id || !open) && (
                          <Txt>
                            هذه تعليمات سابقة. إن حولت بالفعل، أبلغ عن الإيصال
                            للمراجعة؛ لن يعاد حجز المخزون تلقائيًا.
                          </Txt>
                        )}
                      </>
                    )}
                    <Txt>
                      لتصحيح صورة مرفوضة اختر التحويل من سجله أدناه، دون إنشاء
                      تحويل جديد.
                    </Txt>
                    {correction ? (
                      <Txt>
                        تصحيح صورة التحويل المحدد · لا تغيير رقمه أو مبلغه
                      </Txt>
                    ) : (
                      <>
                        <Input
                          label="رقم التحويل الفعلي"
                          value={number}
                          onChange={setNumber}
                        />
                        <Input
                          label="المبلغ المحول بالريال"
                          value={amount}
                          numeric
                          onChange={(v) =>
                            setAmount(
                              v.replace(/[٠-٩]/g, (c) =>
                                String(c.charCodeAt(0) - 1632),
                              ),
                            )
                          }
                        />
                      </>
                    )}
                    <Action
                      title={
                        uploading
                          ? "جارٍ رفع الصورة…"
                          : "اختيار صورة الإيصال ورفعها"
                      }
                      disabled={uploading || locked}
                      onPress={() => void upload()}
                    />
                    {!!imageUri && (
                      <Image
                        accessibilityLabel="معاينة صورة الإيصال"
                        source={{ uri: imageUri }}
                        style={{ width: "100%", height: 180 }}
                        resizeMode="contain"
                      />
                    )}
                    <Action
                      title={
                        correction
                          ? "إرسال الصورة المصححة لنفس التحويل"
                          : "إرسال الإيصال للمراجعة"
                      }
                      disabled={
                        locked ||
                        !image ||
                        (!correction &&
                          (!ins || !number || !/^\d+$/.test(amount)))
                      }
                      onPress={() =>
                        void act(
                          correction
                            ? "payments/" + correction + "/images"
                            : "receipts",
                          correction
                            ? { mediaId: image }
                            : {
                                instructionId: instruction,
                                receiptNumber: number,
                                amountYer: amount,
                                mediaId: image,
                              },
                        ).then((r) => {
                          if (r) {
                            setImage("");
                            setImageUri("");
                            setCorrection("");
                            setNumber("");
                            setAmount("");
                          }
                        })
                      }
                    />
                  </Card>
                )}
              {data.payments.map((p: any) => (
                <Card key={p.id}>
                  <Txt weight="bold">
                    تحويل {p.receipt_number} · {p.amount_yer} ر.ي
                  </Txt>
                  <Txt>
                    {states[p.status] ?? p.status} · المعتمد:{" "}
                    {p.approved_amount_yer ?? "لم يعتمد"}
                  </Txt>
                  {p.attempts.map((a: any) => (
                    <View key={a.id}>
                      <Txt>
                        الصورة{a.attempt_number}:{" "}
                        {a.outcome ? states[a.outcome] : "بانتظار المراجعة"} ·{" "}
                        {a.note}
                      </Txt>
                    </View>
                  ))}
                  {p.attempts.at(-1)?.outcome === "image_rejected" && (
                    <Action
                      secondary
                      title="تصحيح صورة هذا التحويل"
                      disabled={locked}
                      onPress={() => {
                        setCorrection(p.id);
                        setImage("");
                        setImageUri("");
                        setNotice("اختر صورة واضحة ثم أرسل التصحيح");
                      }}
                    />
                  )}
                </Card>
              ))}
              {data.quotes.length > 1 && (
                <Card>
                  <Txt weight="bold">سجل العروض محفوظ</Txt>
                  {data.quotes.slice(1).map((x: any) => (
                    <Txt key={x.id}>
                      نسخة{x.revision} · {x.branch_name} · {x.total_yer} ر.ي ·{" "}
                      {states[x.status]}
                      {x.accepted_at ? " · وافقت عليها سابقًا" : ""}
                    </Txt>
                  ))}
                </Card>
              )}
              {open && (
                <Card>
                  <Input
                    label="سبب الإلغاء"
                    value={reason}
                    onChange={setReason}
                  />
                  <Action
                    secondary
                    title={
                      data.payments.length
                        ? "طلب مراجعة الإلغاء"
                        : "إلغاء قبل التأكيد"
                    }
                    disabled={locked || !reason.trim()}
                    onPress={() => void act("cancel", { reason })}
                  />
                </Card>
              )}
              {data.cancellations.map((c: any) => (
                <Card key={c.id}>
                  <Txt>
                    طلب الإلغاء:{" "}
                    {
                      (
                        {
                          requested: "قيد مراجعة الإدارة",
                          approved: "مقبول",
                          denied: "مرفوض",
                        } as Record<string, string>
                      )[c.status]
                    }{" "}
                    · {c.review_note}
                  </Txt>
                </Card>
              ))}
            </>
          )}
        </>
      )}
      {!!notice && <Txt accessibilityLiveRegion="polite">{notice}</Txt>}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
    </Page>
  );
}
