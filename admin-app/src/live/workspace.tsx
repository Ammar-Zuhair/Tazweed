import { useRouter } from "expo-router";
import { useState, useEffect } from "react";
import { View, Image } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Crypto from "expo-crypto";
import { Page, Txt, Card, Action } from "../ui/components";
import { useTheme } from "../ui/theme-provider";
import { api, useAuth, Input, LoginPanel } from "./connection";
const menus = [
  ["governorates", "المحافظات"],
  ["branches", "الفروع"],
  ["categories", "الأقسام"],
  ["attributes", "الخصائص"],
  ["attribute-values", "قيم الخصائص"],
  ["products", "المنتجات"],
  ["units", "وحدات البيع"],
  ["branch-prices", "أسعار الفروع"],
  ["inventory", "المخزون"],
  ["receipts", "استلام مخزون"],
  ["movements", "سجل الحركات"],
  ["transfers", "نقل مخزون"],
  ["media", "الصور"],
  ["promotions", "العروض الترويجية"],
] as const;
const emptyFields: Record<string, string[]> = {
  promotions: [
    "name_ar",
    "governorate_id",
    "category_id",
    "product_id",
    "target",
    "discount_kind",
    "value",
    "starts_at",
    "ends_at",
  ],
  governorates: ["name_ar", "catalog_branch_id"],
  branches: [
    "name_ar",
    "governorate_id",
    "latitude",
    "longitude",
    "coverage_radius_m",
  ],
  categories: ["name_ar", "parent_id"],
  attributes: ["code", "name_ar"],
  "attribute-values": ["attribute_id", "value_ar"],
  products: [
    "sku",
    "name_ar",
    "category_id",
    "description_ar",
    "origin_country",
  ],
  units: ["product_id", "unit_kind", "pieces_per_unit", "price_yer"],
  "branch-prices": ["branch_id", "product_id", "unit_id", "price_yer"],
  inventory: ["branch_id", "product_id", "unit_id", "quantity", "note"],
  receipts: ["branch_id", "product_id", "unit_id", "quantity", "note"],
  movements: ["branch_id"],
  transfers: [
    "from_branch_id",
    "to_branch_id",
    "product_id",
    "unit_id",
    "quantity",
    "reason",
  ],
};
const labels: Record<string, string> = {
  target: "نوع الخصم",
  discount_kind: "طريقة الخصم",
  value: "قيمة الخصم (النسبة بنقاط الأساس؛1000=10٪)",
  starts_at: "بداية العرض UTC (2026-11-01T00:00:00Z)",
  ends_at: "نهاية العرض UTC",
  name_ar: "الاسم",
  catalog_branch_id: "فرع الكتالوج",
  governorate_id: "المحافظة",
  latitude: "خط العرض",
  longitude: "خط الطول",
  coverage_radius_m: "نطاق التغطية بالمتر",
  parent_id: "القسم الأب",
  code: "المفتاح التعريفي",
  attribute_id: "الخاصية",
  value_ar: "القيمة",
  sku: "SKU ثابت",
  category_id: "القسم",
  description_ar: "الوصف",
  origin_country: "بلد المنشأ",
  product_id: "المنتج",
  unit_kind: "نوع الوحدة",
  pieces_per_unit: "عدد الحبات",
  price_yer: "السعر بالريال",
  branch_id: "الفرع",
  unit_id: "وحدة البيع",
  quantity: "الكمية",
  note: "سبب الحركة",
  from_branch_id: "من فرع",
  to_branch_id: "إلى فرع",
  reason: "السبب",
};
export default function Workspace() {
  const { user } = useAuth();
  return <WorkspaceScreen key={user?.id ?? "signed-out"} />;
}
function WorkspaceScreen() {
  const auth = useAuth(), router=useRouter();
  const { preference, setPreference } = useTheme();
  const [section, setSection] = useState("governorates"),
    [data, setData] = useState<Record<string, any[]>>({}),
    [rows, setRows] = useState<any[]>([]),
    [form, setForm] = useState<Record<string, string>>({}),
    [selectedValues, setValues] = useState<Record<string, string>>({}),
    [required, setRequired] = useState<Record<string, boolean>>({}),
    [filterable, setFilterable] = useState<Record<string, boolean>>({}),
    [imageIds, setImages] = useState<string[]>([]),
    [edit, setEdit] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [next, setNext] = useState<string | null>(null),
    [active, setActive] = useState(true),
    [pendingKey, setKey] = useState(() => Crypto.randomUUID());
  async function lists() {
    const out: Record<string, any[]> = {};
    for (const name of [
      "governorates",
      "branches",
      "categories",
      "attributes",
      "attribute-values",
      "products",
    ]) {
      try {
        out[name] = (await api("/admin/" + name + "?limit=100")).items;
      } catch {
        out[name] = [];
      }
    }
    setData(out);
  }
  useEffect(() => {
    if (auth.user) void lists();
  }, [auth.user]);
  const permission =
    section === "transfers"
      ? "inventory.transfer"
      : section === "branch-prices"
        ? "catalog.write"
        : "inventory.adjust";
  useEffect(() => {
    if (
      auth.user &&
      [
        "inventory",
        "receipts",
        "movements",
        "transfers",
        "branch-prices",
      ].includes(section)
    )
      void api("/admin/access/branches?permission=" + permission)
        .then((v) => setData((old) => ({ ...old, branches: v.items })))
        .catch((e) => setMessage(e.message));
  }, [auth.user, section]);
  useEffect(() => {
    const branch = form.branch_id || form.from_branch_id;
    if (
      auth.user &&
      branch &&
      [
        "inventory",
        "receipts",
        "movements",
        "transfers",
        "branch-prices",
      ].includes(section)
    )
      void api(
        "/admin/stock-products?limit=100&branchId=" +
          branch +
          "&permission=" +
          permission,
      )
        .then((v) => setData((old) => ({ ...old, products: v.items })))
        .catch((e) => setMessage(e.message));
  }, [auth.user, section, form.branch_id, form.from_branch_id]);

  function field(k: string, v: string) {
    setForm((old) => ({
      ...old,
      [k]: v,
      ...(k === "product_id" ? { unit_id: "" } : {}),
    }));
    if (k === "category_id") {
      setValues({});
      setRequired({});
    }
    setKey(Crypto.randomUUID());
  }
  function select(s: string) {
    setSection(s);
    setForm({});
    setEdit(null);
    setRows([]);
    setValues({});
    setImages([]);
    setRequired({});
    setFilterable({});
    setNext(null);
    setActive(true);
    setMessage("");
  }
  function options(k: string) {
    if (k.includes("branch") || k === "catalog_branch_id") return data.branches;
    if (k === "governorate_id") return data.governorates;
    if (k === "category_id" || k === "parent_id") return data.categories;
    if (k === "attribute_id") return data.attributes;
    if (k === "product_id") return data.products;
    if (k === "unit_kind")
      return [
        { id: "piece", name_ar: "حبة" },
        { id: "carton", name_ar: "كرتون" },
      ];
    if (k === "target")
      return [
        { id: "products", name_ar: "منتجات" },
        { id: "delivery", name_ar: "توصيل" },
      ];
    if (k === "discount_kind")
      return [
        { id: "fixed", name_ar: "مبلغ ثابت" },
        { id: "percent", name_ar: "نسبة" },
      ];
    if (k === "unit_id") return data.units;
    return null;
  }
  async function load(cursor?: string) {
    setBusy(true);
    setMessage("");
    try {
      let path = "/admin/" + section;
      if (section === "units") {
        if (!form.product_id) throw Error("اختر المنتج");
        path = "/admin/products/" + form.product_id + "/units";
      }
      if (section === "inventory" || section === "movements") {
        if (!form.branch_id) throw Error("اختر الفرع");
        path =
          "/admin/inventory" +
          (section === "movements" ? "/movements" : "") +
          "?branchId=" +
          form.branch_id;
      }
      if (section === "branch-prices") {
        if (!form.branch_id) throw Error("اختر الفرع");
        path = "/admin/branch-prices?branchId=" + form.branch_id;
      }
      if (["transfers", "media"].includes(section))
        throw Error("استخدم نموذج الحفظ");
      const v = await api(
        path +
          (path.includes("?") ? "&" : "?") +
          "limit=30" +
          (cursor ? "&cursor=" + cursor : ""),
      );
      setRows((old) => (cursor ? [...old, ...v.items] : v.items));
      setNext(v.nextCursor ?? null);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function units(productId: string) {
    try {
      const product = data.products?.find((p) => p.id === productId);
      if (product?.units) {
        setData((old) => ({ ...old, units: product.units }));
        return;
      }
      const v = await api("/admin/products/" + productId + "/units");
      setData((old) => ({ ...old, units: v.items }));
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function categoryRules(id: string) {
    try {
      const v = await api("/admin/categories/" + id + "/attributes");
      setFilterable(
        Object.fromEntries(
          v.items.map((x: any) => [x.attribute_id, x.filterable]),
        ),
      );
      setRequired(
        Object.fromEntries(
          v.items.map((x: any) => [x.attribute_id, x.required]),
        ),
      );
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const f = form;
      let path = "/admin/" + section,
        method = edit ? "PUT" : "POST",
        v: any = {};
      if (section === "promotions")
        v = {
          name_ar: f.name_ar,
          governorate_id: f.governorate_id || null,
          category_id: f.category_id || null,
          product_id: f.product_id || null,
          target: f.target,
          discount_kind: f.discount_kind,
          value: f.value,
          starts_at: f.starts_at,
          ends_at: f.ends_at,
          active,
        };
      if (section === "governorates")
        v = {
          name_ar: f.name_ar,
          active,
          sort_order: 0,
          catalog_branch_id: f.catalog_branch_id || null,
        };
      if (section === "branches")
        v = {
          name_ar: f.name_ar,
          governorate_id: f.governorate_id,
          latitude: Number(f.latitude),
          longitude: Number(f.longitude),
          coverage_radius_m: f.coverage_radius_m
            ? Number(f.coverage_radius_m)
            : null,
          active,
        };
      if (section === "categories")
        v = {
          name_ar: f.name_ar,
          parent_id: f.parent_id || null,
          image_id: imageIds[0] ?? edit?.image_id ?? null,
          active,
          sort_order: 0,
        };
      if (section === "attributes")
        v = { name_ar: f.name_ar, code: f.code, active };
      if (section === "attribute-values")
        v = {
          attribute_id: f.attribute_id,
          value_ar: f.value_ar,
          active,
          sort_order: 0,
        };
      if (section === "products")
        v = {
          sku: f.sku,
          name_ar: f.name_ar,
          category_id: f.category_id,
          description_ar: f.description_ar ?? "",
          origin_country: f.origin_country || null,
          active,
          attributes: Object.entries(selectedValues)
            .filter(([_, v]) => v)
            .map(([attribute_id, value_id]) => ({ attribute_id, value_id })),
          image_ids: imageIds,
          ...(edit ? { expected_version: edit.version } : {}),
        };
      if (section === "units") {
        path = "/admin/products/" + f.product_id + "/units";
        v = {
          unit_kind: f.unit_kind,
          pieces_per_unit: Number(f.pieces_per_unit),
          price_yer: f.price_yer,
          active,
        };
      }
      if (section === "branch-prices") {
        method = "PUT";
        v = {
          branch_id: f.branch_id,
          unit_id: f.unit_id,
          price_yer: f.price_yer,
          active,
        };
      }
      if (section === "inventory" || section === "receipts") {
        path = "/admin/inventory/adjustments";
        method = "POST";
        v = {
          branch_id: f.branch_id,
          product_id: f.product_id,
          unit_id: f.unit_id,
          quantity: Number(f.quantity),
          reason: section === "receipts" ? "receipt" : "adjustment",
          note: f.note,
        };
      }
      if (section === "transfers") {
        path = "/admin/inventory/transfers";
        method = "POST";
        v = {
          from_branch_id: f.from_branch_id,
          to_branch_id: f.to_branch_id,
          reason: f.reason,
          items: [
            {
              product_id: f.product_id,
              unit_id: f.unit_id,
              quantity: Number(f.quantity),
            },
          ],
        };
      }
      if (
        edit &&
        !["branch-prices", "inventory", "receipts", "transfers"].includes(
          section,
        )
      )
        path += "/" + edit.id;
      const result = await api(
        path,
        v,
        method,
        ["inventory", "receipts", "transfers"].includes(section)
          ? pendingKey
          : undefined,
      );
      setMessage("حُفظت العملية في الخادم");
      setEdit(result.id ? result : null);
      setKey(Crypto.randomUUID());
      if (
        !["inventory", "receipts", "transfers", "branch-prices"].includes(
          section,
        )
      )
        await lists();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function photo() {
    setBusy(true);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0]!;
      const blob = await (await fetch(asset.uri)).blob();
      const mime = blob.type || asset.mimeType || "image/jpeg";
      const purpose = section === "categories" ? "category" : "product";
      const upload = await api("/media/uploads", {
        purpose,
        mime,
        size: blob.size,
      });
      const r = await fetch(upload.putUrl, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: blob,
      });
      if (!r.ok) throw Error("تعذر رفع الصورة");
      await api("/media/uploads/" + upload.uploadId + "/complete", {});
      setImages((old) => [...old, upload.uploadId]);
      setMessage("تم التحقق من الصورة وحفظها");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <Txt weight="bold" style={{ fontSize: 26, lineHeight: 40 }}>
        إدارة تزويد
      </Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(["light", "dark", "system"] as const).map((v) => (
          <Action
            key={v}
            secondary={preference !== v}
            title={{ light: "فاتح", dark: "مظلم", system: "تلقائي" }[v]}
            onPress={() => setPreference(v)}
          />
        ))}
      </View>
      <LoginPanel />
      {!auth.user ? (
        <Txt>
          أضف مزود التحقق في الخادم لتسجيل الدخول. لا يوجد دخول تجريبي إلى
          بيانات المتجر.
        </Txt>
      ) : (
        <>
          <Action secondary title="التقرير الشهري PDF" onPress={()=>router.push("/reports" as any)}/>
          <Action secondary title="طلبات حذف الحساب" onPress={()=>router.push("/privacy-requests" as any)}/>
          <Action secondary title="الخصوصية والدعم" onPress={()=>router.push("/privacy" as any)}/>
          <Action secondary title="حذف الحساب" onPress={()=>router.push("/delete" as any)}/>
          <Action title="إدارة الطلبات والدفع" onPress={()=>router.push("/orders")}/>
          <Action secondary title="الموصلون والعمولات" onPress={()=>router.push("/couriers")}/>
          <Action secondary title="الصيانة والإصدارات" onPress={()=>router.push("/operations")}/>
          <Action secondary title="البث والجدولة" onPress={()=>router.push("/campaigns")}/>
          <Action secondary title="مركز الإشعارات" onPress={()=>router.push("/notifications")}/>
          <Action secondary title="الجودة والشكاوى" onPress={()=>router.push("/quality")}/>
          <Action secondary title="وسائل التحويل" onPress={()=>router.push("/methods")}/>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {menus.map(([key, label]) => (
              <Action
                key={key}
                secondary={section !== key}
                title={label}
                onPress={() => select(key)}
              />
            ))}
          </View>
          <Txt weight="bold">{menus.find((x) => x[0] === section)?.[1]}</Txt>
          <Card>
            {(emptyFields[section] ?? []).map((k) => {
              const opts = options(k);
              return (
                <View key={k} style={{ gap: 8 }}>
                  {opts ? (
                    <>
                      <Txt>{labels[k]}</Txt>
                      <View
                        style={{
                          flexDirection: "row",
                          flexWrap: "wrap",
                          gap: 8,
                        }}
                      >
                        <Action
                          secondary
                          title="بدون اختيار"
                          onPress={() => field(k, "")}
                        />
                        {opts.map((o) => (
                          <Action
                            key={o.id}
                            secondary={form[k] !== o.id}
                            title={
                              o.name_ar ??
                              (o.unit_kind === "piece" ? "حبة" : "كرتون") +
                                " · " +
                                o.pieces_per_unit
                            }
                            onPress={() => {
                              field(k, o.id);
                              if (k === "product_id") void units(o.id);
                              if (k === "category_id") void categoryRules(o.id);
                            }}
                          />
                        ))}
                      </View>
                    </>
                  ) : (
                    <Input
                      label={labels[k] ?? k}
                      value={form[k] ?? ""}
                      onChange={(v) => field(k, v)}
                    />
                  )}
                </View>
              );
            })}
            {section === "products" &&
              (data.attributes ?? [])
                .filter((a) => a.id in required)
                .map((a) => (
                  <View key={a.id} style={{ gap: 8 }}>
                    <Txt>
                      {a.name_ar}
                      {required[a.id] ? " (مطلوبة)" : ""}
                    </Txt>
                    <View
                      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                    >
                      {(data["attribute-values"] ?? [])
                        .filter((v) => v.attribute_id === a.id && v.active)
                        .map((v) => (
                          <Action
                            key={v.id}
                            title={v.value_ar}
                            secondary={selectedValues[a.id] !== v.id}
                            onPress={() =>
                              setValues((old) => ({ ...old, [a.id]: v.id }))
                            }
                          />
                        ))}
                    </View>
                  </View>
                ))}
            {![
              "inventory",
              "receipts",
              "movements",
              "transfers",
              "media",
            ].includes(section) && (
              <Action
                secondary
                title={active ? "نشط: نعم" : "نشط: لا"}
                onPress={() => setActive((v) => !v)}
              />
            )}
            {["products", "categories", "media"].includes(section) && (
              <>
                <Action
                  secondary
                  title="اختيار صورة ورفعها"
                  disabled={busy}
                  onPress={photo}
                />
                <Txt>صور متحقق منها: {imageIds.length}</Txt>
              </>
            )}
            {!["media", "movements"].includes(section) && (
              <Action title="حفظ في الخادم" disabled={busy} onPress={save} />
            )}
          </Card>
          {!!message && (
            <Card>
              <Txt accessibilityRole="alert">{message}</Txt>
            </Card>
          )}
          {section === "categories" && edit?.id && (
            <Card>
              <Txt>خصائص القسم</Txt>
              {(data.attributes ?? []).map((a) => (
                <View key={a.id} style={{ gap: 8 }}>
                  <Txt>{a.name_ar}</Txt>
                  <Action
                    secondary
                    title={a.id in required ? "مرتبطة؛ إزالة" : "ربط الخاصية"}
                    onPress={() =>
                      setRequired((old) => {
                        const n = { ...old };
                        if (a.id in n) delete n[a.id];
                        else n[a.id] = false;
                        return n;
                      })
                    }
                  />
                  {a.id in required && (
                    <Action
                      secondary
                      title={
                        (filterable[a.id] ?? true)
                          ? "يظهر في الفلاتر"
                          : "لا يظهر في الفلاتر"
                      }
                      onPress={() =>
                        setFilterable((old) => ({
                          ...old,
                          [a.id]: !(old[a.id] ?? true),
                        }))
                      }
                    />
                  )}
                  {a.id in required && (
                    <Action
                      secondary
                      title={required[a.id] ? "مطلوبة" : "اختيارية"}
                      onPress={() =>
                        setRequired((old) => ({ ...old, [a.id]: !old[a.id] }))
                      }
                    />
                  )}
                </View>
              ))}
              <Action
                title="حفظ ربط الخصائص"
                onPress={() =>
                  api(
                    "/admin/categories/" + edit.id + "/attributes",
                    {
                      items: Object.entries(required).map(
                        ([attribute_id, required], sort_order) => ({
                          attribute_id,
                          required,
                          filterable: filterable[attribute_id] ?? true,
                          sort_order,
                        }),
                      ),
                    },
                    "PUT",
                  )
                    .then(() => setMessage("حُفظ ربط الخصائص"))
                    .catch((e) => setMessage(e.message))
                }
              />
            </Card>
          )}
          {section !== "media" && (
            <Action
              secondary
              title="تحميل السجلات"
              disabled={busy}
              onPress={() => load()}
            />
          )}{" "}
          {rows.map((row) => (
            <Card key={row.id}>
              <Txt weight="bold">{row.name_ar ?? row.value_ar ?? row.id}</Txt>
              {section === "movements" ? (
                <Txt>
                  {row.reason} · {row.delta_pieces} حبة
                </Txt>
              ) : section === "inventory" ? (
                <Txt>
                  فعلي: {row.on_hand} · محجوز: {row.reserved} · حر: {row.free}
                </Txt>
              ) : (
                <Action
                  secondary
                  title="تعديل"
                  onPress={() => {
                    setEdit(row);
                    setForm(
                      Object.fromEntries(
                        Object.entries(
                          section === "units"
                            ? { ...row, product_id: form.product_id }
                            : row,
                        ).map(([k, v]) => [k, v == null ? "" : String(v)]),
                      ),
                    );
                    setActive(row.active ?? true);
                    if (section === "products") {
                      void categoryRules(row.category_id);
                      void api("/admin/products/" + row.id)
                        .then((v) => {
                          setValues(
                            Object.fromEntries(
                              v.attributes.map((a: any) => [
                                a.attribute_id,
                                a.value_id,
                              ]),
                            ),
                          );
                          setImages(v.image_ids);
                        })
                        .catch((e) => setMessage(e.message));
                    }
                    if (section === "categories") void categoryRules(row.id);
                  }}
                />
              )}
            </Card>
          ))}
          {next && (
            <Action secondary title="المزيد" onPress={() => load(next)} />
          )}
          <Txt style={{ fontSize: 12 }}>
            الخادم يراجع الصلاحيات ونطاق الفرع. العمليات غير المتاحة لا تحفظ
            محليًا.
          </Txt>
        </>
      )}
    </Page>
  );
}
