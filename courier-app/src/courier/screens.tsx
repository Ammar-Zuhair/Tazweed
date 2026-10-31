import { useEffect, useState } from "react";
import {
  AppState,
  Image,
  Linking,
  Platform,
  Pressable,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useCourier } from "../data/courier-provider";
import {
  COURIER_ID,
  DEMO_PASSWORD,
  DEMO_PHONE,
  active,
  collected,
  earningPaid,
  externalLinks,
  finances,
  labels,
  paymentState,
} from "../domain/courier-model";
import type { Scenario, Task } from "../domain/types";
import { SettingsScreen } from "../ui/screens";
import { useTheme } from "../ui/theme-provider";
import { palette } from "../ui/theme-model";
import {
  Action,
  Card,
  Field,
  Hint,
  Icon,
  Loading,
  Row,
  Shell,
  Txt,
  money,
  stamp,
  useConfirm,
} from "./components";

export function LoginScreen() {
  const store = useCourier();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Shell title="دخول الموصل" back={false}>
      <Card>
        <Icon name="bicycle-outline" size={40} />
        <Txt weight="bold" style={{ fontSize: 25 }}>
          خطوات واضحة في كل مشوار
        </Txt>
        <Txt>حساب تنشئه الإدارة، ثم تحقق برمز. لا تسجيل عام.</Txt>
        {!store.challenge ? (
          <>
            <Field
              label="رقم الهاتف"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
            <Field
              label="كلمة المرور"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <Action
              title="إرسال رمز التحقق"
              onPress={() => store.startLogin(phone, password)}
            />
          </>
        ) : (
          <>
            <Field
              label="رمز التحقق"
              value={code}
              onChangeText={setCode}
              keyboardType="numeric"
              maxLength={6}
            />
            <Txt>
              المحاولات: {store.challenge.attempts}/5 · صلاحية الرمز:{" "}
              {Math.max(0, Math.ceil((store.challenge.expiresAt - now) / 1000))}
              ث
            </Txt>
            <Action title="تحقق ودخول" onPress={() => store.verifyOtp(code)} />
            <Action
              title="إعادة إرسال الرمز"
              secondary
              disabled={now < store.challenge.resendAt}
              onPress={store.resend}
            />
            <Txt>
              إعادة الإرسال بعد{" "}
              {Math.max(0, Math.ceil((store.challenge.resendAt - now) / 1000))}ث
            </Txt>
          </>
        )}
      </Card>
      <Hint>
        حساب معاينة متعدد الفروع: {DEMO_PHONE} · كلمة الاختبار {DEMO_PASSWORD} ·
        OTP 000000. الإسنادات مستقلة عن معاينة الإدارة، وليست حسابًا حقيقيًا.
      </Hint>
    </Shell>
  );
}
function TaskCard({ task }: { task: Task }) {
  const { markSeen } = useCourier();
  return (
    <Card testID={`task-${task.id}`}>
      <Row style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <Txt weight="bold" style={{ fontSize: 22 }}>
          {task.number}
        </Txt>
        <Txt>
          {labels[task.status]}
          {!task.seen ? " · جديد" : ""}
        </Txt>
      </Row>
      <Txt>{task.branch}</Txt>
      <Txt>{task.customer}</Txt>
      <Txt>{task.address.description}</Txt>
      <Row style={{ flexWrap: "wrap", justifyContent: "space-between" }}>
        <Txt>
          {task.paymentKind === "transfer" ? "تحويل" : "نقد عند الاستلام"}
        </Txt>
        <Txt weight="bold">{money(task.total)}</Txt>
      </Row>
      <Action
        title={`تفاصيل ${task.number}`}
        secondary
        icon="arrow-back-outline"
        onPress={() => {
          markSeen(task.id);
          router.push({ pathname: "/task", params: { id: task.id } });
        }}
      />
    </Card>
  );
}
export function TasksScreen() {
  const { snapshot, status, refresh, pending } = useCourier();
  const [filter, setFilter] = useState<"active" | "all" | "delivered">(
    "active",
  );
  const [branch, setBranch] = useState("الكل");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const day = new Date().toISOString().slice(0, 10);
  const totals = snapshot ? finances(snapshot, day) : null;
  const tasks =
    snapshot?.tasks
      .filter(
        (t) =>
          (filter === "all" ||
            (filter === "delivered"
              ? t.status === "delivered"
              : t.status !== "delivered")) &&
          (branch === "الكل" || t.branch === branch),
      )
      .sort((a, b) =>
        sort === "newest"
          ? b.assignedAt - a.assignedAt || a.number.localeCompare(b.number)
          : a.assignedAt - b.assignedAt || b.number.localeCompare(a.number),
      ) ?? [];
  return (
    <Shell title="مهامي" back={false}>
      <View
        style={{
          padding: 24,
          borderRadius: 24,
          backgroundColor: palette.navy,
          gap: 10,
        }}
      >
        <Txt style={{ color: "#FFFFFF", fontSize: 25 }} weight="bold">
          رفيقك في الطريق
        </Txt>
        <Txt style={{ color: "#D7E3ED" }}>مهام متعددة، وعهدة واضحة.</Txt>
        <Txt style={{ color: "#FFC08C", fontSize: 26 }} weight="bold">
          {totals ? money(totals.daily) : "—"}
        </Txt>
        <Txt style={{ color: "#D7E3ED" }}>
          عمولات مستحقة اليوم · {day} UTC للمعاينة
        </Txt>
      </View>
      <Row style={{ flexWrap: "wrap" }}>
        <Action
          title="تحديث المهام"
          secondary
          icon="refresh-outline"
          onPress={() => void refresh()}
        />
        <Action
          title="عمليات الشبكة"
          secondary
          icon="cloud-outline"
          onPress={() => router.push("/pending")}
        />
      </Row>
      {pending.length > 0 && (
        <Hint warning>
          عمليات تنتظر الإقرار أو المراجعة: {pending.length}. لا تعني أنها نجحت.
        </Hint>
      )}
      {status === "loading" && <Loading />}
      {status === "error" && (
        <Card testID="tasks-error">
          <Txt>
            تعذر تحديث المهام.{" "}
            {snapshot
              ? "تظهر نسخة محلية محدودة الصلاحية."
              : "لا نسخة محلية صالحة."}
          </Txt>
          <Action title="إعادة المحاولة" onPress={() => void refresh()} />
        </Card>
      )}
      {snapshot && (
        <Hint>
          آخر مزامنة محلية: {stamp(snapshot.syncedAt)} · صلاحية النسخة حتى{" "}
          {stamp(snapshot.validUntil)}
        </Hint>
      )}
      <Row style={{ flexWrap: "wrap" }}>
        {(["active", "delivered", "all"] as const).map((id, i) => (
          <Action
            key={id}
            title={["الجارية", "المسلمة", "كل المهام"][i]!}
            secondary={filter !== id}
            onPress={() => setFilter(id)}
          />
        ))}
      </Row>
      <Row style={{ flexWrap: "wrap" }}>
        {["الكل", ...new Set(snapshot?.tasks.map((t) => t.branch) ?? [])].map(
          (x) => (
            <Action
              key={x}
              title={x === "الكل" ? "كل الفروع" : x}
              secondary={branch !== x}
              onPress={() => setBranch(x)}
            />
          ),
        )}
      </Row>
      <Action
        title={
          sort === "newest" ? "الترتيب: الأحدث أولًا" : "الترتيب: الأقدم أولًا"
        }
        secondary
        onPress={() => setSort(sort === "newest" ? "oldest" : "newest")}
      />
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
      {status !== "loading" && tasks.length === 0 && (
        <Card testID="tasks-empty">
          <Icon name="checkmark-done-outline" size={36} />
          <Txt weight="bold">لا مهام في هذا العرض</Txt>
          <Txt>ستظهر هنا المهام التي تسندها الإدارة إلى حسابك.</Txt>
        </Card>
      )}
    </Shell>
  );
}
export function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useCourier();
  const confirm = useConfirm();
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [link, setLink] = useState<{ title: string; url: string } | null>(null);
  const [linkMessage, setLinkMessage] = useState("");
  const task = store.snapshot?.tasks.find(
    (t) => t.id === id && active(t, COURIER_ID, Date.now()),
  );
  const busy = store.pending.some((p) => p.command.orderId === id);
  if (!task || !store.snapshot || store.snapshot.validUntil <= Date.now())
    return (
      <Shell title="تفاصيل المهمة">
        <Hint warning>
          الإسناد غير متاح أو انتهت صلاحية النسخة. أزيلت بيانات العميل من العرض.
        </Hint>
        <Action title="تحديث المهام" onPress={() => void store.refresh()} />
      </Shell>
    );
  const cash = collected(store.snapshot.cash, task.id);
  const links = externalLinks(task);
  const start = () =>
    confirm.ask(
      "بدء التوصيل",
      `بدء رحلة ${task.number} من ${task.branch}؟ لا يبدأ التنفيذ قبل التأكيد.`,
      () => store.submit({ type: "start", orderId: task.id }),
    );
  const deliver = () =>
    confirm.ask(
      "تأكيد التسليم",
      `هل سلمت الطلب ${task.number} فعليًا؟ هذا الإجراء لا يسجل نقدًا أو يورد أموالًا.`,
      () => store.submit({ type: "deliver", orderId: task.id }),
    );
  return (
    <Shell title={task.number}>
      <Card>
        <Txt weight="bold" style={{ fontSize: 24 }}>
          {labels[task.status]}
        </Txt>
        <Txt>{task.branch}</Txt>
        <Txt>إسناد {stamp(task.assignedAt)}</Txt>
        <Txt>
          نوع الدفع:{" "}
          {task.paymentKind === "transfer" ? "تحويل يدوي" : "نقد عند الاستلام"}
        </Txt>
        <Txt>{paymentState(store.snapshot, task)}</Txt>
        <Txt weight="bold">إجمالي الطلب الثابت {money(task.total)}</Txt>
        {busy && (
          <Hint warning>
            توجد عملية لهذا الطلب؛ راجع نتيجتها قبل إجراء آخر.
          </Hint>
        )}
        {busy && (
          <Action
            title="مراجعة العملية المعلقة"
            secondary
            onPress={() => router.push("/pending")}
          />
        )}
      </Card>
      <Card>
        <Txt weight="bold">العميل والعنوان</Txt>
        <Txt>{task.customer}</Txt>
        <Txt style={{ writingDirection: "ltr" }}>{task.phone}</Txt>
        <Txt>{task.address.description}</Txt>
        <Txt>{task.address.landmark}</Txt>
        <View
          style={{
            height: 150,
            borderRadius: 16,
            backgroundColor: "#173E5E",
            justifyContent: "center",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="location" color="#FFC08C" size={40} />
          <Txt style={{ color: "#FFFFFF" }}>
            دبوس العنوان الثابت — رسم تخطيطي
          </Txt>
        </View>
        <Txt testID="coordinates" style={{ writingDirection: "ltr" }}>
          {task.address.latitude.toFixed(6)},{" "}
          {task.address.longitude.toFixed(6)}
        </Txt>
        <Txt>موقع تجريبي دقيق في البيانات؛ لا GPS أو تتبع.</Txt>
        <Row style={{ flexWrap: "wrap" }}>
          {[
            { title: "اتصال بالعميل", url: links.call },
            { title: "واتساب العميل", url: links.whatsapp },
            { title: "ملاحة خارجية", url: links.navigation },
          ].map((x) => (
            <Action
              key={x.title}
              title={x.title}
              secondary
              onPress={() => {
                setLink(x);
                setLinkMessage("");
              }}
            />
          ))}
        </Row>
        {link && (
          <Card>
            <Hint warning>
              تواصل خارجي مع رقم/عنوان تجريبي. راجع الوجهة قبل فتح التطبيق
              الآخر.
            </Hint>
            <Txt>{link.title}</Txt>
            <Txt selectable style={{ fontSize: 12, writingDirection: "ltr" }}>
              {link.url}
            </Txt>
            <Action
              title="نسخ الوجهة"
              secondary
              onPress={() =>
                void Clipboard.setStringAsync(link.url)
                  .then(() => setLinkMessage("نسخت الوجهة."))
                  .catch(() => setLinkMessage("تعذر النسخ؛ حدد النص يدويًا."))
              }
            />
            <Action
              title="فتح التطبيق الخارجي"
              onPress={() =>
                void Linking.openURL(link.url).catch(() =>
                  setLinkMessage(
                    "تعذر فتح التطبيق؛ انسخ الوجهة واستخدمها يدويًا.",
                  ),
                )
              }
            />
            <Action
              title="إغلاق الوجهة"
              secondary
              onPress={() => setLink(null)}
            />
          </Card>
        )}
        {linkMessage && <Txt accessibilityRole="alert">{linkMessage}</Txt>}
      </Card>
      <Card>
        <Txt weight="bold">البنود والوحدات</Txt>
        {task.items.map((item, i) => (
          <View key={i}>
            <Txt>{item.name}</Txt>
            <Txt>
              {item.quantity} × {item.unit} · {item.pieces} حبة للوحدة · SKU{" "}
              {item.sku}
            </Txt>
          </View>
        ))}
        <Txt>
          الإجمالي بالحبة:{" "}
          {task.items.reduce((n, x) => n + x.quantity * x.pieces, 0)}
        </Txt>
      </Card>
      <Card>
        <Txt weight="bold">عمولة مثبتة عند الإسناد</Txt>
        <Txt>توصيل قبل الخصم {money(task.feeBefore)}</Txt>
        <Txt>خصم يتحمله المتجر {money(task.discount)}</Txt>
        <Txt>رسوم العميل {money(task.feeBefore - task.discount)}</Txt>
        <Txt>
          النسبة المثبتة {task.bps / 100}% · العمولة {money(task.commission)}
        </Txt>
        <Hint>
          تستحق عند التسليم فقط، من التوصيل قبل الخصم. قيمة البضائع ليست أساس
          العمولة.
        </Hint>
      </Card>
      {task.paymentKind === "cash_on_delivery" && (
        <Card>
          <Txt weight="bold">تسجيل النقد الحقيقي</Txt>
          <Txt>
            مطلوب {money(task.total)} · مسجل {money(cash)}
          </Txt>
          <Hint>
            التحصيل إجراء مستقل عن التسليم. التصحيح لدى الإدارة بقيد محفوظ.
          </Hint>
          {task.status === "on_the_way" && cash === 0 && (
            <>
              <Field
                label="المبلغ المستلم فعليًا"
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
              <Field
                label="مرجع التحصيل"
                value={reference}
                onChangeText={setReference}
              />
              <Action
                title="استلمت نقدًا"
                disabled={busy}
                onPress={() =>
                  confirm.ask(
                    "تسجيل تحصيل النقد",
                    `تسجيل ${amount || "—"} ريال بموجب المرجع ${reference || "—"}؟ لا تخصم عمولتك.`,
                    () =>
                      store.submit({
                        type: "collect",
                        orderId: task.id,
                        amount: Number(amount),
                        reference,
                      }),
                  )
                }
              />
            </>
          )}
          {task.status === "on_the_way" && cash !== task.total && (
            <>
              <Field
                label="سبب النقص أو التعذر أو الزيادة"
                multiline
                value={reason}
                onChangeText={setReason}
              />
              <Txt>
                الفرق {money(Math.abs(task.total - cash))} ·{" "}
                {cash === 0
                  ? "لم يحصل نقد"
                  : cash < task.total
                    ? "نقص"
                    : "زيادة"}
              </Txt>
              <Action
                title="تسجيل استثناء نقدي للإدارة"
                secondary
                disabled={busy}
                onPress={() =>
                  confirm.ask(
                    "تسجيل استثناء نقدي",
                    "يبقى مبلغ الطلب ثابتًا، ولا يصبح مدفوعًا بافتراض التسليم.",
                    () =>
                      store.submit({
                        type: "cash_exception",
                        orderId: task.id,
                        reason,
                      }),
                  )
                }
              />
            </>
          )}
          {store.snapshot.exceptions
            .filter((x) => x.orderId === task.id)
            .map((x) => (
              <Hint key={x.id} warning>
                استثناء مسجل: {x.reason} · الفرق {money(x.amount)} ·{" "}
                {stamp(x.at)}
              </Hint>
            ))}
        </Card>
      )}
      {task.status === "confirmed" && (
        <Action
          title="بدء التوصيل"
          disabled={busy}
          icon="bicycle-outline"
          onPress={start}
        />
      )}
      {task.status === "on_the_way" && (
        <Action
          title="تم التسليم"
          disabled={busy}
          icon="checkmark-done-outline"
          onPress={deliver}
        />
      )}
      {task.status === "delivered" && (
        <Hint>
          أقرت المحاكاة التسليم في {stamp(task.deliveredAt!)}. لا إنشاء نقد
          تلقائي.
        </Hint>
      )}
      <Action
        title="بلاغ أو تعذر التسليم"
        secondary
        icon="flag-outline"
        disabled={busy}
        onPress={() =>
          router.push({ pathname: "/report", params: { id: task.id } })
        }
      />
      {store.snapshot.reports
        .filter((r) => r.orderId === task.id)
        .map((r) => (
          <Card key={r.id}>
            <Txt weight="bold">
              {r.kind === "delivery_issue" ? "تعذر التسليم" : "بلاغ على العميل"}{" "}
              ·{" "}
              {r.status === "open"
                ? "مفتوح"
                : r.status === "processing"
                  ? "قيد المعالجة"
                  : "محلول"}
            </Txt>
            <Txt>
              {r.reason} · {r.details}
            </Txt>
            {r.image && (
              <Image
                source={{ uri: r.image }}
                style={{ width: 160, height: 140 }}
                accessibilityLabel="صورة البلاغ المحلية"
              />
            )}
            {r.response && <Hint>{r.response}</Hint>}
          </Card>
        ))}
      {confirm.modal}
    </Shell>
  );
}
export function PendingScreen() {
  const { pending, retry, discardFailed } = useCourier();
  const confirm = useConfirm();
  const names = {
    start: "بدء التوصيل",
    deliver: "التسليم",
    collect: "تحصيل نقد",
    cash_exception: "استثناء نقدي",
    report: "بلاغ",
  };
  return (
    <Shell title="عمليات الشبكة">
      <Hint>
        هذه قائمة محلية في الذاكرة، لا تعمل في الخلفية. إعادة المحاولة تستعمل
        المفتاح والمحتوى نفسيهما. لا تحذف عملية مجهولة النتيجة.
      </Hint>
      {pending.length === 0 && (
        <Card>
          <Txt>لا عمليات معلّقة</Txt>
        </Card>
      )}
      {pending.map((p) => (
        <Card key={p.command.key}>
          <Txt weight="bold">
            {names[p.command.type]} · {p.command.orderId}
          </Txt>
          <Txt>
            {p.status === "sending"
              ? "جارٍ الإرسال — لم يؤكد بعد"
              : p.status === "pending_network"
                ? "بانتظار الشبكة — لم يصل الإقرار"
                : "فشل التحقق — يحتاج مراجعة"}
          </Txt>
          <Txt selectable style={{ fontSize: 12 }}>
            {p.command.key}
          </Txt>
          {p.error && p.error !== "pending_network" && (
            <Hint warning>{p.error}</Hint>
          )}
          <Action
            title="إعادة المحاولة بالمفتاح نفسه"
            disabled={p.status === "sending"}
            onPress={() => retry(p.command.key)}
          />
          {p.status === "failed" && (
            <Action
              title="إزالة العملية المرفوضة"
              secondary
              onPress={() =>
                confirm.ask(
                  "إزالة محاولة مرفوضة",
                  "لم تعتمد هذه العملية. حدّث الطلب قبل إدخال محتوى جديد.",
                  () => discardFailed(p.command.key),
                )
              }
            />
          )}
        </Card>
      ))}
      {confirm.modal}
    </Shell>
  );
}
export function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useCourier();
  const task = store.snapshot?.tasks.find(
    (t) => t.id === id && active(t, COURIER_ID, Date.now()),
  );
  const [kind, setKind] = useState<"delivery_issue" | "customer_flag">(
    "delivery_issue",
  );
  const [reason, setReason] = useState("تعذر التواصل");
  const [details, setDetails] = useState("");
  const [image, setImage] = useState<string>();
  const [imageMessage, setImageMessage] = useState("");
  const confirm = useConfirm();
  useEffect(() => {
    if (!task) {
      setImage(undefined);
      setDetails("");
    }
  }, [task?.id]);
  const pick = async () => {
    try {
      if (Platform.OS !== "web") {
        const permission =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setImageMessage("رفض إذن الصور؛ يمكنك إرسال البلاغ دون صورة.");
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
      });
      if (!result.canceled && result.assets[0]) {
        if ((result.assets[0].fileSize ?? 0) > 5 * 1024 * 1024) {
          setImageMessage("حد المعاينة 5MB؛ اختر صورة أصغر.");
          return;
        }
        setImage(result.assets[0].uri);
        setImageMessage("صورة محلية فقط؛ لا رفع لخادم.");
      }
    } catch {
      setImageMessage("تعذر اختيار الصورة؛ تابع دونها.");
    }
  };
  if (!task)
    return (
      <Shell title="البلاغ">
        <Hint warning>الإسناد غير متاح. أزيلت مسودة البيانات الخاصة.</Hint>
      </Shell>
    );
  return (
    <Shell title={`بلاغ ${task.number}`}>
      <Card>
        <Row style={{ flexWrap: "wrap" }}>
          <Action
            title="تعذر التسليم"
            secondary={kind !== "delivery_issue"}
            onPress={() => setKind("delivery_issue")}
          />
          <Action
            title="بلاغ على العميل"
            secondary={kind !== "customer_flag"}
            onPress={() => setKind("customer_flag")}
          />
        </Row>
        <Txt>
          الطلب {task.number} · {task.branch}
        </Txt>
        <Row style={{ flexWrap: "wrap" }}>
          {[
            "تعذر التواصل",
            "العنوان غير واضح",
            "مشكلة مع العميل",
            "سبب آخر",
          ].map((x) => (
            <Action
              key={x}
              title={x}
              secondary={reason !== x}
              onPress={() => setReason(x)}
            />
          ))}
        </Row>
        <Field
          label="تفاصيل البلاغ"
          multiline
          value={details}
          onChangeText={setDetails}
        />
        <Action
          title="اختيار صورة اختيارية"
          secondary
          icon="image-outline"
          onPress={() => void pick()}
        />
        <Action
          title="استخدام صورة بلاغ تجريبية"
          secondary
          onPress={() => {
            setImage(
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1cAAAAASUVORK5CYII=",
            );
            setImageMessage("عينة صورة تجريبية؛ لا تمثل إثباتًا.");
          }}
        />
        {image && (
          <>
            <Image
              source={{ uri: image }}
              style={{ width: 150, height: 120 }}
              accessibilityLabel="معاينة صورة البلاغ"
            />
            <Action
              title="حذف الصورة من المسودة"
              secondary
              onPress={() => setImage(undefined)}
            />
          </>
        )}
        {imageMessage && <Txt>{imageMessage}</Txt>}
        <Hint>
          يظهر للإدارة في الربط اللاحق. في هذه المعاينة يسجل محليًا؛ لا حظر
          تلقائي ولا تغيير حالة أو مبلغ الطلب.
        </Hint>
        <Action
          title="إرسال البلاغ"
          disabled={store.pending.some((p) => p.command.orderId === id)}
          onPress={() =>
            confirm.ask(
              "إرسال البلاغ",
              "أرسل التفاصيل إلى مراجعة الإدارة التجريبية؟",
              () => {
                if (
                  store.submit({
                    type: "report",
                    orderId: id,
                    kind,
                    reason,
                    details,
                    image,
                  })
                )
                  router.back();
              },
            )
          }
        />
      </Card>
      {confirm.modal}
    </Shell>
  );
}
export function EarningsScreen() {
  const { snapshot } = useCourier();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  if (!snapshot)
    return (
      <Shell title="مستحقاتي" back={false}>
        <Hint>حدّث المهام للحصول على كشف محلي صالح.</Hint>
      </Shell>
    );
  const totals = finances(snapshot, day);
  const days = [
    ...new Set(
      snapshot.earnings.map((x) => new Date(x.at).toISOString().slice(0, 10)),
    ),
  ]
    .sort()
    .reverse();
  return (
    <Shell title="مستحقاتي" back={false}>
      <Hint>
        عمولة الموصل فقط. حد اليوم UTC للمعاينة؛ المنطقة التشغيلية D15 لم تعتمد.
      </Hint>
      <Card>
        <Txt weight="bold" style={{ fontSize: 24 }}>
          عمولات {day}: {money(totals.daily)}
        </Txt>
        <Txt>إجمالي المستحق {money(totals.earned)}</Txt>
        <Txt>مسدد {money(totals.paid)}</Txt>
        <Txt weight="bold">غير مسدد {money(totals.unpaid)}</Txt>
      </Card>
      <Row style={{ flexWrap: "wrap" }}>
        {days.map((d) => (
          <Action
            key={d}
            title={d}
            secondary={day !== d}
            onPress={() => setDay(d)}
          />
        ))}
      </Row>
      {snapshot.earnings
        .filter((x) => new Date(x.at).toISOString().slice(0, 10) === day)
        .map((x) => (
          <Card key={x.id}>
            <Txt weight="bold">
              {x.number} · {money(x.amount)}
            </Txt>
            <Txt>
              أساس التوصيل {money(x.base)} · خصم العميل {money(x.discount)}
            </Txt>
            <Txt>
              رسوم العميل {money(x.base - x.discount)} · نسبة مثبتة{" "}
              {x.bps / 100}%
            </Txt>
            <Txt>
              {earningPaid(snapshot, x) ? "مسدد" : "غير مسدد"} · {stamp(x.at)}
            </Txt>
          </Card>
        ))}
      <Txt weight="bold" style={{ fontSize: 22 }}>
        تفاصيل التسويات
      </Txt>
      {snapshot.settlements.map((x) => (
        <Card key={x.id}>
          <Txt weight="bold">
            {x.reference} · {money(x.amount)}
          </Txt>
          <Txt>
            {x.actor} · {stamp(x.at)}
          </Txt>
          <Txt>
            {x.proof} · البنود {x.earningIds.join("، ")}
          </Txt>
          <Txt>
            {x.reversal ? "معكوسة — عاد المبلغ إلى غير المسدد" : "مسدد"}
          </Txt>
          {x.reversal && (
            <Hint>
              العكس {x.reversal.reference} · {x.reversal.reason} ·{" "}
              {x.reversal.proof} · {stamp(x.reversal.at)}. ليس عمولة جديدة.
            </Hint>
          )}
        </Card>
      ))}
      <Action
        title="عهدة نقد المتجر"
        secondary
        onPress={() => router.push("/cash")}
      />
    </Shell>
  );
}
export function CashScreen() {
  const { snapshot } = useCourier();
  if (!snapshot)
    return (
      <Shell title="نقد المتجر">
        <Hint>حدّث المهام لعرض كشف محلي صالح.</Hint>
      </Shell>
    );
  const totals = finances(snapshot, new Date().toISOString().slice(0, 10));
  return (
    <Shell title="نقد المتجر">
      <Hint warning>
        هذه أموال المتجر وليست دخلك. تورد كاملة دون طرح العمولة تلقائيًا. يسجل
        المدير التوريد والتصحيح بإثبات مستقل.
      </Hint>
      <Card>
        <Txt>محصل من العملاء {money(totals.cash)}</Txt>
        <Txt>مورد للإدارة {money(totals.remitted)}</Txt>
        <Txt weight="bold" style={{ fontSize: 24 }}>
          متبقٍ للمتجر {money(totals.outstanding)}
        </Txt>
      </Card>
      <Txt weight="bold">سجل التحصيل</Txt>
      {snapshot.cash.map((x) => (
        <Card key={x.id}>
          <Txt>
            {x.orderId} · {money(x.amount)}
          </Txt>
          <Txt>
            {x.reference} · {stamp(x.at)}
          </Txt>
        </Card>
      ))}
      <Txt weight="bold">سجل التوريد</Txt>
      {snapshot.remittances.map((x) => (
        <Card key={x.id}>
          <Txt>
            {x.reference} · {money(x.amount)}
          </Txt>
          <Txt>
            {x.proof} · {x.actor} · {stamp(x.at)}
          </Txt>
          <Txt>
            {x.reversal ? "معكوس — عاد للعهدة" : "مورد"} · بنود{" "}
            {x.collectionIds.join("، ")}
          </Txt>
        </Card>
      ))}
    </Shell>
  );
}
export function NotificationsScreen() {
  const { snapshot, markRead } = useCourier();
  const [sound, setSound] = useState(true);
  const [message, setMessage] = useState("");
  const player = useAudioPlayer(require("../../assets/task-tone.wav"));
  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
    }).catch(() => setMessage("تعذر إعداد الصوت؛ مركز الإشعارات يبقى متاحًا."));
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        try {
          player.pause();
        } catch {}
      }
    });
    return () => sub.remove();
  }, [player]);
  const play = async () => {
    if (!sound) {
      setMessage("الصوت مكتوم في هذه الجلسة.");
      return;
    }
    try {
      await player.seekTo(0);
      player.play();
      setMessage(
        "طلب تشغيل نغمة محلية؛ يحكمها كتم الجهاز وإذن المتصفح. Push في مرحلة10.",
      );
    } catch {
      setMessage("تعذر تشغيل الصوت؛ راجع الإشعارات النصية.");
    }
  };
  return (
    <Shell title="الإشعارات">
      <Hint>
        مركز محلي. إشعارات الخلفية/الإغلاق وصوت المهام الواردة تختبر على الجهاز
        عند ربط Push؛ لا ضمان لها الآن.
      </Hint>
      <Action
        title={sound ? "كتم صوت المهام" : "تفعيل صوت المهام"}
        secondary
        onPress={() => {
          setSound(!sound);
          if (sound) {
            try {
              player.pause();
            } catch {}
          }
        }}
      />
      <Action
        title="تجربة صوت مهمة"
        icon="volume-high-outline"
        onPress={() => void play()}
      />
      {message && <Txt accessibilityRole="alert">{message}</Txt>}
      {snapshot?.notices.map((x) => (
        <Card key={x.id}>
          <Txt weight="bold">
            {x.title} · {x.read ? "مقروء" : "جديد"}
          </Txt>
          <Txt>{x.body}</Txt>
          <Txt>{stamp(x.at)}</Txt>
          {!x.read && (
            <Action
              title={`تعليم مقروء ${x.title}`}
              secondary
              onPress={() => markRead(x.id)}
            />
          )}
          {x.orderId && (
            <Action
              title={`فتح المهمة ${x.orderId}`}
              secondary
              onPress={() =>
                router.push({ pathname: "/task", params: { id: x.orderId } })
              }
            />
          )}
        </Card>
      ))}
    </Shell>
  );
}
export function AccountScreen() {
  const store = useCourier();
  const confirm = useConfirm();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return (
    <Shell title="حسابي" back={false}>
      <Card>
        <Icon name="person-circle-outline" size={40} />
        <Txt weight="bold">موصل معاينة متعدد الفروع</Txt>
        <Txt>{DEMO_PHONE}</Txt>
        <Txt>
          نطاق تجريبي: عدن وصنعاء · نسبة الحساب الحالية 15% في مثال الإدارة؛
          الإسنادات الأقدم هنا مثبتة على 20%.
        </Txt>
      </Card>
      {[
        { title: "نقد المتجر", path: "/cash" },
        { title: "الإشعارات وصوت المهام", path: "/notifications" },
        { title: "المظهر", path: "/appearance" },
        { title: "الخصوصية والشروط", path: "/policies" },
        { title: "مختبر المعاينة", path: "/preview-lab" },
      ].map((x) => (
        <Action
          key={x.path}
          title={x.title}
          secondary
          icon="arrow-back-outline"
          onPress={() => router.push(x.path as "/cash")}
        />
      ))}
      <Card>
        <Txt weight="bold">الدعم</Txt>
        <Txt>
          رقم الدعم الحقيقي لم يزود. انسخ رسالة وشاركها يدويًا مع الإدارة.
        </Txt>
        <Action
          title="نسخ رسالة دعم"
          secondary
          onPress={() =>
            void Clipboard.setStringAsync(
              "دعم تزويد — الموصل: أحتاج مساعدة في مهمة. اذكر رقمها دون بيانات خاصة.",
            )
              .then(() => {
                setCopied(true);
                setCopyError(false);
              })
              .catch(() => {
                setCopied(false);
                setCopyError(true);
              })
          }
        />
        {copied && <Txt>نسخت رسالة الدعم.</Txt>}
        {copyError && (
          <Txt accessibilityRole="alert">
            تعذر النسخ؛ اذكر رقم المهمة وتواصل يدويًا مع الإدارة.
          </Txt>
        )}
      </Card>
      <Action
        title="تسجيل الخروج"
        secondary
        onPress={() =>
          confirm.ask(
            "تسجيل الخروج",
            "سيمسح هذا الجهاز النسخة المحلية ومسودات البلاغات وقائمة العمليات. راجع العمليات المعلقة؛ الخروج لا يلغي أثر عملية أقرها الخادم التجريبي.",
            store.logout,
          )
        }
      />
      {confirm.modal}
    </Shell>
  );
}
export function AppearanceScreen() {
  return <SettingsScreen />;
}
export function PoliciesScreen() {
  return (
    <Shell title="الخصوصية والشروط">
      <Card>
        <Txt weight="bold">مسودة للمراجعة — ليست سياسة قانونية معتمدة</Txt>
        <Txt>
          تعرض بيانات الطلب المسند فقط أثناء صلاحية النسخة. تمسح النسخة
          والعمليات والمسودات عند الخروج. لا حفظ دائم لبيانات العملاء أو صور
          البلاغات، ولا طلب إذن موقع أو ميكروفون أو تتبع خلفي.
        </Txt>
        <Txt>
          لا يصل الموصل إلى إيصالات تحويل العميل أو سجل بلاغاته الكامل. يحتفظ
          الخادم لاحقًا بالحقائق المالية وفق السياسة المعتمدة؛ مدة الاحتفاظ D19
          لم تحدد.
        </Txt>
        <Txt>
          لا صيانة العميل توقف مهام الموصل. التصحيح المالي بإدارة مخولة، دون
          استرداد آلي أو خصم عمولة من عهدة النقد.
        </Txt>
      </Card>
    </Shell>
  );
}
export function LabScreen() {
  const store = useCourier();
  const confirm = useConfirm();
  return (
    <Shell title="مختبر المعاينة">
      <Hint warning>
        أدوات مراجعة محلية، لا إجراءات موصل أو إدارة حقيقية. التطبيقات الثلاثة
        مستقلة ولا تتبادل هذه البيانات.
      </Hint>
      <Txt weight="bold">حالات القراءة</Txt>
      <Row style={{ flexWrap: "wrap" }}>
        {(["ready", "loading", "empty", "error", "offline"] as Scenario[]).map(
          (x, i) => (
            <Action
              key={x}
              title={`قراءة ${["جاهزة", "تحميل", "فارغة", "خطأ", "انقطاع"][i]}`}
              secondary={store.scenario !== x}
              onPress={() => {
                store.setScenario(x);
                router.replace("/");
              }}
            />
          ),
        )}
      </Row>
      <Txt weight="bold">إرسال العمليات</Txt>
      <Action
        title="الشبكة: متصلة"
        secondary={store.network !== "online"}
        onPress={() => store.setNetwork("online")}
      />
      <Action
        title="الشبكة: منقطعة"
        secondary={store.network !== "offline"}
        onPress={() => store.setNetwork("offline")}
      />
      <Action
        title="الشبكة: فقد إقرار"
        secondary={store.network !== "lost_ack"}
        onPress={() => store.setNetwork("lost_ack")}
      />
      <Action
        title="إنهاء صلاحية إسناد TZ-0401"
        secondary
        onPress={() =>
          confirm.ask(
            "إنهاء إسناد تجريبي",
            "تمسح تفاصيل المهمة وصورتها المحلية والعمليات التابعة لها.",
            () => store.lab("expire"),
          )
        }
      />
      <Action
        title="فتح إسناد TZ-0401"
        secondary
        onPress={() => router.push({ pathname: "/task", params: { id: "t1" } })}
      />
      <Action
        title="محاكاة رد الإدارة على البلاغ"
        secondary
        onPress={() => store.lab("reply")}
      />
      <Action
        title="محاكاة صيانة العميل"
        secondary
        onPress={() => store.lab("maintenance")}
      />
      <Action
        title="إعادة بيانات المعاينة والخروج"
        secondary
        onPress={() =>
          confirm.ask(
            "إعادة المعاينة",
            "ستمسح بيانات الجلسة والعمليات التجريبية ويطلب الدخول مجددًا.",
            () => store.lab("reset"),
          )
        }
      />
      {confirm.modal}
    </Shell>
  );
}
