import { useRouter, usePathname } from "expo-router";
import { Page, Header, Txt, Card, Action } from "../ui/components";
import { useTheme } from "../ui/theme-provider";
export default function Preferences() {
  const theme = useTheme(),
    router = useRouter(),
    path = usePathname();
  return (
    <Page>
      <Header
        title={path === "/settings" ? "المظهر والإعدادات" : "تزويد"}
        subtitle="إعدادات التطبيق ومعلوماته"
      />
      {path === "/settings" ? (
        <Card>
          {(["system", "light", "dark"] as const).map((v) => (
            <Action
              key={v}
              secondary={theme.preference !== v}
              title={{ system: "حسب الجهاز", light: "فاتح", dark: "مظلم" }[v]}
              onPress={() => theme.setPreference(v)}
            />
          ))}
          <Txt>
            {theme.persistenceError
              ? "تعذر حفظ تفضيل المظهر."
              : "يُحفظ المظهر فقط على الجهاز."}
          </Txt>
        </Card>
      ) : path === "/support" ? (
        <Card>
          <Txt>
            بيانات الدعم لم تهيأ بعد. لن تُرسل رسالة أو مكالمة تلقائيًا.
          </Txt>
        </Card>
      ) : (
        <Card>
          <Txt weight="bold">
            {path === "/about" ? "عن تزويد" : "مسودة للمراجعة قبل الإطلاق"}
          </Txt>
          <Txt>
            المنتجات والأسعار والمخزون مصدرها خادم تزويد. الكميات المختارة
            مسودة، ولا تمثل طلبًا مرسلًا أو حجزًا.
          </Txt>
          <Txt>
            الحساب يخضع لكلمة المرور والتحقق من الهاتف. تُحفظ بيانات جلسة الدخول
            الأصلية في مخزن النظام الآمن، ونسخة الويب في الذاكرة. تُرفع الصور
            مباشرة إلى التخزين بإذن مؤقت من الخادم عند تهيئة الخدمة.
          </Txt>
          <Txt>
            سياسة التشغيل المعتمدة وبيانات التواصل ومدد الاحتفاظ ستتاح قبل
            الإطلاق.
          </Txt>
        </Card>
      )}
      <Action
        secondary
        title="العودة للرئيسية"
        onPress={() => router.replace("/")}
      />
    </Page>
  );
}
