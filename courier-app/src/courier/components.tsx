import { useEffect, useState, type PropsWithChildren } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { router } from "expo-router";
import { Action, Card, Header, Page, Row, Txt } from "../ui/components";
import { useTheme } from "../ui/theme-provider";
import { useCourier } from "../data/courier-provider";
export { Action, Card, Row, Txt, Icon } from "../ui/components";
export const money = (n: number) => `${n.toLocaleString("en-US")} ر.ي`;
export const stamp = (at: number) =>
  new Date(at).toISOString().replace("T", " ").slice(0, 16) + " UTC";
export function Hint({
  children,
  warning = false,
}: PropsWithChildren<{ warning?: boolean }>) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        padding: 12,
        borderRadius: 12,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: warning ? colors.primary : colors.border,
      }}
    >
      <Txt
        style={{
          color: warning ? colors.primary : colors.textMuted,
          fontSize: 14,
        }}
      >
        {children}
      </Txt>
    </View>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 5 }}>
      <Txt weight="medium">{label}</Txt>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[
          {
            minHeight: props.multiline ? 96 : 50,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 12,
            borderRadius: 12,
            backgroundColor: colors.surface,
            color: colors.text,
            fontFamily: "Tajawal-Regular",
            fontSize: 16,
            textAlign: "right",
            writingDirection:
              props.keyboardType === "numeric" ||
              props.keyboardType === "phone-pad"
                ? "ltr"
                : "rtl",
          },
          props.style,
        ]}
      />
    </View>
  );
}
export function Shell({
  title,
  children,
  back = true,
}: PropsWithChildren<{ title: string; back?: boolean }>) {
  const { message, clear, network } = useCourier();
  return (
    <Page>
      <Header title={title} subtitle="تزويد · الموصل" />
      {back && (
        <View style={{ marginBottom: 14 }}>
          <Action
            title="العودة"
            secondary
            icon="arrow-forward-outline"
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/")
            }
          />
        </View>
      )}
      <View style={{ gap: 16 }}>
        <Hint>معاينة تجريبية محلية · لا مهام أو أموال فعلية</Hint>
        {network !== "online" && (
          <Hint warning>
            {network === "offline"
              ? "انقطاع شبكة تجريبي"
              : "محاكاة فقد الإقرار بعد التنفيذ"}
          </Hint>
        )}
        {message !== "" && (
          <Card accessibilityLiveRegion="polite">
            <Txt accessibilityRole="alert">{message}</Txt>
            <Action title="إغلاق التنبيه" secondary onPress={clear} />
          </Card>
        )}
        {children}
      </View>
    </Page>
  );
}
export function useConfirm() {
  const [confirmation, setConfirmation] = useState<{
    title: string;
    body: string;
    action: () => void;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const { colors } = useTheme();
  useEffect(() => {
    if (!confirmation) return;
    setReady(false);
    const timer = setTimeout(() => setReady(true), 500);
    return () => clearTimeout(timer);
  }, [confirmation]);
  const modal = (
    <Modal
      visible={!!confirmation}
      transparent
      animationType="fade"
      onRequestClose={() => setConfirmation(null)}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "#00000088",
          justifyContent: "center",
          padding: 22,
          direction: "rtl",
        }}
      >
        <View
          accessibilityViewIsModal
          {...(Platform.OS === "web"
            ? { role: "dialog" as const, "aria-modal": true }
            : {})}
          style={{
            width: "100%",
            maxWidth: 500,
            alignSelf: "center",
            backgroundColor: colors.surface,
            borderRadius: 22,
            padding: 24,
            gap: 18,
          }}
        >
          <Txt weight="bold" style={{ fontSize: 22 }}>
            {confirmation?.title}
          </Txt>
          <Txt>{confirmation?.body}</Txt>
          <Action
            title="تأكيد الإجراء"
            disabled={!ready}
            onPress={() => {
              const action = confirmation?.action;
              setConfirmation(null);
              action?.();
            }}
          />
          <Action
            title="تراجع"
            secondary
            onPress={() => setConfirmation(null)}
          />
        </View>
      </View>
    </Modal>
  );
  return {
    ask: (title: string, body: string, action: () => void) =>
      setConfirmation({ title, body, action }),
    modal,
  };
}
export function Loading() {
  const { colors } = useTheme();
  return (
    <Card testID="tasks-loading">
      <ActivityIndicator
        color={colors.primary}
        accessibilityLabel="جارٍ تحميل المهام"
      />
      <Txt>جارٍ تحميل المهام…</Txt>
    </Card>
  );
}
