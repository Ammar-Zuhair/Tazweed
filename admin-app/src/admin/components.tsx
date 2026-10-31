import { useState, type PropsWithChildren, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { router } from "expo-router";
import { Action, Card, Header, Icon, Page, Row, Txt } from "../ui/components";
import { useTheme } from "../ui/theme-provider";
import { useAdmin } from "../data/admin-provider";
import { accessibleBranches, actor, can } from "../domain/admin-model";
import type { Permission, Command } from "../domain/types";
export { Action, Card, Icon, Row, Txt } from "../ui/components";
export const uid = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
        padding: 14,
        borderRadius: 12,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: warning ? colors.primary : colors.border,
      }}
    >
      <Txt
        style={{
          fontSize: 13,
          color: warning ? colors.primary : colors.textMuted,
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
    <View style={{ gap: 5, flexGrow: 1, minWidth: 0 }}>
      <Txt weight="medium" style={{ fontSize: 14 }}>
        {label}
      </Txt>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[
          {
            minHeight: 48,
            width: "100%",
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 12,
            backgroundColor: colors.surface,
            color: colors.text,
            fontFamily: "Tajawal-Regular",
            fontSize: 16,
            textAlign: "right",
            writingDirection: props.keyboardType === "numeric" ? "ltr" : "rtl",
          },
          props.multiline && { minHeight: 96 },
          props.style,
        ]}
      />
    </View>
  );
}
export function Choice({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      onPress={onPress}
      disabled={disabled}
      style={{
        minHeight: 44,
        maxWidth: "100%",
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 12,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: colors.surface,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Txt
        style={{ fontSize: 14, color: selected ? colors.primary : colors.text }}
      >
        {selected ? "✓ " : ""}
        {label}
      </Txt>
    </Pressable>
  );
}
export function Choices({ children }: PropsWithChildren) {
  return <Row style={{ flexWrap: "wrap", gap: 8 }}>{children}</Row>;
}
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; name: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Txt weight="medium">{label}</Txt>
      <Choices>
        {options.map((x) => (
          <Choice
            key={x.id}
            label={x.name}
            selected={value === x.id}
            onPress={() => onChange(x.id)}
          />
        ))}
      </Choices>
    </View>
  );
}
export function Save({
  title = "حفظ محلي",
  onPress,
}: {
  title?: string;
  onPress: () => void;
}) {
  return <Action title={title} onPress={onPress} icon="checkmark-outline" />;
}
export function Artwork({
  label = "رسم عبوة زيت",
  large = false,
}: {
  label?: string;
  large?: boolean;
}) {
  const { colors } = useTheme();
  const icon = label.includes("بطارية")
    ? "battery-charging-outline"
    : label.includes("إطار")
      ? "ellipse-outline"
      : "water-outline";
  return (
    <View
      accessibilityLabel={label}
      style={{
        minHeight: large ? 160 : 72,
        borderRadius: 18,
        backgroundColor: colors.background,
        justifyContent: "center",
        alignItems: "center",
        padding: 16,
        gap: 8,
      }}
    >
      <Icon name={icon} size={large ? 64 : 34} color={colors.primary} />
      <Txt style={{ fontSize: 12, color: colors.textMuted }}>{label}</Txt>
    </View>
  );
}
export function Feedback() {
  const { message, clear } = useAdmin();
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View
      style={{
        position: "absolute",
        left: 14,
        right: 14,
        bottom: 90,
        maxWidth: 760,
        alignSelf: "center",
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: colors.primary,
        backgroundColor: colors.surface,
        zIndex: 100,
      }}
      accessibilityLiveRegion="polite"
    >
      <Txt accessibilityRole="alert">{message}</Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="إغلاق التنبيه"
        onPress={clear}
        style={{ minHeight: 36, justifyContent: "center" }}
      >
        <Txt weight="bold" style={{ color: colors.primary }}>
          إغلاق التنبيه
        </Txt>
      </Pressable>
    </View>
  );
}
export function Shell({
  title,
  subtitle = "إدارة تزويد",
  children,
  permission,
  branchId,
  back = true,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  permission?: Permission;
  branchId?: string | null;
  back?: boolean;
}>) {
  const { state } = useAdmin();
  const a = actor(state);
  const allowed =
    !permission ||
    can(
      state,
      permission,
      branchId === undefined ? state.selectedBranch : branchId,
    );
  return (
    <Page>
      <Header title={title} subtitle={subtitle} />
      {back && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="العودة إلى لوحة الإدارة"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
          style={{ minHeight: 44 }}
        >
          <Txt>‹ العودة إلى لوحة الإدارة</Txt>
        </Pressable>
      )}
      <View style={{ gap: 16, paddingBottom: 20 }}>
        <Hint>بيانات تجريبية · لا عمليات فعلية</Hint>
        {a && (
          <Txt style={{ fontSize: 13 }}>
            {a.name} ·{" "}
            {state.selectedBranch
              ? state.branches.find((b) => b.id === state.selectedBranch)?.name
              : "كل النطاقات المخولة"}
          </Txt>
        )}
        {allowed ? (
          children
        ) : (
          <Card testID="permission-denied">
            <Icon name="lock-closed-outline" size={32} />
            <Txt weight="bold">هذا الإجراء خارج صلاحياتك أو نطاق فرعك.</Txt>
            <Txt>
              تطبق هذه المعاينة حارسًا محليًا؛ يلزم حارس الخادم في مرحلة05.
            </Txt>
          </Card>
        )}
      </View>
    </Page>
  );
}
export function BranchScope() {
  const { state, send } = useAdmin();
  const all = actor(state)?.grants.some((g) => g.branchId === null);
  return (
    <Select
      label="نطاق الفرع"
      value={state.selectedBranch ?? "all"}
      onChange={(id) =>
        send({ type: "scope", branchId: id === "all" ? null : id })
      }
      options={[
        ...(all ? [{ id: "all", name: "كل الفروع" }] : []),
        ...accessibleBranches(state).map((b) => ({ id: b.id, name: b.name })),
      ]}
    />
  );
}
export function useConfirm() {
  const { send, message, clear } = useAdmin();
  const { colors } = useTheme();
  const [pending, setPending] = useState<{
    title: string;
    body: string;
    command: Command;
    onSuccess?: () => void;
  } | null>(null);
  return {
    ask: (
      title: string,
      body: string,
      command: Command,
      onSuccess?: () => void,
    ) => {
      clear();
      setPending({ title, body, command, onSuccess });
    },
    dialog: (
      <Modal
        visible={!!pending}
        transparent
        animationType="fade"
        onRequestClose={() => setPending(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "#0009",
            justifyContent: "center",
            padding: 22,
          }}
        >
          <Card style={{ width: "100%", maxWidth: 580, alignSelf: "center" }}>
            <Txt weight="bold" style={{ fontSize: 22 }}>
              {pending?.title}
            </Txt>
            <Txt>{pending?.body}</Txt>
            <Hint warning>
              تأكيد إضافي لمعاينة محلية. لا تنفذ مالًا أو تغيير خادم.
            </Hint>
            {message && <Hint warning>{message}</Hint>}
            <Action
              title="تأكيد العملية التجريبية"
              onPress={() => {
                if (pending && send(pending.command)) {
                  pending.onSuccess?.();
                  setPending(null);
                }
              }}
            />
            <Action title="تراجع" secondary onPress={() => setPending(null)} />
          </Card>
        </View>
      </Modal>
    ),
  };
}
export function MiniMap({
  latitude,
  longitude,
  onChange,
}: {
  latitude: number;
  longitude: number;
  onChange: (lat: number, lng: number) => void;
}) {
  const { colors } = useTheme();
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderRelease: (_e, g) =>
      onChange(
        Number((latitude - g.dy * 0.0001).toFixed(6)),
        Number((longitude - g.dx * 0.0001).toFixed(6)),
      ),
  });
  return (
    <View
      {...pan.panHandlers}
      accessibilityLabel="خريطة فرع تخطيطية قابلة للسحب"
      style={{
        height: 180,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <View
        style={{
          position: "absolute",
          width: "150%",
          height: 25,
          backgroundColor: colors.border,
          transform: [{ rotate: "-24deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          height: "140%",
          width: 18,
          backgroundColor: colors.border,
          transform: [{ rotate: "25deg" }],
        }}
      />
      <Icon name="location" color={colors.primary} size={36} />
      <Txt>
        {latitude.toFixed(5)}, {longitude.toFixed(5)}
      </Txt>
      <Txt style={{ fontSize: 12 }}>
        تخطيط محلي · اسحب لتحريك الإحداثيات · لا GPS
      </Txt>
    </View>
  );
}
export function LoadingPanel({
  status,
  onRetry,
}: {
  status: "loading" | "empty" | "error" | "offline";
  onRetry: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Card testID={`admin-${status}`}>
      {status === "loading" && <ActivityIndicator color={colors.primary} />}
      <Txt weight="bold">
        {status === "loading"
          ? "جارٍ تحميل المعاينة…"
          : status === "empty"
            ? "لا سجلات مطابقة"
            : status === "offline"
              ? "معاينة دون اتصال"
              : "تعذر تحميل المعاينة"}
      </Txt>
      <Action title="إعادة المحاولة" onPress={onRetry} />
    </Card>
  );
}
