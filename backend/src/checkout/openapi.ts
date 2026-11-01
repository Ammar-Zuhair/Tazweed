import { z } from "zod";
import { preview, promotion } from "./contracts.js";
const money = z.string().regex(/^(0|[1-9][0-9]*)$/),
  id = z.uuid();
const line = z.object({
  unitId: id,
  productId: id,
  categoryId: id,
  name_ar: z.string(),
  productVersion: z.number().int(),
  unitKind: z.enum(["piece", "carton"]),
  piecesPerUnit: z.number().int().positive(),
  quantity: z.number().int().positive(),
  unitPriceYer: money,
  lineTotalYer: money,
});
const selected = z.object({
  id,
  name_ar: z.string(),
  target: z.enum(["products", "delivery"]),
  discount_kind: z.enum(["fixed", "percent"]),
  value: money,
  eligible_base_yer: money,
  saving_yer: money,
});
export const previewResponse = z.object({
  source: z.literal("backend"),
  previewOnly: z.literal(true),
  reservationCreated: z.literal(false),
  executionBranchId: z.null(),
  reviewStage: z.literal("awaiting_branch"),
  catalogBranchId: id,
  governorateId: id,
  addressId: id,
  kind: z.enum(["retail", "wholesale"]),
  calculatedAt: z.iso.datetime(),
  pricingMode: z.enum(["retail_estimate", "wholesale_reference"]),
  items: z.array(line),
  delivery: z
    .object({
      status: z.enum(["estimated", "review_required", "outside_coverage"]),
      reason: z.string().nullable(),
      pricingMode: z.enum(["road"]).nullable(),
      fee_yer: money.nullable(),
      route: z
        .object({
          geometry: z.object({
            type: z.literal("LineString"),
            coordinates: z.array(z.array(z.number())),
          }),
          duration_seconds: z.number(),
        })
        .nullable(),
      snapshot: z.record(z.string(), z.unknown()).nullable(),
    })
    .loose(),
  promotion: selected.nullable(),
  promotionSelection: z.enum([
    "excluded_wholesale",
    "pending_delivery",
    "greatest_saving_id_asc",
  ]),
  estimatedTotals: z.object({
    subtotal_yer: money,
    product_discount_yer: money,
    delivery_before_discount_yer: money.nullable(),
    delivery_discount_yer: money,
    delivery_customer_yer: money.nullable(),
    total_yer: money.nullable(),
  }),
  notice: z.string(),
});
export function addCheckoutOpenapi(doc: any) {
  const add = (
    method: string,
    path: string,
    body?: z.ZodType,
    response: z.ZodType = z.object({}).loose(),
    auth = false,
  ) => {
    const params: any[] = [];
    if (auth)
      params.push({
        in: "header",
        name: "X-Client-App",
        required: true,
        schema: { enum: ["customer", "admin"] },
      });
    if (path.endsWith("{id}"))
      params.push({
        in: "path",
        name: "id",
        required: true,
        schema: { type: "string", format: "uuid" },
      });
    if (
      ["/catalog/promotions", "/delivery/catalog-context"].some((v) =>
        path.endsWith(v),
      )
    )
      params.push({
        in: "query",
        name: "governorateId",
        required: true,
        schema: { type: "string", format: "uuid" },
      });
    if (path.includes("promotions") && method === "get")
      params.push(
        {
          in: "query",
          name: "cursor",
          schema: { type: "string", format: "uuid" },
        },
        {
          in: "query",
          name: "limit",
          schema: { type: "integer", minimum: 1, maximum: 100 },
        },
      );
    doc.paths[path] ??= {};
    doc.paths[path][method] = {
      tags: ["Phase07"],
      summary: path,
      parameters: params,
      ...(auth ? { security: [{ bearerAuth: [] }] } : {}),
      ...(body
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: z.toJSONSchema(body, {
                    io: "input",
                    unrepresentable: "any",
                  }),
                },
              },
            },
          }
        : {}),
      responses: {
        [method === "post" && path.includes("/admin/") ? 201 : 200]: {
          description:
            "Server-only authoritative calculation; checkout preview creates no reservation, quote, or order",
          content: {
            "application/json": {
              schema: z.toJSONSchema(response, { unrepresentable: "any" }),
            },
          },
        },
        ...Object.fromEntries(
          [401, 403, 404, 409, 422, 429, 503].map((n) => [
            n,
            {
              description: "Rejected or unavailable",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          ]),
        ),
      },
    };
  };
  add("post", "/api/v1/checkout/preview", preview, previewResponse, true);
  for (const path of [
    "/public/maps",
    "/delivery/catalog-context",
    "/catalog/promotions",
  ])
    add("get", "/api/v1" + path);
  add("get", "/api/v1/admin/promotions", undefined, undefined, true);
  add("post", "/api/v1/admin/promotions", promotion, undefined, true);
  add("put", "/api/v1/admin/promotions/{id}", promotion, undefined, true);
  doc.info.version = "0.7.0";
  doc.info.title = "Tazweed identity, catalog, maps and checkout preview";
  doc.info.description =
    "Phase07: owned addresses, MapLibre public display config, server routing adapter, floor_km fees and one greatest-saving promotion. Preview is read-only; phase08 order submission/quotes are deferred. Real providers require owner configuration and requested verification.";
  return doc;
}
