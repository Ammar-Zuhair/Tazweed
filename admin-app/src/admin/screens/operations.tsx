import { useState } from "react";
import { View } from "react-native";
import { useAdmin } from "../../data/admin-provider";
import {
  accessibleBranches,
  can,
  currentQuote,
  money,
} from "../../domain/admin-model";
import type { Release } from "../../domain/types";
import {
  Action,
  BranchScope,
  Card,
  Choice,
  Field,
  Hint,
  Save,
  Select,
  Shell,
  Txt,
  stamp,
  useConfirm,
} from "../components";
export function OperationsScreen() {
  const { state } = useAdmin();
  const [maintenance, setMaintenance] = useState(state.maintenance.enabled);
  const [message, setMessage] = useState(state.maintenance.message);
  const [alert, setAlert] = useState(String(state.settings.lateAlertMinutes));
  const [privacy, setPrivacy] = useState(state.settings.privacy);
  const [support, setSupport] = useState(state.settings.support);
  const [release, setRelease] = useState<Release>({
    app: "customer",
    platform: "android",
    environment: "staging",
    minimum: 1,
    latest: 1,
    version: "0.1.0",
    url: "",
    message: "",
  });
  const confirm = useConfirm();
  return (
    <Shell
      title="الصيانة والإصدارات"
      permission={
        can(state, "maintenance.write", null) ||
        can(state, "releases.write", null)
          ? undefined
          : "maintenance.write"
      }
      branchId={null}
    >
      {can(state, "maintenance.write", null) && (
        <Card>
          <Txt weight="bold">صيانة العميل فقط</Txt>
          <Hint warning>
            علم محلي للمعاينة؛ لا يغير تطبيق العميل المستقل أو خدمة فعلية الآن.
            تظل الإدارة والموصل قابلين للاستخدام.
          </Hint>
          <Choice
            label="محاكاة صيانة العميل"
            selected={maintenance}
            onPress={() => setMaintenance(!maintenance)}
          />
          <Field
            label="رسالة الصيانة *"
            multiline
            value={message}
            onChangeText={setMessage}
          />
          <Txt>
            المستثنى: طلب جارٍ وقبوله وتحويله ودعم وخصوصية وحذف. الممنوع:
            الكتالوج والطلبات الجديدة. يلزم تنفيذ الخادم لاحقًا.
          </Txt>
          <Save
            title="مراجعة حفظ صيانة العميل"
            onPress={() =>
              confirm.ask(
                "تغيير صيانة العميل محليًا",
                `${maintenance ? "تشغيل" : "إيقاف"} · الإدارة والموصل مستمران.`,
                {
                  type: "maintenance",
                  enabled: maintenance,
                  message,
                  confirmed: true,
                },
              )
            }
          />
          <Txt testID="maintenance-state">
            الحالة المحفوظة:{" "}
            {state.maintenance.enabled ? "العميل بصيانة تجريبية" : "عادية"}
          </Txt>
        </Card>
      )}
      {can(state, "releases.write", null) && (
        <Card>
          <Txt weight="bold">الإصدارات لكل تطبيق ومنصة وبيئة</Txt>
          <Hint>
            إعداد واجهة فقط؛ لا OTA أو نشر أو متجر مهيأ، وbuild أعداد لا مقارنة
            نصية.
          </Hint>
          <Select
            label="تطبيق الإصدار"
            value={release.app}
            options={[
              { id: "customer", name: "العميل" },
              { id: "admin", name: "الإدارة" },
              { id: "courier", name: "الموصل" },
            ]}
            onChange={(app) => setRelease({ ...release, app })}
          />
          <Select
            label="منصة الإصدار"
            value={release.platform}
            options={[
              { id: "android", name: "Android" },
              { id: "ios", name: "iOS" },
            ]}
            onChange={(platform) => setRelease({ ...release, platform })}
          />
          <Select
            label="بيئة إعداد الإصدار"
            value={release.environment}
            options={[
              { id: "staging", name: "Staging" },
              { id: "production", name: "Production — إعداد محلي فقط" },
            ]}
            onChange={(environment) => setRelease({ ...release, environment })}
          />
          <Field
            label="أقل build مسموح *"
            keyboardType="numeric"
            value={String(release.minimum)}
            onChangeText={(x) => setRelease({ ...release, minimum: Number(x) })}
          />
          <Field
            label="أحدث build *"
            keyboardType="numeric"
            value={String(release.latest)}
            onChangeText={(x) => setRelease({ ...release, latest: Number(x) })}
          />
          <Field
            label="نص الإصدار *"
            value={release.version}
            onChangeText={(version) => setRelease({ ...release, version })}
          />
          <Field
            label="رابط المتجر HTTPS *"
            value={release.url}
            onChangeText={(url) => setRelease({ ...release, url })}
          />
          <Field
            label="رسالة الإصدار"
            value={release.message}
            onChangeText={(message) => setRelease({ ...release, message })}
          />
          <Save
            title="مراجعة حفظ إعداد الإصدار"
            onPress={() =>
              confirm.ask(
                "إعداد إصدار محلي",
                `${release.app}/${release.platform}/${release.environment} · minimum ${release.minimum} / latest ${release.latest} · لا نشر.`,
                { type: "release", value: release, confirmed: true },
              )
            }
          />
          {state.releases.map((r) => (
            <Card key={`${r.app}-${r.platform}-${r.environment}`}>
              <Txt>
                {r.app}/{r.platform}/{r.environment} · {r.minimum}←{r.latest}
              </Txt>
              <Txt>
                {r.url} · {r.message}
              </Txt>
              <Action
                title={`تحرير إعداد ${r.app} ${r.platform} ${r.environment}`}
                secondary
                onPress={() => setRelease({ ...r })}
              />
            </Card>
          ))}
        </Card>
      )}
      {can(state, "maintenance.write", null) && (
        <Card>
          <Txt weight="bold">مواعيد التنبيه وروابط المساعدة</Txt>
          <Field
            label="مهلة الحجز الأولي بالدقائق — قرار المالك"
            value="30"
            editable={false}
          />
          <Field
            label="تنبيه تأخر المراجعة بالدقائق"
            keyboardType="numeric"
            value={alert}
            onChangeText={setAlert}
          />
          <Hint warning>
            حد التنبيه إعداد معاينة وليس مهلة تحرير؛ الحجز المحمي بلا انتهاء
            آلي. تعديل30دقيقة المالية يحتاج قرار مالك.
          </Hint>
          <Field
            label="مسار الخصوصية أو رابطها"
            value={privacy}
            onChangeText={setPrivacy}
          />
          <Field
            label="مسار الدعم أو رابطه"
            value={support}
            onChangeText={setSupport}
          />
          <Hint>
            النص القانوني ومدد الاحتفاظ وروابط المتجر والدعم الحقيقية غير
            معتمدة. الصفحات العامة وتنفيذها في11؛ لا وعود حذف أو نشر سياسة.
          </Hint>
          <Save
            title="مراجعة حفظ إعدادات التنبيه"
            onPress={() =>
              confirm.ask(
                "حفظ إعداد التنبيه",
                `تنبيه ${alert}دقيقة دون تحرير حجز محمي.`,
                {
                  type: "settings",
                  value: {
                    holdMinutes: 30,
                    lateAlertMinutes: Number(alert),
                    privacy,
                    support,
                  },
                  confirmed: true,
                },
              )
            }
          />
        </Card>
      )}
      {confirm.dialog}
    </Shell>
  );
}
export function ReportsScreen() {
  const { state } = useAdmin();
  const [month, setMonth] = useState(
    new Date(state.now).toISOString().slice(0, 7),
  );
  const [preview, setPreview] = useState(false);
  const orders = state.orders
    .filter(
      (o) =>
        can(state, "reports.read", o.branchId ?? o.catalogBranchId) &&
        (!state.selectedBranch ||
          (o.branchId ?? o.catalogBranchId) === state.selectedBranch),
    )
    .filter(
      (o) =>
        o.status === "delivered" &&
        new Date(o.deliveredAt!).toISOString().startsWith(month),
    );
  const ids = new Set(orders.map((o) => o.id));
  const quotes = orders.map((o) => currentQuote(o)!);
  const earnings = state.earnings.filter((e) => ids.has(e.orderId));
  const cash = state.cash.filter((c) => ids.has(c.orderId));
  const visibleBranches = accessibleBranches(state).map((b) => b.id);
  const remits = state.remittances.filter(
    (p) =>
      p.branchIds.every(
        (b) =>
          visibleBranches.includes(b) &&
          (!state.selectedBranch || state.selectedBranch === b),
      ) && new Date(p.at).toISOString().startsWith(month),
  );
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  return (
    <Shell title="التقرير الشهري" permission="reports.read">
      <BranchScope />
      <Field
        label="شهر التقرير — UTC للمعاينة"
        value={month}
        onChangeText={(x) => {
          setMonth(x);
          setPreview(false);
        }}
        placeholder="YYYY-MM"
      />
      <Hint warning>
        تصور تقرير PDF عربي تجريبي فقط؛ ليس ملفًا ماليًا مولدًا أو مشاركًا. D15
        لحدود اليوم لم تعتمد؛ المعاينة UTC مؤقتًا.
      </Hint>
      {!valid && <Hint warning>أدخل شهرًا بصيغة YYYY-MM.</Hint>}
      <Action
        title="عرض تصور PDF التجريبي"
        disabled={!valid}
        onPress={() => setPreview(true)}
      />
      {preview && (
        <View
          testID="report-preview"
          style={{
            backgroundColor: "#FFFFFF",
            padding: 22,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#B8C2CC",
            gap: 16,
          }}
        >
          <Txt weight="bold" style={{ color: "#082A48", fontSize: 25 }}>
            تزويد · تقرير مبيعات شهري
          </Txt>
          <Txt
            style={{ color: "#B94700", fontSize: 22 }}
            accessibilityRole="header"
          >
            تجريبي — غير صالح للمحاسبة
          </Txt>
          <Txt style={{ color: "#082A48" }}>
            الفترة {month} · UTC مؤقت ·{" "}
            {state.selectedBranch ?? "كل الفروع المخولة"}
          </Txt>
          {[
            ["طلبات مسلمة", String(orders.length)],
            ["مبيعات نهائية", money(quotes.reduce((n, q) => n + q.total, 0))],
            [
              "توصيل قبل الخصم",
              money(quotes.reduce((n, q) => n + q.delivery, 0)),
            ],
            [
              "خصم التوصيل",
              money(quotes.reduce((n, q) => n + q.deliveryDiscount, 0)),
            ],
            [
              "رسوم العميل للتوصيل",
              money(
                quotes.reduce((n, q) => n + q.delivery - q.deliveryDiscount, 0),
              ),
            ],
            [
              "عمولات مستحقة",
              money(earnings.reduce((n, e) => n + e.amount, 0)),
            ],
            ["نقد محصل مستقل", money(cash.reduce((n, c) => n + c.amount, 0))],
            [
              "نقد مورد خلال الشهر",
              money(remits.reduce((n, r) => n + r.amount, 0)),
            ],
          ].map(([label, value]) => (
            <View
              key={label}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
                borderBottomWidth: 1,
                borderColor: "#DDE4EA",
                paddingBottom: 9,
              }}
            >
              <Txt style={{ color: "#082A48" }}>{label}</Txt>
              <Txt weight="bold" style={{ color: "#082A48" }}>
                {value}
              </Txt>
            </View>
          ))}
          <Txt style={{ color: "#082A48", fontSize: 12 }}>
            بيانات محلية وهمية · لا ملف PDF أو إرسال مشاركة من التطبيق في03.
            {"\n"}المبيعات حسب تاريخ التسليم، والتوريد حسب تاريخ القيد؛ ليسا نفس
            التدفق.
          </Txt>
        </View>
      )}
    </Shell>
  );
}
