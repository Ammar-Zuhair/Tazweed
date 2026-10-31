import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { appInfo } from "../config";
import {
  Action,
  Card,
  Header,
  Icon,
  Page,
  Row,
  SectionTitle,
  Txt,
} from "./components";
import type { ThemePreference } from "./theme-model";
import { useTheme } from "./theme-provider";
export function SettingsScreen() {
  const { colors, preference, setPreference, persistenceError } = useTheme();
  const choices: {
    id: ThemePreference;
    title: string;
    body: string;
    icon: "phone-portrait-outline" | "sunny-outline" | "moon-outline";
  }[] = [
    {
      id: "system",
      title: "حسب الجهاز",
      body: "يتبع مظهر جهازك تلقائيًا",
      icon: "phone-portrait-outline",
    },
    {
      id: "light",
      title: "الوضع الفاتح",
      body: "مساحات مشرقة وتفاصيل واضحة",
      icon: "sunny-outline",
    },
    {
      id: "dark",
      title: "الوضع المظلم",
      body: "هدوء أكثر في الإضاءة المنخفضة",
      icon: "moon-outline",
    },
  ];
  return (
    <Page>
      <Header title="الإعدادات" subtitle="تجربة تناسبك" />
      <Action
        title="العودة"
        secondary
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace("/account")
        }
      />
      <SectionTitle>مظهر التطبيق</SectionTitle>
      <Txt style={{ color: colors.textMuted, marginBottom: 18 }}>
        اختر مظهرك المفضل. نحفظ اختيارك للمرة القادمة.
      </Txt>
      <View accessibilityRole="radiogroup" style={{ gap: 12 }}>
        {choices.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="radio"
            accessibilityLabel={item.title}
            accessibilityState={{ checked: preference === item.id }}
            aria-checked={preference === item.id}
            onPress={() => setPreference(item.id)}
            style={{
              borderRadius: 18,
              padding: 18,
              backgroundColor: colors.surface,
              borderWidth: 1.5,
              borderColor:
                preference === item.id ? colors.primary : colors.border,
            }}
          >
            <Row>
              <Icon
                name={item.icon}
                color={
                  preference === item.id ? colors.primary : colors.textMuted
                }
              />
              <View style={{ flex: 1 }}>
                <Txt weight="bold">{item.title}</Txt>
                <Txt style={{ color: colors.textMuted, fontSize: 13 }}>
                  {item.body}
                </Txt>
              </View>
              <Icon
                name={
                  preference === item.id
                    ? "radio-button-on"
                    : "radio-button-off"
                }
                color={
                  preference === item.id ? colors.primary : colors.textMuted
                }
              />
            </Row>
          </Pressable>
        ))}
      </View>
      {persistenceError && (
        <Txt
          accessibilityRole="alert"
          style={{ marginTop: 12, color: colors.primary }}
        >
          تعذر حفظ التفضيل على هذا الجهاز. يطبق المظهر لهذه الجلسة فقط.
        </Txt>
      )}
      <Card style={{ marginTop: 28 }}>
        <Row>
          <Icon name="language-outline" />
          <Txt weight="bold">العربية</Txt>
        </Row>
        <Txt style={{ color: colors.textMuted }}>
          واجهة من اليمين إلى اليسار، بخط Tajawal.
        </Txt>
      </Card>
      <Txt
        style={{
          color: colors.textMuted,
          fontSize: 12,
          textAlign: "center",
          marginTop: 24,
        }}
      >
        تزويد · {appInfo.roleLabel} · إصدار المعاينة 0.1.0
      </Txt>
    </Page>
  );
}
