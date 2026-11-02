import { useState, useCallback } from "react";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import { View, Image } from "react-native";
import { Page, Header, Card, Txt, Action } from "../ui/components";
import { api, useAuth, Input, LoginPanel } from "./connection";
import { useOperation } from "./operations";
import { pickUpload } from "./upload";
const utc = (value: string) =>
  `\u2066${new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC\u2069`;
function Nav() {
  const r = useRouter();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {[
        ["الطلبات", "/orders"],
        ["الموصلون", "/couriers"],
        ["الدفاتر", "/finance"],
        ["الجودة", "/quality"],
      ].map(([t, p]) => (
        <Action key={p} secondary title={t!} onPress={() => r.push(p as any)} />
      ))}
    </View>
  );
}
export function Couriers() {
  const { user } = useAuth();
  return <CouriersView key={user?.id ?? "guest"} />;
}
function CouriersView() {
  const { user } = useAuth(),
    op = useOperation(user?.id),
    router = useRouter();
  const [rows, setRows] = useState<any[]>([]),
    [bs, setBs] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [password, setPassword] = useState(""),
    [bps, setBps] = useState(""),
    [branchIds, setBranchIds] = useState<string[]>([]),
    [active, setActive] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [next, setNext] = useState<string | null>(null),
    [historyId, setHistoryId] = useState(""),
    [history, setHistory] = useState<any[]>([]),
    [historyNext, setHistoryNext] = useState<string | null>(null);
  async function readHistory(id: string, more = false) {
    setBusy(true);
    try {
      const d = await api(
        "/admin/couriers/" +
          id +
          "/configuration-history" +
          (more && historyNext ? "?cursor=" + historyNext : ""),
      );
      setHistoryId(id);
      setHistory((old) => (more ? [...old, ...d.items] : d.items));
      setHistoryNext(d.nextCursor);
      setError("");
    } catch (e) {
      setHistory([]);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function load(more = false) {
    setBusy(true);
    setConfirm(false);
    try {
      const d = await api(
        "/admin/couriers" + (more && next ? "?cursor=" + next : ""),
      );
      setRows((old) => (more ? [...old, ...d.items] : d.items));
      setNext(d.nextCursor);
      setBs(
        (await api("/admin/access/branches?permission=couriers.manage")).items,
      );
      setError("");
    } catch (e) {
      setRows([]);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useFocusEffect(
    useCallback(() => {
      if (user) void load();
      return () => {
        setHistory([]);
        setHistoryId("");
        setPassword("");
      };
    }, [user?.id]),
  );
  async function save() {
    setError("");
    if (bps !== "" && (!/^\d+(?:\.\d{1,2})?$/.test(bps) || Number(bps) > 100)) {
      setError("أدخل نسبة بين0 و100 بمنزلتين عشريتين كحد أقصى");
      return;
    }
    try {
      await op.execute(
        selected
          ? "/admin/couriers/" + selected + "/configure"
          : "/admin/couriers",
        {
          name,
          ...(!selected ? { phone, password } : {}),
          branchIds,
          commissionBps: bps === "" ? null : Math.round(Number(bps) * 100),
          active,
        },
      );
      setPassword("");
      setNotice("حفظ الخادم إعدادات الموصل؛ النسبة الجديدة للإسنادات اللاحقة");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const locked = busy || op.busy || !!op.command || !op.ready;
  return (
    <Page>
      <Header
        title="إدارة الموصلين"
        subtitle="الحساب ونطاق الفروع ونسبة العمولة"
      />
      <Nav />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <Action
            title="تحديث الموصلين"
            disabled={busy}
            onPress={() => void load()}
          />
          {op.command && (
            <Action
              title="إعادة محاولة العملية المحفوظة"
              disabled={op.busy}
              onPress={() =>
                void op
                  .execute()
                  .then(() => load())
                  .catch((e) => setError(e.message))
              }
            />
          )}{" "}
          {rows.map((c) => (
            <Card key={c.id}>
              <Txt weight="bold">
                {c.name_ar} · {c.phone_e164}
              </Txt>
              <Txt>
                {c.active ? "نشط" : "متوقف"} ·{" "}
                {c.commission_bps === null
                  ? "النسبة غير مهيأة"
                  : c.commission_bps / 100 + "%"}{" "}
                · {c.branch_ids.length} فروع
              </Txt>
              <Action
                secondary
                title={"تعديل الموصل " + c.name_ar}
                disabled={locked}
                onPress={() => {
                  setSelected(c.id);
                  setName(c.name_ar);
                  setBps(
                    c.commission_bps === null
                      ? ""
                      : String(c.commission_bps / 100),
                  );
                  setBranchIds(c.branch_ids);
                  setActive(c.active);
                  setConfirm(false);
                }}
              />
              <Action
                secondary
                title={"سجل إعدادات " + c.name_ar}
                disabled={locked}
                onPress={() => void readHistory(c.id)}
              />
              {historyId === c.id && (
                <>
                  {!history.length && <Txt>لا تعديلات مسجلة بعد.</Txt>}
                  {history.map((h) => (
                    <Card key={h.id}>
                      <Txt>
                        النسبة{" "}
                        {h.commission_bps === null
                          ? "غير مهيأة"
                          : h.commission_bps / 100 + "%"}{" "}
                        · {h.active ? "نشط" : "متوقف"} · {h.branch_count} فروع
                      </Txt>
                      <Txt>
                        {utc(h.created_at)} · بواسطة{" "}
                        {h.actor_name ?? "موظف مخول"}
                      </Txt>
                    </Card>
                  ))}
                  {historyNext && (
                    <Action
                      title="المزيد من إعدادات الموصل السابقة"
                      disabled={locked}
                      onPress={() => void readHistory(c.id, true)}
                    />
                  )}
                </>
              )}
              <Action
                secondary
                title={"دفاتر الموصل " + c.name_ar}
                onPress={() =>
                  router.push({
                    pathname: "/finance",
                    params: { courierId: c.id },
                  })
                }
              />
            </Card>
          ))}
          {next && (
            <Action
              title="المزيد من الموصلين"
              onPress={() => void load(true)}
            />
          )}
          <Card>
            <Txt weight="bold">
              {selected ? "تعديل الموصل" : "إنشاء حساب موصل"}
            </Txt>
            {selected && (
              <Action
                secondary
                title="موصل جديد"
                onPress={() => {
                  setSelected("");
                  setName("");
                  setPhone("");
                  setBps("");
                  setBranchIds([]);
                  setConfirm(false);
                }}
              />
            )}
            <Input label="اسم الموصل" value={name} onChange={setName} />
            {!selected && (
              <>
                <Input
                  label="هاتف الموصل"
                  value={phone}
                  onChange={setPhone}
                  numeric
                />
                <Input
                  label="كلمة المرور الأولية (12 محرفًا على الأقل)"
                  value={password}
                  onChange={setPassword}
                  secure
                />
              </>
            )}
            <Input
              label="نسبة العمولة (%)"
              value={bps}
              onChange={setBps}
              numeric
            />
            <Txt>
              اترك النسبة فارغة لمنع الإسناد حتى يحددها المدير. صفر نسبة صريحة.
            </Txt>
            {bs.map((b) => (
              <Action
                key={b.id}
                secondary
                title={
                  (branchIds.includes(b.id) ? "✓ " : "") +
                  "فرع الموصل " +
                  b.name_ar
                }
                onPress={() =>
                  setBranchIds((old) =>
                    old.includes(b.id)
                      ? old.filter((x) => x !== b.id)
                      : [...old, b.id],
                  )
                }
              />
            ))}
            <Action
              secondary
              title={active ? "الحساب نشط" : "الحساب متوقف"}
              onPress={() => setActive(!active)}
            />
            <Action
              title="مراجعة حفظ الموصل"
              disabled={locked || !name || !branchIds.length}
              onPress={() => setConfirm(true)}
            />
            {confirm && (
              <>
                <Txt>راجع الاسم والفروع والنسبة قبل الحفظ.</Txt>
                <Action
                  title="تأكيد حفظ الموصل"
                  disabled={locked}
                  onPress={() => void save()}
                />
              </>
            )}
          </Card>
        </>
      )}
      {!!notice && <Txt>{notice}</Txt>}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
    </Page>
  );
}
export function Finance() {
  const { user } = useAuth(),
    { courierId } = useLocalSearchParams<{ courierId: string }>();
  return (
    <FinanceView
      key={(user?.id ?? "guest") + (courierId ?? "")}
      initial={courierId}
    />
  );
}
function FinanceView({ initial }: { initial?: string }) {
  const { user } = useAuth(),
    op = useOperation(user?.id);
  const [couriers, setCouriers] = useState<any[]>([]),
    [cid, setCid] = useState(initial ?? ""),
    [cash, setCash] = useState(false),
    [d, setD] = useState<any>(null),
    [selected, setSelected] = useState<string[]>([]),
    [credits, setCredits] = useState<string[]>([]),
    [reference, setReference] = useState(""),
    [reason, setReason] = useState(""),
    [proof, setProof] = useState(""),
    [adjust, setAdjust] = useState<any>(null),
    [amount, setAmount] = useState(""),
    [confirm, setConfirm] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load(id = cid, isCash = cash) {
    void api(
      "/admin/couriers/ledger-options?kind=" + (isCash ? "cash" : "commission"),
    )
      .then((v) => setCouriers(v.items))
      .catch((e) => setError(e.message));
    setBusy(true);
    setConfirm(null);
    setD(null);
    setSelected([]);
    setCredits([]);
    setAdjust(null);
    try {
      if (id)
        setD(
          await api(
            "/admin/couriers/" +
              id +
              "/" +
              (isCash ? "cash-balance" : "earnings"),
          ),
        );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useFocusEffect(
    useCallback(() => {
      if (user) {
        void api("/admin/couriers/ledger-options?kind=commission")
          .then((v) => setCouriers(v.items))
          .catch((e) => setError(e.message));
        if (cid) void load();
      }
      return () => setD(null);
    }, [user?.id]),
  );
  async function execute() {
    setError("");
    try {
      await op.execute(confirm.path, confirm.body);
      setNotice("أقر الخادم العملية المالية");
      await load();
      setProof("");
      setReason("");
      setReference("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function upload() {
    setUploading(true);
    try {
      const id = await pickUpload("financial_proof", user.id);
      if (id) setProof(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  const locked = busy || uploading || op.busy || !!op.command || !op.ready,
    base = cash ? "/admin/cash-remittances" : "/admin/settlements";
  const total = d
    ? [
        ...d.sources.filter((s: any) => selected.includes(s.id)),
        ...d.credits.filter((s: any) => credits.includes(s.id)),
      ]
        .reduce((sum: bigint, s: any) => sum + BigInt(s.amount_yer), 0n)
        .toString()
    : "0";
  const toggle = (id: string, credit = false) => {
    const setter = credit ? setCredits : setSelected;
    setter((old) =>
      old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
    );
    setConfirm(null);
  };
  return (
    <Page>
      <Header
        title="دفاتر الموصل"
        subtitle="العمولة والنقد مستقلان؛ لا مقاصة تلقائية"
      />
      <Nav />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <View style={{ gap: 8, flexDirection: "row", flexWrap: "wrap" }}>
            {couriers.map((c) => (
              <Action
                key={c.id}
                secondary
                title={"اختيار " + c.name_ar}
                disabled={busy}
                onPress={() => {
                  setCid(c.id);
                  void load(c.id);
                }}
              />
            ))}
          </View>
          <Action
            title={cash ? "عرض العمولات" : "عرض نقد المتجر"}
            secondary
            disabled={busy}
            onPress={() => {
              setCash(!cash);
              void load(cid, !cash);
            }}
          />
          {cid && (
            <Action
              title="تحديث الدفتر"
              disabled={busy}
              onPress={() => void load()}
            />
          )}{" "}
          {op.command && (
            <Card>
              <Txt>
                عملية مالية معلقة بإقرار الخادم؛ أعد المحاولة قبل إجراء آخر.
              </Txt>
              <Action
                title="إعادة محاولة العملية المالية"
                disabled={op.busy}
                onPress={() =>
                  void op
                    .execute()
                    .then(() => load())
                    .catch((e) => setError(e.message))
                }
              />
            </Card>
          )}
          {d && (
            <>
              <Card>
                <Txt weight="bold">
                  {cash ? "نقد المتجر" : "مستحقات العمولة"} · المتبقي{" "}
                  {d.balanceYer} ر.ي
                </Txt>
                <Txt>
                  {cash ? "المحصل" : "المكتسب"} {d.totalYer} ·{" "}
                  {cash ? "المورد" : "المسدد"} {d.paidYer} · العكس{" "}
                  {d.reversedYer}
                </Txt>
                <Txt>
                  التواريخ UTC. رصيد العكس يعيد إتاحة التخصيص ولا يضيف دخل
                  عمولة.
                </Txt>
              </Card>
              {!d.sources.length && <Txt>لا قيود حتى الآن.</Txt>}
              {d.sources.map((s: any) => (
                <Card key={s.id}>
                  <Txt weight="bold">
                    طلب #{s.order_number} · {s.amount_yer} ر.ي
                  </Txt>
                  {!cash && (
                    <Txt>
                      توصيل قبل الخصم {s.delivery_fee_before_discount_yer} · خصم{" "}
                      {s.delivery_discount_yer} · نسبة {s.commission_bps / 100}%
                    </Txt>
                  )}
                  <Txt>{s.allocated_to ? "مخصص سابقًا" : "متاح للتخصيص"}</Txt>
                  {!s.allocated_to && (
                    <Action
                      title={
                        (selected.includes(s.id) ? "✓ " : "") +
                        "تحديد قيد " +
                        s.amount_yer
                      }
                      secondary
                      disabled={locked}
                      onPress={() => toggle(s.id)}
                    />
                  )}{" "}
                  {cash && s.entry_type === "collection" && (
                    <Action
                      secondary
                      title="تصحيح التحصيل بإثبات"
                      disabled={locked}
                      onPress={() => {
                        setAdjust(s);
                        setAmount("");
                        setConfirm(null);
                      }}
                    />
                  )}
                </Card>
              ))}
              {d.credits.map((c: any) => (
                <Card key={c.id}>
                  <Txt>
                    رصيد عكس {c.amount_yer} · {c.reference} · {c.reason}
                  </Txt>
                  {!c.allocated_to ? (
                    <Action
                      title={
                        (credits.includes(c.id) ? "✓ " : "") +
                        "تحديد رصيد عكس " +
                        c.amount_yer
                      }
                      secondary
                      disabled={locked}
                      onPress={() => toggle(c.id, true)}
                    />
                  ) : (
                    <Txt>أعيد تخصيصه</Txt>
                  )}
                </Card>
              ))}
              <Card>
                <Txt weight="bold">بيانات العملية</Txt>
                <Input
                  label="مرجع العملية المالية"
                  value={reference}
                  onChange={setReference}
                />
                <Input
                  label="سبب التصحيح أو العكس"
                  value={reason}
                  onChange={setReason}
                />
                <Action
                  secondary
                  title={
                    proof ? "الإثبات جاهز" : "رفع إثبات خاص للتصحيح أو العكس"
                  }
                  disabled={locked}
                  onPress={() => void upload()}
                />
                <Txt>مجموع البنود المختارة {total} ر.ي</Txt>
                <Action
                  title={cash ? "مراجعة توريد النقد" : "مراجعة صرف العمولة"}
                  disabled={locked || !reference || BigInt(total) <= 0n}
                  onPress={() =>
                    setConfirm({
                      path: base,
                      body: {
                        courierId: cid,
                        sourceIds: selected,
                        reversalCreditIds: credits,
                        totalYer: total,
                        reference,
                      },
                    })
                  }
                />
                {adjust && (
                  <>
                    <Txt>
                      تصحيح أصل تحصيل {adjust.amount_yer} ر.ي. اكتب الفرق الموجب
                      أو السالب؛ يبقى الأصل محفوظًا.
                    </Txt>
                    <Input
                      label="مبلغ التصحيح الموجب أو السالب"
                      value={amount}
                      onChange={setAmount}
                      numeric
                    />
                    <Action
                      title="مراجعة تصحيح التحصيل"
                      disabled={
                        locked || !proof || !reason || !reference || !amount
                      }
                      onPress={() =>
                        setConfirm({
                          path:
                            "/admin/cash-collections/" +
                            adjust.id +
                            "/adjustments",
                          body: {
                            amountYer: amount,
                            reason,
                            reference,
                            proofMediaId: proof,
                            collectedAt: new Date().toISOString(),
                          },
                        })
                      }
                    />
                  </>
                )}
              </Card>
              {d.payouts.map((p: any) => (
                <Card key={p.id}>
                  <Txt weight="bold">
                    {cash ? "توريد" : "تسوية"} {p.total_yer} ر.ي · {p.reference}
                  </Txt>
                  <Txt>
                    {utc(p.created_at)} · {p.allocations.length} بنود محفوظة
                  </Txt>
                  {!d.credits.some(
                    (c: any) => (c.remittance_id ?? c.settlement_id) === p.id,
                  ) && (
                    <Action
                      secondary
                      title={"مراجعة عكس " + p.reference}
                      disabled={locked || !proof || !reason || !reference}
                      onPress={() =>
                        setConfirm({
                          path: base + "/" + p.id + "/reversals",
                          amountYer: p.total_yer,
                          originalReference: p.reference,
                          body: { reason, reference, proofMediaId: proof },
                        })
                      }
                    />
                  )}
                </Card>
              ))}
              {confirm && (
                <Card>
                  <Txt weight="bold">تأكيد العملية المالية</Txt>
                  <Txt>
                    راجع المرجع {confirm.body.reference} والمبلغ{" "}
                    {confirm.body.totalYer ??
                      confirm.body.amountYer ??
                      confirm.amountYer}{" "}
                    ر.ي. هذه عملية موثقة بعد تحققك الخارجي من الصرف أو التوريد
                    أو العكس.
                  </Txt>
                  {confirm.originalReference && (
                    <Txt>عكس الأصل ذي المرجع {confirm.originalReference}</Txt>
                  )}
                  {confirm.body.reason && (
                    <Txt>السبب: {confirm.body.reason}</Txt>
                  )}
                  <Action
                    title="تأكيد العملية المالية"
                    disabled={locked}
                    onPress={() => void execute()}
                  />
                  <Action
                    secondary
                    title="إلغاء التأكيد"
                    onPress={() => setConfirm(null)}
                  />
                </Card>
              )}
            </>
          )}
        </>
      )}
      {!!notice && <Txt>{notice}</Txt>}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
    </Page>
  );
}
export function Quality() {
  const { user } = useAuth();
  const { orderId, orderNumber } = useLocalSearchParams<{
    orderId?: string;
    orderNumber?: string;
  }>();
  return (
    <QualityView
      key={(user?.id ?? "guest") + (orderId ?? "")}
      orderId={orderId}
      orderNumber={orderNumber}
    />
  );
}
function QualityView({
  orderId,
  orderNumber,
}: {
  orderId?: string;
  orderNumber?: string;
}) {
  const { user } = useAuth(),
    op = useOperation(user?.id);
  const [kind, setKind] = useState("complaints"),
    [rows, setRows] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [selected, setSelected] = useState<any>(null),
    [status, setStatus] = useState(""),
    [confirm, setConfirm] = useState(false),
    [picture, setPicture] = useState(""),
    [busy, setBusy] = useState(false),
    [flagConfirm, setFlagConfirm] = useState(false),
    [flagDetails, setFlagDetails] = useState(""),
    [notice, setNotice] = useState("");
  async function load(k = kind, more = false) {
    setBusy(true);
    setConfirm(false);
    setSelected(null);
    try {
      const d = await api(
        "/admin/" + k + (more && next ? "?cursor=" + next : ""),
      );
      setRows((old) => (more ? [...old, ...d.items] : d.items));
      setNext(d.nextCursor);
      setError("");
    } catch (e) {
      setRows([]);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useFocusEffect(
    useCallback(() => {
      if (user) void load();
      return () => setPicture("");
    }, [user?.id]),
  );
  async function save() {
    try {
      await op.execute("/admin/" + kind + "/" + selected.id + "/review", {
        expectedVersion: selected.version,
        status,
        ...(kind === "complaints" ? { response: note } : { note }),
      });
      setNotice("حفظ الخادم المراجعة");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function flag() {
    try {
      const d = await api("/admin/orders/" + orderId);
      await op.execute("/admin/customer-flags", {
        orderId,
        expectedVersion: d.order.version,
        details: flagDetails,
        kind: "customer_flag",
      });
      setNotice("استلم الخادم البلاغ دون حظر آلي");
      setFlagDetails("");
      setFlagConfirm(false);
      await load("customer-flags");
      setKind("customer-flags");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const locked = busy || op.busy || !!op.command || !op.ready;
  const labels: Record<string, string> = {
    open: "مفتوح",
    in_progress: "قيد المعالجة",
    resolved: "محلول",
    reviewed: "تمت المراجعة",
    dismissed: "مستبعد",
  };
  return (
    <Page>
      <Header
        title="الجودة والمتابعة"
        subtitle="التقييمات والشكاوى والبلاغات"
      />
      <Nav />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[
              ["complaints", "الشكاوى"],
              ["customer-flags", "بلاغات العملاء"],
              ["reviews", "التقييمات"],
            ].map(([k, t]) => (
              <Action
                key={k}
                secondary
                title={t!}
                disabled={busy}
                onPress={() => {
                  setKind(k!);
                  void load(k);
                }}
              />
            ))}
          </View>
          <Action
            title="تحديث الجودة"
            disabled={busy}
            onPress={() => void load()}
          />
          {op.command && (
            <Action
              title="إعادة محاولة مراجعة الجودة"
              disabled={op.busy}
              onPress={() =>
                void op
                  .execute()
                  .then(() => load())
                  .catch((e) => setError(e.message))
              }
            />
          )}{" "}
          {!rows.length && !busy && !error && (
            <Txt>لا توجد سجلات ضمن نطاقك.</Txt>
          )}
          {rows.map((s: any) => (
            <Card key={s.id ?? s.order_id}>
              <Txt weight="bold">
                طلب #{s.order_number} ·{" "}
                {kind === "reviews" ? s.rating + "/5" : labels[s.status]}
              </Txt>
              <Txt>{s.details_ar ?? s.comment_ar}</Txt>
              {s.admin_response && <Txt>رد الإدارة: {s.admin_response}</Txt>}
              {s.admin_note && <Txt>ملاحظة المراجعة: {s.admin_note}</Txt>}
              {s.attachment_id && (
                <Action
                  secondary
                  title="عرض المرفق الخاص"
                  onPress={() =>
                    void api("/media/" + s.attachment_id + "/access")
                      .then((v) => setPicture(v.url))
                      .catch((e) => setError(e.message))
                  }
                />
              )}{" "}
              {kind !== "reviews" && (
                <Action
                  secondary
                  title={"مراجعة سجل " + s.order_number}
                  disabled={locked}
                  onPress={() => {
                    setSelected(s);
                    setStatus(s.status);
                    setNote(s.admin_response ?? s.admin_note ?? "");
                    setConfirm(false);
                  }}
                />
              )}
            </Card>
          ))}
          {next && (
            <Action
              title="المزيد من سجلات الجودة"
              onPress={() => void load(kind, true)}
            />
          )}{" "}
          {selected && (
            <Card>
              <Input
                label={
                  kind === "complaints" ? "رد الإدارة" : "ملاحظة مراجعة البلاغ"
                }
                value={note}
                onChange={setNote}
              />
              {(kind === "complaints"
                ? ["open", "in_progress", "resolved"]
                : ["open", "reviewed", "dismissed"]
              ).map((s) => (
                <Action
                  key={s}
                  secondary
                  title={(status === s ? "✓ " : "") + labels[s]}
                  disabled={locked}
                  onPress={() => setStatus(s)}
                />
              ))}
              <Action
                title="مراجعة حفظ الرد"
                disabled={locked || !note}
                onPress={() => setConfirm(true)}
              />
              {confirm && (
                <Action
                  title="تأكيد حفظ الرد"
                  disabled={locked}
                  onPress={() => void save()}
                />
              )}
            </Card>
          )}
          {picture && (
            <Card>
              <Image
                source={{ uri: picture }}
                style={{ height: 240, width: "100%" }}
                resizeMode="contain"
              />
              <Action
                secondary
                title="إغلاق المرفق"
                onPress={() => setPicture("")}
              />
            </Card>
          )}
          {orderId ? (
            <Card>
              <Txt weight="bold">تسجيل بلاغ إداري مرتبط بطلب</Txt>
              <Txt>الطلب #{orderNumber ?? "المحدد من قائمة الطلبات"}</Txt>
              <Input
                label="تفاصيل البلاغ الإداري"
                value={flagDetails}
                onChange={(v) => {
                  setFlagDetails(v);
                  setFlagConfirm(false);
                }}
              />
              <Action
                title="مراجعة البلاغ الإداري"
                disabled={locked || !orderId || !flagDetails}
                onPress={() => setFlagConfirm(true)}
              />
              {flagConfirm && (
                <>
                  <Txt>{flagDetails}</Txt>
                  <Action
                    title="تأكيد إرسال البلاغ الإداري"
                    disabled={locked}
                    onPress={() => void flag()}
                  />
                </>
              )}
            </Card>
          ) : (
            <Txt>
              لتسجيل بلاغ إداري، افتح الطلب ثم اختر «تسجيل بلاغ على هذا الطلب».
            </Txt>
          )}
        </>
      )}
      {!!notice && <Txt>{notice}</Txt>}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
    </Page>
  );
}
export function Dispatch({
  data,
  onChanged,
  locked,
}: {
  data: any;
  onChanged: () => Promise<void>;
  locked: boolean;
}) {
  const { user } = useAuth(),
    op = useOperation(user?.id);
  const [rows, setRows] = useState<any[]>([]),
    [cid, setCid] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  async function options() {
    setConfirm(false);
    try {
      setRows(
        (await api("/admin/orders/" + data.order.id + "/courier-options"))
          .items,
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function assign() {
    try {
      await op.execute("/admin/orders/" + data.order.id + "/assign", {
        expectedVersion: data.order.version,
        courierId: cid,
        reason,
      });
      setConfirm(false);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Card>
      <Txt weight="bold">إسناد التوصيل</Txt>
      {data.assignments?.map((a: any) => (
        <Txt key={a.id}>
          {a.name_ar} · {a.ended_at ? "إسناد سابق" : "الإسناد الحالي"} · نسبة{" "}
          {a.commission_bps / 100}% · عمولة {a.commission_yer} ر.ي
        </Txt>
      ))}
      {data.allowedActions.includes("assign") && (
        <>
          <Action
            title="تحميل الموصلين المتاحين"
            disabled={locked}
            secondary
            onPress={() => void options()}
          />
          {rows.map((c) => (
            <Action
              key={c.id}
              title={(cid === c.id ? "✓ " : "") + "إسناد إلى " + c.name_ar}
              secondary
              disabled={locked}
              onPress={() => {
                setCid(c.id);
                setConfirm(false);
              }}
            />
          ))}
          <Input
            label="سبب الإسناد أو إعادة الإسناد"
            value={reason}
            onChange={setReason}
          />
          <Action
            title="مراجعة الإسناد"
            disabled={locked || !cid || !reason}
            onPress={() => setConfirm(true)}
          />
          {confirm && (
            <>
              <Txt>النسبة تثبت الآن، وتستحق العمولة عند التسليم.</Txt>
              <Action
                title="تأكيد الإسناد"
                disabled={locked}
                onPress={() => void assign()}
              />
            </>
          )}
        </>
      )}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
    </Card>
  );
}
