import { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import {
  actor,
  accessibleBranches,
  can,
  currentQuote,
  money,
  visibleOrders,
} from "../../domain/admin-model";
import { useAdmin, useAdminClock } from "../../data/admin-provider";
import { previewPassword } from "../../fixtures/admin-fixtures";
import {
  permissionNames,
  type Permission,
  type AdminState,
} from "../../domain/types";
import {
  Action,
  BranchScope,
  Card,
  Choice,
  Choices,
  Field,
  Hint,
  Icon,
  Row,
  Shell,
  Txt,
  stamp,
  useConfirm,
} from "../components";
import { Page, Header } from "../../ui/components";
import { palette } from "../../ui/theme-model";
export function LoginScreen() {
  const { state, send } = useAdmin();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const now = Math.max(tick, state.now);
  return (
    <Page>
      <Header title="إدارة تزويد" subtitle="دخول الموظفين المخولين فقط" />
      <View style={{ gap: 18, paddingBottom: 100 }}>
        <View
          style={{
            backgroundColor: palette.navy,
            padding: 24,
            borderRadius: 24,
            gap: 12,
          }}
        >
          <Icon name="shield-checkmark-outline" size={42} color="#FFC08C" />
          <Txt weight="bold" style={{ fontSize: 26, color: "#FFF" }}>
            كل تفصيل في مكانه.
          </Txt>
          <Txt style={{ color: "#DFE8EF" }}>
            مساحة فريق تزويد للطلبات والمخزون والمال.
          </Txt>
        </View>
        <Hint warning>
          معاينة03 محلية فقط · لا حساب حقيقي أو SMS أو جلسة خادم. لا تدخل بيانات
          حساسة. لا إنشاء حساب عام.
        </Hint>
        {!state.challenge ? (
          <Card>
            <Txt weight="bold">اختر حساب اختبار</Txt>
            <Choices>
              {state.staff.slice(0, 4).map((a) => (
                <Choice
                  key={a.id}
                  label={a.name}
                  selected={phone === a.phone}
                  onPress={() => {
                    setPhone(a.phone);
                    setPassword(previewPassword);
                  }}
                />
              ))}
            </Choices>
            <Field
              label="رقم الموظف"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <Field
              label="كلمة مرور الاختبار"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <Txt style={{ fontSize: 13 }}>
              المدير770000001 · الفرع770000002 · المراجع770000003 ·
              المخزن770000004{"\n"}كلمة الاختبار: {previewPassword}
            </Txt>
            <Action
              title="متابعة إلى رمز التحقق"
              onPress={() => send({ type: "login", phone, password })}
            />
          </Card>
        ) : (
          <Card>
            <Txt weight="bold">تحقق موظف تجريبي</Txt>
            <Hint>
              رمز المعاينة000000 ·5 محاولات · صلاحية5 دقائق · إعادة60ث. هذه
              واجهة محلية وليست حماية خادم.
            </Hint>
            <Field
              label="رمز التحقق"
              value={code}
              onChangeText={setCode}
              keyboardType="numeric"
              maxLength={6}
            />
            <Txt>
              متبقي الصلاحية:{" "}
              {Math.max(0, Math.ceil((state.challenge.expiresAt - now) / 1000))}
              ث · المحاولات: {state.challenge.attempts}/5
            </Txt>
            <Action
              title="دخول لوحة الإدارة"
              onPress={() => {
                if (send({ type: "otp", code })) setCode("");
              }}
            />
            <Action
              secondary
              title="إعادة إرسال رمز الاختبار"
              disabled={now < state.challenge.resendAt}
              onPress={() => send({ type: "resend" })}
            />
            <Action
              secondary
              title="تغيير حساب الاختبار"
              onPress={() => send({ type: "logout" })}
            />
          </Card>
        )}
      </View>
    </Page>
  );
}
export const adminLinks: {
  path: string;
  name: string;
  body: string;
  permission: Permission;
  icon:
    | "layers-outline"
    | "cube-outline"
    | "wallet-outline"
    | "people-outline"
    | "notifications-outline"
    | "settings-outline"
    | "shield-checkmark-outline"
    | "document-text-outline"
    | "location-outline"
    | "chatbubble-outline";
}[] = [
  {
    path: "/attributes",
    name: "الخصائص وقيمها",
    body: "قوائم مسجلة ومفاتيح ثابتة",
    permission: "attributes.write",
    icon: "layers-outline",
  },
  {
    path: "/categories",
    name: "الأقسام والفلاتر",
    body: "إلزام وترتيب وروابط واضحة",
    permission: "catalog.write",
    icon: "layers-outline",
  },
  {
    path: "/products",
    name: "المنتجات والوحدات",
    body: "حبة وكرتون وأسعار الفروع",
    permission: "catalog.write",
    icon: "cube-outline",
  },
  {
    path: "/inventory",
    name: "مخزون الفروع",
    body: "حر ومحجوز وحركات مسببة",
    permission: "inventory.adjust",
    icon: "cube-outline",
  },
  {
    path: "/branches",
    name: "المحافظات والفروع",
    body: "كتالوج وتغطية وتعرفة",
    permission: "branches.write",
    icon: "location-outline",
  },
  {
    path: "/couriers",
    name: "الموصلون والعمولات",
    body: "نطاق ونسبة وسجل تعديل",
    permission: "couriers.manage",
    icon: "people-outline",
  },
  {
    path: "/finance",
    name: "الدفاتر المالية",
    body: "عمولات وتوريد نقد واستثناءات",
    permission: "reports.read",
    icon: "wallet-outline",
  },
  {
    path: "/methods",
    name: "وسائل التحويل",
    body: "مستفيد وتعليمات ونطاق",
    permission: "payment-methods.write",
    icon: "wallet-outline",
  },
  {
    path: "/marketing",
    name: "العروض والبنرات",
    body: "عرض واحد بأكبر توفير",
    permission: "promotions.write",
    icon: "notifications-outline",
  },
  {
    path: "/campaigns",
    name: "الرسائل والبث",
    body: "معاينة وجدولة محلية",
    permission: "notifications.broadcast",
    icon: "notifications-outline",
  },
  {
    path: "/quality",
    name: "الشكاوى والتقييمات",
    body: "بلاغ العميل ورد الموظف",
    permission: "complaints.manage",
    icon: "chatbubble-outline",
  },
  {
    path: "/staff",
    name: "الموظفون والأدوار",
    body: "إجراءات ونطاق فروع صريح",
    permission: "staff.manage",
    icon: "shield-checkmark-outline",
  },
  {
    path: "/audit",
    name: "سجل التدقيق",
    body: "من فعل ماذا ومتى",
    permission: "audit.read",
    icon: "document-text-outline",
  },
  {
    path: "/reports",
    name: "التقرير الشهري",
    body: "تصور PDF تجريبي فقط",
    permission: "reports.read",
    icon: "document-text-outline",
  },
  {
    path: "/operations",
    name: "الصيانة والإصدارات",
    body: "العميل فقط وإعدادات المنصات",
    permission: "maintenance.write",
    icon: "settings-outline",
  },
];
export function linkAllowed(
  state: AdminState,
  link: { path: string; permission: Permission },
) {
  const permissions: Partial<Record<string, Permission[]>> = {
    "/operations": ["maintenance.write", "releases.write"],
    "/finance": [
      "commissions.settle",
      "cash.remit",
      "financial-exceptions.resolve",
    ],
    "/inventory": ["inventory.adjust", "inventory.transfer"],
    "/quality": ["complaints.manage", "customer-flags.read"],
  };
  return (permissions[link.path] ?? [link.permission]).some((p) =>
    can(state, p),
  );
}
export function DashboardScreen() {
  const { state, send } = useAdmin();
  const now = useAdminClock();
  const [date, setDate] = useState(
    new Date(state.now).toISOString().slice(0, 10),
  );
  const orders = visibleOrders(state);
  const daily = orders.filter((o) =>
    new Date(o.createdAt).toISOString().startsWith(date),
  );
  const late = orders.filter((o) =>
    state.reservations.some(
      (r) =>
        r.orderId === o.id &&
        r.state === "active" &&
        r.kind === "receipt_review" &&
        now - (r.protectedAt ?? now) >= state.settings.lateAlertMinutes * 60000,
    ),
  );
  const delivered = orders.filter(
    (o) =>
      o.status === "delivered" &&
      new Date(o.deliveredAt!).toISOString().startsWith(date),
  );
  const sales = delivered.reduce(
    (n, o) => n + (currentQuote(o)?.total ?? 0),
    0,
  );
  const branches = accessibleBranches(state).map((b) => b.id);
  const earnings = state.earnings.filter(
    (e) =>
      branches.includes(e.branchId) &&
      (!state.selectedBranch || e.branchId === state.selectedBranch) &&
      new Date(e.at).toISOString().startsWith(date),
  );
  const reportAccess = can(state, "reports.read");
  const stats = [
    [
      "طلبات جديدة",
      daily.filter((o) => o.status === "pending_review" && !o.payments.length)
        .length,
    ],
    ["قيد المراجعة", daily.filter((o) => o.status === "pending_review").length],
    ["حجز محمي متأخر", late.length],
    ["مبيعات المسلّم", reportAccess ? money(sales) : "غير مخول"],
    [
      "عمولات التسليم",
      reportAccess
        ? money(earnings.reduce((n, e) => n + e.amount, 0))
        : "غير مخول",
    ],
  ];
  return (
    <Shell title="لوحة الإدارة" subtitle="نظرة واضحة إلى يومك" back={false}>
      <BranchScope />
      <Field
        label="اليوم — UTC للمعاينة"
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
      />
      <Hint>
        تقارير UTC تجريبية؛ D15 بانتظار الاعتماد. المبيعات للمسلّم فقط.
      </Hint>
      <Row style={{ flexWrap: "wrap", alignItems: "stretch" }}>
        {stats.map(([label, value]) => (
          <Card key={label} style={{ flexGrow: 1, flexBasis: 140 }}>
            <Txt style={{ fontSize: 13 }}>{label}</Txt>
            <Txt weight="bold" style={{ fontSize: 25 }}>
              {value}
            </Txt>
          </Card>
        ))}
      </Row>
      <Card>
        <Txt weight="bold">توزيع الطلبات في اليوم المحدد</Txt>
        {[
          ["قيد المراجعة", "pending_review"],
          ["مؤكد", "confirmed"],
          ["في الطريق", "on_the_way"],
          ["مسلم", "delivered"],
        ].map(([label, status]) => {
          const count = daily.filter((o) => o.status === status).length;
          return (
            <View
              key={status}
              accessibilityLabel={`${label}: ${count}`}
              style={{ gap: 5 }}
            >
              <Txt>
                {label} · {count}
              </Txt>
              <View
                style={{
                  height: 10,
                  backgroundColor: "#B8C2CC",
                  borderRadius: 8,
                }}
              >
                <View
                  style={{
                    height: 10,
                    borderRadius: 8,
                    width: `${daily.length ? (count / daily.length) * 100 : 0}%`,
                    backgroundColor: palette.orange,
                  }}
                />
              </View>
            </View>
          );
        })}
      </Card>
      {late.map((o) => (
        <Card key={o.id}>
          <Hint warning>
            حجز محمي متأخر · {o.id} · لا تحرير بالوقت بعد الإيصال
          </Hint>
          <Action
            title={`مراجعة الحجز ${o.id}`}
            onPress={() => router.push(`/order?id=${o.id}`)}
          />
        </Card>
      ))}
      <Txt weight="bold" style={{ fontSize: 21 }}>
        ابدأ من هنا
      </Txt>
      {adminLinks
        .filter((l) => linkAllowed(state, l))
        .slice(0, 6)
        .map((l) => (
          <Action
            key={l.path}
            title={l.name}
            secondary
            icon={l.icon}
            onPress={() => router.push(l.path as never)}
          />
        ))}
      <Action title="كل أدوات الإدارة" onPress={() => router.push("/more")} />
      {can(state, "orders.review", null) && (
        <Card>
          <Txt weight="bold">أحداث معاينة03</Txt>
          <Txt>
            بيانات هذه الإدارة مستقلة عن العميل؛ لا ربط بين التطبيقين الآن.
          </Txt>
          <Action
            title="تقدم وقت المعاينة31دقيقة"
            secondary
            onPress={() => send({ type: "preview-time", minutes: 31 })}
          />
        </Card>
      )}
    </Shell>
  );
}
export function MoreScreen() {
  const { state, send, reset } = useAdmin();
  const confirm = useConfirm();
  return (
    <Shell title="أدوات الإدارة" back={false}>
      <BranchScope />
      {adminLinks.map((l) => (
        <Card key={l.path}>
          <Row>
            <Icon name={l.icon} />
            <Txt weight="bold" style={{ flex: 1 }}>
              {l.name}
            </Txt>
            {!linkAllowed(state, l) && <Icon name="lock-closed-outline" />}
          </Row>
          <Txt>{l.body}</Txt>
          <Action
            title={`فتح ${l.name}`}
            secondary
            onPress={() => router.push(l.path as never)}
          />
        </Card>
      ))}
      <Action
        title="تسجيل الخروج"
        onPress={() =>
          confirm.ask(
            "تسجيل الخروج",
            "ستنتهي جلسة الموظف المحلية. تبقى بيانات المعاينة حتى إعادة تحميل التطبيق.",
            { type: "logout" },
          )
        }
      />
      <Action
        title="إعادة بيانات المعاينة وتسجيل الخروج"
        secondary
        onPress={() =>
          confirm.ask(
            "إعادة بيانات المعاينة",
            "تمسح التعديلات المحلية وتسجل الخروج. يلزم تأكيدك لإعادة البداية.",
            { type: "logout" },
            reset,
          )
        }
      />
      {confirm.dialog}
    </Shell>
  );
}
