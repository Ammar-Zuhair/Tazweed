import { useState, useCallback } from "react";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Linking, View } from "react-native";
import { Page, Header, Card, Txt, Action } from "../ui/components";
import { api, useAuth, LoginPanel, Input } from "./connection";
import { useOperation } from "./operations";
const states: Record<string, string> = {
  confirmed: "مؤكد",
  on_the_way: "في الطريق",
  delivered: "تم التسليم",
};
const utc = (value: string) =>
  `\u2066${new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC\u2069`;
function Nav() {
  const r = useRouter();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {[
        ["المهام", "/"],
        ["مستحقاتي", "/earnings"],
        ["نقد المتجر", "/cash"],
        ["العمليات المعلقة", "/pending"],
        ["الحساب", "/account"],
        ["مركز الإشعارات", "/notifications"],
        ["الخصوصية والدعم", "/privacy"],
        ["حذف الحساب", "/delete"],
      ].map(([title, path]) => (
        <Action
          key={path}
          secondary
          title={title!}
          onPress={() => r.push(path as any)}
        />
      ))}
    </View>
  );
}
export function Account() {
  return (
    <Page>
      <Header title="حساب الموصل" subtitle="حساب تنشئه الإدارة؛ تحقق آمن" />
      <Nav />
      <LoginPanel />

    </Page>
  );
}
export function Tasks() {
  const { user } = useAuth();
  return <TaskList key={user?.id ?? "guest"} />;
}
function TaskList() {
  const { user } = useAuth(),
    r = useRouter();
  const [data, setData] = useState<any[]>([]),
    [today, setToday] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(more = false) {
    setBusy(true);
    setError("");
    try {
      const d = await api(
        "/courier/orders" + (more && next ? "?cursor=" + next : ""),
      );
      setData((old) => (more ? [...old, ...d.items] : d.items));
      setNext(d.nextCursor);
      try {
        setToday((await api("/courier/earnings")).todayEarnedYer);
      } catch {
        setToday(null);
      }
    } catch (e) {
      setData([]);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useFocusEffect(
    useCallback(() => {
      if (user) void load();
      return () => setData([]);
    }, [user?.id]),
  );
  return (
    <Page>
      <Header title="مهامي" subtitle="طلباتك المسندة من المتجر" />
      <Nav />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          {today !== null && (
            <Card>
              <Txt weight="bold">عمولات التسليم اليوم (UTC): {today} ر.ي</Txt>
            </Card>
          )}
          <Action
            title="تحديث المهام"
            disabled={busy}
            onPress={() => void load()}
          />
          {busy && <Txt>جارٍ تحميل المهام…</Txt>}
          {!busy && !data.length && !error && (
            <Card>
              <Txt>لا توجد مهام مسندة إليك حاليًا.</Txt>
            </Card>
          )}
          {data.map((o) => (
            <Card key={o.id}>
              <Txt weight="bold">
                طلب #{o.order_number} · {states[o.status]}
              </Txt>
              {o.status === "confirmed" && <Txt>مهمة جديدة</Txt>}
              <Txt>
                {o.branch_name} ·{" "}
                {o.payment_kind === "transfer" ? "تحويل" : "نقد عند الاستلام"}
              </Txt>
              <Action
                title={"فتح المهمة " + o.order_number}
                onPress={() =>
                  r.push({ pathname: "/task", params: { id: o.id } })
                }
              />
            </Card>
          ))}
          {next && (
            <Action title="المزيد من المهام" onPress={() => void load(true)} />
          )}
        </>
      )}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
    </Page>
  );
}
export function Task() {
  const { user } = useAuth(),
    { id } = useLocalSearchParams<{ id: string }>();
  return <TaskView key={(user?.id ?? "guest") + id} />;
}
function TaskView() {
  const { user } = useAuth(),
    { id } = useLocalSearchParams<{ id: string }>(),
    op = useOperation(user?.id),
    r = useRouter();
  const [d, setD] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [amount, setAmount] = useState(""),
    [reference, setReference] = useState(""),
    [reason, setReason] = useState(""),
    [cashException, setCashException] = useState(""),
    [confirm, setConfirm] = useState<any>(null),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setConfirm(null);
    setError("");
    try {
      setD(await api("/courier/orders/" + id));
    } catch (e) {
      setD(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useFocusEffect(
    useCallback(() => {
      if (user) void load();
      return () => {
        setD(null);
        setConfirm(null);
      };
    }, [user?.id, id]),
  );
  async function execute(path?: string, body?: any) {
    setError("");
    try {
      const out = await op.execute(path, body);
      if (out?.exceptionId) setCashException(out.exceptionId);
      setNotice("أقر الخادم العملية");
      setConfirm(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const locked = busy || op.busy || !!op.command || !op.ready,
    addr = d?.privateDetails?.address_snapshot,
    contact = d?.privateDetails?.contact_snapshot;
  function prepare(path: string, extra: any = {}) {
    setConfirm({
      path: "/courier/orders/" + id + "/" + path,
      body: { expectedVersion: d.order.version, ...extra },
    });
  }
  async function open(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      setError("تعذر فتح التطبيق الخارجي؛ استخدم العنوان أو الرقم الظاهر");
    }
  }
  return (
    <Page>
      <Header
        title="تفاصيل المهمة"
        subtitle={d ? "طلب #" + d.order.order_number : "المهمة المسندة"}
      />
      <Nav />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <Action
            secondary
            title="تحديث المهمة"
            disabled={busy || op.busy}
            onPress={() => void load()}
          />
          {op.command && (
            <Card>
              <Txt>
                عملية محفوظة بانتظار الإقرار. أعد المحاولة بالمحتوى نفسه.
              </Txt>
              <Action
                title="إعادة محاولة العملية"
                disabled={op.busy}
                onPress={() => void execute()}
              />
            </Card>
          )}
          {d && (
            <>
              <Card>
                <Txt weight="bold">
                  طلب #{d.order.order_number} · {states[d.order.status]}
                </Txt>
                <Txt>{d.branch.name}</Txt>
                <Txt>
                  {d.paymentKind === "transfer"
                    ? "تحويل"
                    : d.order.payment_kind === "transfer"
                      ? "تحويل معتمد"
                      : "نقد عند الاستلام"}
                </Txt>
                <Txt>الإجمالي {d.totalYer} ر.ي</Txt>
                <Txt>العميل: {contact?.name ?? contact?.name_ar ?? "—"}</Txt>
                <Txt>
                  الهاتف: {contact?.phone ?? contact?.phone_e164 ?? "—"}
                </Txt>
                <Txt>
                  العنوان: {addr?.label} · {addr?.description}
                </Txt>
                <Txt>
                  الدبوس: {addr?.latitude}، {addr?.longitude}
                </Txt>
                {addr && (
                  <Action
                    secondary
                    title="فتح الملاحة"
                    onPress={() =>
                      void open(
                        "https://www.google.com/maps/dir/?api=1&destination=" +
                          encodeURIComponent(
                            addr.latitude + "," + addr.longitude,
                          ),
                      )
                    }
                  />
                )}
                {(contact?.phone ?? contact?.phone_e164) && (
                  <>
                    <Action
                      secondary
                      title="اتصال بالعميل"
                      onPress={() =>
                        void open(
                          "tel:" + (contact.phone ?? contact.phone_e164),
                        )
                      }
                    />
                    <Action
                      secondary
                      title="واتساب العميل"
                      onPress={() =>
                        void open(
                          "https://wa.me/" +
                            String(contact.phone ?? contact.phone_e164).replace(
                              /\D/g,
                              "",
                            ),
                        )
                      }
                    />
                  </>
                )}
                {d.items.map((x: any, n: number) => (
                  <Txt key={n}>
                    {x.name_snapshot} · {x.quantity}{" "}
                    {x.unit_snapshot === "piece"
                      ? "حبة"
                      : x.unit_snapshot === "carton"
                        ? "كرتون"
                        : "وحدة"}
                  </Txt>
                ))}
              </Card>
              <Card>
                <Txt weight="bold">عمولة هذا الإسناد</Txt>
                <Txt>
                  التوصيل قبل الخصم{" "}
                  {d.assignment.delivery_fee_before_discount_yer} · خصم العميل{" "}
                  {d.assignment.delivery_discount_yer}
                </Txt>
                <Txt>
                  النسبة المثبتة {d.assignment.commission_bps / 100}% · العمولة{" "}
                  {d.assignment.commission_yer} ر.ي
                </Txt>
                <Txt>تستحق عند التسليم مرة واحدة.</Txt>
              </Card>
              {d.order.status === "confirmed" && (
                <Action
                  title="بدء التوصيل"
                  disabled={locked}
                  onPress={() => prepare("start")}
                />
              )}{" "}
              {d.order.payment_kind === "cash_on_delivery" && (
                <Card>
                  <Txt weight="bold">نقد المتجر</Txt>
                  <Txt>
                    المحصل فعليًا {d.cashCollectedYer} · الباقي {d.cashDueYer}{" "}
                    ر.ي
                  </Txt>
                  {(d.cashExternalReceivedYer !== "0" ||
                    d.cashRefundedYer !== "0" ||
                    d.cashWrittenOffYer !== "0") && (
                    <Txt>
                      تسويات الإدارة: استلام خارجي {d.cashExternalReceivedYer} ·
                      رد {d.cashRefundedYer} · شطب {d.cashWrittenOffYer}. ليست
                      تحصيلًا بيدك.
                    </Txt>
                  )}
                  {d.order.status !== "confirmed" &&
                    !d.collections.some(
                      (c: any) => c.entry_type === "collection",
                    ) && (
                      <>
                        <Input
                          label="المبلغ النقدي المستلم فعليًا"
                          value={amount}
                          onChange={setAmount}
                          numeric
                        />
                        <Input
                          label="مرجع التحصيل"
                          value={reference}
                          onChange={setReference}
                        />
                        <Action
                          title="تسجيل التحصيل الفعلي"
                          disabled={locked || !amount || !reference}
                          onPress={() =>
                            prepare("cash-collections", {
                              amountYer: amount,
                              reference,
                              collectedAt: new Date().toISOString(),
                            })
                          }
                        />
                      </>
                    )}
                  {d.order.status === "on_the_way" && d.cashDueYer !== "0" && (
                    <>
                      <Input
                        label="سبب نقص أو تعذر التحصيل"
                        value={reason}
                        onChange={setReason}
                      />
                      <Action
                        title="إبلاغ الإدارة بفرق النقد"
                        disabled={locked || !reason}
                        onPress={() => prepare("cash-exceptions", { reason })}
                      />
                      {d.exceptions.map((e: any) => (
                        <Action
                          key={e.id}
                          secondary
                          title={"اختيار استثناء " + e.amount_yer + " ر.ي"}
                          disabled={locked}
                          onPress={() => setCashException(e.id)}
                        />
                      ))}
                      {!!cashException && (
                        <Txt>
                          اختير استثناء الفرق؛ ستتحقق منه الخدمة عند التسليم.
                        </Txt>
                      )}
                    </>
                  )}
                </Card>
              )}
              {d.order.status === "on_the_way" && (
                <Action
                  title="تم التسليم"
                  disabled={locked}
                  onPress={() =>
                    prepare(
                      "deliver",
                      d.order.payment_kind === "cash_on_delivery" &&
                        d.cashDueYer !== "0" &&
                        cashException
                        ? { cashExceptionId: cashException }
                        : {},
                    )
                  }
                />
              )}
              <Action
                secondary
                title="بلاغ أو تعذر تسليم"
                disabled={locked}
                onPress={() => r.push({ pathname: "/report", params: { id } })}
              />
              {confirm && (
                <Card>
                  <Txt weight="bold">تأكيد الإجراء</Txt>
                  <Txt>
                    {confirm.path.endsWith("/start")
                      ? "بدء التوصيل"
                      : confirm.path.endsWith("/deliver")
                        ? "تسجيل تسليم الطلب"
                        : confirm.path.endsWith("/cash-collections")
                          ? "تسجيل التحصيل الفعلي"
                          : "إبلاغ الإدارة بفرق النقد"}
                  </Txt>
                  {confirm.body.amountYer && (
                    <Txt>
                      المستلم فعليًا: {confirm.body.amountYer} ر.ي · المرجع:{" "}
                      {confirm.body.reference}
                    </Txt>
                  )}
                  {confirm.body.reason && <Txt>{confirm.body.reason}</Txt>}
                  <Txt>
                    راجع البيانات. لا يُسجل الإجراء إلا بعد إقرار الخادم.
                  </Txt>
                  <Action
                    title="تأكيد التنفيذ"
                    disabled={locked}
                    onPress={() => void execute(confirm.path, confirm.body)}
                  />
                  <Action
                    title="تراجع"
                    secondary
                    onPress={() => setConfirm(null)}
                  />
                </Card>
              )}
            </>
          )}
        </>
      )}
      {!!notice && <Txt accessibilityLiveRegion="polite">{notice}</Txt>}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
    </Page>
  );
}
export function Earnings() {
  return <Ledger cash={false} />;
}
export function Cash() {
  return <Ledger cash />;
}
function Ledger({ cash }: { cash: boolean }) {
  const { user } = useAuth();
  return <LedgerView key={(user?.id ?? "guest") + cash} cash={cash} />;
}
function LedgerView({ cash }: { cash: boolean }) {
  const { user } = useAuth();
  const [d, setD] = useState<any>(null),
    [error, setError] = useState("");
  async function load() {
    try {
      setD(await api("/courier/" + (cash ? "cash-balance" : "earnings")));
      setError("");
    } catch (e) {
      setD(null);
      setError((e as Error).message);
    }
  }
  useFocusEffect(
    useCallback(() => {
      if (user) void load();
      return () => setD(null);
    }, [user?.id, cash]),
  );
  return (
    <Page>
      <Header
        title={cash ? "نقد المتجر" : "مستحقاتي"}
        subtitle={cash ? "أموال مستلمة لحساب المتجر" : "عمولات التسليم المثبتة"}
      />
      <Nav />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <Action title="تحديث الدفتر" onPress={() => void load()} />
          {d && (
            <>
              <Card>
                <Txt weight="bold">
                  {cash ? "المتبقي للمتجر" : "غير المسدد"}: {d.balanceYer} ر.ي
                </Txt>
                <Txt>
                  {cash ? "المحصل" : "المكتسب"} {d.totalYer} ·{" "}
                  {cash ? "المورد" : "المسدد"} {d.paidYer} · رصيد العكس{" "}
                  {d.reversedYer}
                </Txt>
                <Txt>
                  {cash
                    ? "العمولة مستقلة ولا تخصم من النقد."
                    : "النقد المحصل ليس دخلًا أو عمولة."}{" "}
                  التواريخ أدناه UTC.
                </Txt>
              </Card>
              {!d.sources.length && <Txt>لا توجد قيود بعد.</Txt>}
              {d.sources.map((s: any) => (
                <Card key={s.id}>
                  <Txt weight="bold">
                    طلب #{s.order_number} · {s.amount_yer} ر.ي
                  </Txt>
                  <Txt>
                    {s.allocated_to ? (cash ? "مورد" : "مسدد") : "غير مخصص"} ·{" "}
                    {utc(s.earned_at ?? s.collected_at)}
                  </Txt>
                  {!cash && (
                    <Txt>
                      أساس {s.delivery_fee_before_discount_yer} · خصم{" "}
                      {s.delivery_discount_yer} · نسبة {s.commission_bps / 100}%
                    </Txt>
                  )}
                </Card>
              ))}
              {d.payouts.map((p: any) => (
                <Card key={p.id}>
                  <Txt>
                    {cash ? "توريد" : "تسوية"} {p.total_yer} ر.ي · {p.reference}
                  </Txt>
                  <Txt>
                    {utc(p.created_at)} · {p.allocations.length} بنود
                  </Txt>
                </Card>
              ))}
              {d.credits.map((c: any) => (
                <Card key={c.id}>
                  <Txt>
                    عكس موثق {c.amount_yer} · {c.reason} · {c.reference}
                  </Txt>
                  <Txt>
                    {c.allocated_to ? "خصص مرة أخرى" : "متاح لإعادة التخصيص"}
                  </Txt>
                </Card>
              ))}
            </>
          )}
        </>
      )}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
    </Page>
  );
}
export function Report() {
  const { user } = useAuth(),
    { id } = useLocalSearchParams<{ id: string }>();
  return <ReportView key={(user?.id ?? "guest") + id} />;
}
function ReportView() {
  const { user } = useAuth(),
    { id } = useLocalSearchParams<{ id: string }>(),
    r = useRouter(),
    op = useOperation(user?.id);
  const [details, setDetails] = useState(""),
    [kind, setKind] = useState("delivery_problem"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [media, setMedia] = useState(""),
    [uploading, setUploading] = useState(false),
    [confirm, setConfirm] = useState(false);
  async function send() {
    try {
      const d = await api("/courier/orders/" + id);
      await op.execute("/courier/orders/" + id + "/customer-flags", {
        expectedVersion: d.order.version,
        details,
        kind,
        ...(media ? { attachmentId: media } : {}),
      });
      setNotice("استلم الخادم البلاغ؛ تتابعه الإدارة دون حظر آلي");
      setConfirm(false);
      setDetails("");
      setMedia("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Page>
      <Header title="بلاغ أو تعذر التسليم" subtitle="مراجعة الإدارة" />
      <Action
        secondary
        title="العودة للمهمة"
        onPress={() => r.replace({ pathname: "/task", params: { id } })}
      />
      {!user ? (
        <LoginPanel />
      ) : (
        <Card>
          <Action
            title={
              kind === "delivery_problem"
                ? "النوع: تعذر تسليم"
                : "النوع: بلاغ على العميل"
            }
            secondary
            onPress={() =>
              setKind(
                kind === "delivery_problem"
                  ? "customer_flag"
                  : "delivery_problem",
              )
            }
          />
          <Input label="تفاصيل البلاغ" value={details} onChange={setDetails} />
          <Action
            secondary
            title={media ? "الصورة جاهزة" : "إضافة صورة اختيارية"}
            disabled={uploading || op.busy || !!op.command}
            onPress={() => {
              setUploading(true);
              void import("./upload")
                .then((m) => m.pickUpload("customer_flag", user.id))
                .then((id) => {
                  if (id) setMedia(id);
                })
                .catch((e) => setError(e.message))
                .finally(() => setUploading(false));
            }}
          />
          <Action
            title="مراجعة إرسال البلاغ"
            disabled={uploading || op.busy || !!op.command || !details}
            onPress={() => setConfirm(true)}
          />
          {confirm && (
            <Action
              title="تأكيد إرسال البلاغ"
              disabled={op.busy || uploading}
              onPress={() => void send()}
            />
          )}{" "}
          {op.command && (
            <Action
              title="إعادة محاولة البلاغ المحفوظ"
              disabled={op.busy}
              onPress={() =>
                void op
                  .execute()
                  .then(() => setNotice("أقر الخادم البلاغ"))
                  .catch((e) => setError(e.message))
              }
            />
          )}
        </Card>
      )}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
      {!!notice && <Txt>{notice}</Txt>}
    </Page>
  );
}
export function Pending() {
  const { user } = useAuth(),
    op = useOperation(user?.id);
  const [error, setError] = useState("");
  return (
    <Page>
      <Header
        title="العمليات المعلقة"
        subtitle="إعادة المحاولة بالمفتاح والمحتوى المحفوظين"
      />
      <Nav />
      {!user ? (
        <LoginPanel />
      ) : op.command ? (
        <Card>
          <Txt>عملية تنتظر إقرار الخادم</Txt>
          <Action
            title="إعادة المحاولة"
            disabled={op.busy}
            onPress={() => void op.execute().catch((e) => setError(e.message))}
          />
        </Card>
      ) : (
        <Txt>لا توجد عملية معلقة.</Txt>
      )}
      {!!error && <Txt>{error}</Txt>}
    </Page>
  );
}
