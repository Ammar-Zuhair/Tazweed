import { jsonRequest } from "./transport";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform, TextInput, View } from "react-native";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import { Txt, Action, Card } from "../ui/components";
import { useTheme } from "../ui/theme-provider";
export const clientApp: "customer" | "admin" = "customer";
// Public routing metadata only. No provider, signing, DB or storage credentials belong here.
export function apiBase() {
  if (Platform.OS === "web") return window.location.origin + "/api/v1";
  const host = Constants.expoConfig?.hostUri ?? "";
  if (!host) throw Error("رابط الخادم غير متاح");
  return (
    (host.endsWith(".exp.direct") ? "https://" : "http://") + host + "/api/v1"
  );
}
let tokens: any = null,
  device = Crypto.randomUUID();
let refreshing: Promise<any> | null = null;
let sessionCleared = () => {};
async function save(value: any) {
  tokens = value;
  if (Platform.OS !== "web") {
    if (value)
      await SecureStore.setItemAsync(
        "tazweed.session.v1",
        JSON.stringify(value),
      );
    else await SecureStore.deleteItemAsync("tazweed.session.v1");
  }
}
async function send(path: string, body: unknown, method: string, key?: string) {
  return jsonRequest(apiBase() + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(tokens
        ? {
            Authorization: "Bearer " + tokens.accessToken,
            "X-Client-App": clientApp,
          }
        : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
async function rotate() {
  if (!refreshing) {
    const refreshToken = tokens?.refreshToken;
    refreshing = (async () => {
      try {
        const { r, data } = await send(
          "/auth/refresh",
          { app: clientApp, deviceId: device, refreshToken },
          "POST",
        );
        if (!r.ok) throw Error("انتهت الجلسة؛ سجل الدخول");
        await save(data);
        return data;
      } catch (e) {
        await save(null);
        sessionCleared();
        throw e;
      }
    })().finally(() => (refreshing = null));
  }
  return refreshing;
}
export async function api(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  key?: string,
): Promise<any> {
  let result = await send(path, body, method, key);
  if (result.r.status === 401 && tokens && !path.startsWith("/auth/")) {
    await rotate();
    result = await send(path, body, method, key);
  }
  if (!result.r.ok)
    throw Error(result.data?.error?.message ?? "تعذر الاتصال بالخادم");
  return result.data;
}
const Context = createContext<any>(null);
export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<any>(null),
    [ready, setReady] = useState(false);
  async function restore() {
    if (Platform.OS !== "web") {
      const d = await SecureStore.getItemAsync("tazweed.device.v1");
      if (d) device = d;
      else await SecureStore.setItemAsync("tazweed.device.v1", device);
      const raw = await SecureStore.getItemAsync("tazweed.session.v1");
      if (raw) tokens = JSON.parse(raw);
    }
    if (tokens) {
      try {
        await rotate();
        setUser(await api("/me"));
      } catch {
        await save(null);
        setUser(null);
      }
    }
    setReady(true);
  }
  useEffect(() => {
    sessionCleared = () => setUser(null);
    void restore().catch(async () => {
      await save(null);
      setUser(null);
      setReady(true);
    });
    return () => {
      sessionCleared = () => {};
    };
  }, []);
  const value = {
    user,
    ready,
    deviceId: device,
    accept: async (v: any) => {
      await save(v);
      setUser(await api("/me"));
    },
    logout: async () => {
      try {
        await api("/auth/logout", {});
      } finally {
        await save(null);
        setUser(null);
      }
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useAuth = () => useContext(Context);
export function Input({
  label,
  value,
  onChange,
  secure = false,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  numeric?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Txt>{label}</Txt>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        keyboardType={numeric ? "numeric" : "default"}
        style={{
          fontFamily: "Tajawal-Medium",
          fontSize: 17,
          lineHeight: 26,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.border,
          color: colors.text,
          backgroundColor: colors.surface,
          borderRadius: 14,
          textAlign: "right",
          minHeight: 52,
        }}
      />
    </View>
  );
}
export function LoginPanel() {
  const auth = useAuth();
  const [phone, setPhone] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [mode, setMode] = useState<"login" | "register" | "password-reset">(
      "login",
    ),
    [challenge, setChallenge] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  async function act(action: string) {
    setBusy(true);
    setError("");
    try {
      if (action === "resend") {
        await api("/auth/otp/resend", {
          app: clientApp,
          deviceId: auth.deviceId,
          challengeId: challenge.challengeId,
          preauthToken: challenge.preauthToken,
        });
        setCooldown(60);
        return;
      }
      if (!challenge) {
        const v = await api("/auth/" + mode + "/start", {
          app: clientApp,
          deviceId: auth.deviceId,
          phone,
          ...(mode !== "password-reset" ? { password } : {}),
          ...(mode === "register" ? { name } : {}),
        });
        setChallenge(v);
        setCooldown(v.resendAfter);
      } else {
        const result = await api("/auth/" + mode + "/verify", {
          app: clientApp,
          deviceId: auth.deviceId,
          challengeId: challenge.challengeId,
          preauthToken: challenge.preauthToken,
          code,
          ...(mode === "password-reset" ? { newPassword: password } : {}),
        });
        if (mode === "password-reset") {
          setChallenge(null);
          setMode("login");
          setError("تم تغيير كلمة المرور؛ سجل الدخول");
        } else {
          await auth.accept(result);
          setPassword("");
          setCode("");
          setChallenge(null);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!auth.ready) return <Txt>جارٍ تهيئة الجلسة…</Txt>;
  if (auth.user)
    return (
      <Card>
        <Txt>أهلًا {auth.user.name}</Txt>
        <Action
          title="تسجيل الخروج"
          onPress={() => auth.logout().catch((e: Error) => setError(e.message))}
        />
        {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
      </Card>
    );
  return (
    <Card>
      <Txt weight="bold">
        {clientApp === "admin" ? "دخول الإدارة" : "حساب العميل"}
      </Txt>
      {clientApp === "customer" && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(["login", "register", "password-reset"] as const).map((m, n) => (
            <Action
              key={m}
              secondary
              title={["دخول", "تسجيل جديد", "نسيت كلمة المرور"][n]!}
              onPress={() => {
                setMode(m);
                setChallenge(null);
                setError("");
              }}
            />
          ))}
        </View>
      )}
      {!challenge ? (
        <>
          {mode === "register" && (
            <Input label="الاسم" value={name} onChange={setName} />
          )}
          <Input label="رقم الجوال" value={phone} onChange={setPhone} numeric />
          {mode !== "password-reset" && (
            <Input
              label="كلمة المرور"
              value={password}
              onChange={setPassword}
              secure
            />
          )}
        </>
      ) : (
        <>
          <Input label="رمز التحقق" value={code} onChange={setCode} numeric />
          {mode === "password-reset" && (
            <Input
              label="كلمة المرور الجديدة"
              value={password}
              onChange={setPassword}
              secure
            />
          )}
          <Action
            secondary
            title={`إعادة الإرسال${cooldown ? " (" + cooldown + ")" : ""}`}
            disabled={busy || cooldown > 0}
            onPress={() => act("resend")}
          />
        </>
      )}
      <Action
        title={challenge ? "تحقق ومتابعة" : "متابعة"}
        disabled={busy}
        onPress={() => act("continue")}
      />
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
      <Txt style={{ fontSize: 12 }}>
        يتحقق الخادم من الحساب والصلاحيات. لا يمكن الدخول عند غياب خدمة التحقق.
      </Txt>
    </Card>
  );
}
