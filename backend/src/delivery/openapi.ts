import { z } from "zod";
import * as c from "./contracts.js";
const row = z.object({ id: z.uuid() }).loose();
const signed = z.string().regex(/^-?(0|[1-9][0-9]*)$/),
  amount = z.string().regex(/^(0|[1-9][0-9]*)$/);
const result = row.extend({ version: z.number().int().positive().optional() });
const ledger = z.object({
  todayEarnedYer: signed,
  dayBasis: z.literal("UTC"),
  source: z.literal("backend"),
  kind: z.enum(["cash", "commission"]),
  courierId: z.uuid(),
  totalYer: signed,
  reversedYer: amount,
  paidYer: amount,
  balanceYer: signed,
  sources: z.array(
    row.extend({ amount_yer: signed, allocated_to: z.uuid().nullable() }),
  ),
  credits: z.array(
    row.extend({ amount_yer: amount, allocated_to: z.uuid().nullable() }),
  ),
  payouts: z.array(
    row.extend({
      total_yer: amount,
      allocations: z.array(
        z.object({
          sourceId: z.uuid().nullable(),
          reversalCreditId: z.uuid().nullable(),
        }),
      ),
    }),
  ),
});
const detail = z.object({
  source: z.literal("backend"),
  order: row.extend({
    order_number: amount,
    status: z.enum(["confirmed", "on_the_way", "delivered"]),
    version: z.number().int().positive(),
    payment_kind: z.enum(["transfer", "cash_on_delivery"]),
    delivered_at: z.string().nullable(),
  }),
  assignment: row.extend({
    commission_bps: z.number().int(),
    commission_yer: amount,
    delivery_fee_before_discount_yer: amount,
    delivery_discount_yer: amount,
    customer_delivery_yer: amount,
  }),
  branch: row.extend({ name: z.string() }),
  privateDetails: z
    .object({
      address_snapshot: z.record(z.string(), z.unknown()),
      contact_snapshot: z.record(z.string(), z.unknown()),
    })
    .nullable(),
  items: z.array(
    z.object({
      name_snapshot: z.string(),
      unit_snapshot: z.string(),
      quantity: z.number().int().positive(),
      pieces_per_unit: z.number().int().positive(),
    }),
  ),
  totalYer: amount,
  cashCollectedYer: signed,
  cashExternalReceivedYer: amount,
  cashRefundedYer: amount,
  cashWrittenOffYer: amount,
  cashDueYer: signed,
  collections: z.array(row),
  exceptions: z.array(row),
  allowedActions: z.array(z.string()),
});
const list = z.object({
  items: z.array(row),
  nextCursor: z.uuid().nullable(),
  source: z.literal("backend"),
});
export function addDeliveryOpenapi(doc: any) {
  function add(
    method: string,
    path: string,
    body?: z.ZodType,
    response: z.ZodType = result,
  ) {
    const json = (v: z.ZodType) =>
      z.toJSONSchema(v, { io: "input", unrepresentable: "any" });
    const parameters: any[] = [
      {
        in: "header",
        name: "X-Client-App",
        required: true,
        schema: {
          enum: [
            path.startsWith("/courier")
              ? "courier"
              : path.startsWith("/admin")
                ? "admin"
                : "customer",
          ],
        },
      },
    ];
    for (const m of path.matchAll(/\{(\w+)\}/g))
      parameters.push({
        in: "path",
        name: m[1],
        required: true,
        schema: { type: "string", format: "uuid" },
      });
    if (method !== "get")
      parameters.push({
        in: "header",
        name: "Idempotency-Key",
        required: true,
        schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,100}$" },
      });
    const error = {
      description: "Rejected without a partial financial write",
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/Error" } },
      },
    };
    doc.paths["/api/v1" + path] ??= {};
    doc.paths["/api/v1" + path][method] = {
      summary: "Phase09 " + method + " " + path,
      security: [{ bearerAuth: [] }],
      parameters,
      ...(body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: json(body) } },
            },
          }
        : {}),
      responses: {
        200: {
          description: "Authoritative backend result",
          content: { "application/json": { schema: json(response) } },
        },
        ...Object.fromEntries(
          [400, 401, 403, 404, 409, 413, 422, 429, 500, 503].map((n) => [
            n,
            error,
          ]),
        ),
      },
    };
  }
  add("get", "/courier/orders", undefined, list);
  add("get", "/courier/orders/{id}", undefined, detail);
  for (const [path, schema] of [
    ["start", c.start],
    ["deliver", c.deliver],
    ["cash-collections", c.collect],
    ["cash-exceptions", c.cashException],
    ["customer-flags", c.flag],
  ] as const)
    add("post", "/courier/orders/{id}/" + path, schema);
  add("post", "/admin/orders/{id}/assign", c.assign);
  add(
    "get",
    "/admin/orders/{id}/courier-options",
    undefined,
    z.object({ items: z.array(row) }),
  );
  for (const path of ["earnings", "cash-balance"]) {
    add("get", "/courier/" + path, undefined, ledger);
    add("get", "/admin/couriers/{id}/" + path, undefined, ledger);
  }
  for (const path of ["settlements", "cash-remittances"]) {
    add("post", "/admin/" + path, c.allocation);
    add("post", "/admin/" + path + "/{id}/reversals", c.reverse);
  }
  add("post", "/admin/cash-collections/{id}/adjustments", c.adjust);
  add(
    "get",
    "/admin/couriers/ledger-options",
    undefined,
    z.object({ items: z.array(row) }),
  );
  add("get", "/admin/couriers", undefined, list);
  add("post", "/admin/couriers", c.profile);
  add("post", "/admin/couriers/{id}/configure", c.configure);
  add("get", "/admin/couriers/{id}/configuration-history", undefined, list);
  add("post", "/orders/{id}/review", c.review);
  add("post", "/orders/{id}/complaints", c.complaint);
  add("post", "/admin/customer-flags", c.adminFlag);
  for (const [path, schema] of [
    ["customer-flags", c.flagUpdate],
    ["complaints", c.complaintUpdate],
  ] as const) {
    add("get", "/admin/" + path, undefined, list);
    add("post", "/admin/" + path + "/{id}/review", schema);
  }
  add(
    "get",
    "/admin/reviews",
    undefined,
    z.object({
      items: z.array(
        z
          .object({
            order_id: z.uuid(),
            rating: z.number().int().min(1).max(5),
          })
          .loose(),
      ),
      nextCursor: z.uuid().nullable(),
      source: z.literal("backend"),
    }),
  );
  for (const path of [
    "/courier/orders",
    "/admin/couriers",
    "/admin/customer-flags",
    "/admin/complaints",
    "/admin/reviews",
    "/admin/couriers/{id}/configuration-history",
  ]) {
    doc.paths["/api/v1" + path].get.parameters.push(
      {
        in: "query",
        name: "cursor",
        schema: { type: "string", format: "uuid" },
      },
      {
        in: "query",
        name: "limit",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 30 },
      },
    );
  }
  doc.paths["/api/v1/admin/couriers/ledger-options"].get.parameters.push({
    in: "query",
    name: "kind",
    required: true,
    schema: { type: "string", enum: ["cash", "commission"] },
  });
  doc.info = {
    title:
      "Tazweed Phase09 delivery, independent cash and commissions, quality",
    version: "0.9.0",
    description:
      "PostgreSQL transactions and scoped authorization. Commission before discount frozen at dispatch and earned once at delivery. Cash is explicitly recorded. Original allocations and reversal credits are retained. Real providers and devices await the owner.",
  };
  return doc;
}
