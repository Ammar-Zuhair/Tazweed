import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState, Platform, View, StyleSheet, Linking } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Application from "expo-application";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname, useRouter, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { api, useAuth, LoginPanel, clientApp } from "./connection";
import { Page, Card, Txt, Action } from "../ui/components";
import { useTheme } from "../ui/theme-provider";
import { downloadUpdateForNextLaunch } from "../../integration/updates";
const app = clientApp as "customer" | "admin" | "courier";
const nativeReady =
  Platform.OS !== "web" &&
  Constants.executionEnvironment !== "storeClient" &&
  Device.isDevice &&
  !!Constants.expoConfig?.extra?.eas?.projectId;
const Context = createContext<any>(null);
const safeId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id);
export function EngagementProvider({ children }: PropsWithChildren) {
  const { user } = useAuth(),
    router = useRouter(),
    path = usePathname(),
    { colors } = useTheme();
  const [config, setConfig] = useState<any>(null),
    [error, setError] = useState(""),
    [permission, setPermission] = useState(
      nativeReady ? "unknown" : "unavailable",
    ),
    [sound, setSound] = useState(true),
    [notice, setNotice] = useState(""),
    [dismissed, setDismissed] = useState(false);
  const account = useRef(user?.id);
  account.current = user?.id;
  const seen = useRef(new Set<string>()),
    busy = useRef(false);
  const build =
    Platform.OS === "web" || Constants.executionEnvironment === "storeClient"
      ? 0
      : Number(Application.nativeBuildVersion ?? "0");
  const refresh = useCallback(async () => {
    try {
      const c = await api(
        `/public/config?app=${app}&platform=${Platform.OS === "ios" ? "ios" : "android"}&build=${build}`,
      );
      setConfig(c);
      setError("");
    } catch {
      setError("تعذر تحديث حالة التشغيل؛ أعد المحاولة.");
    }
  }, [build]);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 60000),
      sub = AppState.addEventListener("change", (s) => {
        if (s === "active") void refresh();
      });
    void downloadUpdateForNextLaunch();
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [refresh]);
  useEffect(() => {
    setNotice("");
    seen.current.clear();
    setSound(true);
    if (user)
      void AsyncStorage.getItem("tazweed.sound." + app + "." + user.id).then(
        (v) => {
          if (account.current === user.id) setSound(v !== "false");
        },
      );
  }, [user?.id]);
  async function activate(request = false, preferredSound = sound) {
    const owner = user?.id;
    if (!nativeReady || !owner || busy.current) return;
    busy.current = true;
    try {
      const N = await import("expo-notifications");
      if (Platform.OS === "android") {
        await N.setNotificationChannelAsync("tazweed-alerts-v1", {
          name: "تنبيهات تزويد",
          importance: N.AndroidImportance.HIGH,
          sound: "default",
        });
        await N.setNotificationChannelAsync("tazweed-silent-v1", {
          name: "تنبيهات صامتة",
          importance: N.AndroidImportance.DEFAULT,
          sound: null,
        });
      }
      let p = await N.getPermissionsAsync();
      if (request && !p.granted) p = await N.requestPermissionsAsync();
      if (account.current !== owner) return;
      setPermission(p.granted ? "granted" : "denied");
      if (!p.granted) {
        await api("/devices/push-tokens", {}, "DELETE", undefined, owner);
        return;
      }
      const t = await N.getExpoPushTokenAsync({
        projectId: Constants.expoConfig!.extra!.eas.projectId,
      });
      if (account.current !== owner) return;
      await api(
        "/devices/push-tokens",
        {
          token: t.data,
          platform: Platform.OS,
          projectId: Constants.expoConfig!.extra!.eas.projectId,
          soundEnabled: preferredSound,
        },
        "POST",
        undefined,
        owner,
      );
      if (account.current === owner)
        setNotice("حُفظ إعداد الإشعارات لهذا الحساب والجهاز.");
    } catch (e) {
      if (account.current === owner) setNotice((e as Error).message);
    } finally {
      busy.current = false;
    }
  }
  useEffect(() => {
    if (!nativeReady || !user) return;
    let cancelled = false;
    const subscriptions: { remove: () => void }[] = [];
    const owner = user.id;
    const open = async (data: any) => {
      if (
        cancelled ||
        account.current !== owner ||
        data?.app !== app ||
        !safeId(data?.notificationId) ||
        seen.current.has("tap:" + data.notificationId)
      )
        return;
      seen.current.add("tap:" + data.notificationId);
      try {
        const n = await api(
          "/notifications/" + data.notificationId,
          undefined,
          "GET",
          undefined,
          owner,
        );
        if (cancelled || account.current !== owner) return;
        await api(
          "/notifications/" + n.id + "/read",
          {},
          "PATCH",
          undefined,
          owner,
        );
        if (cancelled || account.current !== owner) return;
        if (safeId(n.data?.orderId))
          router.push(
            ((app === "courier" ? "/task?id=" : "/order?id=") +
              n.data.orderId) as any,
          );
        else router.push("/notifications");
      } catch {
        if (!cancelled && account.current === owner)
          router.push("/notifications");
      }
    };
    void (async () => {
      const N = await import("expo-notifications");
      if (cancelled) return;
      N.setNotificationHandler({
        handleNotification: async (n) => {
          const data = n.request.content.data;
          const id = data?.notificationId;
          const allowed =
            !cancelled &&
            account.current === owner &&
            data?.app === app &&
            data?.userId === owner &&
            safeId(id) &&
            !seen.current.has(id);
          let authorized = allowed;
          if (allowed) {
            authorized = await Promise.race([
              api("/notifications/" + id, undefined, "GET", undefined, owner)
                .then(() => account.current === owner && !cancelled)
                .catch(() => false),
              new Promise<boolean>((resolve) =>
                setTimeout(() => resolve(false), 1500),
              ),
            ]);
          }
          if (authorized && safeId(id)) seen.current.add(id);
          return {
            shouldShowBanner: authorized,
            shouldShowList: authorized,
            shouldPlaySound: authorized && sound && !!n.request.content.sound,
            shouldSetBadge: false,
          };
        },
      });
      subscriptions.push(
        N.addNotificationResponseReceivedListener(
          (r) => void open(r.notification.request.content.data),
        ),
      );
      subscriptions.push(N.addPushTokenListener(() => void activate()));
      const last = await N.getLastNotificationResponseAsync();
      if (last) await open(last.notification.request.content.data);
      await activate();
    })().catch(() => {
      if (!cancelled) setNotice("تعذر تهيئة إشعارات الجهاز.");
    });
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void activate();
    });
    return () => {
      cancelled = true;
      subscriptions.forEach((s) => s.remove());
      sub.remove();
      void import("expo-notifications").then((N) =>
        N.setNotificationHandler(null),
      );
    };
  }, [user?.id, sound]);
  async function toggleSound() {
    if (!user) return;
    const owner = user.id,
      v = !sound;
    setSound(v);
    await AsyncStorage.setItem("tazweed.sound." + app + "." + owner, String(v));
    if (account.current === owner) await activate(false, v);
  }
  const exempt = ["/privacy", "/terms", "/support", "/delete"];
  const current = [
    "/orders",
    "/order",
    "/quote",
    "/payment",
    "/auth",
    "/otp",
    "/account",
    "/notifications",
    "/complaint",
    "/review",
    "/addresses",
    "/address",
  ];
  const required = !!config?.release?.required && !exempt.includes(path);
  const maintained =
    app === "customer" &&
    config?.maintenance?.enabled &&
    ![...exempt, ...current].includes(path);
  const overlay = required || maintained;
  return (
    <Context.Provider
      value={{
        config,
        refresh,
        error,
        permission,
        sound,
        toggleSound,
        notice,
        nativeReady,
        activate,
      }}
    >
      <View style={{ flex: 1 }}>
        <View
          style={{ flex: 1 }}
          accessibilityElementsHidden={overlay}
          importantForAccessibility={overlay ? "no-hide-descendants" : "auto"}
          pointerEvents={overlay ? "none" : "auto"}
        >
          {children}
        </View>
        {!!error && !overlay && (
          <View style={{ backgroundColor: colors.surface, padding: 8 }}>
            <Txt>{error}</Txt>
            <Action
              secondary
              title="تحديث حالة التشغيل"
              onPress={() => void refresh()}
            />
          </View>
        )}
        {config?.release?.optional && !dismissed && !overlay && (
          <View style={{ backgroundColor: colors.surface, padding: 12 }}>
            <Txt>يتوفر إصدار {config.release.latestVersion}</Txt>
            <Action
              title="فتح المتجر"
              onPress={() =>
                void Linking.openURL(config.release.storeUrl).catch(() =>
                  setError("تعذر فتح المتجر"),
                )
              }
            />
            <Action
              secondary
              title="لاحقًا"
              onPress={() => setDismissed(true)}
            />
          </View>
        )}
        {overlay && (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.background, zIndex: 1000 },
            ]}
            accessibilityViewIsModal
          >
            <Page>
              <Card>
                <Txt weight="bold">
                  {required ? "يلزم تحديث التطبيق" : "تزويد يعود إليك قريبًا"}
                </Txt>
                <Txt>
                  {required
                    ? config.release.message
                    : config.maintenance.message}
                </Txt>
                {required && (
                  <Action
                    title="تحديث من المتجر"
                    onPress={() =>
                      void Linking.openURL(config.release.storeUrl).catch(() =>
                        setError("تعذر فتح المتجر"),
                      )
                    }
                  />
                )}
                <Action
                  secondary
                  title="إعادة التحقق"
                  onPress={() => void refresh()}
                />
                {!required && (
                  <Action
                    title="متابعة طلباتي"
                    onPress={() => router.push("/orders")}
                  />
                )}
                <Action
                  secondary
                  title="الدعم"
                  onPress={() => router.push("/support")}
                />
                {app === "customer" && (
                  <>
                    <Action
                      secondary
                      title="الخصوصية"
                      onPress={() => router.push("/privacy")}
                    />
                    <Action
                      secondary
                      title="طلب حذف الحساب"
                      onPress={() => router.push("/delete")}
                    />
                  </>
                )}
                {!!error && <Txt>{error}</Txt>}
              </Card>
            </Page>
          </View>
        )}
      </View>
    </Context.Provider>
  );
}
export const useEngagement = () => useContext(Context);
export function NotificationsScreen() {
  const { user } = useAuth();
  return <Inbox key={user?.id ?? "out"} />;
}
function Inbox() {
  const { user } = useAuth(),
    e = useEngagement(),
    router = useRouter();
  const [rows, setRows] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const alive = useRef(true);
  async function load(cursor?: string) {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const r = await api(
        "/notifications?limit=30" + (cursor ? "&cursor=" + cursor : ""),
        undefined,
        "GET",
        undefined,
        user.id,
      );
      if (alive.current) {
        setRows((old) => (cursor ? [...old, ...r.items] : r.items));
        setNext(r.nextCursor);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      void load();
      return () => {
        alive.current = false;
      };
    }, [user?.id]),
  );
  async function open(n: any) {
    setBusy(true);
    try {
      await api(
        "/notifications/" + n.id + "/read",
        {},
        "PATCH",
        undefined,
        user.id,
      );
      if (!alive.current) return;
      setRows((r) =>
        r.map((x) =>
          x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x,
        ),
      );
      if (safeId(n.data?.orderId))
        router.push(
          ((app === "courier" ? "/task?id=" : "/order?id=") +
            n.data.orderId) as any,
        );
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Page>
      <View style={{ gap: 12 }}>
        <Txt weight="bold">مركز الإشعارات</Txt>
        <Action secondary title="العودة" onPress={() => router.back()} />
        <Action secondary title="الرئيسية" onPress={() => router.push("/")} />
        <Action
          secondary
          title="فحص حالة التشغيل"
          onPress={() => void e.refresh()}
        />
        {!user ? (
          <LoginPanel />
        ) : (
          <>
            <Card>
              <Txt>تبقى رسائلك هنا حتى عند رفض إذن الإشعارات.</Txt>
              <Txt>
                {e.nativeReady
                  ? e.permission === "granted"
                    ? "إشعارات الجهاز مفعّلة"
                    : "إشعارات الجهاز غير مفعّلة"
                  : "إشعارات الجهاز تحتاج نسخة أصلية مهيأة؛ المركز متاح هنا."}
              </Txt>
              {e.nativeReady && (
                <Action
                  title="تفعيل إشعارات الجهاز"
                  onPress={() => void e.activate(true)}
                />
              )}
              <Action
                secondary
                title={e.sound ? "كتم صوت التنبيهات" : "تشغيل صوت التنبيهات"}
                onPress={() =>
                  void e.toggleSound().catch((x: Error) => setError(x.message))
                }
              />
              {!!e.notice && <Txt>{e.notice}</Txt>}
            </Card>
            <Action
              title="تحديث الإشعارات"
              disabled={busy}
              onPress={() => void load()}
            />
            {!busy && !rows.length && <Txt>لا إشعارات حاليًا.</Txt>}
            {rows.map((n) => (
              <Card key={n.id}>
                <Txt weight="bold">
                  {n.readAt ? "○" : "●"} {n.title}
                </Txt>
                <Txt>{n.body}</Txt>
                <Txt>
                  {"\u2066" +
                    n.createdAt.replace("T", " ").slice(0, 16) +
                    " UTC\u2069"}
                </Txt>
                <Action
                  secondary
                  title={n.data?.orderId ? "فتح الطلب" : "تحديد كمقروء"}
                  disabled={busy}
                  onPress={() => void open(n)}
                />
              </Card>
            ))}
            {next && (
              <Action
                secondary
                title="المزيد"
                disabled={busy}
                onPress={() => void load(next)}
              />
            )}
          </>
        )}
        {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
      </View>
    </Page>
  );
}
