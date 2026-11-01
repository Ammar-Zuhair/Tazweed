import { z } from "zod";
export const id = z.uuid();
export const text = z.string().trim().min(1).max(200);
export const money = z.string().regex(/^(0|[1-9][0-9]{0,14})$/);
export const page = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: id.optional(),
});
export const governorate = z.strictObject({
  name_ar: text,
  active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
  catalog_branch_id: id.nullable().default(null),
});
export const branch = z.strictObject({
  governorate_id: id,
  name_ar: text,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  coverage_radius_m: z.number().int().positive().nullable().default(null),
  active: z.boolean().default(true),
});
export const category = z.strictObject({
  name_ar: text,
  parent_id: id.nullable().default(null),
  image_id: id.nullable().default(null),
  active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});
export const attribute = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,49}$/),
  name_ar: text,
  active: z.boolean().default(true),
});
export const value = z.strictObject({
  attribute_id: id,
  value_ar: text,
  active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});
export const categoryAttributes = z.strictObject({
  items: z
    .array(
      z.strictObject({
        attribute_id: id,
        required: z.boolean(),
        filterable: z.boolean(),
        sort_order: z.number().int(),
      }),
    )
    .max(40),
});
export const product = z.strictObject({
  sku: z.string().trim().min(1).max(80),
  category_id: id,
  name_ar: text,
  description_ar: z.string().max(5000).default(""),
  origin_country: z.string().max(100).nullable().default(null),
  active: z.boolean().default(true),
  attributes: z
    .array(z.strictObject({ attribute_id: id, value_id: id }))
    .max(40),
  image_ids: z.array(id).max(6).default([]),
  expected_version: z.number().int().positive().optional(),
});
export const unit = z
  .strictObject({
    unit_kind: z.enum(["piece", "carton"]),
    pieces_per_unit: z.number().int().min(1).max(100000),
    price_yer: money,
    active: z.boolean().default(true),
  })
  .refine((v) =>
    v.unit_kind === "piece" ? v.pieces_per_unit === 1 : v.pieces_per_unit > 1,
  );
export const price = z.strictObject({
  branch_id: id,
  unit_id: id,
  price_yer: money,
  active: z.boolean().default(true),
});
export const stock = z.strictObject({
  branch_id: id,
  product_id: id,
  unit_id: id,
  quantity: z
    .number()
    .int()
    .min(-10000000)
    .max(10000000)
    .refine((n) => n !== 0),
  reason: z.enum(["receipt", "adjustment"]),
  note: text,
});
export const transfer = z
  .strictObject({
    from_branch_id: id,
    to_branch_id: id,
    reason: text,
    items: z
      .array(
        z.strictObject({
          product_id: id,
          unit_id: id,
          quantity: z.number().int().positive().max(10000000),
        }),
      )
      .min(1)
      .max(50),
  })
  .refine(
    (v) =>
      v.from_branch_id !== v.to_branch_id &&
      new Set(v.items.map((i) => i.product_id)).size === v.items.length,
  );
export const listProducts = page.extend({
  governorateId: id,
  categoryId: id.optional(),
  search: z.string().trim().max(100).default(""),
  attributeValueIds: z.string().max(1500).default(""),
});
export const upload = z.strictObject({
  purpose: z.enum([
    "product",
    "category",
    "banner",
    "receipt",
    "complaint",
    "customer_flag",
    "report",
  ]),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z
    .number()
    .int()
    .positive()
    .max(8 * 1024 * 1024),
});
