import { z } from "zod";
import { id, money, text } from "../catalog/contracts.js";
export const preview = z.strictObject({
  governorateId: id,
  addressId: id,
  kind: z.enum(["retail", "wholesale"]),
  items: z
    .array(
      z.strictObject({
        unitId: id,
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (a) => new Set(a.map((i) => i.unitId)).size === a.length,
      "الوحدة مكررة",
    ),
});
export const promotion = z
  .strictObject({
    name_ar: text,
    governorate_id: id.nullable().default(null),
    category_id: id.nullable().default(null),
    product_id: id.nullable().default(null),
    target: z.enum(["products", "delivery"]),
    discount_kind: z.enum(["fixed", "percent"]),
    value: money,
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    active: z.boolean().default(true),
  })
  .refine(
    (v) => Date.parse(v.ends_at) > Date.parse(v.starts_at),
    "نهاية العرض بعد بدايته",
  )
  .refine(
    (v) => v.discount_kind !== "percent" || BigInt(v.value) <= 10000n,
    "النسبة بنقاط الأساس من0 إلى10000",
  )
  .refine((v) => !v.category_id || !v.product_id, "اختر نطاق القسم أو المنتج");
