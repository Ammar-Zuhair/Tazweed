import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { View, Image, Pressable, FlatList } from "react-native";
import { Page, Txt, Card, Action } from "../ui/components";
import { useTheme } from "../ui/theme-provider";
import { api, Input, LoginPanel } from "./connection";
import { useCart } from "./cart-state";
function Photo({ id }: { id: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    api("/media/" + id + "/public")
      .then((v) => {
        if (alive) setUrl(v.thumbnailUrl);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);
  return url ? (
    <Image
      source={{ uri: url }}
      style={{ height: 150, width: "100%", borderRadius: 16 }}
      resizeMode="contain"
    />
  ) : (
    <View style={{ height: 100, justifyContent: "center" }}>
      <Txt>تزويد</Txt>
    </View>
  );
}
export default function LiveCatalog() {
  const { colors } = useTheme();
  const router = useRouter(),
    cart = useCart(),
    { gov, setGov, draft, setDraft } = cart;
  const [promos, setPromos] = useState<any[]>([]);
  const [governorates, setGovs] = useState<any[]>([]),
    [categories, setCats] = useState<any[]>([]),
    [category, setCategory] = useState(""),
    [search, setSearch] = useState(""),
    [filters, setFilters] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [products, setProducts] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [rev, setRev] = useState(0),
    [detail, setDetail] = useState<string | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    let alive = true;
    setPromos([]);
    if (gov)
      api("/catalog/promotions?governorateId=" + gov + "&limit=100")
        .then((v) => {
          if (alive) setPromos(v.items);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [gov, rev]);
  useEffect(() => {
    for (const p of products)
      for (const u of p.units)
        cart.remember(
          u.id,
          p.name_ar + " · " + (u.kind === "piece" ? "حبة" : "كرتون"),
        );
  }, [products]);
  useEffect(() => {
    let alive = true;
    Promise.all([
      api("/public/governorates?limit=100"),
      api("/catalog/categories?limit=100"),
    ])
      .then(([g, c]) => {
        if (alive) {
          setGovs(g.items);
          setCats(c.items);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [rev]);
  useEffect(() => {
    let alive = true;
    setSelected([]);
    setFilters([]);
    if (category)
      api("/catalog/categories/" + category + "/filters")
        .then((v) => {
          if (alive) setFilters(v.items);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [category]);
  async function load(cursor?: string, seq = sequence.current) {
    if (!gov) return;
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams({
        governorateId: gov,
        limit: "20",
        search,
        ...(category ? { categoryId: category } : {}),
        ...(selected.length ? { attributeValueIds: selected.join(",") } : {}),
        ...(cursor ? { cursor } : {}),
      });
      const v = await api("/catalog/products?" + p);
      if (seq === sequence.current) {
        setProducts((old) => (cursor ? [...old, ...v.items] : v.items));
        setNext(v.nextCursor);
      }
    } catch (e) {
      if (seq === sequence.current) {
        setError((e as Error).message);
        setProducts([]);
      }
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    const seq = ++sequence.current;
    setProducts([]);
    setNext(null);
    const t = setTimeout(() => void load(undefined, seq), 250);
    return () => clearTimeout(t);
  }, [gov, category, search, selected.join(","), rev]);
  function qty(id: string, change: number) {
    const n = Number(draft[id] ?? 0);
    setDraft((v) => ({
      ...v,
      [id]: String(Math.max(0, Math.min(999, n + change))),
    }));
  }
  return (
    <Page>
      <Txt weight="bold" style={{ fontSize: 28, lineHeight: 40 }}>
        تزويد
      </Txt>
      <Txt>منتجاتنا وأسعارها من فرع محافظتك</Txt>
      <Card>
        <Txt weight="bold">اختر المحافظة</Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {governorates.map((g) => (
            <Action
              key={g.id}
              secondary={gov !== g.id}
              title={g.name_ar}
              onPress={() => {
                setGov(g.id);
              }}
            />
          ))}
        </View>
        {!governorates.length && !error && <Txt>لم تضف محافظات بعد.</Txt>}
      </Card>
      <Card>
        <Txt weight="bold">العروض</Txt>
        {promos.length ? (
          <FlatList
            horizontal
            data={promos}
            keyExtractor={(p) => p.id}
            showsHorizontalScrollIndicator
            renderItem={({ item: p }) => (
              <View
                style={{
                  width: 260,
                  padding: 16,
                  margin: 6,
                  gap: 8,
                  borderRadius: 18,
                  backgroundColor: colors.surface,
                }}
              >
                <Txt weight="bold">{p.name_ar}</Txt>
                <Txt>
                  {p.target === "delivery" ? "خصم توصيل" : "خصم منتجات"} ·{" "}
                  {p.discount_kind === "percent"
                    ? Number(p.value) / 100 + "٪"
                    : p.value + " ر.ي"}
                </Txt>
                <Action
                  secondary
                  title="عرض المنتجات"
                  onPress={async () => {
                    setSelected([]);
                    setError("");
                    try {
                      if (p.product_id) {
                        const product = await api(
                          "/catalog/products/" +
                            p.product_id +
                            "?governorateId=" +
                            gov,
                        );
                        setCategory(product.category_id);
                        setSearch(product.sku);
                        setDetail(product.id);
                      } else {
                        setCategory(p.category_id ?? "");
                        setSearch("");
                      }
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                />
              </View>
            )}
          />
        ) : (
          <Txt style={{ color: colors.textMuted }}>
            لا عروض فعالة لهذه المحافظة حاليًا.
          </Txt>
        )}
      </Card>
      <Action
        title="فتح السلة ومعاينة السعر"
        onPress={() => router.push("/checkout")}
      />
      <Txt weight="bold">الأقسام</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Action
          secondary={!!category}
          title="جميع المنتجات"
          onPress={() => setCategory("")}
        />
        {categories.map((c) => (
          <Action
            key={c.id}
            secondary={category !== c.id}
            title={c.name_ar}
            onPress={() => setCategory(c.id)}
          />
        ))}
      </View>
      <Input label="ابحث بالاسم أو SKU" value={search} onChange={setSearch} />
      {filters.map((a) => (
        <Card key={a.id}>
          <Txt>{a.name_ar}</Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {a.values.map((v: any) => (
              <Action
                key={v.id}
                secondary={!selected.includes(v.id)}
                title={v.label}
                onPress={() =>
                  setSelected((old) =>
                    old.includes(v.id)
                      ? old.filter((x) => x !== v.id)
                      : [...old, v.id],
                  )
                }
              />
            ))}
          </View>
        </Card>
      ))}
      {!!error && (
        <Card>
          <Txt accessibilityRole="alert">{error}</Txt>
          <Action title="إعادة المحاولة" onPress={() => setRev((x) => x + 1)} />
        </Card>
      )}
      {loading && <Txt>جارٍ تحميل المنتجات…</Txt>}
      {gov && !loading && !products.length && !error && (
        <Txt>لا منتجات مطابقة حاليًا.</Txt>
      )}
      {products.map((p) => (
        <Card key={p.id}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={"تفاصيل " + p.name_ar}
            onPress={() => setDetail(detail === p.id ? null : p.id)}
          >
            {p.images[0] && <Photo id={p.images[0].id} />}
            <Txt weight="bold" style={{ fontSize: 21, lineHeight: 32 }}>
              {p.name_ar}
            </Txt>
            <Txt>{p.sku}</Txt>
          </Pressable>
          {detail === p.id && (
            <>
              <Txt>{p.description_ar}</Txt>
              <Txt>{p.origin_country ?? ""}</Txt>
              {p.attributes.map((a: any) => (
                <Txt key={a.attribute_id}>
                  {a.name}: {a.value}
                </Txt>
              ))}
              {p.images.slice(1).map((image: any) => (
                <Photo key={image.id} id={image.id} />
              ))}
            </>
          )}
          {p.units.map((u: any) => (
            <View key={u.id} style={{ gap: 8, paddingVertical: 8 }}>
              <Txt>
                {u.kind === "piece"
                  ? "حبة"
                  : "كرتون (" + u.pieces_per_unit + " حبة)"}{" "}
                · {u.price_yer} ر.ي · {u.available ? "متوفر" : "غير متوفر"}
              </Txt>
              <View
                style={{ flexDirection: "row", gap: 10, alignItems: "center" }}
              >
                <Action secondary title="−" onPress={() => qty(u.id, -1)} />
                <View style={{ flex: 1 }}>
                  <Input
                    label="الكمية"
                    value={draft[u.id] ?? "0"}
                    numeric
                    onChange={(v) => {
                      const s = v.replace(/[٠-٩]/g, (c) =>
                        String(c.charCodeAt(0) - 1632),
                      );
                      if (/^\d{0,3}$/.test(s))
                        setDraft((old) => ({ ...old, [u.id]: s }));
                    }}
                  />
                </View>
                <Action
                  secondary
                  title="+"
                  disabled={!u.available}
                  onPress={() => qty(u.id, 1)}
                />
              </View>
              <Action
                title={Number(draft[u.id]) ? "كمية السلة" : "طلب"}
                disabled={!u.available}
                onPress={() => qty(u.id, Number(draft[u.id]) ? 0 : 1)}
              />
            </View>
          ))}
        </Card>
      ))}
      {next && (
        <Action
          secondary
          title="تحميل المزيد"
          disabled={loading}
          onPress={() => load(next)}
        />
      )}
      <Txt style={{ fontSize: 12 }}>
        الكميات مسودة سلة. افتح السلة لمعاينة السعر من الخادم بلا حجز؛ يحدد
        المدير فرع التنفيذ والعرض النهائي لاحقًا.
      </Txt>
    </Page>
  );
}
export function LiveAccount() {
  const router = useRouter();
  return (
    <Page>
      <Txt weight="bold">حسابي</Txt>
      <Action
        secondary
        title="متابعة التسوق"
        onPress={() => router.push("/")}
      />
      <LoginPanel />
      <Action secondary title="مركز الإشعارات" onPress={()=>router.push("/notifications")}/>
      {(
        [
          "addresses",
          "settings",
          "privacy",
          "terms",
          "about",
          "support",
        ] as const
      ).map((path, n) => (
        <Action
          key={path}
          secondary
          title={
            [
              "عناوين التوصيل",
              "المظهر والإعدادات",
              "الخصوصية",
              "الشروط",
              "عن تزويد",
              "الدعم",
            ][n]!
          }
          onPress={() => router.push(("/" + path) as any)}
        />
      ))}
    </Page>
  );
}
export function Deferred() {
  return (
    <Page>
      <Txt weight="bold">تزويد</Txt>
      <Txt>
        هذه الخدمة ليست متاحة بعد. يمكنك الآن تصفح الكتالوج الفعلي من الرئيسية
        والأقسام.
      </Txt>
    </Page>
  );
}
