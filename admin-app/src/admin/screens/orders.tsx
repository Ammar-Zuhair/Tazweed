import { useCallback, useState } from "react";
import { View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useAdmin, useAdminClock } from "../../data/admin-provider";
import { readOrders, type ReadScenario } from "../../data/admin-repository";
import {
  accessibleBranches,
  can,
  commission,
  currentQuote,
  money,
  netApproved,
  clientFlags,
} from "../../domain/admin-model";
import type { Order } from "../../domain/types";
import {
  quoteStatuses,
  receiptOutcomes,
  holdStates,
  exceptionNames,
} from "../../domain/labels";
import {
  Action,
  BranchScope,
  Card,
  Choice,
  Choices,
  Field,
  Hint,
  LoadingPanel,
  Select,
  Shell,
  Txt,
  stamp,
  useConfirm,
} from "../components";
export const statusNames: Record<Order["status"], string> = {
  pending_review: "قيد المراجعة",
  confirmed: "تم التأكيد",
  on_the_way: "في الطريق",
  delivered: "تم التسليم",
  rejected: "مرفوض",
  cancelled: "ملغي",
};
export function OrdersScreen() {
  const { state } = useAdmin();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [scenario, setScenario] = useState<ReadScenario>("ready");
  const [rows, setRows] = useState<Order[]>([]);
  const [phase, setPhase] = useState<ReadScenario>("loading");
  const [retry, setRetry] = useState(0);
  useFocusEffect(
    useCallback(() => {
      const c = new AbortController();
      setPhase("loading");
      readOrders(state, query, status, scenario, c.signal)
        .then((data) => {
          if (!c.signal.aborted) {
            setRows(data);
            setPhase(data.length ? "ready" : "empty");
          }
        })
        .catch((e) => {
          if (!c.signal.aborted)
            setPhase(e.message === "offline" ? "offline" : "error");
        });
      return () => c.abort();
    }, [state, query, status, scenario, retry]),
  );
  return (
    <Shell title="الطلبات" permission="orders.review" back={false}>
      <BranchScope />
      <Field
        label="بحث رقم الطلب أو العميل"
        value={query}
        onChangeText={setQuery}
      />
      <Select
        label="حالة الطلب"
        value={status}
        options={[
          { id: "all", name: "كل الحالات" },
          ...Object.entries(statusNames).map(([id, name]) => ({ id, name })),
        ]}
        onChange={setStatus}
      />
      <Card>
        <Txt style={{ fontSize: 13 }}>اختبار حالات قراءة محلية</Txt>
        <Choices>
          {(
            ["ready", "loading", "empty", "error", "offline"] as ReadScenario[]
          ).map((x) => (
            <Choice
              key={x}
              label={
                {
                  ready: "بيانات المعاينة",
                  loading: "تحميل بطيء",
                  empty: "قائمة فارغة",
                  error: "خطأ تجريبي",
                  offline: "انقطاع تجريبي",
                }[x]
              }
              selected={scenario === x}
              onPress={() => setScenario(x)}
            />
          ))}
        </Choices>
      </Card>
      {phase !== "ready" ? (
        <LoadingPanel
          status={phase}
          onRetry={() => {
            setScenario("ready");
            setRetry((n) => n + 1);
          }}
        />
      ) : (
        rows.map((o) => (
          <Card key={o.id}>
            <Txt weight="bold" style={{ fontSize: 21 }}>
              {o.id} · {statusNames[o.status]}
            </Txt>
            <Txt>
              {o.customer} · {o.kind === "wholesale" ? "جملة" : "تجزئة"} ·{" "}
              {o.paymentKind === "cash" ? "نقد عند الاستلام" : "تحويل"}
            </Txt>
            <Txt>
              {o.branchId
                ? state.branches.find((b) => b.id === o.branchId)?.name
                : "بانتظار اختيار فرع التنفيذ"}
            </Txt>
            {o.quotes.length > 0 && (
              <Txt>
                نسخة{o.quotes.length} ·{" "}
                {currentQuote(o)?.status === "accepted"
                  ? "مقبولة"
                  : "تنتظر العميل"}{" "}
                · {money(currentQuote(o)!.total)}
              </Txt>
            )}
            {state.complaints.some(
              (f) =>
                f.type === "flag" &&
                state.orders.find((x) => x.id === f.orderId)?.customerId ===
                  o.customerId,
            ) && (
              <Hint warning>تنبيه: بلاغ سابق على العميل · ليس حظرًا آليًا</Hint>
            )}
            {state.reservations.some(
              (r) =>
                r.orderId === o.id &&
                r.state === "active" &&
                r.kind === "receipt_review",
            ) && (
              <Hint warning>إيصال قيد المراجعة · حجز محمي بلا مهلة تحرير</Hint>
            )}
            <Action
              title={`فتح الطلب ${o.id}`}
              onPress={() => router.push(`/order?id=${o.id}`)}
            />
          </Card>
        ))
      )}
    </Shell>
  );
}
export function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, send } = useAdmin();
  const now = useAdminClock();
  const o = state.orders.find((o) => o.id === id);
  const confirm = useConfirm();
  const [branch, setBranch] = useState(
    o?.branchId ?? o?.catalogBranchId ?? "aden",
  );
  const [prices, setPrices] = useState<string[]>(
    (o && (currentQuote(o)?.items ?? o.items).map((i) => String(i.price))) ??
      [],
  );
  const [deliveryMode, setDeliveryMode] = useState<"road" | "manual">("road");
  const [manualDelivery, setManualDelivery] = useState("500");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [external, setExternal] = useState(false);
  const [holdAction, setHoldAction] = useState<"keep" | "release">("keep");
  const [outcome, setOutcome] = useState<
    "image_rejected" | "transfer_verified" | "transfer_rejected"
  >("transfer_verified");
  const [ack, setAck] = useState(false);
  const [courier, setCourier] = useState("courier-1");
  const [receiptNumber, setReceiptNumber] = useState("DEMO-NEW");
  const [method, setMethod] = useState("wallet-demo");
  const [cash, setCash] = useState("");
  const [reference, setReference] = useState("");
  if (!o)
    return (
      <Shell title="الطلب غير موجود">
        <Hint>ارجع إلى قائمة الطلبات.</Hint>
      </Shell>
    );
  const q = currentQuote(o);
  const permissionBranch = o.branchId ?? o.catalogBranchId;
  const allowed = (p: Parameters<typeof can>[1]) =>
    can(state, p, permissionBranch);
  const flags = clientFlags(state, o);
  const holds = state.reservations.filter((r) => r.orderId === o.id);
  const payment = o.payments.at(-1);
  const assigned = o.assignments.at(-1);
  return (
    <Shell
      title={`طلب ${o.id}`}
      subtitle={`${statusNames[o.status]} · ${o.kind === "wholesale" ? "جملة" : "تجزئة"} · نسخة حالة${o.version}`}
      permission="orders.review"
      branchId={permissionBranch}
    >
      <Card>
        <Txt weight="bold">{o.customer}</Txt>
        <Txt>
          {o.address} · {o.phone}
        </Txt>
        <Txt>
          فرع الكتالوج:{" "}
          {state.branches.find((b) => b.id === o.catalogBranchId)?.name}
        </Txt>
        <Txt>
          فرع التنفيذ:{" "}
          {state.branches.find((b) => b.id === o.branchId)?.name ??
            "لم يختره المدير"}
        </Txt>
        <Txt>
          الدفع:{" "}
          {o.paymentKind === "cash"
            ? "نقد — انتظار التحصيل الفعلي"
            : "تحويل يدوي — تحقق خارجي"}
        </Txt>
        {o.cancellationRequested && (
          <Hint warning>
            طلب إلغاء من العميل بعد الإيصال؛ راجع المال أولًا.
          </Hint>
        )}
      </Card>
      {flags.hasFlags && (
        <Card>
          <Hint warning>
            تنبيه بلاغ سابق على العميل. لا حظر آلي؛ المراجعة قبل التأكيد.
          </Hint>
          {flags.details.length > 0 ? (
            flags.details.map((f) => <Txt key={f.id}>{f.text}</Txt>)
          ) : (
            <Txt>تفاصيل البلاغ للمخول فقط؛ اطلب مراجعة مسؤول مخول.</Txt>
          )}
          <Choice
            label="راجعت تنبيه بلاغ العميل"
            selected={ack}
            onPress={() => setAck(!ack)}
          />
        </Card>
      )}
      <Card>
        <Txt weight="bold">
          بنود الطلب{" "}
          {o.kind === "wholesale"
            ? q
              ? "— أسعار الجملة الخاصة بالطلب"
              : "— مرجع تجزئة قبل التسعيرة"
            : ""}
        </Txt>
        {(q?.items ?? o.items).map((i, n) => (
          <Txt key={`${i.unitId}-${n}`}>
            {i.name} · {i.quantity} {i.unitName} × {i.pieces} حبة ·{" "}
            {money(i.price)} للوحدة
          </Txt>
        ))}
      </Card>
      {q && (
        <Card>
          <Txt weight="bold">التسعيرة الحالية · نسخة{q.revision}</Txt>
          <Txt>
            منتجات {money(q.subtotal)} · خصم منتجات {money(q.productDiscount)}
          </Txt>
          <Txt>
            توصيل قبل الخصم {money(q.delivery)} · خصمه{" "}
            {money(q.deliveryDiscount)} · رسوم العميل{" "}
            {money(q.delivery - q.deliveryDiscount)}
          </Txt>
          <Txt weight="bold" testID="quote-total">
            الإجمالي {money(q.total)}
          </Txt>
          <Txt>
            {q.pricingMode === "road"
              ? `طريق تجريبي ${q.distance}م؛ المحسوب ${Math.floor((q.distance ?? 0) / 1000)}كم صحيحة`
              : `يدوي بسبب: ${q.reason}`}
          </Txt>
          <Txt>
            {q.status === "accepted"
              ? `قبول محفوظ ${stamp(q.acceptedAt!)}`
              : "تنتظر موافقة العميل على هذه النسخة"}
          </Txt>
        </Card>
      )}
      <Card>
        <Txt weight="bold">تاريخ النسخ والموافقة</Txt>
        {o.quotes.length === 0 ? (
          <Txt>لا تسعيرة أو حجز قبل إصدار المدير.</Txt>
        ) : (
          o.quotes.map((v) => (
            <View key={v.id} style={{ gap: 4, paddingVertical: 8 }}>
              <Txt>
                نسخة{v.revision} ·{" "}
                {state.branches.find((b) => b.id === v.branchId)?.name} ·{" "}
                {money(v.total)} · {quoteStatuses[v.status]}
              </Txt>
              <Txt>
                {v.reason} ·{" "}
                {v.acceptedAt
                  ? `القبول السابق محفوظ: ${stamp(v.acceptedAt)}`
                  : "لم تقبل"}
              </Txt>
            </View>
          ))
        )}
      </Card>
      <Card>
        <Txt weight="bold">الحجز وتاريخه</Txt>
        {holds.length === 0 ? (
          <Txt>لا حجز.</Txt>
        ) : (
          holds.map((r) => (
            <Txt key={r.id}>
              {r.pieces} حبة · {holdStates[r.state]} ·{" "}
              {r.kind === "receipt_review"
                ? `محمي حتى مراجعة صريحة، بلا انتهاء${r.state === "active" && now - (r.protectedAt ?? now) >= state.settings.lateAlertMinutes * 60000 ? " · تنبيه مراجعة متأخرة" : ""}`
                : `أولي حتى ${stamp(r.expiresAt!)}`}
            </Txt>
          ))
        )}
      </Card>
      {o.status === "pending_review" && allowed("orders.reprice") && (
        <Card>
          <Txt weight="bold">إصدار نسخة جديدة</Txt>
          <Select
            label="فرع التنفيذ اليدوي"
            value={branch}
            options={accessibleBranches(state).map((b) => ({
              id: b.id,
              name: b.name,
            }))}
            onChange={setBranch}
          />
          <Hint warning>
            تغيير الفرع يحتاج موافقة جديدة ولو الإجمالي نفسه. إيصال محمي يمنع
            إعادة التسعير الصامتة.
          </Hint>
          {o.items.map((i, n) => (
            <Field
              key={i.unitId}
              label={`سعر البند ${n + 1} بالريال`}
              keyboardType="numeric"
              value={prices[n] ?? ""}
              onChangeText={(v) =>
                setPrices(prices.map((x, index) => (index === n ? v : x)))
              }
            />
          ))}
          <Select
            label="طريقة رسوم التوصيل"
            value={deliveryMode}
            options={[
              { id: "road", name: "طريق تجريبي 2800م" },
              { id: "manual", name: "تعذر الطريق — رسوم يدوية" },
            ]}
            onChange={setDeliveryMode}
          />
          {deliveryMode === "manual" && (
            <Field
              label="رسوم التوصيل اليدوية"
              keyboardType="numeric"
              value={manualDelivery}
              onChangeText={setManualDelivery}
            />
          )}
          <Field
            label="سبب القرار *"
            multiline
            value={reason}
            onChangeText={setReason}
          />
          <Action
            title="مراجعة إصدار التسعيرة"
            onPress={() =>
              confirm.ask(
                "إصدار نسخة جديدة",
                `الفرع المختار: ${state.branches.find((b) => b.id === branch)?.name} · النسخة السابقة محفوظة؛ يلزم قبول العميل.`,
                {
                  type: "quote",
                  orderId: o.id,
                  expectedVersion: o.version,
                  branchId: branch,
                  prices: prices.map((x) => (x.trim() ? Number(x) : NaN)),
                  deliveryMode,
                  manualDelivery: Number(manualDelivery),
                  reason,
                  confirmed: true,
                },
              )
            }
          />
        </Card>
      )}
      {o.status === "pending_review" && (
        <Card>
          <Txt weight="bold">أحداث العميل للمعاينة فقط</Txt>
          <Hint>
            لا اتصال بتطبيق العميل. هذه الأزرار تحاكي الردود لمراجعة الإدارة.
          </Hint>
          <Action
            title="محاكاة قبول العميل — نقد"
            secondary
            onPress={() =>
              send({
                type: "preview-accept",
                orderId: o.id,
                paymentKind: "cash",
              })
            }
          />
          <Action
            title="محاكاة قبول العميل — تحويل"
            secondary
            onPress={() =>
              send({
                type: "preview-accept",
                orderId: o.id,
                paymentKind: "transfer",
              })
            }
          />
          {allowed("payments.verify") && (
            <>
              <Select
                label="وسيلة تحويل المعاينة"
                value={method}
                options={state.methods
                  .filter(
                    (m) =>
                      m.active && (!m.branchId || m.branchId === o.branchId),
                  )
                  .map((m) => ({ id: m.id, name: m.name }))}
                onChange={setMethod}
              />
              <Field
                label="رقم تحويل المعاينة"
                value={receiptNumber}
                onChangeText={setReceiptNumber}
              />
              <Action
                title="تثبيت تعليمات التحويل التجريبية"
                secondary
                onPress={() =>
                  send({
                    type: "preview-instructions",
                    orderId: o.id,
                    methodId: method,
                  })
                }
              />
              {o.instructions
                .filter((i) => i.quoteId === q?.id && i.methodId === method)
                .map((i) => (
                  <Hint key={i.id}>
                    تعليمات ثابتة قبل الإيصال · {i.snapshot.method} ·{" "}
                    {i.snapshot.beneficiary} · {i.snapshot.destination} ·{" "}
                    {money(i.snapshot.amount)}
                  </Hint>
                ))}
              <Field
                label="مبلغ التحويل أو التحقق"
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
              <Action
                title="محاكاة رفع صورة لنفس التحويل"
                secondary
                onPress={() =>
                  send({
                    type: "preview-receipt",
                    orderId: o.id,
                    number: receiptNumber,
                    amount: amount.trim() ? Number(amount) : NaN,
                    methodId: method,
                  })
                }
              />
            </>
          )}
        </Card>
      )}
      {allowed("payments.verify") ? (
        <Card>
          <Txt weight="bold">صور الإيصال الخاصة — معاينة مخولة</Txt>
          <Hint warning>
            رسوم إيصال محلية وليست ملفات مالية حقيقية أو روابط R2. لا تعتمد
            المال من الصورة وحدها.
          </Hint>
          {o.payments.map((p) => (
            <View key={p.id} style={{ gap: 14 }}>
              <Txt weight="bold">
                {p.number} · التحويل {p.id}
              </Txt>
              <Txt>
                {p.instructions.method} · {p.instructions.beneficiary} ·{" "}
                {p.instructions.destination}
              </Txt>
              <Txt>
                تعليمات مثبتة {money(p.instructions.amount)} · مبلغ عنه{" "}
                {money(p.reported)} · معتمد {money(p.approved ?? 0)}
              </Txt>
              {p.attempts.map((a, n) => (
                <Card key={a.id} accessibilityLabel={`محاولة الإيصال ${n + 1}`}>
                  <View
                    style={{
                      padding: 24,
                      borderStyle: "dashed",
                      borderWidth: 1,
                      borderColor: "#B8C2CC",
                      gap: 8,
                    }}
                  >
                    <Txt weight="bold">إيصال تجريبي — لا قيمة مالية</Txt>
                    <Txt>{a.image}</Txt>
                    <Txt>
                      {p.number} · {money(p.reported)}
                    </Txt>
                  </View>
                  <Txt>{stamp(a.submittedAt)}</Txt>
                  <Txt>
                    {a.review
                      ? `${receiptOutcomes[a.review.outcome]} · ${a.review.reason} · ${a.review.holdAction === "keep" ? "حجز باقٍ" : "تحرير صريح"}`
                      : "بانتظار المراجعة الخارجية"}
                  </Txt>
                </Card>
              ))}
            </View>
          ))}
          {payment &&
            !payment.attempts.at(-1)?.review &&
            o.status === "pending_review" && (
              <>
                <Select
                  label="نتيجة مراجعة الإيصال"
                  value={outcome}
                  options={[
                    { id: "transfer_verified", name: "تحويل متحقق خارجيًا" },
                    { id: "image_rejected", name: "رفض صورة للتصحيح" },
                    { id: "transfer_rejected", name: "رفض التحويل بعد التحقق" },
                  ]}
                  onChange={setOutcome}
                />
                <Field
                  label="المبلغ المتحقق خارجيًا"
                  keyboardType="numeric"
                  value={amount}
                  onChangeText={setAmount}
                />
                <Choice
                  label="تحققت خارجيًا من وصول المال"
                  selected={external}
                  onPress={() => setExternal(!external)}
                />
                <Select
                  label="إجراء الحجز الصريح"
                  value={holdAction}
                  options={[
                    { id: "keep", name: "إبقاء الحجز للمراجعة أو التصحيح" },
                    { id: "release", name: "تحرير بعد مراجعة مسببّة" },
                  ]}
                  onChange={setHoldAction}
                />
                <Field
                  label="سبب مراجعة الإيصال *"
                  multiline
                  value={reason}
                  onChangeText={setReason}
                />
                <Action
                  title="مراجعة قرار الإيصال والحجز"
                  onPress={() =>
                    confirm.ask(
                      "اعتماد مراجعة الإيصال",
                      `النتيجة ${receiptOutcomes[outcome]} · مبلغ ${amount || "غير محدد"} · الحجز ${holdAction === "keep" ? "يبقى محميًا" : "يحرر صراحة"} · ${reason}`,
                      {
                        type: "receipt-review",
                        orderId: o.id,
                        outcome,
                        amount: Number(amount),
                        reason,
                        externalChecked: external,
                        holdAction,
                        confirmed: true,
                      },
                    )
                  }
                />
              </>
            )}
        </Card>
      ) : (
        <Hint>مراجعة الإيصال وتفاصيله محجوبة دون payments.verify.</Hint>
      )}
      {state.exceptions
        .filter((e) => e.orderId === o.id)
        .map((e) => (
          <Card key={e.id}>
            <Hint warning>
              استثناء مالي {exceptionNames[e.kind]} · {money(e.amount)} ·{" "}
              {e.resolution ? "معالجة موثقة" : "مفتوح"}
            </Hint>
            <Txt>{e.reason}</Txt>
            <Action
              title="فتح معالجة الاستثناءات"
              secondary
              onPress={() => router.push("/finance")}
            />
          </Card>
        ))}
      {o.deliveryIssues.length > 0 && (
        <Card>
          <Txt weight="bold">بلاغات تعذر التسليم</Txt>
          {o.deliveryIssues.map((i) => (
            <View key={i.id} style={{ gap: 8 }}>
              <Hint warning>
                {i.reason} · {stamp(i.at)}
              </Hint>
              <Txt>
                {i.response
                  ? `رد الإدارة: ${i.response}`
                  : "مفتوح · لا تسليم أو إلغاء أو تغيير مبلغ تلقائي"}
              </Txt>
            </View>
          ))}
          {o.status === "on_the_way" &&
            allowed("orders.assign") &&
            o.deliveryIssues.some((i) => !i.response) && (
              <>
                <Field
                  label="رد الإدارة على تعذر التسليم *"
                  value={reason}
                  onChangeText={setReason}
                  multiline
                />
                <Action
                  title="مراجعة رد تعذر التسليم"
                  onPress={() =>
                    confirm.ask("توثيق رد الإدارة", reason, {
                      type: "delivery-issue",
                      orderId: o.id,
                      reason,
                      preview: false,
                      confirmed: true,
                    })
                  }
                />
              </>
            )}
        </Card>
      )}
      {o.status === "pending_review" && allowed("orders.confirm") && (
        <Card>
          <Txt weight="bold">التحقق والتأكيد</Txt>
          <Txt>
            صافي تحويل متحقق {money(netApproved(state, o))} · النقد لا يحتاج
            إيصالًا.
          </Txt>
          <Field
            label="سبب إعادة التحقق أو الرفض *"
            multiline
            value={reason}
            onChangeText={setReason}
          />
          <Action
            title="مراجعة إعادة تحقق حجز نقدي"
            secondary
            onPress={() =>
              confirm.ask(
                "إعادة فحص نفس الحقائق",
                "لا تغيير snapshot أو قبول سابق. تغير السعر يلزم نسخة جديدة.",
                { type: "revalidate", orderId: o.id, reason, confirmed: true },
              )
            }
          />
          <Action
            title="مراجعة تأكيد الطلب"
            onPress={() =>
              confirm.ask(
                "تأكيد الطلب وصرف المخزون",
                `المبلغ ${money(q?.total ?? 0)} ثابت بعد التأكيد. النقد ليس مدفوعًا تلقائيًا.`,
                {
                  type: "confirm",
                  orderId: o.id,
                  expectedVersion: o.version,
                  flagAcknowledged: ack,
                  confirmed: true,
                },
              )
            }
          />
          {allowed("orders.reject") && (
            <>
              <Action
                title="مراجعة رفض الطلب"
                secondary
                onPress={() =>
                  confirm.ask("رفض الطلب", reason, {
                    type: "close-order",
                    orderId: o.id,
                    status: "rejected",
                    reason,
                    confirmed: true,
                  })
                }
              />
              {o.cancellationRequested && (
                <Action
                  title="مراجعة قبول طلب الإلغاء"
                  secondary
                  onPress={() =>
                    confirm.ask("قبول طلب الإلغاء", reason, {
                      type: "close-order",
                      orderId: o.id,
                      status: "cancelled",
                      reason,
                      confirmed: true,
                    })
                  }
                />
              )}
            </>
          )}
        </Card>
      )}
      {(o.status === "confirmed" || o.status === "on_the_way") &&
        allowed("orders.assign") && (
          <Card>
            <Txt weight="bold">الإسناد والعمولة</Txt>
            {assigned && (
              <Txt>
                الأساس قبل الخصم {money(assigned.base)} · خصم{" "}
                {money(assigned.discount)} · نسبة {assigned.bps / 100}% · عمولة
                ثابتة {money(assigned.commission)} · تستحق عند التسليم
              </Txt>
            )}
            {o.assignments.map((a) => (
              <Txt key={a.id} style={{ fontSize: 13 }}>
                {state.couriers.find((c) => c.id === a.courierId)?.name} ·{" "}
                {stamp(a.at)} ·{" "}
                {a.endedAt ? "إسناد سابق محفوظ" : "الإسناد الحالي"} ·{" "}
                {a.bps / 100}% · {money(a.commission)}
              </Txt>
            ))}
            {o.status === "confirmed" && (
              <>
                <Select
                  label="الموصل المسند"
                  value={courier}
                  options={state.couriers
                    .filter(
                      (c) => c.active && c.branchIds.includes(o.branchId!),
                    )
                    .map((c) => ({
                      id: c.id,
                      name: `${c.name} · ${c.bps === null ? "نسبة غير مضبوطة" : `${c.bps / 100}%`}`,
                    }))}
                  onChange={setCourier}
                />
                <Field
                  label="سبب الإسناد أو إعادة الإسناد *"
                  value={reason}
                  onChangeText={setReason}
                />
                <Hint>
                  المثال500 قبل الخصم−100خصم، بنسبة20%: العمولة
                  {commission(500, 2000)}، ورسوم العميل400.
                </Hint>
                <Action
                  title="مراجعة إسناد الموصل"
                  onPress={() =>
                    confirm.ask(
                      "إسناد موصل",
                      `تثبت نسبة الموصل وأساس ما قبل الخصم الآن؛ لا رفض إسناد من الموصل.`,
                      {
                        type: "assign",
                        orderId: o.id,
                        courierId: courier,
                        reason,
                        confirmed: true,
                      },
                    )
                  }
                />
                {assigned && (
                  <Action
                    title="محاكاة بدء الطريق"
                    secondary
                    onPress={() =>
                      send({
                        type: "preview-courier",
                        orderId: o.id,
                        stage: "on_the_way",
                        collected: 0,
                        reference: "",
                        reason: "",
                      })
                    }
                  />
                )}
              </>
            )}
            {o.status === "on_the_way" && (
              <>
                <Hint>محاكاة حدث موصل فقط، دون تنفيذ تطبيق04.</Hint>
                <Field
                  label="نقد محصل فعليًا — محاكاة"
                  keyboardType="numeric"
                  value={cash}
                  onChangeText={setCash}
                />
                <Field
                  label="مرجع تحصيل المعاينة"
                  value={reference}
                  onChangeText={setReference}
                />
                <Field
                  label="سبب نقص أو تعذر التحصيل"
                  value={reason}
                  onChangeText={setReason}
                />
                <Action
                  title="محاكاة بلاغ تعذر التسليم"
                  secondary
                  onPress={() =>
                    send({
                      type: "delivery-issue",
                      orderId: o.id,
                      reason,
                      preview: true,
                      confirmed: false,
                    })
                  }
                />
                <Action
                  title="محاكاة تسليم وتحصيل صريح"
                  secondary
                  onPress={() =>
                    send({
                      type: "preview-courier",
                      orderId: o.id,
                      stage: "delivered",
                      collected: cash.trim() ? Number(cash) : NaN,
                      reference,
                      reason,
                    })
                  }
                />
              </>
            )}
          </Card>
        )}
      <Card>
        <Txt weight="bold">خط زمني محفوظ</Txt>
        {o.events.map((e, n) => (
          <Txt key={n}>
            {stamp(e.at)} · {e.text}
          </Txt>
        ))}
      </Card>
      {confirm.dialog}
    </Shell>
  );
}
