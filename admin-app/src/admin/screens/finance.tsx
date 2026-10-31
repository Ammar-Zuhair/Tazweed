import { useState } from "react";
import { useAdmin, useAdminClock } from "../../data/admin-provider";
import {
  accessibleBranches,
  availableSources,
  can,
  money,
} from "../../domain/admin-model";
import type { Courier, Method } from "../../domain/types";
import { exceptionNames } from "../../domain/labels";
import {
  Action,
  BranchScope,
  Card,
  Choice,
  Choices,
  Field,
  Hint,
  Save,
  Select,
  Shell,
  Txt,
  stamp,
  uid,
  useConfirm,
} from "../components";
const freshCourier = (): Courier => ({
  id: uid("courier"),
  name: "",
  phone: "",
  active: true,
  branchIds: [],
  bps: null,
});
export function CouriersScreen() {
  const { state } = useAdmin();
  const now = useAdminClock();
  const [form, setForm] = useState<Courier>(freshCourier);
  const [reason, setReason] = useState("");
  const confirm = useConfirm();
  const branches = accessibleBranches(state);
  const set = (v: Partial<Courier>) => setForm({ ...form, ...v });
  const visible = state.couriers.filter((c) =>
    c.branchIds.some((b) => branches.some((x) => x.id === b)),
  );
  return (
    <Shell title="الموصلون والعمولات" permission="couriers.manage">
      <BranchScope />
      <Choices>
        <Choice
          label="موصل داخلي جديد"
          selected={!state.couriers.some((x) => x.id === form.id)}
          onPress={() => setForm(freshCourier())}
        />
        {visible.map((c) => (
          <Choice
            key={c.id}
            label={c.name}
            selected={c.id === form.id}
            onPress={() => setForm(JSON.parse(JSON.stringify(c)))}
          />
        ))}
      </Choices>
      <Card>
        <Field
          label="اسم الموصل *"
          value={form.name}
          onChangeText={(name) => set({ name })}
        />
        <Field
          label="هاتف الموصل التجريبي *"
          keyboardType="phone-pad"
          value={form.phone}
          onChangeText={(phone) => set({ phone })}
        />
        <Field
          label="نسبة العمولة bps — فارغ لغير المضبوط"
          value={form.bps === null ? "" : String(form.bps)}
          onChangeText={(v) => set({ bps: v === "" ? null : Number(v) })}
          keyboardType="numeric"
        />
        <Hint>
          2000bps =20% · لا نسبة تشغيلية افتراضية. تغيير النسبة يؤثر على الإسناد
          الجديد فقط، لا التاريخ.
        </Hint>
        <Txt>نطاق الفروع</Txt>
        <Choices>
          {branches.map((b) => (
            <Choice
              key={b.id}
              label={`نطاق ${b.name}`}
              selected={form.branchIds.includes(b.id)}
              onPress={() =>
                set({
                  branchIds: form.branchIds.includes(b.id)
                    ? form.branchIds.filter((x) => x !== b.id)
                    : [...form.branchIds, b.id],
                })
              }
            />
          ))}
        </Choices>
        <Choice
          label="الموصل نشط"
          selected={form.active}
          onPress={() => set({ active: !form.active })}
        />
        <Field
          label="سبب تعديل الموصل *"
          value={reason}
          onChangeText={setReason}
        />
        <Save
          title="مراجعة حفظ الموصل"
          onPress={() =>
            confirm.ask(
              "تعديل حساب موصل تجريبي",
              `${form.name} · ${form.bps === null ? "لا نسبة" : `${form.bps / 100}%`} · ${reason}`,
              { type: "courier", value: form, reason, confirmed: true },
            )
          }
        />
      </Card>
      <Card>
        <Txt weight="bold">سجل تعديل الموصلين</Txt>
        {state.audit
          .filter(
            (x) =>
              x.action === "courier" &&
              (!x.branchId || branches.some((b) => b.id === x.branchId)),
          )
          .map((x) => (
            <Txt key={x.id}>
              {stamp(x.at)} · {x.summary}
            </Txt>
          ))}
      </Card>
      {visible.map((c) => {
        const earned = state.earnings.filter(
          (e) =>
            e.courierId === c.id &&
            can(state, "reports.read", e.branchId) &&
            (!state.selectedBranch || state.selectedBranch === e.branchId),
        );
        const today = new Date(now).toISOString().slice(0, 10);
        const due = availableSources(state, "commission", c.id).filter(
          (e) =>
            (!state.selectedBranch || e.branchId === state.selectedBranch) &&
            (!e.branchIds ||
              e.branchIds.every(
                (b) => !state.selectedBranch || b === state.selectedBranch,
              )),
        );
        return (
          <Card key={c.id}>
            <Txt weight="bold">مستحقات {c.name}</Txt>
            <Txt>
              عمولات تسليم اليوم — UTC:{" "}
              {money(
                earned
                  .filter((e) => new Date(e.at).toISOString().startsWith(today))
                  .reduce((n, e) => n + e.amount, 0),
              )}
            </Txt>
            <Txt>
              غير المسدد المخول: {money(due.reduce((n, e) => n + e.amount, 0))}
            </Txt>
            <Hint>
              العمولة تستحق مرة عند التسليم. نقد المتجر وتوريده في دفتر مستقل.
              بيانات يوم UTC للمعاينة فقط.
            </Hint>
          </Card>
        );
      })}
      {confirm.dialog}
    </Shell>
  );
}
const newMethod = (): Method => ({
  id: uid("method"),
  name: "",
  beneficiary: "",
  destination: "",
  instructions: "",
  active: true,
  branchId: null,
  order: 1,
});
export function MethodsScreen() {
  const { state, send } = useAdmin();
  const [form, setForm] = useState<Method>(newMethod);
  const set = (v: Partial<Method>) => setForm({ ...form, ...v });
  return (
    <Shell
      title="وسائل التحويل"
      permission="payment-methods.write"
      branchId={null}
    >
      <Hint warning>
        بيانات وهمية، لا تحول مالًا. لا API مالي أو مزود متصل. تعليمات الطلب
        السابقة لا تتغير بتعديل هذه الوسائل.
      </Hint>
      <Choices>
        <Choice
          label="وسيلة جديدة"
          selected={!state.methods.some((m) => m.id === form.id)}
          onPress={() => setForm(newMethod())}
        />
        {state.methods.map((m) => (
          <Choice
            key={m.id}
            label={m.name}
            selected={m.id === form.id}
            onPress={() => setForm({ ...m })}
          />
        ))}
      </Choices>
      <Card>
        <Field
          label="اسم وسيلة التحويل *"
          value={form.name}
          onChangeText={(name) => set({ name })}
        />
        <Field
          label="المستفيد *"
          value={form.beneficiary}
          onChangeText={(beneficiary) => set({ beneficiary })}
        />
        <Field
          label="رقم المستفيد التجريبي *"
          value={form.destination}
          onChangeText={(destination) => set({ destination })}
        />
        <Field
          label="تعليمات التحويل"
          multiline
          value={form.instructions}
          onChangeText={(instructions) => set({ instructions })}
        />
        <Field
          label="ترتيب الوسيلة"
          keyboardType="numeric"
          value={String(form.order)}
          onChangeText={(x) => set({ order: Number(x) })}
        />
        <Select
          label="نطاق الوسيلة"
          value={form.branchId ?? "all"}
          options={[
            { id: "all", name: "كل الفروع" },
            ...state.branches.map((b) => ({ id: b.id, name: b.name })),
          ]}
          onChange={(b) => set({ branchId: b === "all" ? null : b })}
        />
        <Choice
          label="وسيلة نشطة"
          selected={form.active}
          onPress={() => set({ active: !form.active })}
        />
        <Save
          title="حفظ وسيلة التحويل"
          onPress={() => send({ type: "method", value: form })}
        />
      </Card>
    </Shell>
  );
}
export function FinanceScreen() {
  const { state } = useAdmin();
  const [kind, setKind] = useState<"commission" | "cash">("commission");
  const [courier, setCourier] = useState("courier-1");
  const [selected, setSelected] = useState<string[]>([]);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [proof, setProof] = useState("");
  const [direction, setDirection] = useState<
    "refund" | "received" | "write_off" | "other"
  >("refund");
  const confirm = useConfirm();
  const sources = availableSources(state, kind, courier);
  const payouts = kind === "commission" ? state.settlements : state.remittances;
  const reversals =
    kind === "commission" ? state.commissionReversals : state.cashReversals;
  const allowed = (b: string) =>
    can(
      state,
      kind === "commission" ? "commissions.settle" : "cash.remit",
      b,
    ) &&
    (!state.selectedBranch || state.selectedBranch === b);
  const rows = (kind === "commission" ? state.earnings : state.cash).filter(
    (r) => allowed(r.branchId),
  );
  const couriers = state.couriers.filter((c) => c.branchIds.some(allowed));
  const visibleSources = sources.filter((r) =>
    r.branchIds ? r.branchIds.every(allowed) : allowed(r.branchId),
  );
  const visiblePayouts = payouts.filter(
    (p) => p.courierId === courier && p.branchIds.every(allowed),
  );
  const exceptions = state.exceptions.filter((e) => {
    const o = state.orders.find((o) => o.id === e.orderId);
    return (
      o &&
      can(
        state,
        "financial-exceptions.resolve",
        o.branchId ?? o.catalogBranchId,
      ) &&
      (!state.selectedBranch ||
        (o.branchId ?? o.catalogBranchId) === state.selectedBranch)
    );
  });
  return (
    <Shell title="الدفاتر المالية">
      <BranchScope />
      <Hint warning>
        دفتر أموال المتجر مستقل عن عمولات الموصل. كل قيد هنا محلي، ولا تنفيذ دفع
        أو استرداد.
      </Hint>
      <Select
        label="نوع الدفتر"
        value={kind}
        options={[
          { id: "commission", name: "عمولات الموصل" },
          { id: "cash", name: "نقد المتجر وتوريده" },
        ]}
        onChange={(x) => {
          setKind(x);
          setSelected([]);
        }}
      />
      <Select
        label="موصل الدفتر"
        value={courier}
        options={couriers.map((c) => ({ id: c.id, name: c.name }))}
        onChange={(x) => {
          setCourier(x);
          setSelected([]);
        }}
      />
      <Card>
        <Txt weight="bold">
          {kind === "commission" ? "استحقاقات التسليم" : "النقد المحصل الفعلي"}
        </Txt>
        {rows
          .filter((r) => r.courierId === courier)
          .map((r) => (
            <Txt key={r.id}>
              {r.orderId} · {money(r.amount)} · {r.reference} · {stamp(r.at)}
            </Txt>
          ))}
        {rows.filter((r) => r.courierId === courier).length === 0 && (
          <Txt>لا قيود مخولة في هذا النطاق.</Txt>
        )}
        <Txt testID="available-ledger">
          {kind === "commission"
            ? "المتاح لصرف العمولة"
            : "المتاح لتوريد النقد"}
          : {money(visibleSources.reduce((n, r) => n + r.amount, 0))}
        </Txt>
        <Hint>
          {kind === "commission"
            ? "تستحق مرة عند التسليم على أساس التوصيل قبل الخصم. عكس التسوية رصيد مستقل وليس earning جديدًا."
            : "تسجيل التسليم لا يخلق تحصيلًا. المبلغ المحصل مال متجر كامل؛ لا تطرح منه العمولة تلقائيًا."}
        </Hint>
      </Card>
      <Card>
        <Txt weight="bold">مصادر القيد المتاحة</Txt>
        {visibleSources.map((r) => (
          <Choice
            key={r.id}
            label={`${r.reference} · ${money(r.amount)}`}
            selected={selected.includes(r.id)}
            onPress={() =>
              setSelected(
                selected.includes(r.id)
                  ? selected.filter((x) => x !== r.id)
                  : [...selected, r.id],
              )
            }
          />
        ))}
        <Field
          label="مرجع القيد أو المعالجة *"
          value={reference}
          onChangeText={setReference}
        />
        <Field
          label="سبب القيد أو العكس *"
          multiline
          value={reason}
          onChangeText={setReason}
        />
        <Select
          label="إثبات محلي تجريبي *"
          value={proof}
          options={[
            { id: "", name: "اختر إثباتًا" },
            { id: "LOCAL-DEMO-PROOF", name: "مرفق معاينة غير مالي" },
          ]}
          onChange={setProof}
        />
        <Action
          title={
            kind === "commission"
              ? "مراجعة صرف عمولة"
              : "مراجعة استلام توريد النقد"
          }
          onPress={() =>
            confirm.ask(
              kind === "commission"
                ? "تسوية عمولة منفصلة"
                : "استلام نقد المتجر كاملًا",
              `الإجمالي المختار ${money(visibleSources.filter((r) => selected.includes(r.id)).reduce((n, r) => n + r.amount, 0))} · ${reference} · لا مقاصة بين الدفترين.`,
              {
                type: "payout",
                kind,
                courierId: courier,
                sourceIds: selected.filter((id) =>
                  visibleSources.some((r) => r.id === id),
                ),
                reference,
                reason,
                proof,
                confirmed: true,
              },
              () => setSelected([]),
            )
          }
        />
      </Card>
      <Card>
        <Txt weight="bold">التسويات والتوريدات والعكس</Txt>
        {visiblePayouts.map((p) => (
          <Card key={p.id}>
            <Txt>
              {p.id} · {money(p.amount)} · {p.reference}
            </Txt>
            <Txt>
              {p.reason} · {p.proof} · {stamp(p.at)}
            </Txt>
            {reversals.some((r) => r.payoutId === p.id) ? (
              <Txt>عكس موثق محفوظ؛ لا حذف للأصل أو تخصيص قديم</Txt>
            ) : (
              <Action
                title={`مراجعة عكس ${p.id}`}
                secondary
                onPress={() =>
                  confirm.ask(
                    "عكس القيد كاملًا مرة واحدة",
                    `الأصل ${p.id} · ${money(p.amount)} · إثبات ومرجع جديدان مطلوبان.`,
                    {
                      type: "reverse",
                      kind,
                      payoutId: p.id,
                      reference,
                      reason,
                      proof,
                      confirmed: true,
                    },
                  )
                }
              />
            )}
          </Card>
        ))}
      </Card>
      <Card>
        <Txt weight="bold">الاستثناءات والتسويات الخارجية</Txt>
        <Select
          label="اتجاه المعالجة الخارجية"
          value={direction}
          options={[
            { id: "refund", name: "رد مال خارجي موثق" },
            { id: "received", name: "مال إضافي متحقق مستلم" },
            { id: "write_off", name: "شطب مسبب — ليس مالًا مستلمًا" },
            { id: "other", name: "معالجة أخرى موثقة" },
          ]}
          onChange={setDirection}
        />
        {exceptions.map((e) => (
          <Card key={e.id}>
            <Hint warning>
              {e.orderId} · {exceptionNames[e.kind]} · {money(e.amount)}
            </Hint>
            <Txt>
              {e.reason} · {e.resolution ? "معالج محليًا" : "مفتوح"}
            </Txt>
            {e.resolution ? (
              <Txt>
                {e.resolution.reference} · {e.resolution.reason} ·{" "}
                {e.resolution.proof}
              </Txt>
            ) : (
              <Action
                title={`مراجعة معالجة ${e.id}`}
                secondary
                onPress={() =>
                  confirm.ask(
                    "توثيق معالجة خارجية",
                    `${money(e.amount)} · ${direction} · ${reason}. لا تحويل آلي أو تعديل إجمالي مؤكد.`,
                    {
                      type: "resolve-exception",
                      id: e.id,
                      direction,
                      amount: e.amount,
                      reference,
                      reason,
                      proof,
                      confirmed: true,
                    },
                  )
                }
              />
            )}
          </Card>
        ))}
        {exceptions.length === 0 && (
          <Txt>لا استثناءات مخولة في هذا النطاق.</Txt>
        )}
      </Card>
      {confirm.dialog}
    </Shell>
  );
}
