import { useEffect, useRef, useState } from "react";
import { useRouter, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";
import { Page, Txt, Card, Action } from "../ui/components";
import { api, Input, useAuth, LoginPanel } from "./connection";
import { useCart } from "./cart-state";
import MapPicker from "./MapPicker";
const reasons: Record<string, string> = {
  ROUTING_UNCONFIGURED:
    "خدمة الطريق غير مهيأة؛ تحتاج الرسوم إلى مراجعة الإدارة.",
  ROUTING_UNAVAILABLE: "تعذرت خدمة الطريق؛ لا توجد رسوم مؤكدة.",
  NO_ROUTE: "لم يُعثر على طريق؛ تحتاج الإدارة إلى مراجعة العنوان والرسوم.",
  SNAP_TOO_FAR: "العنوان بعيد عن طريق معروف؛ راجع الدبوس.",
  DELIVERY_UNCONFIGURED: "التوصيل أو تغطيته وتعرفته غير مهيأة لهذا الفرع.",
  OUTSIDE_COVERAGE: "العنوان خارج نطاق تغطية فرع الكتالوج.",
  ROAD_LIMIT_EXCEEDED: "مسافة الطريق تتجاوز حد توصيل فرع الكتالوج.",
};
export default function Checkout() {
  const { user } = useAuth();
  return <CheckoutScreen key={user?.id ?? "signed-out"} />;
}
function CheckoutScreen() {
  const cart = useCart(),
    auth = useAuth(),
    router = useRouter();
  const [addresses, setAddresses] = useState<any[]>([]),
    [kind, setKind] = useState<"retail" | "wholesale">("retail"),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const fingerprint = JSON.stringify([
      cart.gov,
      cart.addressId,
      cart.draft,
      kind,
      auth.user?.id,
    ]),
    latest = useRef(fingerprint);
  latest.current = fingerprint;
  const seq = useRef(0);
  useEffect(() => {
    setResult(null);
    setError("");
    seq.current++;
    setBusy(false);
  }, [fingerprint]);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setResult(null);
      seq.current++;
      if (auth.user)
        api("/me/addresses")
          .then((v) => {
            if (alive) setAddresses(v.items);
          })
          .catch((e) => {
            if (alive) setError(e.message);
          });
      return () => {
        alive = false;
        seq.current++;
        setResult(null);
      };
    }, [auth.user?.id]),
  );
  const selected = addresses.find(
      (a) => a.id === cart.addressId && a.governorate_id === cart.gov,
    ),
    entries = Object.entries(cart.draft).filter(([, q]) => q === "" || Number(q) > 0),
    incompleteQuantity=entries.some(([,q])=>q==='');
  async function calculate() {
    const current = ++seq.current,
      fp = latest.current;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      if (!cart.gov || !selected)
        throw Error("اختر عنوانًا في المحافظة الحالية.");
      const value = await api("/checkout/preview", {
        governorateId: cart.gov,
        addressId: cart.addressId,
        kind,
        items: entries.map(([unitId, q]) => ({ unitId, quantity: Number(q) })),
      });
      if (current === seq.current && fp === latest.current) setResult(value);
    } catch (e) {
      if (current === seq.current && fp === latest.current)
        setError((e as Error).message);
    } finally {
      if (current === seq.current) setBusy(false);
    }
  }
  return (
    <Page>
      <Txt weight="bold" style={{ fontSize: 26, lineHeight: 38 }}>
        السلة ومعاينة السعر
      </Txt>
      <Txt>
        اختياراتك محفوظة خلال هذه الجلسة. تغيير المحافظة يبقي البنود ويستلزم
        اختيار عنوان وإعادة التسعير.
      </Txt>
      <Action
        secondary
        title="متابعة التسوق أو تغيير المحافظة"
        onPress={() => router.push("/")}
      />
      {!entries.length && (
        <Card>
          <Txt>لم تختر منتجات بعد.</Txt>
        </Card>
      )}
      {entries.map(([id, q]) => (
        <Card key={id}>
          <Txt weight="bold">{cart.names[id] ?? "وحدة مختارة"}</Txt>
          <Input
            label={"كمية " + (cart.names[id] ?? id)}
            value={q}
            numeric
            onChange={(v) => {
              const n = v.replace(/[٠-٩۰-۹]/g, (c) =>
                String(
                  c.charCodeAt(0) - (c.charCodeAt(0) > 1775 ? 1776 : 1632),
                ),
              );
              if (/^\d{0,3}$/.test(n))
                cart.setDraft((old) => ({ ...old, [id]: n }));
            }}
          />
          <Action
            secondary
            title="إزالة من السلة"
            onPress={() =>
              cart.setDraft((old) => {
                const n = { ...old };
                delete n[id];
                return n;
              })
            }
          />
        </Card>
      ))}
      {incompleteQuantity&&<Txt accessibilityRole="alert">أدخل كمية من1 إلى999 للبنود الفارغة أو أزلها.</Txt>}
      {!auth.user ? (
        <LoginPanel />
      ) : (
        <>
          <Action
            secondary
            title="إدارة عناوين التوصيل"
            onPress={() => router.push("/addresses")}
          />
          <Card>
            <Txt weight="bold">عنوان في المحافظة المختارة</Txt>
            {addresses
              .filter((a) => a.governorate_id === cart.gov)
              .map((a) => (
                <Action
                  key={a.id}
                  secondary={cart.addressId !== a.id}
                  title={a.label}
                  onPress={() => cart.setAddressId(a.id)}
                />
              ))}
            {!addresses.some((a) => a.governorate_id === cart.gov) && (
              <Txt>أضف عنوانًا في المحافظة الحالية أولًا.</Txt>
            )}
          </Card>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Action
              secondary={kind !== "retail"}
              title="تجزئة"
              onPress={() => setKind("retail")}
            />
            <Action
              secondary={kind !== "wholesale"}
              title="جملة"
              onPress={() => setKind("wholesale")}
            />
          </View>
          {kind === "wholesale" && (
            <Txt>
              أسعار الكتالوج مرجع فقط؛ الجملة تحتاج تسعيرة الإدارة ولا تجمع عروض
              التجزئة.
            </Txt>
          )}
          <Action
            title={busy ? "جارٍ حساب المعاينة…" : "حساب المعاينة من الخادم"}
            disabled={busy || !entries.length || !selected || incompleteQuantity}
            onPress={calculate}
          />
        </>
      )}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
      {result && (
        <Card>
          <Txt weight="bold">معاينة تقديرية · لا حجز</Txt>
          {result.items.map((l: any) => (
            <Txt key={l.unitId}>
              {l.name_ar} · {l.quantity} × {l.unitPriceYer} = {l.lineTotalYer}{" "}
              ر.ي
            </Txt>
          ))}
          <Txt>المنتجات: {result.estimatedTotals.subtotal_yer} ر.ي</Txt>
          {result.delivery.status === "estimated" ? (
            <>
              <Txt>
                مسافة الطريق: {result.delivery.distance_m} متر · الكيلومترات
                المحتسبة: {result.delivery.billed_km}
              </Txt>
              <Txt>
                التعرفة: {result.delivery.base_yer} +{" "}
                {result.delivery.billed_km} × {result.delivery.per_km_yer} ر.ي
                (الجزء الصحيح)
              </Txt>
              <Txt>
                التوصيل قبل الخصم:{" "}
                {result.estimatedTotals.delivery_before_discount_yer} ر.ي
              </Txt>
              <Txt>
                خصم المنتجات: {result.estimatedTotals.product_discount_yer} ر.ي
                · خصم التوصيل: {result.estimatedTotals.delivery_discount_yer}{" "}
                ر.ي
              </Txt>
              <Txt>
                رسوم توصيل العميل:{" "}
                {result.estimatedTotals.delivery_customer_yer} ر.ي
              </Txt>
              <Txt weight="bold">
                الإجمالي التقديري: {result.estimatedTotals.total_yer} ر.ي
              </Txt>
              {result.promotion && (
                <Txt>
                  العرض المختار: {result.promotion.name_ar} · توفير{" "}
                  {result.promotion.saving_yer} ر.ي
                </Txt>
              )}
              {selected && (
                <MapPicker
                  latitude={selected.latitude}
                  longitude={selected.longitude}
                  readOnly
                  route={result.delivery.route.geometry}
                  onPoint={() => {}}
                  onError={() => {}}
                />
              )}
            </>
          ) : (
            <Txt>
              {reasons[result.delivery.reason] ??
                "رسوم التوصيل تحتاج مراجعة الإدارة."}{" "}
              الإجمالي غير مكتمل؛ لا مسافة مستقيمة بديلة.
            </Txt>
          )}
          <Txt>{result.notice}</Txt>
          <Txt>
            فرع التنفيذ: بانتظار اختيار المدير. إرسال الطلب متاح عند تنفيذ08.
          </Txt>
        </Card>
      )}
    </Page>
  );
}
