import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { Page, Header, Card, Txt, Action } from "../ui/components";
import { api, useAuth, LoginPanel } from "./connection";
const statuses: Record<string, string> = {
  requested: "استلم",
  verified: "موثق",
  processing: "جارٍ الحذف",
  completed: "مكتمل",
  needs_review: "تحتاج مراجعة",
};
export default function PrivacyRequests() {
  const { user } = useAuth();
  return <Requests key={user?.id ?? "out"} />;
}
function Requests() {
  const { user } = useAuth(),
    router = useRouter(),
    [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    alive = useRef(true);
  async function load() {
    const r = await api(
      "/admin/deletion-requests",
      undefined,
      "GET",
      undefined,
      user.id,
    );
    if (alive.current) setRows(r.items);
  }
  useEffect(() => {
    alive.current = true;
    if (user) void load().catch((e) => setError(e.message));
    return () => {
      alive.current = false;
    };
  }, [user?.id]);
  async function process(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/admin/deletion-requests/" + id + "/process",
        {},
        "POST",
        undefined,
        user.id,
      );
      await load();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Page>
      <Header
        title="طلبات حذف الحساب"
        subtitle="صلاحية خصوصية عامة · لا حذف لدفاتر المال"
      />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <Card>
            <Txt>
              يستقبل الخادم الطلب ويبطِل الجلسات بعد التحقق. تراجع الالتزامات
              قبل التعمية؛ زر المعالجة لا يتجاوز السياسة أو الرصيد أو الطلب
              الجاري.
            </Txt>
            <Action
              secondary
              title="تحديث طلبات الحذف"
              disabled={busy}
              onPress={() => void load().catch((e) => setError(e.message))}
            />
          </Card>
          {rows.map((r) => (
            <Card key={r.id}>
              <Txt selectable>طلب {r.id}</Txt>
              <Txt>الحالة: {statuses[r.status] ?? r.status}</Txt>
              <Txt>{r.notice}</Txt>
              {r.retainedUntil && <Txt>انتهاء المدة: {r.retainedUntil}</Txt>}
              {r.status !== "completed" && (
                <Action
                  title="فحص الالتزامات ومعالجة الطلب"
                  disabled={busy}
                  onPress={() => void process(r.id)}
                />
              )}
            </Card>
          ))}
          {!rows.length && !error && <Txt>لا طلبات حذف ظاهرة.</Txt>}
        </>
      )}
      {!!error && (
        <Card>
          <Txt accessibilityRole="alert">{error}</Txt>
        </Card>
      )}
      <Action
        secondary
        title="العودة للإدارة"
        onPress={() => router.replace("/")}
      />
    </Page>
  );
}
