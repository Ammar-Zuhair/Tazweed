import { useState, useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { Platform, View } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Page, Header, Card, Txt, Action } from "../ui/components";
import { api, apiBytes, useAuth, Input, LoginPanel } from "./connection";
import { useOperation } from "./operations";
export default function Reports() {
  const { user } = useAuth();
  return <ReportsView key={user?.id ?? "out"} />;
}
function ReportsView() {
  const { user } = useAuth(),
    router = useRouter(),
    op = useOperation(user?.id),
    now = new Date();
  const [year, setYear] = useState(String(now.getUTCFullYear())),
    [month, setMonth] = useState(String(now.getUTCMonth() + 1)),
    [branches, setBranches] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [job, setJob] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const alive = useRef(true),
    lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    if (user)
      api(
        "/admin/access/branches?permission=reports.read",
        undefined,
        "GET",
        undefined,
        user.id,
      )
        .then((v) => {
          if (alive.current) {
            setBranches(v.items);
            setSelected(v.items.map((x: any) => x.id));
          }
        })
        .catch((e) => {
          if (alive.current) setError(e.message);
        });
    return () => {
      alive.current = false;
    };
  }, [user?.id]);
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
  async function load(id: string) {
    const v = await api(
      "/admin/reports/" + id,
      undefined,
      "GET",
      undefined,
      user.id,
    );
    if (alive.current) setJob(v);
  }
  async function create() {
    await run(async () => {
      const v = await op.execute("/admin/reports/monthly-sales", {
        year: Number(year),
        month: Number(month),
        branchIds: selected,
      });
      await load(v.id);
    });
  }
  async function download() {
    await run(async () => {
      const bytes = await apiBytes(
        "/admin/reports/" + job.id + "/download",
        user.id,
      );
      if (!alive.current) return;
      const name = `tazweed-${job.summary.year}-${job.summary.month}.pdf`;
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        if (!(await Sharing.isAvailableAsync()))
          throw Error("المشاركة غير متاحة على هذا الجهاز");
        const file = new File(Paths.cache, name);
        try {
          file.create({ overwrite: true });
          file.write(bytes);
          await Sharing.shareAsync(file.uri, {
            mimeType: "application/pdf",
            UTI: "com.adobe.pdf",
            dialogTitle: "تقرير تزويد الشهري",
          });
        } finally {
          if (file.exists) file.delete();
        }
      }
    });
  }
  return (
    <Page>
      <Header
        title="تقرير المبيعات الشهري"
        subtitle="ملف PDF عربي خاص بالفروع المصرح بها"
      />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <Card>
            <Input
              label="سنة التقرير"
              numeric
              value={year}
              onChange={setYear}
            />
            <Input
              label="شهر التقرير من1إلى12"
              numeric
              value={month}
              onChange={setMonth}
            />
            <Txt>اختر الفروع:</Txt>
            <View style={{ gap: 8 }}>
              {branches.map((b) => (
                <Action
                  key={b.id}
                  secondary={!selected.includes(b.id)}
                  title={(selected.includes(b.id) ? "✓ " : "") + b.name_ar}
                  disabled={busy}
                  onPress={() =>
                    setSelected((v) =>
                      v.includes(b.id)
                        ? v.filter((x) => x !== b.id)
                        : [...v, b.id],
                    )
                  }
                />
              ))}
            </View>
            <Txt>
              تحسب المبيعات للطلبات المسلّمة، وتفصل عنها حركات التحويل والنقد
              والتوريد والعمولة. المنطقة الزمنية مثبتة داخل الملف، وصلاحية
              تنزيله يوم واحد.
            </Txt>
            <Action
              title="إنشاء تقرير PDF"
              disabled={
                busy ||
                op.busy ||
                !selected.length ||
                !/^[0-9]{4}$/.test(year) ||
                !/^([1-9]|1[0-2])$/.test(month)
              }
              onPress={() => void create()}
            />
            {op.command && (
              <Action
                secondary
                title="إعادة محاولة التقرير المعلق"
                disabled={busy || op.busy}
                onPress={() =>
                  void run(async () => {
                    const v = await op.execute();
                    await load(v.id);
                  })
                }
              />
            )}
          </Card>
          {job && (
            <Card>
              <Txt weight="bold">
                حالة التقرير:{" "}
                {
                  {
                    pending: "قيد الإنشاء",
                    processing: "جارٍ الإنشاء",
                    ready: "جاهز",
                    failed: "أخفق",
                  }[job.state as string]
                }
              </Txt>
              {job.error && <Txt accessibilityRole="alert">{job.error}</Txt>}
              {job.summary && (
                <>
                  <Txt>المنطقة الزمنية: {job.summary.timeZone}</Txt>
                  <Txt>
                    المبيعات المسلّمة: {job.summary.totals.salesTotal} ر.ي
                  </Txt>
                  <Txt>
                    المحصل: {job.summary.totals.cashCollected} ر.ي · العمولة:{" "}
                    {job.summary.totals.commissionEarned} ر.ي
                  </Txt>
                </>
              )}
              <Action
                secondary
                title="تحديث حالة التقرير"
                disabled={busy}
                onPress={() => void run(() => load(job.id))}
              />
              {job.state === "ready" && (
                <Action
                  title="تنزيل ومشاركة PDF"
                  disabled={busy}
                  onPress={() => void download()}
                />
              )}
            </Card>
          )}
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
