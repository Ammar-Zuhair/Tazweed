import { useEffect, useState, useCallback } from "react";
import { View } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { Page, Txt, Card, Action } from "../ui/components";
import { api, Input, useAuth, LoginPanel } from "./connection";
import { useCart } from "./cart-state";
import MapPicker from "./MapPicker";
export default function AddressBook() {
  const { user } = useAuth();
  return <AddressScreen key={user?.id ?? "signed-out"} />;
}
function AddressScreen() {
  const auth = useAuth(),
    cart = useCart(),
    router = useRouter();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [rows, setRows] = useState<any[]>([]),
    [govs, setGovs] = useState<any[]>([]),
    [edit, setEdit] = useState<string | null>(null),
    [gov, setGov] = useState(cart.gov),
    [label, setLabel] = useState(""),
    [description, setDescription] = useState(""),
    [lat, setLat] = useState(""),
    [lon, setLon] = useState(""),
    [isDefault, setDefault] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [rev, setRev] = useState(0);
  useEffect(() => {
    let active = true;
    if (auth.user)
      Promise.all([api("/me/addresses"), api("/public/governorates?limit=100")])
        .then(([a, g]) => {
          if (active) {
            setRows(a.items);
            setGovs(g.items);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [auth.user?.id, rev]);
  const point = useCallback((latitude: number, longitude: number) => {
    setLat(latitude.toFixed(6));
    setLon(longitude.toFixed(6));
  }, []);
  const mapError = useCallback(
    () =>
      setNotice(
        "تعذر تحميل بيانات الخريطة. يمكنك إدخال الإحداثيات أو إعادة المحاولة.",
      ),
    [],
  );
  function fresh() {
    setEdit(null);
    setGov(cart.gov);
    setLabel("");
    setDescription("");
    setLat("");
    setLon("");
    setDefault(false);
    setError("");
    setNotice("");
  }
  async function chooseGov(id: string) {
    setGov(id);
    try {
      const c = await api("/delivery/catalog-context?governorateId=" + id);
      point(c.latitude, c.longitude);
      setNotice("الخريطة عند فرع الكتالوج. حدد موقع عنوانك قبل الحفظ.");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function locate() {
    setBusy(true);
    setError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted")
        throw Error(
          "لم يُمنح إذن الموقع؛ حدد الدبوس أو أدخل الإحداثيات يدويًا.",
        );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Error("تأخر تحديد الموقع؛ حاول مجددًا أو أدخل الإحداثيات."),
              ),
            12000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      point(position.coords.latitude, position.coords.longitude);
      setNotice(
        position.coords.accuracy === null
          ? "دقة الجهاز غير متاحة. راجع الدبوس قبل الحفظ."
          : `دقة الجهاز التقريبية: ${Math.round(position.coords.accuracy)} متر. راجع الدبوس قبل الحفظ.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (
        !gov ||
        !label.trim() ||
        !lat.trim() ||
        !lon.trim() ||
        !Number.isFinite(Number(lat)) ||
        !Number.isFinite(Number(lon))
      )
        throw Error("اختر المحافظة وأدخل اسم العنوان وإحداثياته.");
      const result = await api(
        "/me/addresses" + (edit ? "/" + edit : ""),
        {
          governorateId: gov,
          label,
          description,
          latitude: Number(lat),
          longitude: Number(lon),
          isDefault,
        },
        edit ? "PATCH" : "POST",
      );
      cart.setGov(gov);
      cart.setAddressId(result.id);
      setNotice("حُفظ العنوان في الخادم.");
      setRev((v) => v + 1);
      setEdit(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <Txt weight="bold" style={{ fontSize: 26, lineHeight: 38 }}>
        عناوين التوصيل
      </Txt>
      <Action
        secondary
        title="عودة إلى السلة"
        onPress={() => router.push("/checkout")}
      />
      {!auth.user ? (
        <LoginPanel />
      ) : (
        <>
          {rows.map((a) => (
            <Card key={a.id}>
              <Txt weight="bold">
                {a.label}
                {a.is_default ? " · افتراضي" : ""}
              </Txt>
              <Txt>{a.description}</Txt>
              <Txt>
                {a.latitude}, {a.longitude}
              </Txt>
              <Action
                title="اختيار هذا العنوان"
                onPress={() => {
                  cart.setGov(a.governorate_id);
                  cart.setAddressId(a.id);
                  router.push("/checkout");
                }}
              />
              <Action
                secondary
                title={"تعديل " + a.label}
                onPress={() => {
                  setEdit(a.id);
                  setGov(a.governorate_id);
                  setLabel(a.label);
                  setDescription(a.description ?? "");
                  point(a.latitude, a.longitude);
                  setDefault(a.is_default);
                  setError("");
                  setNotice("");
                }}
              />
              <Action
                secondary
                title={"أرشفة " + a.label}
                disabled={busy}
                onPress={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await api("/me/addresses/" + a.id, undefined, "DELETE");
                    if (cart.addressId === a.id) cart.setAddressId("");
                    if (edit === a.id) fresh();
                    setRev((v) => v + 1);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </Card>
          ))}
          <Action secondary title="عنوان جديد" onPress={fresh} />
          <Card>
            <Txt weight="bold">{edit ? "تعديل العنوان" : "إضافة عنوان"}</Txt>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {govs.map((g) => (
                <Action
                  key={g.id}
                  secondary={gov !== g.id}
                  title={g.name_ar}
                  onPress={() => chooseGov(g.id)}
                />
              ))}
            </View>
            <Input label="اسم العنوان" value={label} onChange={setLabel} />
            <Input
              label="وصف المكان أو معلم قريب"
              value={description}
              onChange={setDescription}
            />
            {focused && (
              <MapPicker
                latitude={
                  lat && Number.isFinite(Number(lat)) ? Number(lat) : 15
                }
                longitude={
                  lon && Number.isFinite(Number(lon)) ? Number(lon) : 44
                }
                onPoint={point}
                onError={mapError}
              />
            )}
            <Txt>
              الخريطة لعرض الموقع فقط؛ رسوم التوصيل يحسبها الخادم من الطريق.
              راجع الدبوس والإحداثيات.
            </Txt>
            <Action
              secondary
              title="استخدام موقعي الحالي"
              disabled={busy}
              onPress={locate}
            />
            <Input label="خط العرض" value={lat} onChange={setLat} />
            <Input label="خط الطول" value={lon} onChange={setLon} />
            <Action
              secondary
              title={isDefault ? "عنوان افتراضي: نعم" : "عنوان افتراضي: لا"}
              onPress={() => setDefault((v) => !v)}
            />
            <Action
              title="حفظ العنوان في الخادم"
              disabled={busy}
              onPress={save}
            />
          </Card>
          {!!notice && <Txt accessibilityRole="text">{notice}</Txt>}
          {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
          <Action
            secondary
            title="إعادة تحميل العناوين"
            onPress={() => setRev((v) => v + 1)}
          />
        </>
      )}
    </Page>
  );
}
