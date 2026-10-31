import { useState } from "react";
import { useAdmin } from "../../data/admin-provider";
import { bestPromotion, money } from "../../domain/admin-model";
import type { Banner, Campaign, Promotion } from "../../domain/types";
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
  stamp,
  uid,
  useConfirm,
} from "../components";
const dates = () => [
  new Date().toISOString().slice(0, 16) + "Z",
  new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16) + "Z",
];
const freshPromo = (): Promotion => ({
  id: uid("promo"),
  name: "",
  target: "products",
  discountKind: "fixed",
  value: 0,
  branchId: null,
  categoryId: null,
  productId: null,
  startsAt: 0,
  endsAt: 0,
  active: true,
});
const freshBanner = (): Banner => ({
  id: uid("banner"),
  title: "",
  image: fixtureImages[0]!,
  branchId: null,
  categoryId: null,
  productId: null,
  active: true,
  order: 1,
  startsAt: 0,
  endsAt: 0,
});
export function MarketingScreen() {
  const { state, send } = useAdmin();
  const [promo, setPromo] = useState<Promotion>(freshPromo);
  const [banner, setBanner] = useState<Banner>(freshBanner);
  const [start, setStart] = useState(dates()[0]!);
  const [end, setEnd] = useState(dates()[1]!);
  const [bannerStart, setBannerStart] = useState(dates()[0]!);
  const [bannerEnd, setBannerEnd] = useState(dates()[1]!);
  const sample = state.orders[1]!;
  const picked = bestPromotion(state, "aden", sample.items, 500, "retail");
  return (
    <Shell
      title="العروض والبنرات"
      permission="promotions.write"
      branchId={null}
    >
      <Hint>
        عرض واحد بأكبر توفير؛ التعادل بالمعرف. لا جمع خصم المنتجات والتوصيل من
        عرضين، ولا عروض تجزئة تلقائية على الجملة.
      </Hint>
      <Card>
        <Txt weight="bold">العروض</Txt>
        <Choices>
          <Choice
            label="عرض جديد"
            selected={!state.promotions.some((p) => p.id === promo.id)}
            onPress={() => {
              setPromo(freshPromo());
              setStart(dates()[0]!);
              setEnd(dates()[1]!);
            }}
          />
          {state.promotions.map((p) => (
            <Choice
              key={p.id}
              label={p.name}
              selected={p.id === promo.id}
              onPress={() => {
                setPromo({ ...p });
                setStart(new Date(p.startsAt).toISOString());
                setEnd(new Date(p.endsAt).toISOString());
              }}
            />
          ))}
        </Choices>
        <Field
          label="اسم العرض *"
          value={promo.name}
          onChangeText={(name) => setPromo({ ...promo, name })}
        />
        <Select
          label="هدف الخصم"
          value={promo.target}
          options={[
            { id: "products", name: "المنتجات" },
            { id: "delivery", name: "التوصيل" },
          ]}
          onChange={(target) => setPromo({ ...promo, target })}
        />
        <Select
          label="نوع الخصم"
          value={promo.discountKind}
          options={[
            { id: "fixed", name: "مبلغ ثابت" },
            { id: "percent", name: "نسبة bps" },
          ]}
          onChange={(discountKind) => setPromo({ ...promo, discountKind })}
        />
        <Field
          label="قيمة الخصم — ريال أو bps"
          keyboardType="numeric"
          value={String(promo.value)}
          onChangeText={(v) => setPromo({ ...promo, value: Number(v) })}
        />
        <Select
          label="فرع العرض"
          value={promo.branchId ?? "all"}
          options={[
            { id: "all", name: "كل الفروع" },
            ...state.branches.map((b) => ({ id: b.id, name: b.name })),
          ]}
          onChange={(b) =>
            setPromo({ ...promo, branchId: b === "all" ? null : b })
          }
        />
        <Select
          label="قسم العرض الاختياري"
          value={promo.categoryId ?? "all"}
          options={[
            { id: "all", name: "كل الأقسام" },
            ...state.categories.map((c) => ({ id: c.id, name: c.name })),
          ]}
          onChange={(c) =>
            setPromo({
              ...promo,
              categoryId: c === "all" ? null : c,
              productId: null,
            })
          }
        />
        <Select
          label="منتج العرض الاختياري"
          value={promo.productId ?? "all"}
          options={[
            { id: "all", name: "كل المنتجات" },
            ...state.products.map((p) => ({ id: p.id, name: p.name })),
          ]}
          onChange={(p) =>
            setPromo({
              ...promo,
              productId: p === "all" ? null : p,
              categoryId: null,
            })
          }
        />
        <Field
          label="بداية العرض UTC *"
          value={start}
          onChangeText={setStart}
        />
        <Field label="نهاية العرض UTC *" value={end} onChangeText={setEnd} />
        <Choice
          label="العرض نشط"
          selected={promo.active}
          onPress={() => setPromo({ ...promo, active: !promo.active })}
        />
        <Save
          title="حفظ العرض"
          onPress={() =>
            send({
              type: "promotion",
              value: {
                ...promo,
                startsAt: Date.parse(start),
                endsAt: Date.parse(end),
              },
            })
          }
        />
        <Hint>
          عينة تجزئة فرع عدن: العرض المختار{" "}
          {state.promotions.find((p) => p.id === picked.id)?.name ?? "لا عرض"} ·
          توفير {money(picked.productDiscount + picked.deliveryDiscount)}. عينة
          الجملة: لا عرض تلقائي.
        </Hint>
      </Card>
      <Card>
        <Txt weight="bold">البنرات ومعاينة الثيم الحالي</Txt>
        <Choices>
          <Choice
            label="بنر جديد"
            selected={!state.banners.some((b) => b.id === banner.id)}
            onPress={() => setBanner(freshBanner())}
          />
          {state.banners.map((b) => (
            <Choice
              key={b.id}
              label={b.title}
              selected={b.id === banner.id}
              onPress={() => {
                setBanner({ ...b });
                setBannerStart(new Date(b.startsAt).toISOString());
                setBannerEnd(new Date(b.endsAt).toISOString());
              }}
            />
          ))}
        </Choices>
        <Field
          label="عنوان البنر *"
          value={banner.title}
          onChangeText={(title) => setBanner({ ...banner, title })}
        />
        <Select
          label="رسم البنر المحلي"
          value={banner.image}
          options={fixtureImages.map((x) => ({ id: x, name: x }))}
          onChange={(image) => setBanner({ ...banner, image })}
        />
        <Artwork label={banner.image} large />
        <Txt weight="bold">{banner.title || "معاينة عنوان البنر"}</Txt>
        <Select
          label="نطاق البنر"
          value={banner.branchId ?? "all"}
          options={[
            { id: "all", name: "كل الفروع" },
            ...state.branches.map((b) => ({ id: b.id, name: b.name })),
          ]}
          onChange={(b) =>
            setBanner({ ...banner, branchId: b === "all" ? null : b })
          }
        />
        <Select
          label="وجهة البنر — قسم"
          value={banner.categoryId ?? "none"}
          options={[
            { id: "none", name: "دون قسم" },
            ...state.categories.map((c) => ({ id: c.id, name: c.name })),
          ]}
          onChange={(c) =>
            setBanner({
              ...banner,
              categoryId: c === "none" ? null : c,
              productId: null,
            })
          }
        />
        <Select
          label="وجهة البنر — منتج"
          value={banner.productId ?? "none"}
          options={[
            { id: "none", name: "دون منتج" },
            ...state.products.map((p) => ({ id: p.id, name: p.name })),
          ]}
          onChange={(p) =>
            setBanner({
              ...banner,
              productId: p === "none" ? null : p,
              categoryId: null,
            })
          }
        />
        <Field
          label="ترتيب البنر"
          keyboardType="numeric"
          value={String(banner.order)}
          onChangeText={(v) => setBanner({ ...banner, order: Number(v) })}
        />
        <Field
          label="بداية البنر UTC"
          value={bannerStart}
          onChangeText={setBannerStart}
        />
        <Field
          label="نهاية البنر UTC"
          value={bannerEnd}
          onChangeText={setBannerEnd}
        />
        <Choice
          label="البنر نشط"
          selected={banner.active}
          onPress={() => setBanner({ ...banner, active: !banner.active })}
        />
        <Save
          title="حفظ البنر"
          onPress={() =>
            send({
              type: "banner",
              value: {
                ...banner,
                startsAt: Date.parse(bannerStart),
                endsAt: Date.parse(bannerEnd),
              },
            })
          }
        />
      </Card>
    </Shell>
  );
}
export function CampaignsScreen() {
  const { state } = useAdmin();
  const [form, setForm] = useState<Campaign>({
    id: uid("campaign"),
    title: "",
    body: "",
    branchId: null,
    audience: "customers",
    scheduledAt: 0,
    status: "draft",
  });
  const [when, setWhen] = useState(
    new Date(Date.now() + 86400000).toISOString(),
  );
  const confirm = useConfirm();
  return (
    <Shell
      title="الرسائل والبث"
      permission="notifications.broadcast"
      branchId={null}
    >
      <Hint warning>
        معاينة محلية ومخطط جدولة فقط. لا Push أو outbox أو عامل خلفية أو إرسال
        إلى مستخدمين حقيقيين.
      </Hint>
      <Card>
        <Choices>
          <Choice
            label="حملة جديدة"
            selected={!state.campaigns.some((c) => c.id === form.id)}
            onPress={() =>
              setForm({
                id: uid("campaign"),
                title: "",
                body: "",
                branchId: null,
                audience: "customers",
                scheduledAt: 0,
                status: "draft",
              })
            }
          />
          {state.campaigns.map((c) => (
            <Choice
              key={c.id}
              label={c.title}
              selected={c.id === form.id}
              onPress={() => {
                setForm({ ...c });
                setWhen(new Date(c.scheduledAt || state.now).toISOString());
              }}
            />
          ))}
        </Choices>
        <Field
          label="عنوان الرسالة *"
          value={form.title}
          onChangeText={(title) => setForm({ ...form, title })}
        />
        <Field
          label="نص الرسالة *"
          multiline
          value={form.body}
          onChangeText={(body) => setForm({ ...form, body })}
        />
        <Select
          label="جمهور الرسالة"
          value={form.audience}
          options={[
            { id: "all", name: "كل المستخدمين" },
            { id: "customers", name: "العملاء" },
            { id: "couriers", name: "الموصلون" },
          ]}
          onChange={(audience) => setForm({ ...form, audience })}
        />
        <Select
          label="استهداف الفرع"
          value={form.branchId ?? "all"}
          options={[
            { id: "all", name: "كل الفروع" },
            ...state.branches.map((b) => ({ id: b.id, name: b.name })),
          ]}
          onChange={(b) =>
            setForm({ ...form, branchId: b === "all" ? null : b })
          }
        />
        <Field label="موعد البث UTC" value={when} onChangeText={setWhen} />
        <Select
          label="حالة الحملة المحلية"
          value={form.status}
          options={[
            { id: "draft", name: "مسودة" },
            { id: "scheduled_local", name: "جدولة تجريبية دون إرسال" },
            { id: "cancelled", name: "ملغاة" },
          ]}
          onChange={(status) => setForm({ ...form, status })}
        />
        <Card>
          <Txt weight="bold">{form.title || "معاينة عنوان الإشعار"}</Txt>
          <Txt>{form.body || "سيظهر المحتوى هنا حسب الثيم الحالي."}</Txt>
          <Txt style={{ fontSize: 12 }}>معاينة محتوى · لا إشعار مرسل</Txt>
        </Card>
        <Save
          title="مراجعة حفظ الحملة"
          onPress={() =>
            confirm.ask(
              "حفظ حملة محلية",
              `${form.title} · ${form.audience} · ${form.status} · لا إرسال حقيقي.`,
              {
                type: "campaign",
                value: { ...form, scheduledAt: Date.parse(when) },
                confirmed: true,
              },
            )
          }
        />
      </Card>
      {confirm.dialog}
    </Shell>
  );
}
