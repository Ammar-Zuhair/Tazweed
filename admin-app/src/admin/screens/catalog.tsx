import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useAdmin } from "../../data/admin-provider";
import type { Attribute, Category, Product } from "../../domain/types";
import { fixtureImages } from "../../fixtures/admin-fixtures";
import {
  Action,
  Artwork,
  Card,
  Choice,
  Choices,
  Field,
  Hint,
  Save,
  Select,
  Shell,
  Txt,
  uid,
} from "../components";
const newAttribute = (): Attribute => ({
  id: uid("attr"),
  code: "",
  name: "",
  active: true,
  values: [],
});
export function AttributesScreen() {
  const { state, send } = useAdmin();
  const [form, setForm] = useState(newAttribute);
  const [value, setValue] = useState("");
  const [query, setQuery] = useState("");
  const set = (v: Partial<Attribute>) => setForm({ ...form, ...v });
  return (
    <Shell title="الخصائص وقيمها" permission="attributes.write" branchId={null}>
      <Field label="بحث الخاصية" value={query} onChangeText={setQuery} />
      <Choices>
        <Choice
          label="خاصية جديدة"
          selected={!state.attributes.some((x) => x.id === form.id)}
          onPress={() => setForm(newAttribute())}
        />
        {state.attributes
          .filter((a) => a.name.includes(query) || a.code.includes(query))
          .map((a) => (
            <Choice
              key={a.id}
              label={a.name}
              selected={form.id === a.id}
              onPress={() => setForm(JSON.parse(JSON.stringify(a)))}
            />
          ))}
      </Choices>
      <Card>
        <Field
          label="اسم الخاصية *"
          value={form.name}
          onChangeText={(name) => set({ name })}
        />
        <Field
          label="مفتاح الخاصية *"
          value={form.code}
          onChangeText={(code) => set({ code })}
          autoCapitalize="none"
          placeholder="viscosity"
        />
        <Choice
          label="الخاصية نشطة"
          selected={form.active}
          onPress={() => set({ active: !form.active })}
        />
        <Hint>
          العلامة مثل اللزوجة والمقاس قائمة قيم مسجلة. لا تحذف القيم التاريخية؛
          أوقفها.
        </Hint>
        <Field label="قيمة جديدة" value={value} onChangeText={setValue} />
        <Action
          title="إضافة القيمة للقائمة"
          secondary
          disabled={!value.trim()}
          onPress={() => {
            if (value.trim()) {
              set({
                values: [
                  ...form.values,
                  {
                    id: uid("value"),
                    name: value.trim(),
                    active: true,
                    order: form.values.length + 1,
                  },
                ],
              });
              setValue("");
            }
          }}
        />
        {form.values.map((v, i) => (
          <Card key={v.id}>
            <Field
              label={`اسم القيمة ${i + 1}`}
              value={v.name}
              onChangeText={(name) =>
                set({
                  values: form.values.map((x) =>
                    x.id === v.id ? { ...x, name } : x,
                  ),
                })
              }
            />
            <Field
              label={`ترتيب القيمة ${i + 1}`}
              keyboardType="numeric"
              value={String(v.order)}
              onChangeText={(n) =>
                set({
                  values: form.values.map((x) =>
                    x.id === v.id ? { ...x, order: Number(n) } : x,
                  ),
                })
              }
            />
            <Choice
              label={`نشاط ${v.name}`}
              selected={v.active}
              onPress={() =>
                set({
                  values: form.values.map((x) =>
                    x.id === v.id ? { ...x, active: !x.active } : x,
                  ),
                })
              }
            />
          </Card>
        ))}
        <Save
          title="حفظ الخاصية وقيمها"
          onPress={() => send({ type: "attribute", value: form })}
        />
        <Action
          title="الانتقال إلى ربط القسم"
          secondary
          onPress={() => router.push("/categories")}
        />
      </Card>
    </Shell>
  );
}
const newCategory = (): Category => ({
  id: uid("category"),
  name: "",
  parentId: null,
  active: true,
  order: 1,
  image: fixtureImages[0]!,
  attributes: [],
});
export function CategoriesScreen() {
  const { state, send } = useAdmin();
  const [form, setForm] = useState(newCategory);
  const set = (v: Partial<Category>) => setForm({ ...form, ...v });
  return (
    <Shell title="الأقسام والفلاتر" permission="catalog.write" branchId={null}>
      <Choices>
        <Choice
          label="قسم جديد"
          selected={!state.categories.some((x) => x.id === form.id)}
          onPress={() => setForm(newCategory())}
        />
        {state.categories.map((a) => (
          <Choice
            key={a.id}
            label={a.name}
            selected={form.id === a.id}
            onPress={() => setForm(JSON.parse(JSON.stringify(a)))}
          />
        ))}
      </Choices>
      <Card>
        <Field
          label="اسم القسم *"
          value={form.name}
          onChangeText={(name) => set({ name })}
        />
        <Field
          label="ترتيب القسم"
          keyboardType="numeric"
          value={String(form.order)}
          onChangeText={(x) => set({ order: Number(x) })}
        />
        <Select
          label="القسم الأب"
          value={form.parentId ?? "none"}
          options={[
            { id: "none", name: "قسم رئيسي" },
            ...state.categories
              .filter((x) => x.id !== form.id)
              .map((x) => ({ id: x.id, name: x.name })),
          ]}
          onChange={(x) => set({ parentId: x === "none" ? null : x })}
        />
        <Select
          label="صورة القسم — رسم محلي"
          value={form.image}
          options={fixtureImages.map((x) => ({ id: x, name: x }))}
          onChange={(image) => set({ image })}
        />
        <Artwork label={form.image} />
        <Choice
          label="القسم نشط"
          selected={form.active}
          onPress={() => set({ active: !form.active })}
        />
        <Hint>
          لا توريث ضمني للفلاتر. إلزام خاصية جديدة يتطلب إكمال قيم المنتجات
          الحالية قبل تسعيرها.
        </Hint>
        {state.attributes
          .filter((a) => a.active)
          .map((a) => {
            const link = form.attributes.find((l) => l.attributeId === a.id);
            return (
              <Card key={a.id}>
                <Choice
                  label={`ربط ${a.name}`}
                  selected={!!link}
                  onPress={() =>
                    set({
                      attributes: link
                        ? form.attributes.filter((l) => l !== link)
                        : [
                            ...form.attributes,
                            {
                              attributeId: a.id,
                              required: false,
                              filterable: true,
                              order: form.attributes.length + 1,
                            },
                          ],
                    })
                  }
                />
                {link && (
                  <>
                    <Choice
                      label={`${a.name} مطلوبة`}
                      selected={link.required}
                      onPress={() =>
                        set({
                          attributes: form.attributes.map((l) =>
                            l === link ? { ...l, required: !l.required } : l,
                          ),
                        })
                      }
                    />
                    <Choice
                      label={`${a.name} في الفلاتر`}
                      selected={link.filterable}
                      onPress={() =>
                        set({
                          attributes: form.attributes.map((l) =>
                            l === link
                              ? { ...l, filterable: !l.filterable }
                              : l,
                          ),
                        })
                      }
                    />
                    <Field
                      label={`ترتيب فلتر ${a.name}`}
                      value={String(link.order)}
                      keyboardType="numeric"
                      onChangeText={(x) =>
                        set({
                          attributes: form.attributes.map((l) =>
                            l === link ? { ...l, order: Number(x) } : l,
                          ),
                        })
                      }
                    />
                  </>
                )}
              </Card>
            );
          })}
        <Save
          title="حفظ القسم وفلاتره"
          onPress={() => send({ type: "category", value: form })}
        />
        <Action
          title="الانتقال إلى المنتجات"
          secondary
          onPress={() => router.push("/products")}
        />
      </Card>
    </Shell>
  );
}
const newProduct = (): Product => ({
  id: uid("product"),
  sku: "",
  name: "",
  description: "",
  origin: "",
  categoryId: "oil",
  active: true,
  images: [],
  values: {},
  units: [
    {
      id: uid("unit"),
      kind: "piece",
      pieces: 1,
      price: 0,
      active: true,
      used: false,
    },
  ],
  branchPrices: {},
});
export function ProductsScreen() {
  const { state, send } = useAdmin();
  const [form, setForm] = useState(newProduct);
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("aden");
  const set = (v: Partial<Product>) => setForm({ ...form, ...v });
  const category = state.categories.find((c) => c.id === form.categoryId);
  return (
    <Shell title="المنتجات والوحدات" permission="catalog.write" branchId={null}>
      <Field label="بحث اسم أو SKU" value={query} onChangeText={setQuery} />
      <Choices>
        <Choice
          label="منتج جديد"
          selected={!state.products.some((x) => x.id === form.id)}
          onPress={() => setForm(newProduct())}
        />
        {state.products
          .filter((x) => `${x.name} ${x.sku}`.includes(query))
          .map((p) => (
            <Choice
              key={p.id}
              label={p.name}
              selected={form.id === p.id}
              onPress={() => setForm(JSON.parse(JSON.stringify(p)))}
            />
          ))}
      </Choices>
      <Card>
        <Field
          label="اسم المنتج *"
          value={form.name}
          onChangeText={(name) => set({ name })}
        />
        <Field
          label="SKU ثابت *"
          editable={!state.products.some((p) => p.id === form.id)}
          value={form.sku}
          onChangeText={(sku) => set({ sku })}
          autoCapitalize="none"
        />
        <Field
          label="وصف المنتج *"
          multiline
          value={form.description}
          onChangeText={(description) => set({ description })}
        />
        <Field
          label="بلد المنشأ *"
          value={form.origin}
          onChangeText={(origin) => set({ origin })}
        />
        <Select
          label="قسم المنتج"
          value={form.categoryId}
          options={state.categories
            .filter((c) => c.active)
            .map((c) => ({ id: c.id, name: c.name }))}
          onChange={(categoryId) => set({ categoryId, values: {} })}
        />
        {category?.attributes
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((link) => {
            const a = state.attributes.find((x) => x.id === link.attributeId)!;
            return (
              <Select
                key={a.id}
                label={`${a.name}${link.required ? " *" : ""}`}
                value={form.values[a.id] ?? ""}
                options={[
                  { id: "", name: "اختر قيمة مسجلة" },
                  ...a.values
                    .filter((v) => v.active)
                    .map((v) => ({ id: v.id, name: v.name })),
                ]}
                onChange={(id) =>
                  set({ values: { ...form.values, [a.id]: id } })
                }
              />
            );
          })}
        <Choice
          label="المنتج نشط"
          selected={form.active}
          onPress={() => set({ active: !form.active })}
        />
        <Txt weight="bold">صور محلية توضيحية1–3</Txt>
        <Hint>اختيار رسوم محلية للمعاينة؛ لا صور متجر أو رفع R2.</Hint>
        <Choices>
          {fixtureImages.map((image) => (
            <Choice
              key={image}
              label={image}
              selected={form.images.includes(image)}
              onPress={() =>
                set({
                  images: form.images.includes(image)
                    ? form.images.filter((x) => x !== image)
                    : [...form.images, image],
                })
              }
            />
          ))}
        </Choices>
        {form.images.map((image) => (
          <Artwork key={image} label={image} />
        ))}
        <Txt weight="bold">وحدات البيع وأسعارها المستقلة</Txt>
        <Hint warning>
          الوحدة المستخدمة معاملها ثابت. أوقفها وأنشئ وحدة بديلة؛ سعر الكرتون
          مستقل عن سعر الحبة.
        </Hint>
        {form.units.map((u, i) => (
          <Card key={u.id}>
            <Txt weight="bold">
              {u.kind === "piece" ? "حبة" : "كرتون"} {i + 1} ·{" "}
              {u.used ? "مستخدمة سابقًا" : "جديدة"}
            </Txt>
            <Field
              label={`معامل الوحدة ${i + 1}`}
              keyboardType="numeric"
              value={String(u.pieces)}
              editable={!u.used && u.kind !== "piece"}
              onChangeText={(x) =>
                set({
                  units: form.units.map((v) =>
                    v.id === u.id ? { ...v, pieces: Number(x) } : v,
                  ),
                })
              }
            />
            <Field
              label={`سعر الوحدة ${i + 1} بالريال`}
              keyboardType="numeric"
              value={String(u.price)}
              onChangeText={(x) =>
                set({
                  units: form.units.map((v) =>
                    v.id === u.id ? { ...v, price: Number(x) } : v,
                  ),
                })
              }
            />
            <Choice
              label={`وحدة ${i + 1} نشطة`}
              selected={u.active}
              onPress={() =>
                set({
                  units: form.units.map((v) =>
                    v.id === u.id ? { ...v, active: !v.active } : v,
                  ),
                })
              }
            />
          </Card>
        ))}
        <Action
          title="إضافة وحدة كرتون بديلة"
          secondary
          onPress={() =>
            set({
              units: [
                ...form.units,
                {
                  id: uid("unit"),
                  kind: "carton",
                  pieces: 12,
                  price: 0,
                  active: true,
                  used: false,
                },
              ],
            })
          }
        />
        <Select
          label="أسعار فرع اختيارية"
          value={branch}
          options={state.branches.map((b) => ({ id: b.id, name: b.name }))}
          onChange={setBranch}
        />
        {form.units.map((u, i) => (
          <Field
            key={u.id}
            label={`سعر الفرع للوحدة ${i + 1} — فارغ للأساسي`}
            keyboardType="numeric"
            value={
              form.branchPrices[branch]?.[u.id] === undefined
                ? ""
                : String(form.branchPrices[branch]?.[u.id])
            }
            onChangeText={(x) => {
              const prices = { ...form.branchPrices[branch] };
              if (x === "") delete prices[u.id];
              else prices[u.id] = Number(x);
              set({ branchPrices: { ...form.branchPrices, [branch]: prices } });
            }}
          />
        ))}
        <Save
          title="حفظ المنتج والوحدات"
          onPress={() => send({ type: "product", value: form })}
        />
        <Action
          title="فتح مخزون الفروع"
          secondary
          onPress={() => router.push("/inventory")}
        />
      </Card>
    </Shell>
  );
}
