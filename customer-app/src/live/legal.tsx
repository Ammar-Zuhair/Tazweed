import { eraseStoredOperations } from "./operations";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter, useFocusEffect } from "expo-router";
import { Linking, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { Page, Card, Txt, Action, Header } from "../ui/components";
import {
  api,
  apiBase,
  useAuth,
  clientApp,
  Input,
  LoginPanel,
} from "./connection";
export function Legal() {
  const path = usePathname(),
    r = useRouter(),
    [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api("/public/legal")
        .then((x) => {
          if (alive) setData(x);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
      return () => {
        alive = false;
      };
    }, []),
  );
  const title =
    path === "/privacy"
      ? "الخصوصية"
      : path === "/terms"
        ? "شروط الاستخدام"
        : "الدعم";
  return (
    <Page>
      <Header title={title} subtitle="تزويد · المعلومات من الخادم" />
      {error ? (
        <Card>
          <Txt accessibilityRole="alert">{error}</Txt>
          <Action
            title="إعادة المحاولة"
            onPress={() =>
              api("/public/legal")
                .then(setData)
                .catch((e) => setError(e.message))
            }
          />
        </Card>
      ) : !data ? (
        <Txt>جارٍ تحميل المعلومات…</Txt>
      ) : (
        <>
          {!data.policy.approved && (
            <Card>
              <Txt>
                السياسة وبيانات المالك بانتظار الإعداد والاعتماد؛ لا موعد احتفاظ
                مفترض.
              </Txt>
            </Card>
          )}
          {path === "/support" ? (
            <Card>
              <Txt>الجهة: {data.policy.legalName || "لم تهيأ بعد"}</Txt>
              <Txt>الدعم: {data.policy.supportPhone || "لم يهيأ بعد"}</Txt>
              <Txt>الخصوصية: {data.policy.email || "لم يهيأ بعد"}</Txt>
              {!!data.policy.supportPhone && (
                <Action
                  title="الاتصال بالدعم"
                  onPress={() =>
                    Linking.openURL("tel:" + data.policy.supportPhone).catch(
                      (e) => setError(e.message),
                    )
                  }
                />
              )}
              {!!data.policy.email && (
                <Action
                  title="مراسلة مسؤول الخصوصية"
                  onPress={() =>
                    Linking.openURL("mailto:" + data.policy.email).catch((e) =>
                      setError(e.message),
                    )
                  }
                />
              )}
            </Card>
          ) : (
            (path === "/terms" ? data.terms : data.privacy).map((s: any) => (
              <Card key={s.title}>
                <Txt weight="bold">{s.title}</Txt>
                <Txt>{s.body}</Txt>
              </Card>
            ))
          )}
          <Action
            secondary
            title="حذف الحساب"
            onPress={() => r.push("/delete" as any)}
          />
        </>
      )}
      <Action secondary title="العودة" onPress={() => r.back()} />
    </Page>
  );
}
const receiptKey = "tazweed.deletion.receipt.v1";
async function readReceipt() {
  const raw =
    Platform.OS === "web"
      ? sessionStorage.getItem(receiptKey)
      : await SecureStore.getItemAsync(receiptKey);
  return raw ? JSON.parse(raw) : null;
}
async function saveReceipt(v: any) {
  if (Platform.OS === "web") {
    if (v) sessionStorage.setItem(receiptKey, JSON.stringify(v));
    else sessionStorage.removeItem(receiptKey);
  } else if (v) await SecureStore.setItemAsync(receiptKey, JSON.stringify(v));
  else await SecureStore.deleteItemAsync(receiptKey);
}
const statusText: Record<string, string> = {
  unverified: "لم يؤكد بعد",
  requested: "استلم",
  verified: "موثق",
  processing: "جارٍ الحذف",
  completed: "مكتمل",
  needs_review: "تحتاج مراجعة",
};
export function DeleteAccount() {
  const [showToken, setShowToken] = useState(false);
  const auth = useAuth(),
    router = useRouter(),
    [challenge, setChallenge] = useState<any>(null),
    [receipt, setReceipt] = useState<any>(null),
    [code, setCode] = useState(""),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [wait, setWait] = useState(0);
  const lock = useRef(false),
    alive = useRef(true),
    account = useRef(auth.user?.id);
  useEffect(() => {
    alive.current = true;
    void readReceipt()
      .then((x) => {
        if (alive.current) setReceipt(x);
      })
      .catch((e) => setError(e.message));
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (account.current !== auth.user?.id) {
      setChallenge(null);
      setCode("");
      setConfirm(false);
      account.current = auth.user?.id;
    }
  }, [auth.user?.id]);
  useEffect(() => {
    if (!wait) return;
    const t = setInterval(() => setWait((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [!!wait]);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function start() {
    await run(async () => {
      const v = await api(
        "/me/deletion-requests/start",
        {
          app: clientApp,
          phone: auth.user.phone,
          deviceId: auth.deviceId,
          confirm: true,
        },
        "POST",
        undefined,
        auth.user.id,
      );
      const early = {
        id: v.requestId,
        ownerId: auth.user.id,
        receiptToken: v.receiptToken,
        notice: "لم يؤكد الحذف بعد؛ أدخل رمز التحقق.",
        status: "unverified",
      };
      await saveReceipt(early);
      setReceipt(early);
      setChallenge(v);
      setWait(60);
    });
  }
  async function verify() {
    await run(async () => {
      const v = await api("/account-deletion/verify", {
        app: clientApp,
        deviceId: auth.deviceId,
        challengeId: challenge.challengeId,
        preauthToken: challenge.preauthToken,
        code,
        confirm: true,
      });
      const next = { ...v, ownerId: receipt?.ownerId ?? auth.user?.id };
      await saveReceipt(next);
      setReceipt(next);
      setChallenge(null);
      setCode("");
      await auth.forget();
      if (next.ownerId) {
        await eraseStoredOperations(next.ownerId);
        await AsyncStorage.removeItem(
          "tazweed.sound." + clientApp + "." + next.ownerId,
        );
      }
    });
  }
  async function refresh() {
    await run(async () => {
      const v = await api("/account-deletion/status", {
        requestId: receipt.id,
        receiptToken: receipt.receiptToken,
      });
      const next = {
        ...v,
        receiptToken: receipt.receiptToken,
        ownerId: receipt.ownerId,
      };
      await saveReceipt(next);
      setReceipt(next);
      if (next.verifiedAt && next.ownerId) {
        if (auth.user?.id === next.ownerId) await auth.forget();
        await eraseStoredOperations(next.ownerId);
        await AsyncStorage.removeItem(
          "tazweed.sound." + clientApp + "." + next.ownerId,
        );
      }
    });
  }
  return (
    <Page>
      <Header title="حذف الحساب" subtitle="تحقق حديث ومتابعة من الخادم" />
      <Card>
        <Txt>
          يحذف الحساب وبياناته وفق السياسة. يبطل التحقق جلساتك ورموز الإشعارات
          ويوقف الطلبات الجديدة. لا تمنع الطلبات أو الالتزامات الجارية استلام
          الطلب؛ تحتاج تسويتها قبل إزالة بيانات التنفيذ.
        </Txt>
        <Action
          secondary
          title="قراءة سياسة الخصوصية"
          onPress={() => router.push("/privacy" as any)}
        />
        <Action
          secondary
          title="صفحة الحذف من المتصفح"
          onPress={() =>
            Linking.openURL(
              apiBase().replace(/\/api\/v1$/, "") + "/delete-account",
            ).catch((e) => setError(e.message))
          }
        />
      </Card>
      {receipt && (
        <Card>
          <Txt weight="bold">متابعة حذف الحساب</Txt>
          <Txt selectable>رقم المتابعة: {receipt.id}</Txt>
          <Txt>{receipt.notice}</Txt>
          <Txt>الحالة: {statusText[receipt.status] ?? receipt.status}</Txt>
          {receipt.retainedUntil && (
            <Txt>انتهاء مدة البيانات المحتفظة: {receipt.retainedUntil}</Txt>
          )}
          <Txt>
            يحفظ مفتاح المتابعة سرًا على هذا الجهاز. احتفظ به عند الحاجة
            للمتابعة من المتصفح.
          </Txt>
          <Action
            secondary
            title={
              showToken ? "إخفاء مفتاح المتابعة" : "إظهار مفتاح المتابعة السري"
            }
            onPress={() => setShowToken(!showToken)}
          />
          {showToken && <Txt selectable>{receipt.receiptToken}</Txt>}
          <Action
            title="تحديث حالة الحذف"
            disabled={busy}
            onPress={() => void refresh()}
          />
          <Action
            secondary
            title="مسح مفتاح المتابعة من الجهاز"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await saveReceipt(null);
                setReceipt(null);
              })
            }
          />
        </Card>
      )}
      {!auth.user ? (
        !receipt && <LoginPanel />
      ) : challenge ? (
        <Card>
          <Txt>أرسل رمز حذف مخصص إلى رقم حسابك.</Txt>
          <Input
            label="رمز تأكيد حذف الحساب"
            numeric
            value={code}
            onChange={setCode}
          />
          <Action
            title="تأكيد حذف الحساب نهائيًا"
            disabled={busy || !/^\d{6}$/.test(code)}
            onPress={() => void verify()}
          />
          <Action
            secondary
            title={`طلب رمز حذف جديد${wait ? " (" + wait + ")" : ""}`}
            disabled={busy || wait > 0}
            onPress={() => void start()}
          />
        </Card>
      ) : (
        <Card>
          <Txt>الحساب: {auth.user.name}</Txt>
          <Action
            secondary
            title={
              confirm
                ? "✓ أوافق على طلب حذف الحساب"
                : "أوافق على طلب حذف الحساب"
            }
            disabled={busy}
            onPress={() => setConfirm(!confirm)}
          />
          <Action
            title="إرسال رمز حذف الحساب"
            disabled={busy || !confirm}
            onPress={() => void start()}
          />
        </Card>
      )}
      {!!error && (
        <Card>
          <Txt accessibilityRole="alert">{error}</Txt>
        </Card>
      )}
      <Action secondary title="العودة" onPress={() => router.back()} />
    </Page>
  );
}
