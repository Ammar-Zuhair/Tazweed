import { useState, useCallback, useRef, useEffect } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { View } from "react-native";
import { Page, Card, Txt, Action } from "../ui/components";
import { api, useAuth, Input, LoginPanel } from "./connection";
import { useOperation } from "./operations";
function Nav() {
  const r = useRouter();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {[
        ["/operations", "الصيانة والإصدارات"],
        ["/campaigns", "البث والجدولة"],
        ["/notifications", "إشعاراتي"],
        ["/", "الإدارة"],
      ].map(([path, title]) => (
        <Action
          key={path}
          secondary
          title={title!}
          onPress={() => r.push(path as any)}
        />
      ))}
    </View>
  );
}
export function Operations() {
  const { user } = useAuth();
  return <OperationsView key={user?.id ?? "out"} />;
}
function OperationsView() {
  const { user } = useAuth();
  const [m, setM] = useState<any>(null),
    [releases, setReleases] = useState<any[]>([]),
    [releaseAllowed, setReleaseAllowed] = useState(false),
    [environment, setEnv] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [enabled, setEnabled] = useState(false),
    [message, setMessage] = useState(""),
    [app, setApp] = useState("customer"),
    [platform, setPlatform] = useState("android"),
    [min, setMin] = useState(""),
    [latest, setLatest] = useState(""),
    [version, setVersion] = useState(""),
    [url, setUrl] = useState(""),
    [releaseMessage, setReleaseMessage] = useState(""),
    [binary, setBinary] = useState(false),
    [confirm, setConfirm] = useState<any>(null);
  const writing = useRef(false),
    alive = useRef(true);
  async function load() {
    if (!user) return;
    setBusy(true);
    setConfirm(null);
    setError("");
    try {
      const results = await Promise.allSettled([
        api(
          "/admin/customer-maintenance",
          undefined,
          "GET",
          undefined,
          user.id,
        ),
        api("/admin/app-releases", undefined, "GET", undefined, user.id),
      ]);
      if (!alive.current) return;
      if (results[0].status === "fulfilled") {
        const v = results[0].value;
        setM(v);
        setEnabled(v.enabled);
        setMessage(v.message_ar);
      } else {
        setM(null);
        if (results[0].reason.status !== 403) throw results[0].reason;
      }
      if (results[1].status === "fulfilled") {
        setReleaseAllowed(true);
        setReleases(results[1].value.items);
        setEnv(results[1].value.environment);
      } else {
        setReleaseAllowed(false);
        if (results[1].reason.status !== 403) throw results[1].reason;
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
  const old = releases.find((x) => x.app === app && x.platform === platform);
  function editRelease() {
    setMin(String(old?.minimum_build ?? ""));
    setLatest(String(old?.latest_build ?? ""));
    setVersion(old?.latest_version ?? "");
    setUrl(old?.store_url ?? "");
    setReleaseMessage(old?.message_ar ?? "");
    setBinary(false);
    setConfirm(null);
  }
  useEffect(() => {
    editRelease();
  }, [app, platform, releases]);
  async function save() {
    if (writing.current || !confirm || !user) return;
    writing.current = true;
    setBusy(true);
    try {
      await api(confirm.path, confirm.body, "PUT", undefined, user.id);
      if (alive.current) {
        setConfirm(null);
        await load();
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Page>
      <Txt weight="bold">الصيانة والإصدارات</Txt>
      <Nav />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <Action
            title="تحديث إعدادات التشغيل"
            disabled={busy}
            onPress={() => void load()}
          />
          {m && (
            <Card>
              <Txt weight="bold">صيانة العميل فقط</Txt>
              <Txt>
                تبقى الطلبات الجارية والدعم والخصوصية والحذف، وتستمر الإدارة
                والموصل.
              </Txt>
              <Action
                secondary
                disabled={busy}
                title={
                  enabled
                    ? "الصيانة مفعّلة؛ اضغط لإيقافها"
                    : "الصيانة متوقفة؛ اضغط لتفعيلها"
                }
                onPress={() => {
                  setEnabled(!enabled);
                  setConfirm(null);
                }}
              />
              <Input
                label="رسالة الصيانة"
                value={message}
                onChange={(v) => {
                  setMessage(v);
                  setConfirm(null);
                }}
              />
              <Action
                title="مراجعة الصيانة"
                disabled={busy}
                onPress={() =>
                  setConfirm({
                    path: "/admin/customer-maintenance",
                    label: enabled
                      ? "تفعيل صيانة العميل"
                      : "إيقاف صيانة العميل",
                    body: { enabled, message, expectedVersion: m.version },
                  })
                }
              />
            </Card>
          )}
          {releaseAllowed && (
            <Card>
              <Txt weight="bold">حدود إصدارات المتجر · {environment}</Txt>
              <Txt>
                لا ينشر هذا النموذج تطبيقًا أو OTA. أكد توفر النسخة ورابطها قبل
                رفع الحد الأدنى.
              </Txt>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {[
                  ["customer", "العميل"],
                  ["admin", "الإدارة"],
                  ["courier", "الموصل"],
                ].map(([a, label]) => (
                  <Action
                    key={a}
                    secondary={a !== app}
                    title={label!}
                    disabled={busy}
                    onPress={() => {
                      setApp(a!);
                      setConfirm(null);
                      setBinary(false);
                    }}
                  />
                ))}
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {["android", "ios"].map((p) => (
                  <Action
                    key={p}
                    secondary={p !== platform}
                    title={p}
                    disabled={busy}
                    onPress={() => {
                      setPlatform(p);
                      setConfirm(null);
                      setBinary(false);
                    }}
                  />
                ))}
              </View>
              <Action
                secondary
                title="قراءة النسخة المحددة للنموذج"
                disabled={busy}
                onPress={editRelease}
              />
              <Txt>
                {old
                  ? `الحد الحالي ${old.minimum_build} / الأحدث ${old.latest_build}`
                  : "لم تضبط حدود لهذا التطبيق والمنصة بعد."}
              </Txt>
              {[
                [min, setMin, "الحد الأدنى للبناء"],
                [latest, setLatest, "أحدث رقم بناء"],
                [version, setVersion, "اسم الإصدار"],
                [url, setUrl, "رابط المتجر"],
                [releaseMessage, setReleaseMessage, "رسالة التحديث"],
              ].map(([value, setter, label]) => (
                <Input
                  key={label as string}
                  label={label as string}
                  value={value as string}
                  onChange={(v) => {
                    (setter as any)(v);
                    setConfirm(null);
                  }}
                />
              ))}
              <Action
                secondary
                title={
                  binary
                    ? "✓ تحققت من توفر النسخة ورابطها"
                    : "تأكيد التحقق من توفر النسخة ورابط المتجر"
                }
                disabled={busy}
                onPress={() => {
                  setBinary(!binary);
                  setConfirm(null);
                }}
              />
              <Action
                title="مراجعة حدود الإصدار"
                disabled={busy || !binary}
                onPress={() =>
                  setConfirm({
                    path: "/admin/app-releases",
                    label: `${app} / ${platform} / ${environment} · الحد ${min} والأحدث ${latest}`,
                    body: {
                      app,
                      platform,
                      minimumBuild: Number(min),
                      latestBuild: Number(latest),
                      latestVersion: version,
                      storeUrl: url,
                      message: releaseMessage,
                      binaryConfirmed: binary,
                      expectedVersion: old?.version ?? 0,
                    },
                  })
                }
              />
            </Card>
          )}
          {confirm && (
            <Card>
              <Txt weight="bold">تأكيد: {confirm.label}</Txt>
              <Txt>{confirm.body.message}</Txt>
              <Action
                title="حفظ إعداد التشغيل"
                disabled={busy}
                onPress={() => void save()}
              />
              <Action
                secondary
                title="تراجع"
                disabled={busy}
                onPress={() => setConfirm(null)}
              />
            </Card>
          )}
          {!m && !releaseAllowed && !busy && (
            <Txt>لا تملك صلاحية عامة لإعدادات التشغيل.</Txt>
          )}
        </>
      )}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
    </Page>
  );
}
const labels: Record<string, string> = {
  draft: "مسودة",
  scheduled: "مجدولة",
  sending: "يُنشأ مركز الرسائل",
  sent: "اكتمل إنشاء الرسائل؛ ليس إثبات وصول Push",
  cancelled: "ملغاة",
  failed: "تعذرت",
};
export function Campaigns() {
  const { user } = useAuth();
  return <CampaignsView key={user?.id ?? "out"} />;
}
function CampaignsView() {
  const { user } = useAuth(),
    op = useOperation(user?.id);
  const [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [kind, setKind] = useState("customers"),
    [branch, setBranch] = useState<string | null>(null),
    [branches, setBranches] = useState<any[]>([]),
    [rows, setRows] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [when, setWhen] = useState(""),
    [confirm, setConfirm] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const alive = useRef(true),
    writing = useRef(false);
  async function load(cursor?: string) {
    if (!user) return;
    setBusy(true);
    setConfirm(null);
    try {
      const r = await api(
        "/admin/campaigns?limit=30" + (cursor ? "&cursor=" + cursor : ""),
        undefined,
        "GET",
        undefined,
        user.id,
      );
      if (alive.current) {
        setRows((old) => (cursor ? [...old, ...r.items] : r.items));
        setNext(r.nextCursor);
        setError("");
      }
      const bs = await api(
        "/admin/access/branches?permission=notifications.broadcast",
        undefined,
        "GET",
        undefined,
        user.id,
      );
      if (alive.current) setBranches(bs.items);
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
  async function execute(retry = false) {
    if (writing.current || !user) return;
    writing.current = true;
    setBusy(true);
    try {
      await (retry ? op.execute() : op.execute(confirm.path, confirm.body));
      if (alive.current) {
        setConfirm(null);
        await load();
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const disabled = busy || op.busy || !!op.command;
  return (
    <Page>
      <Txt weight="bold">البث المستهدف والمجدول</Txt>
      <Nav />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <Txt>
            المواعيد UTC. جمهور الفرع: عملاء لهم طلب في الفرع، وموصلوه وموظفوه.
            «اكتمل إنشاء الرسائل» لا يعني وصولها إلى الجهاز.
          </Txt>
          <Action
            title="تحديث الحملات"
            disabled={busy}
            onPress={() => void load()}
          />
          <Card>
            <Input
              label="عنوان البث"
              value={title}
              onChange={(v) => {
                setTitle(v);
                setConfirm(null);
              }}
            />
            <Input
              label="نص البث"
              value={body}
              onChange={(v) => {
                setBody(v);
                setConfirm(null);
              }}
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {[
                ["customers", "العملاء"],
                ["couriers", "الموصلون"],
                ["all", "كل المستخدمين"],
              ].map(([k, label]) => (
                <Action
                  key={k}
                  title={label!}
                  secondary={kind !== k}
                  disabled={disabled}
                  onPress={() => {
                    setKind(k!);
                    setConfirm(null);
                  }}
                />
              ))}
            </View>
            <Action
              secondary={branch !== null}
              title="كل الفروع"
              disabled={disabled}
              onPress={() => {
                setBranch(null);
                setConfirm(null);
              }}
            />
            {branches.map((b) => (
              <Action
                key={b.id}
                secondary={branch !== b.id}
                title={b.name_ar}
                disabled={disabled}
                onPress={() => {
                  setBranch(b.id);
                  setConfirm(null);
                }}
              />
            ))}
            <Card>
              <Txt weight="bold">{title || "معاينة عنوان البث"}</Txt>
              <Txt>{body || "معاينة النص"}</Txt>
            </Card>
            <Action
              title="مراجعة حفظ مسودة البث"
              disabled={disabled}
              onPress={() =>
                setConfirm({
                  path: "/admin/campaigns",
                  label: `حفظ مسودة · ${kind} · ${branch ? "فرع محدد" : "كل الفروع"}`,
                  body: { title, body, audience: { kind, branchId: branch } },
                })
              }
            />
          </Card>
          <Input
            label="موعد البث UTC (ISO 8601)"
            value={when}
            onChange={(v) => {
              setWhen(v);
              setConfirm(null);
            }}
          />
          {rows.map((c) => (
            <Card key={c.id}>
              <Txt weight="bold">{c.title_ar}</Txt>
              <Txt>{c.body_ar}</Txt>
              <Txt>
                {labels[c.status]} · {c.scheduled_at ?? "دون موعد"}
              </Txt>
              {["draft", "scheduled"].includes(c.status) && (
                <>
                  <Action
                    title="مراجعة جدولة البث"
                    disabled={disabled || !when}
                    onPress={() =>
                      setConfirm({
                        path: "/admin/campaigns/" + c.id + "/schedule",
                        label: `جدولة ${c.title_ar} · ${when}`,
                        body: { expectedVersion: c.version, scheduledAt: when },
                      })
                    }
                  />
                  <Action
                    secondary
                    title="مراجعة إلغاء الحملة"
                    disabled={disabled}
                    onPress={() =>
                      setConfirm({
                        path: "/admin/campaigns/" + c.id + "/cancel",
                        label: "إلغاء " + c.title_ar,
                        body: { expectedVersion: c.version },
                      })
                    }
                  />
                </>
              )}
            </Card>
          ))}
          {next && (
            <Action
              secondary
              title="المزيد"
              disabled={busy}
              onPress={() => void load(next)}
            />
          )}{" "}
          {confirm && (
            <Card>
              <Txt weight="bold">تأكيد: {confirm.label}</Txt>
              <Action
                title="تنفيذ قرار البث"
                disabled={disabled}
                onPress={() => void execute()}
              />
              <Action
                secondary
                title="تراجع"
                onPress={() => setConfirm(null)}
              />
            </Card>
          )}
          {op.command && !op.command.path.startsWith("/admin/campaigns") && (
            <Card>
              <Txt>
                يوجد إجراء آخر معلق؛ راجعه من صفحة الطلب أو المالية قبل البث.
              </Txt>
            </Card>
          )}
          {op.command?.path.startsWith("/admin/campaigns") && (
            <Card>
              <Txt>
                يوجد إجراء محفوظ ينتظر الإقرار؛ ستعاد المحاولة بالمحتوى والمفتاح
                نفسيهما.
              </Txt>
              <Action
                title="إعادة محاولة إجراء البث المحفوظ"
                disabled={busy || op.busy}
                onPress={() => void execute(true)}
              />
            </Card>
          )}
        </>
      )}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
    </Page>
  );
}
