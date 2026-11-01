import { useState, useCallback } from "react";
import { useRouter, useFocusEffect } from "expo-router";
import { Page, Txt, Card, Action, Header } from "../ui/components";
import { api, useAuth, Input, LoginPanel } from "./connection";
export default function Methods() {
  const { user } = useAuth();
  return <MethodsView key={user?.id ?? "guest"} />;
}
function MethodsView() {
  const { user } = useAuth(),
    router = useRouter();
  const [items, setItems] = useState<any[]>([]),
    [branches, setBranches] = useState<any[]>([]),
    [global, setGlobal] = useState(false),
    [edit, setEdit] = useState(""),
    [branch, setBranch] = useState<string | null>(null),
    [name, setName] = useState(""),
    [beneficiary, setBeneficiary] = useState(""),
    [destination, setDestination] = useState(""),
    [instructions, setInstructions] = useState(""),
    [active, setActive] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setItems((await api("/admin/payment-methods")).items);
      setBranches(
        (await api("/admin/access/branches?permission=payment-methods.write"))
          .items,
      );
      setGlobal(
        (await api("/admin/access")).grants.some(
          (g: any) =>
            g.global_scope && g.permissions.includes("payment-methods.write"),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useFocusEffect(
    useCallback(() => {
      if (user) void load();
    }, [user?.id]),
  );
  return (
    <Page>
      <Header
        title="وسائل التحويل"
        subtitle="بيانات الجهة والمستفيد يديرها الخادم"
      />
      <Action
        secondary
        title="إدارة الطلبات"
        onPress={() => router.push("/orders")}
      />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <Txt>
            أدخل بيانات التحويل الحقيقية قبل استقبال مدفوعات. تعديل الوسيلة لا
            يغير التعليمات المثبتة للطلبات السابقة.
          </Txt>
          <Action
            secondary
            title="وسيلة جديدة"
            onPress={() => {
              setEdit("");
              setName("");
              setBeneficiary("");
              setDestination("");
              setInstructions("");
              setBranch(null);
              setActive(true);
            }}
          />
          {items.map((m) => (
            <Card key={m.id}>
              <Txt>
                {m.name_ar} · {m.active ? "نشطة" : "معطلة"}
              </Txt>
              <Action
                secondary
                title={"تعديل " + m.name_ar}
                onPress={() => {
                  setEdit(m.id);
                  setName(m.name_ar);
                  setBeneficiary(m.beneficiary);
                  setDestination(m.destination_number);
                  setInstructions(m.instructions_ar ?? "");
                  setBranch(m.branch_id);
                  setActive(m.active);
                }}
              />
            </Card>
          ))}
          <Card>
            {global && (
              <Action
                secondary={branch !== null}
                title="متاحة لجميع الفروع"
                onPress={() => setBranch(null)}
              />
            )}{" "}
            {branches.map((b) => (
              <Action
                key={b.id}
                secondary={branch !== b.id}
                title={b.name_ar}
                onPress={() => setBranch(b.id)}
              />
            ))}
            <Input label="اسم جهة التحويل" value={name} onChange={setName} />
            <Input
              label="اسم المستفيد"
              value={beneficiary}
              onChange={setBeneficiary}
            />
            <Input
              label="رقم حساب أو جهة التحويل"
              value={destination}
              onChange={setDestination}
            />
            <Input
              label="تعليمات التحويل"
              value={instructions}
              onChange={setInstructions}
            />
            <Action
              secondary
              title={active ? "الوسيلة نشطة" : "الوسيلة معطلة"}
              onPress={() => setActive((v) => !v)}
            />
            <Action
              title="حفظ وسيلة التحويل"
              disabled={
                busy ||
                !name ||
                !beneficiary ||
                !destination ||
                (!global && !branch)
              }
              onPress={() => {
                setBusy(true);
                setError("");
                void api(
                  "/admin/payment-methods" + (edit ? "/" + edit : ""),
                  {
                    branchId: branch,
                    name_ar: name,
                    beneficiary,
                    destination_number: destination,
                    instructions_ar: instructions,
                    active,
                  },
                  edit ? "PUT" : "POST",
                )
                  .then(() => load())
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            />
          </Card>
        </>
      )}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
    </Page>
  );
}
